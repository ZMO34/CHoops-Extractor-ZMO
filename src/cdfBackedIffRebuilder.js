const path = require('path');
const fs = require('fs/promises');

const ddsUtil = require('./ddsUtil');
const cdfBackedIffExtractor = require('./cdfBackedIffExtractor');
const h7aCompressionUtil = require('../2k-tools/src/util/h7aCompressionUtil');

function safeName(value) {
    return String(value || 'record').replace(/[<>:"/\\|?*]/g, '_');
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch (err) {
        return false;
    }
}

function readUInt32BE(buffer, offset, fallback = null) {
    if (!buffer || offset < 0 || offset + 4 > buffer.length) return fallback;
    return buffer.readUInt32BE(offset);
}

async function readJsonIfExists(filePath) {
    if (!await pathExists(filePath)) return null;
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

function getH7aOptionsFromManifest(manifest) {
    return {
        shiftAmount: manifest && manifest.h7a && manifest.h7a.shiftAmount ? manifest.h7a.shiftAmount : 0x8,
        unknown0C: manifest && manifest.h7a && Number.isInteger(manifest.h7a.unknown0C) ? manifest.h7a.unknown0C : 0
    };
}

function validateDdsForManifest(recordName, dds, manifest) {
    if (!manifest || !manifest.ddsLayout) return;

    const expected = manifest.ddsLayout;
    if (dds.width !== expected.width || dds.height !== expected.height || dds.mipMapCount !== expected.mipMapCount) {
        throw new Error(
            `${recordName}.dds layout mismatch. `
            + `Expected ${expected.width}x${expected.height} mips=${expected.mipMapCount}, `
            + `got ${dds.width}x${dds.height} mips=${dds.mipMapCount}.`
        );
    }

    if (String(dds.fourCC).trim() !== String(expected.format).trim()) {
        throw new Error(
            `${recordName}.dds format mismatch. Expected ${expected.format}, got ${dds.fourCC}.`
        );
    }

    const expectedPayloadSize = ddsUtil.payloadSizeFor(expected.width, expected.height, expected.format, expected.mipMapCount);
    if (dds.payload.length !== expectedPayloadSize) {
        throw new Error(
            `${recordName}.dds payload size mismatch. Expected 0x${expectedPayloadSize.toString(16)}, `
            + `got 0x${dds.payload.length.toString(16)}.`
        );
    }
}

async function buildH7aPayloadFromDds(recordDir, recordName, originalPayload) {
    const ddsPath = path.join(recordDir, `${safeName(recordName)}.dds`);
    if (!await pathExists(ddsPath)) return originalPayload;

    const manifestPath = path.join(recordDir, `${safeName(recordName)}.texture_manifest.json`);
    const manifest = await readJsonIfExists(manifestPath);
    const dds = ddsUtil.parseDds(await fs.readFile(ddsPath));
    validateDdsForManifest(recordName, dds, manifest);

    return h7aCompressionUtil.buildLiteralWrappedPayload(dds.payload, getH7aOptionsFromManifest(manifest));
}

async function buildGtfPayloadFromDds(recordDir, recordName, originalPayload, textureReader) {
    // GTF CDF rebuild from edited DDS is intentionally conservative for now.
    // The standard TXTR writer knows how to rebuild normal IFF TXTRs, but CDF GTF
    // records can carry bank-specific metadata. Preserve original GTF unless the
    // user provides a complete replacement .gtf in the record folder.
    const gtfPath = path.join(recordDir, `${safeName(recordName)}.gtf`);
    if (await pathExists(gtfPath)) {
        return await fs.readFile(gtfPath);
    }

    return originalPayload;
}

async function buildRecordPayload({ record, recordDir, originalPayload, textureReader }) {
    if (record.type !== 'TXTR') {
        const rawPayloadPath = path.join(recordDir, `${safeName(record.name)}.payload.bin`);
        const audioPayloadPath = path.join(recordDir, `${safeName(record.name)}.audio_payload.bin`);

        if (await pathExists(rawPayloadPath)) return await fs.readFile(rawPayloadPath);
        if (await pathExists(audioPayloadPath)) return await fs.readFile(audioPayloadPath);
        return originalPayload;
    }

    const payloadMagic = readUInt32BE(originalPayload, 0);

    if (payloadMagic === cdfBackedIffExtractor.CDF_TEXTURE_MAGIC) {
        return await buildH7aPayloadFromDds(recordDir, record.name, originalPayload);
    }

    if (payloadMagic === 0x01080000) {
        return await buildGtfPayloadFromDds(recordDir, record.name, originalPayload, textureReader);
    }

    const rawPayloadPath = path.join(recordDir, `${safeName(record.name)}.cdf_payload.bin`);
    if (await pathExists(rawPayloadPath)) return await fs.readFile(rawPayloadPath);

    return originalPayload;
}

async function rebuildCdfBackedPairFromFolder(folderPath, textureReader = null) {
    const baseName = path.basename(folderPath);
    const iffPath = path.join(folderPath, `${baseName}.iff`);
    const cdfPath = path.join(folderPath, `${baseName}.cdf`);

    if (!await pathExists(iffPath) || !await pathExists(cdfPath)) {
        return null;
    }

    const originalIff = await fs.readFile(iffPath);
    if (originalIff.length < 4 || originalIff.readUInt32BE(0) !== cdfBackedIffExtractor.CDF_BACKED_IFF_MAGIC) {
        return null;
    }

    const originalCdf = await fs.readFile(cdfPath);
    const rebuiltIff = Buffer.from(originalIff);
    const parsed = cdfBackedIffExtractor.parseCdfBackedIff(originalIff);

    const rebuiltParts = [];
    let runningOffset = 0;
    let modifiedRecords = 0;

    for (const record of parsed.records) {
        if (record.segmentHeaderOffset === null || record.segmentHeaderLength === null || record.payloadOffset === null || record.payloadLength === null) {
            throw new Error(`${baseName}: record ${record.index}/${record.name} has incomplete CDF segment metadata.`);
        }

        const recordDir = path.join(folderPath, safeName(record.type.toUpperCase()), safeName(record.name));
        const originalHeader = originalCdf.slice(record.segmentHeaderOffset, record.segmentHeaderOffset + record.segmentHeaderLength);
        const originalPayload = originalCdf.slice(record.payloadOffset, record.payloadOffset + record.payloadLength);
        const rebuiltPayload = await buildRecordPayload({ record, recordDir, originalPayload, textureReader });

        if (!rebuiltPayload.equals(originalPayload)) {
            modifiedRecords += 1;
        }

        const newHeaderOffset = runningOffset;
        const newPayloadOffset = newHeaderOffset + originalHeader.length;
        rebuiltParts.push(originalHeader, rebuiltPayload);
        runningOffset = newPayloadOffset + rebuiltPayload.length;

        rebuiltIff.writeUInt32BE(newHeaderOffset, record.segmentDescriptorOffset + 0x00);
        rebuiltIff.writeUInt32BE(originalHeader.length, record.segmentDescriptorOffset + 0x04);
        rebuiltIff.writeUInt32BE(newPayloadOffset, record.segmentDescriptorOffset + 0x08);
        rebuiltIff.writeUInt32BE(rebuiltPayload.length, record.segmentDescriptorOffset + 0x0C);
    }

    return {
        iffBuffer: rebuiltIff,
        cdfBuffer: Buffer.concat(rebuiltParts),
        summary: {
            baseName,
            recordCount: parsed.records.length,
            modifiedRecords,
            originalCdfSize: originalCdf.length,
            rebuiltCdfSize: runningOffset,
            originalIffSize: originalIff.length,
            rebuiltIffSize: rebuiltIff.length
        }
    };
}

module.exports = {
    rebuildCdfBackedPairFromFolder
};
