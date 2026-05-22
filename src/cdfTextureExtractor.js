const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const CDF_TEXTURE_MAGIC = 0x0e4837c3;

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

function findNextMagic(buffer, startOffset) {
    const magicBytes = Buffer.from([0x0e, 0x48, 0x37, 0xc3]);
    return buffer.indexOf(magicBytes, startOffset);
}

function parseCdfTextureRecords(buffer) {
    const records = [];

    let offset = findNextMagic(buffer, 0);

    while (offset >= 0 && offset < buffer.length) {
        const nextMagic = findNextMagic(buffer, offset + 4);
        const nextOffset = nextMagic >= 0 ? nextMagic : buffer.length;

        const recordHeaderSize = readUInt32BE(buffer, offset + 0x04);
        const headerASize = readUInt32BE(buffer, offset + 0x08);
        const payloadOffset = offset + (recordHeaderSize || 0xB0);

        records.push({
            index: records.length,
            offset,
            nextOffset,
            size: nextOffset - offset,
            recordHeaderSize,
            headerASize,
            payloadOffset,
            payloadSize: Math.max(0, nextOffset - payloadOffset),
            recordIdHex: toHex(readUInt32BE(buffer, offset + 0x15)),
            widthOrTileWidth: readUInt32BE(buffer, offset + 0x6A),
            heightOrTileHeight: readUInt32BE(buffer, offset + 0x6E),
            structuralMismatch: false,
            usedFallbackBoundary: true
        });

        offset = nextMagic;
    }

    return records;
}

async function extractCdfTextureRecords(cdfPath, outputPath, options = {}) {
    await mkdir(outputPath);

    const buffer = await fs.readFile(cdfPath);
    const records = parseCdfTextureRecords(buffer);

    const recordsDir = path.join(outputPath, 'records');
    await mkdir(recordsDir);

    const limit = options.limit
        ? Number.parseInt(options.limit, 10)
        : records.length;

    const selectedRecords = records.slice(0, limit);

    for (const record of selectedRecords) {
        const recordName = `${String(record.index).padStart(4, '0')}_${record.recordIdHex}`;
        const recordDir = path.join(recordsDir, recordName);

        await mkdir(recordDir);

        const fullRecordBuffer = buffer.slice(record.offset, record.nextOffset);
        const payloadBuffer = buffer.slice(record.payloadOffset, record.nextOffset);

        await fs.writeFile(
            path.join(recordDir, `${recordName}.cdftex`),
            fullRecordBuffer
        );

        await fs.writeFile(
            path.join(recordDir, `${recordName}.payload.bin`),
            payloadBuffer
        );

        await fs.writeFile(
            path.join(recordDir, `${recordName}.json`),
            JSON.stringify(record, null, 2)
        );
    }

    const manifest = {
        sourceCdf: cdfPath,
        outputPath,
        recordCount: records.length,
        processedRecordCount: selectedRecords.length,
        parser: 'fallback-magic-scan'
    };

    await fs.writeFile(
        path.join(outputPath, 'cdf_texture_manifest.json'),
        JSON.stringify(manifest, null, 2)
    );

    return manifest;
}

module.exports = {
    CDF_TEXTURE_MAGIC,
    parseCdfTextureRecords,
    extractCdfTextureRecords
};