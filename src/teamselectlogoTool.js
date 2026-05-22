const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const mkdir = require('make-dir');
const { spawnSync } = require('child_process');

const cdfTextureExtractor = require('./cdfTextureExtractor');
const ddsUtil = require('./ddsUtil');

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 128;
const DEFAULT_FORMAT = 'DXT1';
const DEFAULT_IMAGE_RECORD_OFFSET = 0x78;
const GTF_TEXTURE_DESCRIPTOR_SIZE = 0x18;

const DEFAULT_GTF_DESCRIPTOR_OFFSETS = [
    0x21, // begins with 0x88 on teamselectlogo record 0; plausible GCM DXT5-family descriptor
    0x2f, // second 0x88 hit in the record header
    0x34,
    0x38,
    0x3c,
    0x40,
    0x48,
    0x50,
    0x58
];

const DEFAULT_GTF_DATA_OFFSETS = [
    0xb0,
    0xa0,
    0x90,
    0x88,
    0x80,
    0x78,
    0x70
];

function boolOption(value) {
    return value === true || value === 'true';
}

function parseNumberList(value, fallback) {
    if (!value) return fallback;
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number.parseInt(item, item.toLowerCase().startsWith('0x') ? 16 : 10))
        .filter((item) => Number.isFinite(item) && item >= 0);
}

async function pathExists(inputPath) {
    try {
        await fs.access(inputPath);
        return true;
    }
    catch (err) {
        return false;
    }
}

function getBundledToolPath(toolName) {
    return path.join(__dirname, '..', '2k-tools', 'lib', toolName);
}

