const fs = require('fs/promises');
const path = require('path');

function readU32BE(buffer, offset, fallback = 0) {
    if (!buffer || offset < 0 || offset + 4 > buffer.length) return fallback;
    return buffer.readUInt32BE(offset);
}

function readU16BE(buffer, offset, fallback = 0) {
    if (!buffer || offset < 0 || offset + 2 > buffer.length) return fallback;
    return buffer.readUInt16BE(offset);
}

function relTarget(offset, value) {
    if (!Number.isFinite(value) || value <= 0 || value === 0xFFFFFFFF) return null;
    return offset + value - 1;
}

function hex(value, width = 8) {
    if (value === null || value === undefined) return '';
    return `0x${Number(value >>> 0).toString(16).padStart(width, '0')}`;
}

function csvEscape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function toCsv(rows, fields) {
    const lines = [fields.join(',')];
    for (const row of rows) {
        lines.push(fields.map((field) => csvEscape(row[field])).join(','));
    }
    return `${lines.join('\n')}\n`;
}

function readUtf16BeNull(buffer, offset) {
    if (offset === null || offset < 0 || offset >= buffer.length) return '';
    const chars = [];
    let cursor = offset;
    while (cursor + 1 < buffer.length) {
        const code = buffer.readUInt16BE(cursor);
        if (code === 0) break;
        chars.push(String.fromCharCode(code));
        cursor += 2;
    }
    return chars.join('');
}

function scanUtf16BeStrings(buffer, minLength = 3) {
    const strings = [];
    const isPrintable = (code) => code >= 0x20 && code <= 0x7E;

    for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
        const start = offset;
        const chars = [];
        while (offset + 1 < buffer.length) {
            const code = buffer.readUInt16BE(offset);
            if (!isPrintable(code)) break;
            chars.push(String.fromCharCode(code));
            offset += 2;
        }

        if (chars.length >= minLength && offset + 1 < buffer.length && buffer.readUInt16BE(offset) === 0) {
            strings.push({ offset: start, offsetHex: hex(start), value: chars.join('') });
        }
    }

    // The scan above steps by two and can miss strings that begin on odd or non-word-aligned offsets.
    for (let offset = 1; offset + 1 < buffer.length; offset += 2) {
        const start = offset;
        const chars = [];
        while (offset + 1 < buffer.length) {
            const code = buffer.readUInt16BE(offset);
            if (!isPrintable(code)) break;
            chars.push(String.fromCharCode(code));
            offset += 2;
        }

        if (chars.length >= minLength && offset + 1 < buffer.length && buffer.readUInt16BE(offset) === 0) {
            if (!strings.some((entry) => entry.offset === start)) {
                strings.push({ offset: start, offsetHex: hex(start), value: chars.join('') });
            }
        }
    }

    strings.sort((a, b) => a.offset - b.offset);
    return strings;
}

function unwrapToolWrapped(buffer) {
    if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === '2kTl') {
        const headerLength = readU32BE(buffer, 0x04);
        const typeCode = readU16BE(buffer, 0x08);
        const blockCount = readU16BE(buffer, 0x0A);
        const blockLengths = [];
        for (let i = 0; i < blockCount; i++) {
            blockLengths.push(readU32BE(buffer, 0x0C + (i * 4)));
        }
        const blocks = [];
        let cursor = headerLength;
        for (const length of blockLengths) {
            blocks.push(buffer.slice(cursor, cursor + length));
            cursor += length;
        }
        return { wrapped: true, headerLength, typeCode, blockCount, blockLengths, blocks };
    }

    return { wrapped: false, headerLength: 0, typeCode: null, blockCount: 1, blockLengths: [buffer.length], blocks: [buffer] };
}

function parsePackageHeader(headerBlock) {
    const textureCount = readU32BE(headerBlock, 0x20);
    const relativeTextureOffset = readU32BE(headerBlock, 0x24);
    const textureOffset = relTarget(0x24, relativeTextureOffset);
    const modelPartCount = readU32BE(headerBlock, 0x44);
    const relativeModelPartsOffset = readU32BE(headerBlock, 0x48);
    const modelPartsOffset = relTarget(0x48, relativeModelPartsOffset);
    const relativePackageNameOffset = readU32BE(headerBlock, 0x00);
    const packageNameOffset = relTarget(0x00, relativePackageNameOffset);

    return {
        packageNameOffset,
        packageNameOffsetHex: hex(packageNameOffset),
        packageName: readUtf16BeNull(headerBlock, packageNameOffset),
        textureCount,
        relativeTextureOffset,
        textureOffset,
        textureOffsetHex: hex(textureOffset),
        modelPartCount,
        relativeModelPartsOffset,
        modelPartsOffset,
        modelPartsOffsetHex: hex(modelPartsOffset),
        rawWords: Array.from({ length: Math.floor(0x54 / 4) }, (_, i) => hex(readU32BE(headerBlock, i * 4)))
    };
}

