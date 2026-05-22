const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const cdfTextureExtractor = require('./cdfTextureExtractor');
const ddsUtil = require('./ddsUtil');

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 128;
const DEFAULT_FORMAT = 'DXT1';
const DEFAULT_IMAGE_RECORD_OFFSET = 0x78;

function boolOption(value) {
    return value === true || value === 'true';
}

function inferDimensions(record, sourceSize) {
    const candidates = [
        { width: 256, height: 128, format: 'DXT1' },
        { width: 128, height: 64, format: 'DXT1' },
        { width: 256, height: 256, format: 'DXT1' },
        { width: 512, height: 256, format: 'DXT1' },
        { width: 256, height: 128, format: 'DXT5' }
    ];

    for (const candidate of candidates) {
        const expected = ddsUtil.payloadSizeFor(candidate.width, candidate.height, candidate.format);
        if (sourceSize >= expected) {
            return candidate;
        }
    }

    return {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        format: DEFAULT_FORMAT
    };
}

function getImageRecordOffset(options = {}) {
    if (options.imageDataOffset !== undefined && options.imageDataOffset !== null) {
        return Number.parseInt(options.imageDataOffset, 10) || DEFAULT_IMAGE_RECORD_OFFSET;
    }

    return DEFAULT_IMAGE_RECORD_OFFSET;
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
        mode || 'block-rect'
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
        entry.swizzleMode || 'block-rect'
    );
}

async function writeDdsVariant({ editableDir, recordName, sourceImageData, inferred, mode }) {
    const converted = applyExportSwizzleMode(sourceImageData, inferred, mode);
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
    const cdfBuffer = await fs.readFile(cdfPath);

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
    const swizzleMode = options.swizzleMode || 'block-rect';
    const dumpVariants = boolOption(options.dumpVariants);
    const imageRecordOffset = getImageRecordOffset(options);

    for (const record of manifest.records) {
        const recordName = `${String(record.index).padStart(4, '0')}_${record.recordIdHex}`;
        const sourceSize = record.nextOffset - (record.offset + imageRecordOffset);
        const inferred = inferDimensions(record, sourceSize);
        const topMipSize = ddsUtil.topMipSizeFor(inferred.width, inferred.height, inferred.format);
        const imageAbsoluteOffset = record.offset + imageRecordOffset;

        if (imageAbsoluteOffset + topMipSize > record.nextOffset) {
            throw new Error(
                `Invalid image data window for ${recordName}: recordOffset=0x${imageRecordOffset.toString(16)}, `
                + `topMipSize=${topMipSize}, recordEnd=0x${record.nextOffset.toString(16)}`
            );
        }

        const sourceImageData = cdfBuffer.slice(
            imageAbsoluteOffset,
            imageAbsoluteOffset + topMipSize
        );

        const ddsName = await writeDdsVariant({
            editableDir,
            recordName,
            sourceImageData,
            inferred,
            mode: swizzleMode
        });

        const variants = [];
        if (dumpVariants) {
            for (const mode of ['none', 'morton', 'morton-yx', 'block-rect', 'byte-rect']) {
                variants.push(await writeDdsVariant({
                    editableDir,
                    recordName,
                    sourceImageData,
                    inferred,
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
            recordOffset: record.offset,
            recordSize: record.size,
            nextOffset: record.nextOffset,
            legacyPayloadOffset: record.payloadOffset,
            legacyPayloadSize: record.payloadSize,
            imageRecordOffset,
            imageAbsoluteOffset,
            topMipSize,
            leadingRecordSideDataSize: imageRecordOffset,
            trailingRecordSideDataSize: record.size - imageRecordOffset - topMipSize,
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

        const gameImageData = applyImportSwizzleMode(parsed.payload, entry);
        gameImageData.copy(cdfBuffer, entry.imageAbsoluteOffset);
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