async function prepareExecutableTool(toolName, outputPath, overridePath) {
    if (overridePath) {
        return overridePath;
    }

    const adjacentToExe = process.pkg
        ? path.join(path.dirname(process.execPath), toolName)
        : null;

    if (adjacentToExe && await pathExists(adjacentToExe)) {
        return adjacentToExe;
    }

    const cwdTool = path.join(process.cwd(), toolName);
    if (await pathExists(cwdTool)) {
        return cwdTool;
    }

    const bundledPath = getBundledToolPath(toolName);

    if (!process.pkg) {
        return bundledPath;
    }

    const toolDir = path.join(outputPath || os.tmpdir(), '_tools');
    await mkdir(toolDir);
    const extractedToolPath = path.join(toolDir, toolName);
    await fs.copyFile(bundledPath, extractedToolPath);
    return extractedToolPath;
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

function makeGtfFromCdfRecord(recordBuffer, descriptorOffset, dataOffset) {
    if (descriptorOffset + GTF_TEXTURE_DESCRIPTOR_SIZE > recordBuffer.length) {
        throw new Error(`Descriptor offset 0x${descriptorOffset.toString(16)} is outside the CDF record.`);
    }

    if (dataOffset >= recordBuffer.length) {
        throw new Error(`Data offset 0x${dataOffset.toString(16)} is outside the CDF record.`);
    }

    const textureDescriptor = recordBuffer.slice(
        descriptorOffset,
        descriptorOffset + GTF_TEXTURE_DESCRIPTOR_SIZE
    );
    const textureData = recordBuffer.slice(dataOffset);

    const gtfHeader = Buffer.alloc(0x30, 0);
    gtfHeader.writeUInt32BE(0x01080000, 0x00);
    gtfHeader.writeUInt32BE(textureData.length + 0x30, 0x04);
    gtfHeader.writeUInt32BE(0x01, 0x08);
    gtfHeader.writeUInt32BE(0x00, 0x0C);
    gtfHeader.writeUInt32BE(0x30, 0x10);
    gtfHeader.writeUInt32BE(textureData.length, 0x14);
    textureDescriptor.copy(gtfHeader, 0x18);

    return Buffer.concat([gtfHeader, textureData]);
}

function runGtf2Dds(gtf2ddsPath, gtfPath, ddsPath) {
    const attempts = [
        ['-v', '-z', '-o', ddsPath, gtfPath],
        ['-z', '-o', ddsPath, gtfPath],
        ['-o', ddsPath, gtfPath],
        [gtfPath, ddsPath]
    ];

    const results = [];
    for (const args of attempts) {
        const result = spawnSync(gtf2ddsPath, args, {
            cwd: path.dirname(gtfPath),
            windowsHide: true,
            encoding: 'utf-8'
        });

        results.push({
            args,
            status: result.status,
            signal: result.signal,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error ? result.error.message : null
        });
    }

    return { attempts: results };
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
    if (entry.swizzleMode === 'none' || entry.swizzleMode === 'linear' || entry.exportMode === 'gtf') {
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

async function writeManualDdsVariant({ editableDir, recordName, sourceImageData, inferred, mode }) {
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

async function writeGtfConvertedDds({ recordBuffer, recordName, editableDir, gtfDir, gtf2ddsPath, keepGtf, options }) {
    const descriptorOffsets = parseNumberList(options.gtfDescriptorOffsets, DEFAULT_GTF_DESCRIPTOR_OFFSETS);
    const dataOffsets = parseNumberList(options.gtfDataOffsets, DEFAULT_GTF_DATA_OFFSETS);
    const attempts = [];

    for (const descriptorOffset of descriptorOffsets) {
        for (const dataOffset of dataOffsets) {
            const suffix = `desc${descriptorOffset.toString(16)}_data${dataOffset.toString(16)}`;
            const gtfPath = path.join(gtfDir, `${recordName}.${suffix}.gtf`);
            const ddsName = `${recordName}.${suffix}.dds`;
            const ddsPath = path.join(editableDir, ddsName);

            try {
                const gtfBuffer = makeGtfFromCdfRecord(recordBuffer, descriptorOffset, dataOffset);
                await fs.writeFile(gtfPath, gtfBuffer);

                const conversion = runGtf2Dds(gtf2ddsPath, gtfPath, ddsPath);
                const outputExists = await pathExists(ddsPath);

                attempts.push({
                    descriptorOffset,
                    dataOffset,
                    gtfPath: keepGtf ? gtfPath : null,
                    ddsPath,
                    outputExists,
                    conversion
                });

                if (!keepGtf) {
                    await fs.rm(gtfPath, { force: true });
                }

                if (outputExists) {
                    return {
                        ddsName,
                        gtfPath: keepGtf ? gtfPath : null,
                        conversion,
                        descriptorOffset,
                        dataOffset,
                        attempts
                    };
                }
            }
            catch (err) {
                attempts.push({
                    descriptorOffset,
                    dataOffset,
                    error: err.message
                });
            }
        }
    }

    const attemptLogPath = path.join(gtfDir, `${recordName}.gtf_attempts.json`);
    await fs.writeFile(attemptLogPath, JSON.stringify(attempts, null, 2));

    throw new Error(
        `No GTF candidate converted for ${recordName}. `
        + `Kept attempt log at ${attemptLogPath}. `
        + `Try inspecting generated GTF candidates or narrowing --gtf-descriptor-offsets / --gtf-data-offsets.`
    );
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
    const gtfDir = path.join(outputPath, 'gtf');
    await mkdir(editableDir);
    await mkdir(gtfDir);

    const exportMode = options.exportMode || 'gtf';
    const editableManifest = [];
    const swizzleMode = options.swizzleMode || 'block-rect';
    const dumpVariants = boolOption(options.dumpVariants);
    const keepGtf = boolOption(options.keepGtf);
    const imageRecordOffset = getImageRecordOffset(options);
    const gtf2ddsPath = await prepareExecutableTool('gtf2dds.exe', outputPath, options.gtf2ddsPath);

    for (const record of manifest.records) {
        const recordName = `${String(record.index).padStart(4, '0')}_${record.recordIdHex}`;
        const recordBuffer = cdfBuffer.slice(record.offset, record.nextOffset);
        const sourceSize = record.nextOffset - (record.offset + imageRecordOffset);
        const inferred = inferDimensions(record, sourceSize);
        const topMipSize = ddsUtil.topMipSizeFor(inferred.width, inferred.height, inferred.format);
        const imageAbsoluteOffset = record.offset + imageRecordOffset;

        let ddsName;
        let gtfConversion = null;
        let gtfDescriptorOffset = null;
        let gtfDataOffset = null;
        const variants = [];

        if (exportMode === 'manual') {
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

            ddsName = await writeManualDdsVariant({
                editableDir,
                recordName,
                sourceImageData,
                inferred,
                mode: swizzleMode
            });

            if (dumpVariants) {
                for (const mode of ['none', 'morton', 'morton-yx', 'block-rect', 'byte-rect']) {
                    variants.push(await writeManualDdsVariant({
                        editableDir,
                        recordName,
                        sourceImageData,
                        inferred,
                        mode
                    }));
                }
            }
        }
        else {
            const result = await writeGtfConvertedDds({
                recordBuffer,
                recordName,
                editableDir,
                gtfDir,
                gtf2ddsPath,
                keepGtf,
                options
            });
            ddsName = result.ddsName;
            gtfConversion = result.conversion;
            gtfDescriptorOffset = result.descriptorOffset;
            gtfDataOffset = result.dataOffset;
        }

        editableManifest.push({
            index: record.index,
            recordIdHex: record.recordIdHex,
            width: inferred.width,
            height: inferred.height,
            format: inferred.format,
            exportMode,
            gtf2ddsPath: exportMode === 'gtf' ? gtf2ddsPath : null,
            gtfDescriptorOffset,
            gtfDataOffset,
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
            swizzleMode: exportMode === 'manual' ? swizzleMode : null,
            ddsPath: ddsName,
            variants,
            gtfConversion
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

        if (entry.exportMode === 'gtf') {
            throw new Error(
                'Reimport for GTF-converted teamselectlogo DDS is intentionally disabled until dds2gtf-backed import is wired. '
                + 'Export is the active focus for this workflow.'
            );
        }

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
    makeGtfFromCdfRecord,
    exportTeamselectlogo,
    importTeamselectlogo
};