function parseTextures(headerBlock, dataBlock, packageHeader) {
    const textures = [];
    if (packageHeader.textureOffset === null) return textures;

    for (let index = 0; index < packageHeader.textureCount; index++) {
        const offset = packageHeader.textureOffset + (index * 0xB0);
        if (offset + 0xB0 > headerBlock.length) break;
        const header = headerBlock.slice(offset, offset + 0xB0);
        const relativeDataOffset = readU32BE(header, 0xA4);
        const dataOffset = relativeDataOffset > 0 ? relativeDataOffset - 1 : null;
        let nextRelativeDataOffset = null;
        if (index + 1 < packageHeader.textureCount) {
            nextRelativeDataOffset = readU32BE(headerBlock, offset + 0xB0 + 0xA4);
        }
        const nextDataOffset = nextRelativeDataOffset && nextRelativeDataOffset > 0 ? nextRelativeDataOffset - 1 : dataBlock.length;
        const dataLength = dataOffset === null ? 0 : Math.max(0, nextDataOffset - dataOffset);
        const dimensionWord = readU32BE(header, 0x60);

        textures.push({
            index,
            name: `texture_${index}`,
            headerOffset: offset,
            headerOffsetHex: hex(offset),
            relativeDataOffset,
            dataOffset,
            dataOffsetHex: hex(dataOffset),
            dataLength,
            dataLengthHex: hex(dataLength),
            gtfWord58: hex(readU32BE(header, 0x58)),
            remapWord5C: hex(readU32BE(header, 0x5C)),
            dimensionWord60: hex(dimensionWord),
            dimensionWidth: dimensionWord >>> 16,
            dimensionHeight: dimensionWord & 0xFFFF,
            word64: hex(readU32BE(header, 0x64)),
            word68: hex(readU32BE(header, 0x68)),
            word6C: hex(readU32BE(header, 0x6C)),
            word70: hex(readU32BE(header, 0x70)),
            word90: hex(readU32BE(header, 0x90)),
            rawHeaderHex: header.toString('hex')
        });
    }

    return textures;
}

function parseMaterialRecords(headerBlock, stringByOffset, count, pointer) {
    const records = [];
    if (pointer === null) return records;
    for (let index = 0; index < count; index++) {
        const offset = pointer + (index * 0x30);
        if (offset + 0x30 > headerBlock.length) break;
        const namePointerRaw = readU32BE(headerBlock, offset + 0x20);
        const nameOffset = relTarget(offset + 0x20, namePointerRaw);
        const name = stringByOffset.get(nameOffset) || readUtf16BeNull(headerBlock, nameOffset);
        records.push({
            index,
            offset,
            offsetHex: hex(offset),
            name,
            nameOffset,
            nameOffsetHex: hex(nameOffset),
            namePointerRaw: hex(namePointerRaw),
            hash: hex(readU32BE(headerBlock, offset + 0x24)),
            flags28: hex(readU32BE(headerBlock, offset + 0x28)),
            flags2C: hex(readU32BE(headerBlock, offset + 0x2C)),
            rawWords: Array.from({ length: 12 }, (_, i) => hex(readU32BE(headerBlock, offset + (i * 4))))
        });
    }
    return records;
}

function parseDrawRunRecords(headerBlock, count, pointer) {
    const records = [];
    if (pointer === null) return records;
    for (let index = 0; index < count; index++) {
        const offset = pointer + (index * 0x30);
        if (offset + 0x30 > headerBlock.length) break;
        const words = Array.from({ length: 12 }, (_, i) => readU32BE(headerBlock, offset + (i * 4)));
        records.push({
            index,
            offset,
            offsetHex: hex(offset),
            constant00: words[0],
            start04: words[1],
            count08: words[2],
            span0C: words[3],
            start14: words[5],
            count18: words[6],
            drawId20: words[8],
            word2C: words[11],
            rawWords: words.map((word) => hex(word))
        });
    }
    return records;
}

function parseGeometryRecords(headerBlock, count, pointer) {
    const records = [];
    if (pointer === null) return records;
    for (let index = 0; index < count; index++) {
        const offset = pointer + (index * 0x40);
        if (offset + 0x40 > headerBlock.length) break;
        records.push({
            index,
            offset,
            offsetHex: hex(offset),
            rawWords: Array.from({ length: 16 }, (_, i) => hex(readU32BE(headerBlock, offset + (i * 4))))
        });
    }
    return records;
}

