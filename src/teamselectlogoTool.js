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
const GTF_TEXTURE_DESCRIPTOR_OFFSET = 0x58;
const GTF_TEXTURE_DESCRIPTOR_SIZE = 0x18;
const CDF_TEXTURE_DATA_OFFSET = 0xB0;

function boolOption(value) {
    return value === true || value === 'true';
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

    // pkg cannot execute a binary directly from the virtual snapshot, so copy it to a real temp path first.
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

function makeGtfFromCdfRecord(recordBuffer) {
    if (recordBuffer.length <= CDF_TEXTURE_DATA_OFFSET) {
        throw new Error('CDF texture record is too small to contain texture data.');
    }

    const textureDescriptor = recordBuffer.slice(
        GTF_TEXTURE_DESCRIPTOR_OFFSET,
        GTF_TEXTURE_DESCRIPTOR_OFFSET + GTF_TEXTURE_DESCRIPTOR_SIZE
    );
    const textureData = recordBuffer.slice(CDF_TEXTURE_DATA_OFFSET);

    const gtfHeader = Buffer.alloc(0x30, 0);

    // Same layout used by 2k-tools/src/parser/choops/ChoopsTextureReader.js.
    // 0x01080000 is the GTF container signature/version used by the shipped gtf2dds.exe.
    gtfHeader.writeUInt32BE(0x01080000, 0x00);
    gtfHeader.writeUInt32BE(textureData.length + 0x30, 0x04);
    gtfHeader.writeUInt32BE(0x01, 0x08);

    // Single texture table entry.
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

        if (result.status === 0) {
            return { success: true, attempts: results };
        }
    }

    return { success: false, attempts: results };
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

async function writeGtfConvertedDds({ recordBuffer, recordName, editableDir, gtfDir, gtf2ddsPath, keepGtf }) {
    const gtfBuffer = makeGtfFromCdfRecord(recordBuffer);
    const gtfPath = path.join(gtfDir, `${recordName}.gtf`);
    const ddsName = `${recordName}.dds`;
    const ddsPath = path.join(editableDir, ddsName);

    await fs.writeFile(gtfPath, gtfBuffer);
    const conversion = runGtf2Dds(gtf2ddsPath, gtfPath, ddsPath);
    const outputExists = await pathExists(ddsPath);

    if (!keepGtf) {
        await fs.rm(gtfPath, { force: true });
    }

    if (!outputExists) {
        throw new Error(
            `gtf2dds failed for ${recordName}. `
            + JSON.stringify(conversion.attempts[conversion.attempts.length - 1], null, 2)
        );
    }

    return {
        ddsName,
        gtfPath: keepGtf ? gtfPath : null,
        conversion
    };
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

        if (imageAbsoluteOffset + topMipSize > record.nextOffset) {
            throw new Error(
                `Invalid image data window for ${recordName}: recordOffset=0x${imageRecordOffset.toString(16)}, `
                + `topMipSize=${topMipSize}, recordEnd=0x${record.nextOffset.toString(16)}`
            );
        }

        let ddsName;
        let gtfConversion = null;
        const variants = [];

        if (exportMode === 'manual') {
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
                keepGtf
            });
            ddsName = result.ddsName;
            gtfConversion = result.conversion;
        }

        editableManifest.push({
            index: record.index,
            recordIdHex: record.recordIdHex,
            width: inferred.width,
            height: inferred.height,
            format: inferred.format,
            exportMode,
            gtf2ddsPath: exportMode === 'gtf' ? gtf2ddsPath : null,
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
