const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');
const { spawnSync } = require('child_process');

const CDF_TEXTURE_MAGIC = 0x0e4837c3;
const DEFAULT_RECORD_HEADER_SIZE = 0xB0;
const IFF_METADATA_RECORD_SIZE = 20;
const TEAMSELECTLOGO_IFF_METADATA_MAGIC = 0x5c369069;

function readUInt32BE(buffer, offset) {
    if (offset < 0 || offset + 4 > buffer.length) {
        return null;
    }

    return buffer.readUInt32BE(offset);
}

function toHex(value) {
    if (value === null || value === undefined) {
        return null;
    }

    return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function safeName(value) {
    return String(value || 'record').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function getBundledToolPath(toolName) {
    return path.join(__dirname, '..', '2k-tools', 'lib', toolName);
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

function runGtf2Dds(gtf2ddsPath, inputPath, outputPath) {
    const attempts = [
        [inputPath, outputPath],
        ['-o', outputPath, inputPath],
        [inputPath]
    ];

    const results = [];
    for (const args of attempts) {
        const result = spawnSync(gtf2ddsPath, args, {
            cwd: path.dirname(inputPath),
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

async function convertCandidateToDds(gtf2ddsPath, candidatePath, ddsPath) {
    const result = runGtf2Dds(gtf2ddsPath, candidatePath, ddsPath);
    const sidecarDds = candidatePath.replace(/\.[^.]+$/, '.dds');
    const finalExists = await pathExists(ddsPath);
    const sidecarExists = await pathExists(sidecarDds);

    if (!finalExists && sidecarExists && sidecarDds !== ddsPath) {
        await fs.copyFile(sidecarDds, ddsPath);
    }

    return {
        ...result,
        outputExists: await pathExists(ddsPath),
        candidatePath,
        ddsPath
    };
}

function getRecordIdFromHeader(buffer, offset) {
    if (offset + 0x19 > buffer.length) {
        return null;
    }

    // The 2K texture ID is byte-shifted in the CDF header for teamselectlogo.cdf.
    return buffer.readUInt32BE(offset + 0x15);
}

function parseCdfTextureRecords(buffer, options = {}) {
    const records = [];
    let offset = 0;

    while (offset + DEFAULT_RECORD_HEADER_SIZE <= buffer.length) {
        const magic = readUInt32BE(buffer, offset);
        if (magic !== CDF_TEXTURE_MAGIC) {
            throw new Error(`CDF texture record magic mismatch at 0x${offset.toString(16)}. Found ${toHex(magic)}.`);
        }

        const recordHeaderSize = readUInt32BE(buffer, offset + 0x04);
        const headerASize = readUInt32BE(buffer, offset + 0x08);
        const headerBOffset = offset + headerASize;
        const headerBMagic = readUInt32BE(buffer, headerBOffset);
        const recordTailSize = readUInt32BE(buffer, headerBOffset + 0x08);
        const nextOffset = offset + headerASize + recordTailSize;
        const payloadOffset = offset + recordHeaderSize;
        const payloadSize = nextOffset - payloadOffset;

        const structuralMismatch = (
            recordHeaderSize !== DEFAULT_RECORD_HEADER_SIZE
            || headerASize <= 0
            || headerBMagic !== CDF_TEXTURE_MAGIC
            || recordTailSize <= 0
            || nextOffset <= offset
            || nextOffset > buffer.length
            || payloadOffset > nextOffset
        );

        if (structuralMismatch) {
            throw new Error(
                `Invalid CDF texture record at index ${records.length}, offset 0x${offset.toString(16)}. `
                + `headerSize=${recordHeaderSize}, headerASize=${headerASize}, `
                + `headerBMagic=${toHex(headerBMagic)}, tailSize=${recordTailSize}.`
            );
        }

        const record = {
            index: records.length,
            offset,
            nextOffset,
            size: nextOffset - offset,
            recordHeaderSize,
            headerASize,
            headerBOffset,
            headerBMagic: toHex(headerBMagic),
            recordTailSize,
            payloadOffset,
            payloadSize,
            recordId: getRecordIdFromHeader(buffer, offset),
            recordIdHex: toHex(getRecordIdFromHeader(buffer, offset)),
            widthOrTileWidth: readUInt32BE(buffer, headerBOffset + 0x0C),
            heightOrTileHeight: readUInt32BE(buffer, headerBOffset + 0x10),
            formatOrMipInfo: toHex(readUInt32BE(buffer, headerBOffset + 0x14)),
            unknownHeaderB18: toHex(readUInt32BE(buffer, headerBOffset + 0x18)),
            structuralMismatch: false,
            usedSequentialBoundary: true
        };

        records.push(record);

        if (options.verbose) {
            console.log(
                `[cdf-texture] #${record.index} offset=0x${offset.toString(16)} `
                + `size=${record.size} payload=${record.payloadSize} `
                + `id=${record.recordIdHex} dims=${record.widthOrTileWidth}x${record.heightOrTileHeight}`
            );
        }

        offset = nextOffset;
    }

    if (offset !== buffer.length) {
        throw new Error(`CDF texture parser ended at 0x${offset.toString(16)} but file size is 0x${buffer.length.toString(16)}.`);
    }

    return records;
}

function findIffMetadataTable(buffer, expectedCount) {
    const maxProbe = Math.max(1, Math.min(expectedCount, 8));
    const candidates = [];

    for (let offset = 0; offset + (expectedCount * IFF_METADATA_RECORD_SIZE) <= buffer.length; offset++) {
        let score = 0;
        for (let i = 0; i < maxProbe; i++) {
            const recordOffset = offset + (i * IFF_METADATA_RECORD_SIZE);
            const metadataMagic = readUInt32BE(buffer, recordOffset + 0x04);
            const constantTwo = readUInt32BE(buffer, recordOffset + 0x08);
            if (metadataMagic === TEAMSELECTLOGO_IFF_METADATA_MAGIC) score += 2;
            if (constantTwo === 2) score += 1;
        }

        if (score >= maxProbe * 2) {
            candidates.push({ offset, score });
        }
    }

    if (candidates.length <= 0) {
        return null;
    }

    candidates.sort((a, b) => b.score - a.score || a.offset - b.offset);
    return candidates[0].offset;
}

function parseIffMetadataRecords(buffer, expectedCount) {
    const metadataOffset = findIffMetadataTable(buffer, expectedCount);
    if (metadataOffset === null) {
        return {
            metadataOffset: null,
            records: []
        };
    }

    const records = [];
    for (let i = 0; i < expectedCount; i++) {
        const recordOffset = metadataOffset + (i * IFF_METADATA_RECORD_SIZE);
        if (recordOffset + IFF_METADATA_RECORD_SIZE > buffer.length) break;

        records.push({
            index: i,
            offset: recordOffset,
            recordId: readUInt32BE(buffer, recordOffset + 0x00),
            recordIdHex: toHex(readUInt32BE(buffer, recordOffset + 0x00)),
            metadataMagic: toHex(readUInt32BE(buffer, recordOffset + 0x04)),
            constantTwo: readUInt32BE(buffer, recordOffset + 0x08),
            metadataField0C: readUInt32BE(buffer, recordOffset + 0x0C),
            metadataField0CHex: toHex(readUInt32BE(buffer, recordOffset + 0x0C)),
            metadataField10: readUInt32BE(buffer, recordOffset + 0x10),
            metadataField10Hex: toHex(readUInt32BE(buffer, recordOffset + 0x10))
        });
    }

    return {
        metadataOffset,
        records
    };
}

function mergeMetadata(cdfRecords, iffMetadataRecords) {
    const metadataById = new Map();
    for (const record of iffMetadataRecords) {
        metadataById.set(record.recordId, record);
    }

    return cdfRecords.map((record) => {
        const metadata = metadataById.get(record.recordId) || null;
        return {
            ...record,
            iffMetadata: metadata,
            iffMetadataMatched: !!metadata
        };
    });
}

async function extractCdfTextureRecords(cdfPath, outputPath, options = {}) {
    await mkdir(outputPath);

    const cdfBuffer = await fs.readFile(cdfPath);
    const cdfRecords = parseCdfTextureRecords(cdfBuffer, options);

    let iffInfo = {
        metadataOffset: null,
        records: []
    };

    if (options.iffPath) {
        const iffBuffer = await fs.readFile(options.iffPath);
        iffInfo = parseIffMetadataRecords(iffBuffer, cdfRecords.length);
    }

    const mergedRecords = mergeMetadata(cdfRecords, iffInfo.records);
    const recordsDir = path.join(outputPath, 'records');
    const ddsDir = path.join(outputPath, 'dds');
    const gtfDir = path.join(outputPath, 'gtf_candidates');
    await mkdir(recordsDir);

    const dumpPayloads = options.dumpPayloads !== false && options.dumpPayloads !== 'false';
    const dumpFullRecords = options.dumpFullRecords === true || options.dumpFullRecords === 'true';
    const dumpHeaders = options.dumpHeaders === true || options.dumpHeaders === 'true';
    const convertDds = options.convertDds === true || options.convertDds === 'true' || options.dds === true || options.dds === 'true';
    const keepGtfCandidates = options.keepGtfCandidates === true || options.keepGtfCandidates === 'true';
    const limit = options.limit ? Number.parseInt(options.limit, 10) : null;
    const gtf2ddsPath = options.gtf2ddsPath || getBundledToolPath('gtf2dds.exe');

    if (convertDds) {
        await mkdir(ddsDir);
        if (keepGtfCandidates) await mkdir(gtfDir);
    }

    const recordsToProcess = Number.isInteger(limit) && limit > 0 ? mergedRecords.slice(0, limit) : mergedRecords;
    const conversionResults = [];

    for (const record of recordsToProcess) {
        const recordName = `${String(record.index).padStart(4, '0')}_${safeName(record.recordIdHex)}`;
        const recordDir = path.join(recordsDir, recordName);
        await mkdir(recordDir);

        const payloadBuffer = cdfBuffer.slice(record.payloadOffset, record.nextOffset);
        const fullRecordBuffer = cdfBuffer.slice(record.offset, record.nextOffset);
        const headerBuffer = cdfBuffer.slice(record.offset, record.payloadOffset);

        const payloadPath = path.join(recordDir, `${recordName}.payload.bin`);
        const fullRecordPath = path.join(recordDir, `${recordName}.cdftex`);
        const headerPath = path.join(recordDir, `${recordName}.header.bin`);

        if (dumpPayloads || convertDds) {
            await fs.writeFile(payloadPath, payloadBuffer);
        }

        if (dumpFullRecords || convertDds) {
            await fs.writeFile(fullRecordPath, fullRecordBuffer);
        }

        if (dumpHeaders) {
            await fs.writeFile(headerPath, headerBuffer);
        }

        const recordManifest = { ...record };

        if (convertDds) {
            const payloadAsGtfPath = path.join(recordDir, `${recordName}.payload.gtf`);
            const fullRecordAsGtfPath = path.join(recordDir, `${recordName}.record.gtf`);

            await fs.writeFile(payloadAsGtfPath, payloadBuffer);
            await fs.writeFile(fullRecordAsGtfPath, fullRecordBuffer);

            const ddsPayloadPath = path.join(ddsDir, `${recordName}.payload.dds`);
            const ddsRecordPath = path.join(ddsDir, `${recordName}.record.dds`);
            const payloadConversion = await convertCandidateToDds(gtf2ddsPath, payloadAsGtfPath, ddsPayloadPath);
            const recordConversion = payloadConversion.outputExists
                ? null
                : await convertCandidateToDds(gtf2ddsPath, fullRecordAsGtfPath, ddsRecordPath);

            recordManifest.ddsConversion = {
                gtf2ddsPath,
                payloadConversion,
                recordConversion,
                converted: payloadConversion.outputExists || (recordConversion && recordConversion.outputExists),
                outputDds: payloadConversion.outputExists
                    ? ddsPayloadPath
                    : (recordConversion && recordConversion.outputExists ? ddsRecordPath : null)
            };

            conversionResults.push({
                index: record.index,
                recordIdHex: record.recordIdHex,
                ...recordManifest.ddsConversion
            });

            if (keepGtfCandidates) {
                await fs.copyFile(payloadAsGtfPath, path.join(gtfDir, `${recordName}.payload.gtf`));
                await fs.copyFile(fullRecordAsGtfPath, path.join(gtfDir, `${recordName}.record.gtf`));
            }
            else {
                await fs.rm(payloadAsGtfPath, { force: true });
                await fs.rm(fullRecordAsGtfPath, { force: true });
            }
        }

        await fs.writeFile(path.join(recordDir, `${recordName}.json`), JSON.stringify(recordManifest, null, 2));
    }

    const manifest = {
        sourceCdf: cdfPath,
        sourceIff: options.iffPath || null,
        outputPath,
        parser: 'cdf-texture-sequential-v2',
        fileSize: cdfBuffer.length,
        recordCount: mergedRecords.length,
        processedRecordCount: recordsToProcess.length,
        iffMetadataOffset: iffInfo.metadataOffset,
        iffMetadataCount: iffInfo.records.length,
        matchedIffMetadataCount: mergedRecords.filter((record) => record.iffMetadataMatched).length,
        payloadSummary: {
            minPayloadSize: Math.min(...mergedRecords.map((record) => record.payloadSize)),
            maxPayloadSize: Math.max(...mergedRecords.map((record) => record.payloadSize)),
            totalPayloadSize: mergedRecords.reduce((sum, record) => sum + record.payloadSize, 0)
        },
        convertDds,
        conversionSummary: convertDds ? {
            gtf2ddsPath,
            convertedCount: conversionResults.filter((result) => result.converted).length,
            failedCount: conversionResults.filter((result) => !result.converted).length
        } : null,
        notes: [
            'teamselectlogo.cdf is a sequential 2K texture container with 520 records.',
            'Each logical record has a nested 0x0e4837c3 subheader; do not split records at that nested magic.',
            'The correct record boundary is offset + headerASize + nestedTailSize.',
            'The CDF is the large payload carrier; the paired IFF is small metadata/linkage.'
        ],
        conversionResults,
        records: mergedRecords
    };

    await fs.writeFile(path.join(outputPath, 'cdf_texture_manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
}

module.exports = {
    CDF_TEXTURE_MAGIC,
    parseCdfTextureRecords,
    parseIffMetadataRecords,
    extractCdfTextureRecords
};