function parseDrawBufferDescriptors(headerBlock, count, pointer) {
    const records = [];
    if (pointer === null) return records;
    for (let index = 0; index < count; index++) {
        const offset = pointer + (index * 0x70);
        if (offset + 0x30 > headerBlock.length) break;
        const words = Array.from({ length: 12 }, (_, i) => readU32BE(headerBlock, offset + (i * 4)));
        records.push({
            index,
            offset,
            offsetHex: hex(offset),
            vertexCountOrSpan10: words[4],
            word14: words[5],
            word18: words[6],
            word1C: hex(words[7]),
            vertexStride20: words[8],
            vertexBufferBytes24: words[9],
            word28: hex(words[10]),
            rawWords: words.map((word) => hex(word))
        });
    }
    return records;
}

function parseModelParts(headerBlock, packageHeader, strings) {
    const stringByOffset = new Map(strings.map((entry) => [entry.offset, entry.value]));
    const parts = [];
    if (packageHeader.modelPartsOffset === null) return parts;

    for (let index = 0; index < packageHeader.modelPartCount; index++) {
        const offset = packageHeader.modelPartsOffset + (index * 0xB0);
        if (offset + 0xB0 > headerBlock.length) break;
        const namePointerRaw = readU32BE(headerBlock, offset + 0x00);
        const nameOffset = relTarget(offset + 0x00, namePointerRaw);
        const name = stringByOffset.get(nameOffset) || readUtf16BeNull(headerBlock, nameOffset);

        const materialRecordCount = readU32BE(headerBlock, offset + 0x60);
        const materialRecordsOffset = relTarget(offset + 0x64, readU32BE(headerBlock, offset + 0x64));
        const drawRunRecordCount = readU32BE(headerBlock, offset + 0x7C);
        const drawRunRecordsOffset = relTarget(offset + 0x80, readU32BE(headerBlock, offset + 0x80));
        const drawBufferDescriptorCount = readU32BE(headerBlock, offset + 0x84);
        const drawBufferDescriptorsOffset = relTarget(offset + 0x88, readU32BE(headerBlock, offset + 0x88));
        const geometryRecordCount = readU32BE(headerBlock, offset + 0x94);
        const geometryRecordsOffset = relTarget(offset + 0x9C, readU32BE(headerBlock, offset + 0x9C));

        parts.push({
            index,
            offset,
            offsetHex: hex(offset),
            name,
            nameOffset,
            nameOffsetHex: hex(nameOffset),
            namePointerRaw: hex(namePointerRaw),
            hash: hex(readU32BE(headerBlock, offset + 0x04)),
            materialRecordCount,
            materialRecordsOffset,
            materialRecordsOffsetHex: hex(materialRecordsOffset),
            drawRunRecordCount,
            drawRunRecordsOffset,
            drawRunRecordsOffsetHex: hex(drawRunRecordsOffset),
            drawBufferDescriptorCount,
            drawBufferDescriptorsOffset,
            drawBufferDescriptorsOffsetHex: hex(drawBufferDescriptorsOffset),
            geometryRecordCount,
            geometryRecordsOffset,
            geometryRecordsOffsetHex: hex(geometryRecordsOffset),
            rawDescriptorWords: Array.from({ length: Math.floor(0xB0 / 4) }, (_, i) => hex(readU32BE(headerBlock, offset + (i * 4)))),
            materialRecords: parseMaterialRecords(headerBlock, stringByOffset, materialRecordCount, materialRecordsOffset),
            drawRunRecords: parseDrawRunRecords(headerBlock, drawRunRecordCount, drawRunRecordsOffset),
            drawBufferDescriptors: parseDrawBufferDescriptors(headerBlock, drawBufferDescriptorCount, drawBufferDescriptorsOffset),
            geometryRecords: parseGeometryRecords(headerBlock, geometryRecordCount, geometryRecordsOffset)
        });
    }

    return parts;
}

function flattenDrawRecords(fileName, packageHeader, parts) {
    const rows = [];
    for (const part of parts) {
        const materialNames = part.materialRecords.map((record) => record.name).join('|');
        for (const record of part.drawRunRecords) {
            rows.push({
                file: fileName,
                packageName: packageHeader.packageName,
                partIndex: part.index,
                partName: part.name,
                materialNames,
                recordIndex: record.index,
                drawId20: record.drawId20,
                start04: record.start04,
                count08: record.count08,
                span0C: record.span0C,
                start14: record.start14,
                count18: record.count18,
                recordOffsetHex: record.offsetHex,
                partOffsetHex: part.offsetHex
            });
        }
    }
    return rows;
}

function flattenTextures(fileName, textures) {
    return textures.map((texture) => ({
        file: fileName,
        index: texture.index,
        name: texture.name,
        dimensionWidth: texture.dimensionWidth,
        dimensionHeight: texture.dimensionHeight,
        dataOffsetHex: texture.dataOffsetHex,
        dataLengthHex: texture.dataLengthHex,
        dataLength: texture.dataLength,
        gtfWord58: texture.gtfWord58,
        remapWord5C: texture.remapWord5C,
        dimensionWord60: texture.dimensionWord60,
        word68: texture.word68,
        word90: texture.word90
    }));
}

