const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const cdfTextureExtractor = require('./cdfTextureExtractor');
const ddsUtil = require('./ddsUtil');

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 128;
const DEFAULT_FORMAT = 'DXT1';

function boolOption(value) {
    return value === true || value === 'true';
}

function inferDimensions(record, payloadSize) {
    const candidates = [
        { width: 256, height: 128, format: 'DXT1' },
        { width: 128, height: 64, format: 'DXT1' },
        { width: 256, height: 256, format: 'DXT1' },
        { width: 512, height: 256, format: 'DXT1' },
        { width: 256, height: 128, format: 'DXT5' }
    ];

    for (const candidate of candidates) {
        const expected = ddsUtil.payloadSizeFor(candidate.width, candidate.height, candidate.format);
        if (payloadSize >= expected) {
            return candidate;
        }
    }

    return {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        format: DEFAULT_FORMAT
    };
}

function inferImageDataOffset(payload, inferred, options = {}) {
    if (options.imageDataOffset !== undefined && options.imageDataOffset !== null) {
        return Number.parseInt(options.imageDataOffset, 10) || 0;
    }

    const topMipSize = ddsUtil.topMipSizeFor(inferred.width, inferred.height, inferred.format);

    // teamselectlogo records are 17,120 bytes for a 16,384-byte 256x128 DXT1 top mip.
    // The extra 736 bytes are 2K/RSX side data and must not be treated as DXT blocks.
    const trailingSideData = payload.length - topMipSize;
    if (trailingSideData >= 0 && trailingSideData <= 4096) {
        return trailingSideData;
    }

    return 0;
}

function applyExportSwizzleMode(imageData, inferred, mode) {
    if (mode === 'none' || mode === 'linear') {
        return Buffer.from(imageData);
    }

    return ddsUtil.deswizzleBcTopMip(
        imageData,
        inferred.width,
        inferred.height,
        inferred.format,
        mode || 'morton'
    );
}

function applyImportSwizzleMode(imageData, entry) {
    if (entry.swizzleMode === 'none' || entry.swizzleMode === 'linear') {
        return Buffer.from(imageData);
    }

    return ddsUtil.swizzleBcTopMip(
        imageData,
        entry.width,
        entry.height,
        entry.format,
        entry.swizzleMode || 'morton'
    );
}

async function writeDdsVariant({ editableDir, recordName, payload, inferred, imageDataOffset, mode }) {
    const topMipSize = ddsUtil.topMipSizeFor(inferred.width, inferred.height, inferred.format);
    const imageData = payload.slice(imageDataOffset, imageDataOffset + topMipSize);
    const converted = applyExportSwizzleMode(imageData, inferred, mode);
    const suffix = mode === 'none' || mode === 'linear' ? 'linear' : mode;
    const ddsName = `${recordName}.${suffix}.dds`;
    await fs.writeFile(
        path.join(editableDir, ddsName),
        ddsUtil.wrapDds(converted, {
            width: inferred.width,
            height: inferred.height,
            fourCC: inferred.format
        })
    );
    return ddsName;
}

async function exportTeamselectlogo(cdfPath, iffPath, outputPath, options = {}) {
    await mkdir(outputPath);

    const extractionPath = path.join(outputPath, 'raw_records');

    const manifest = await cdfTextureExtractor.extractCdfTextureRecords(
        cdfPath,
        extractionPath,
        {
            iffPath,
            dumpFullRecords: true,
            dumpHeaders: true,
            verbose: options.verbose
        }
    );

    const editableDir = path.join(outputPath, 'editable_dds');
    await mkdir(editableDir);

    const editableManifest = [];
    const swizzleMode = options.swizzleMode || 'none';
    const dumpVariants = boolOption(options.dumpVariants);

    for (const record of manifest.records) {
        const recordName = `${String(record.index).padStart(4, '0')}_${record.recordIdHex}`;
        const payloadPath = path.join(
            extractionPath,
            'records',
            recordName,
            `${recordName}.payload.bin`
        );

        const payload = await fs.readFile(payloadPath);
        const inferred = inferDimensions(record, payload.length);
        const topMipSize = ddsUtil.topMipSizeFor(inferred.width, inferred.height, inferred.format);
        const imageDataOffset = inferImageDataOffset(payload, inferred, options);

        if (imageDataOffset + topMipSize > payload.length) {
            throw new Error(
                `Invalid image data window for ${recordName}: offset=${imageDataOffset}, `
                + `topMipSize=${topMipSize}, payloadSize=${payload.length}`
            );
        }

        const ddsName = await writeDdsVariant({
            editableDir,
            recordName,
            payload,
            inferred,
            imageDataOffset,
            mode: swizzleMode
        });

        const variants = [];
        if (dumpVariants) {
            for (const mode of ['none', 'morton', 'morton-yx']) {
                variants.push(await writeDdsVariant({
                    editableDir,
                    recordName,
                    payload,
                    inferred,
                    imageDataOffset,
                    mode
                }));
            }
        }

        editableManifest.push({
            index: record.index,
            recordIdHex: record.recordIdHex,
            width: inferred.width,
            height: inferred.height,
            format: inferred.format,
            payloadOffset: record.payloadOffset,
            payloadSize: record.payloadSize,
            nextOffset: record.nextOffset,
            imageDataOffset,
            topMipSize,
            leadingSideDataSize: imageDataOffset,
            trailingSideDataSize: payload.length - imageDataOffset - topMipSize,
            swizzleMode,
            ddsPath: ddsName,
            variants
        });
    }

    await fs.writeFile(
        path.join(outputPath, 'teamselectlogo_manifest.json'),
        JSON.stringify(editableManifest, null, 2)
    );

    return {
        outputPath,
        extractedCount: editableManifest.length
    };
}

async function importTeamselectlogo(originalCdfPath, manifestPath, editedDdsDir, outputCdfPath) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    const cdfBuffer = await fs.readFile(originalCdfPath);

    for (const entry of manifest) {
        const ddsPath = path.join(editedDdsDir, entry.ddsPath);

        try {
            await fs.access(ddsPath);
        }
        catch (err) {
            continue;
        }

        const ddsBuffer = await fs.readFile(ddsPath);
        const parsed = ddsUtil.parseDds(ddsBuffer);

        if (parsed.payload.length !== entry.topMipSize) {
            throw new Error(
                `Edited DDS payload size mismatch for ${entry.ddsPath}. `
                + `Expected top mip ${entry.topMipSize}, got ${parsed.payload.length}.`
            );
        }

        const existingPayload = cdfBuffer.slice(
            entry.payloadOffset,
            entry.payloadOffset + entry.payloadSize
        );

        const leadingSideData = existingPayload.slice(0, entry.imageDataOffset || 0);
        const trailingStart = (entry.imageDataOffset || 0) + entry.topMipSize;
        const trailingSideData = existingPayload.slice(trailingStart);

        const gameImageData = applyImportSwizzleMode(parsed.payload, entry);

        const rebuiltPayload = Buffer.concat([
            leadingSideData,
            gameImageData,
            trailingSideData
        ]);

        if (rebuiltPayload.length !== entry.payloadSize) {
            throw new Error(
                `Rebuilt payload mismatch for ${entry.ddsPath}. `
                + `Expected ${entry.payloadSize}, got ${rebuiltPayload.length}.`
            );
        }

        rebuiltPayload.copy(cdfBuffer, entry.payloadOffset);
    }

    await fs.writeFile(outputCdfPath, cdfBuffer);

    return {
        outputCdfPath,
        importedCount: manifest.length
    };
}

module.exports = {
    exportTeamselectlogo,
    importTeamselectlogo
};
