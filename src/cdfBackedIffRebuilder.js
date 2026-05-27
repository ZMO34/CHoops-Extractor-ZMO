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

function validateDdsAgainstOriginal(recordName, dds, originalPayload) {
    const decoded = cdfBackedIffExtractor.decodeH7aTexturePayload(originalPayload);
    if (!decoded || !decoded.layout) {
        throw new Error(`${recordName}: cannot infer original CDF texture DDS layout.`);
    }

    const expected = decoded.layout;
    const actualFormat = String(dds.fourCC).trim();
    const expectedFormat = String(expected.format).trim();

    if (dds.width !== expected.width || dds.height !== expected.height || dds.mipMapCount !== expected.mipMapCount || actualFormat !== expectedFormat) {
        throw new Error(
            `${recordName}.dds layout mismatch. `
            + `Expected ${expected.width}x${expected.height} ${expectedFormat} mips=${expected.mipMapCount}, `
            + `got ${dds.width}x${dds.height} ${actualFormat} mips=${dds.mipMapCount}.`
        );
    }

    const expectedPayloadSize = ddsUtil.payloadSizeFor(expected.width, expected.height, expected.format, expected.mipMapCount);
    if (dds.payload.length !== expectedPayloadSize) {
        throw new Error(
            `${recordName}.dds payload size mismatch. Expected 0x${expectedPayloadSize.toString(16)}, `
            + `got 0x${dds.payload.length.toString(16)}.`
        );
    }

    return decoded;
}

async function buildH7aPayloadFromDds(recordDir, recordName, originalPayload) {
    const ddsPath = path.join(recordDir, `${safeName(recordName)}.dds`);
    if (!await pathExists(ddsPath)) return originalPayload;

    const originalWrapper = cdfBackedIffExtractor.parseH7aWrapper(originalPayload);
    if (!originalWrapper) return originalPayload;

    const dds = ddsUtil.parseDds(await fs.readFile(ddsPath));
    validateDdsAgainstOriginal(recordName, dds, originalPayload);

    return h7aCompressionUtil.buildLiteralWrappedPayload(dds.payload, {
        shiftAmount: originalWrapper.shiftAmount || 0x8,
        unknown0C: Number.isInteger(originalWrapper.unknown0C) ? originalWrapper.unknown0C : 0
    });
}

async function buildRecordPayload({ record, recordDir, originalPayload }) {
    if (record.type !== 'TXTR') {
        return originalPayload;
    }

    const payloadMagic = readUInt32BE(originalPayload, 0);

    if (payloadMagic === cdfBackedIffExtractor.CDF_TEXTURE_MAGIC) {
        return await buildH7aPayloadFromDds(recordDir, record.name, originalPayload);
    }

    // GTF-in-CDF DDS import is intentionally not guessed yet. Users can still
    // replace the whole .cdf/.iff pair as raw top-level resources if needed.
    return originalPayload;
}

async function rebuildCdfBackedPairFromFolder(folderPath) {
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
        const rebuiltPayload = await buildRecordPayload({ record, recordDir, originalPayload });

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