function buildMarkdown(inputPath, parsed) {
    const lines = [];
    lines.push(`# SCNE floor dump: ${path.basename(inputPath)}`);
    lines.push('');
    lines.push(`Wrapped: ${parsed.wrapper.wrapped}`);
    lines.push(`Blocks: ${parsed.wrapper.blockLengths.map((value) => `0x${value.toString(16)}`).join(', ')}`);
    lines.push(`Package name: ${parsed.packageHeader.packageName || '(empty)'}`);
    lines.push(`Textures: ${parsed.packageHeader.textureCount}`);
    lines.push(`Model parts: ${parsed.packageHeader.modelPartCount}`);
    lines.push('');
    lines.push('## Model parts');
    lines.push('');
    for (const part of parsed.modelParts) {
        lines.push(`### ${part.index}: ${part.name}`);
        lines.push('');
        lines.push(`- materials: ${part.materialRecords.map((record) => `${record.index}:${record.name}`).join(', ') || '(none)'}`);
        lines.push(`- draw/run records: ${part.drawRunRecordCount}`);
        lines.push(`- draw-buffer descriptors: ${part.drawBufferDescriptorCount}`);
        lines.push(`- geometry/declaration records: ${part.geometryRecordCount}`);
        lines.push('');
        lines.push('| rec | drawId20 | start04 | count08 | span0C | start14 | count18 |');
        lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
        for (const record of part.drawRunRecords) {
            lines.push(`| ${record.index} | ${record.drawId20} | ${record.start04} | ${record.count08} | ${record.span0C} | ${record.start14} | ${record.count18} |`);
        }
        lines.push('');
    }

    lines.push('## Texture headers');
    lines.push('');
    lines.push('| texture | dimensions | data offset | data length | word58 | word5C | word68 |');
    lines.push('| ---: | --- | ---: | ---: | --- | --- | --- |');
    for (const texture of parsed.textures) {
        lines.push(`| ${texture.index} | ${texture.dimensionWidth}x${texture.dimensionHeight} | ${texture.dataOffsetHex} | ${texture.dataLengthHex} | ${texture.gtfWord58} | ${texture.remapWord5C} | ${texture.word68} |`);
    }
    lines.push('');

    return `${lines.join('\n')}\n`;
}

async function inspectScneFloor(inputPath, outputPath) {
    const input = await fs.readFile(inputPath);
    const wrapper = unwrapToolWrapped(input);
    if (wrapper.blocks.length < 2) {
        throw new Error('Expected a tool-wrapped SCNE with two blocks: header and texture data.');
    }

    const headerBlock = wrapper.blocks[0];
    const dataBlock = wrapper.blocks[1];
    const packageHeader = parsePackageHeader(headerBlock);
    const strings = scanUtf16BeStrings(headerBlock);
    const textures = parseTextures(headerBlock, dataBlock, packageHeader);
    const modelParts = parseModelParts(headerBlock, packageHeader, strings);

    const parsed = {
        inputPath,
        fileName: path.basename(inputPath),
        fileSize: input.length,
        wrapper,
        packageHeader,
        strings,
        textures,
        modelParts
    };

    // Do not serialize raw block buffers.
    parsed.wrapper = {
        wrapped: wrapper.wrapped,
        headerLength: wrapper.headerLength,
        typeCode: wrapper.typeCode,
        blockCount: wrapper.blockCount,
        blockLengths: wrapper.blockLengths
    };

    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(path.join(outputPath, 'floor_scne_dump.json'), JSON.stringify(parsed, null, 2));
    await fs.writeFile(path.join(outputPath, 'floor_scne_summary.md'), buildMarkdown(inputPath, parsed));
    await fs.writeFile(path.join(outputPath, 'textures.csv'), toCsv(flattenTextures(path.basename(inputPath), textures), [
        'file', 'index', 'name', 'dimensionWidth', 'dimensionHeight', 'dataOffsetHex', 'dataLengthHex', 'dataLength', 'gtfWord58', 'remapWord5C', 'dimensionWord60', 'word68', 'word90'
    ]));
    await fs.writeFile(path.join(outputPath, 'draw_records.csv'), toCsv(flattenDrawRecords(path.basename(inputPath), packageHeader, modelParts), [
        'file', 'packageName', 'partIndex', 'partName', 'materialNames', 'recordIndex', 'drawId20', 'start04', 'count08', 'span0C', 'start14', 'count18', 'recordOffsetHex', 'partOffsetHex'
    ]));

    return parsed;
}

module.exports = {
    inspectScneFloor,
    _internal: {
        unwrapToolWrapped,
        parsePackageHeader,
        parseTextures,
        parseModelParts,
        scanUtf16BeStrings
    }
};