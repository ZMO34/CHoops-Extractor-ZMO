const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');
const { spawnSync } = require('child_process');

const CDF_TEXTURE_MAGIC = 0x0e4837c3;
const DEFAULT_RECORD_HEADER_SIZE = 0xB0;
const DEFAULT_HEADER_A_SIZE = 0x5E;
const IFF_METADATA_RECORD_SIZE = 20;
const TEAMSELECTLOGO_IFF_METADATA_MAGIC = 0x5c369069;

function readUInt32BE(buffer, offset) {
    if (offset < 0 || offset + 4 > buffer.length) return null;
    return buffer.readUInt32BE(offset);
}

function toHex(value, width = 8) {
    if (value === null || value === undefined) return null;
    return `0x${(value >>> 0).toString(16).padStart(width, '0')}`;
}

function safeName(value) {
    return String(value || 'record').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function getRecordIdFromHeader(buffer, offset) {
    // The matching IFF metadata ID is stored across CDF header bytes +0x15..+0x18.
    if (offset + 0x19 > buffer.length) return null;
    return buffer.readUInt32BE(offset + 0x15);
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
        [inputPath],
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

    // Some versions of gtf2dds write next to the input using the same base name.
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

function parseCdfTextureRecords(buffer) {
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

        if (recordHeaderSize !== DEFAULT_RECORD_HEADER_SIZE) {
            throw new Error(`Unexpected CDF texture header size at 0x${offset.toString(16)}: ${toHex(recordHeaderSize)}.`);
        }

        if (headerASize !== DEFAULT_HEADER_A_SIZE || headerBMagic !== CDF_TEXTURE_MAGIC) {
            throw new Error(`CDF texture sub-header mismatch at 0x${offset.toString(16)}.`);
        }

        const recordTailSize = readUInt32BE(buffer, headerBOffset + 0x08);
        const widthOrTileWidth = readUInt32BE(buffer, headerBOffset + 0x0C);
        const heightOrTileHeight = readUInt32BE(buffer, headerBOffset + 0x10);
        const formatOrMipInfo = readUInt32BE(buffer, headerBOffset + 0x14);
        const unknownHeaderB18 = readUInt32BE(buffer, headerBOffset + 0x18);
        const nextOffset = offset + headerASize + recordTailSize;
        const payloadOffset = offset + recordHeaderSize;
        const payloadSize = nextOffset - payloadOffset;
        const recordId = getRecordIdFromHeader(buffer, offset);

        if (recordTailSize <= 0 || nextOffset <= offset || nextOffset > buffer.length) {
            throw new Error(`Invalid CDF texture record size at 0x${offset.toString(16)}.`);
        }

        records.push({
            index: records.length,
            offset,
            nextOffset,
            size: nextOffset - offset,
            magic: toHex(magic),
            recordId,
            recordIdHex: toHex(recordId),
            recordHeaderSize,
            headerASize,
            headerBOffset,
            headerBSize: recordHeaderSize - headerASize,
            recordTailSize,
            payloadOffset,
            payloadSize,
            widthOrTileWidth,
            heightOrTileHeight,
            formatOrMipInfo: toHex(formatOrMipInfo),
            unknownHeaderB18: toHex(unknownHeaderB18)
        });

        offset = nextOffset;
    }

    if (offset !== buffer.length) {
        throw new Error(`CDF texture parser stopped at 0x${offset.toString(16)} but file length is 0x${buffer.length.toString(16)}.`);
    }

    return records;
}

function findIffMetadataTable(buffer, expectedCount) {
    const candidates = [];
    const requiredRecords = expectedCount || 1;

    for (let offset = 0; offset + (requiredRecords * IFF_METADATA_RECORD_SIZE) <= buffer.length; offset++) {
        let score = 0;
        for (let i = 0; i < Math.min(requiredRecords, 8); i++) {
            const recordOffset = offset + (i * IFF_METADATA_RECORD_SIZE);
            const metadataMagic = readUInt32BE(buffer, recordOffset + 0x04);
            const constantTwo = readUInt32BE(buffer, recordOffset + 0x08);
            if (metadataMagic === TEAMSELECTLOGO_IFF_METADATA_MAGIC) score += 2;
            if (constantTwo === 2) score += 1;
        }

        if (score >= Math.min(requiredRecords, 8) * 2) {
            candidates.push({ offset, score });
        }
    }

    if (candidates.length <= 0) return null;
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
    const cdfRecords = parseCdfTextureRecords(cdfBuffer);

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

    const conversionResults = [];
    const recordsToProcess = Number.isInteger(limit) && limit > 0 ? mergedRecords.slice(0, limit) : mergedRecords;

    for (const record of recordsToProcess) {
        const recordName = `${String(record.index).padStart(4, '0')}_${safeName(record.recordIdHex)}`;
        const recordDir = path.join(recordsDir, recordName);
        await mkdir(recordDir);

        const payloadBuffer = cdfBuffer.slice(record.payloadOffset, record.nextOffset);
        const fullRecordBuffer = cdfBuffer.slice(record.offset, record.nextOffset);
        const payloadPath = path.join(recordDir, `${recordName}.payload.bin`);
        const fullRecordPath = path.join(recordDir, `${recordName}.cdftex`);
        const payloadAsGtfPath = path.join(recordDir, `${recordName}.payload.gtf`);
        const fullRecordAsGtfPath = path.join(recordDir, `${recordName}.record.gtf`);

        if (dumpPayloads || convertDds) {
            await fs.writeFile(payloadPath, payloadBuffer);
        }

        if (dumpFullRecords || convertDds) {
            await fs.writeFile(fullRecordPath, fullRecordBuffer);
        }

        if (dumpHeaders) {
            await fs.writeFile(
                path.join(recordDir, `${recordName}.header.bin`),
                cdfBuffer.slice(record.offset, record.payloadOffset)
            );
        }

        const recordManifest = { ...record };

        if (convertDds) {
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
        parser: 'cdf-texture-records-v1',
        fileSize: cdfBuffer.length,
        recordCount: mergedRecords.length,
        processedRecordCount: recordsToProcess.length,
        iffMetadataOffset: iffInfo.metadataOffset,
        iffMetadataCount: iffInfo.records.length,
        matchedIffMetadataCount: mergedRecords.filter((record) => record.iffMetadataMatched).length,
        convertDds,
        conversionSummary: convertDds ? {
            gtf2ddsPath,
            convertedCount: conversionResults.filter((result) => result.converted).length,
            failedCount: conversionResults.filter((result) => !result.converted).length
        } : null,
        notes: [
            'teamselectlogo.cdf is a sequential CDF texture-record container, not fully encrypted.',
            'Each parsed record starts with magic 0x0e4837c3 and uses a 0xB0-byte CDF texture header.',
            'The corresponding IFF contains a 20-byte-per-record metadata table with matching record IDs.',
            'DDS conversion tries both the raw payload and the full CDF texture record as GTF candidates; failures preserve raw payloads for wrapper refinement.'
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