const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

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
    await mkdir(recordsDir);

    const dumpPayloads = options.dumpPayloads !== false && options.dumpPayloads !== 'false';
    const dumpFullRecords = options.dumpFullRecords === true || options.dumpFullRecords === 'true';
    const dumpHeaders = options.dumpHeaders === true || options.dumpHeaders === 'true';

    for (const record of mergedRecords) {
        const recordName = `${String(record.index).padStart(4, '0')}_${safeName(record.recordIdHex)}`;
        const recordDir = path.join(recordsDir, recordName);
        await mkdir(recordDir);

        if (dumpPayloads) {
            await fs.writeFile(
                path.join(recordDir, `${recordName}.payload.bin`),
                cdfBuffer.slice(record.payloadOffset, record.nextOffset)
            );
        }

        if (dumpFullRecords) {
            await fs.writeFile(
                path.join(recordDir, `${recordName}.cdftex`),
                cdfBuffer.slice(record.offset, record.nextOffset)
            );
        }

        if (dumpHeaders) {
            await fs.writeFile(
                path.join(recordDir, `${recordName}.header.bin`),
                cdfBuffer.slice(record.offset, record.payloadOffset)
            );
        }

        await fs.writeFile(path.join(recordDir, `${recordName}.json`), JSON.stringify(record, null, 2));
    }

    const manifest = {
        sourceCdf: cdfPath,
        sourceIff: options.iffPath || null,
        outputPath,
        parser: 'cdf-texture-records-v1',
        fileSize: cdfBuffer.length,
        recordCount: mergedRecords.length,
        iffMetadataOffset: iffInfo.metadataOffset,
        iffMetadataCount: iffInfo.records.length,
        matchedIffMetadataCount: mergedRecords.filter((record) => record.iffMetadataMatched).length,
        notes: [
            'teamselectlogo.cdf is a sequential CDF texture-record container, not fully encrypted.',
            'Each parsed record starts with magic 0x0e4837c3 and uses a 0xB0-byte CDF texture header.',
            'The corresponding IFF contains a 20-byte-per-record metadata table with matching record IDs.',
            'Payloads are currently dumped as raw CDF texture payloads; DDS/GTF conversion is a separate next step.'
        ],
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
