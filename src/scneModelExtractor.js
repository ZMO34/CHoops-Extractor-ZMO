const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const TOOL_WRAPPER_MAGIC = 0x326b546c; // 2kTl
const PACKAGE_HEADER_SIZE = 0x54;
const TEXTURE_HEADER_SIZE = 0xB0;
const MODEL_PART_RECORD_SIZE = 0xB0;
const MODEL_PART_FIELD_COUNT = MODEL_PART_RECORD_SIZE / 4;

const MODEL_PART_FIELD_MAP = [
    'renderObjectOffsetPlusOne',
    'partHashOrId',
    'lodOrVisibilityFlag',
    'unknownConstant0A',
    'boundingRadiusOrScaleFloat',
    'unknownConstant04',
    'zero06',
    'zero07',
    'zero08',
    'zero09',
    'zero10',
    'zero11',
    'boundsCenterXFloat',
    'boundsCenterYFloat',
    'boundsCenterZFloat',
    'transformWFloat',
    'zero16',
    'zero17',
    'zero18',
    'scaleXFloat',
    'scaleYFloat',
    'scaleZFloat',
    'zero22',
    'zero23',
    'sectionACount',
    'sectionAOffsetPlusOne',
    'zero26',
    'zero27',
    'zero28',
    'zero29',
    'zero30',
    'sectionBCount',
    'sectionBOffsetPlusOne',
    'sectionCCountUsuallyOne',
    'sectionCOffsetPlusOne',
    'zero35',
    'zero36',
    'sectionDCount',
    'zero38',
    'sectionDOffsetPlusOne',
    'zero40',
    'indexBufferFormatOrStrideFlags',
    'indexCountU16',
    'indexBufferDataOffsetPlusOne'
];

function readUInt32Safe(buf, offset) {
    if (!buf || offset < 0 || offset + 4 > buf.length) {
        return null;
    }

    return buf.readUInt32BE(offset);
}

function readFloat32Safe(buf, offset) {
    if (!buf || offset < 0 || offset + 4 > buf.length) {
        return null;
    }

    return buf.readFloatBE(offset);
}

function firstBytesHex(buf, length = 16) {
    return buf.slice(0, Math.min(length, buf.length)).toString('hex').match(/../g)?.join(' ') || '';
}

function safeName(name) {
    return String(name || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function toHex32(value) {
    return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function oneBasedOffset(value) {
    return value > 0 ? value - 1 : null;
}

function unwrapToolWrapper(buf) {
    if (buf.length < 0x0C || buf.readUInt32BE(0) !== TOOL_WRAPPER_MAGIC) {
        return {
            hadToolWrapper: false,
            packageBuffer: buf,
            blocks: [{ index: 0, offset: 0, length: buf.length }]
        };
    }

    const blockCount = buf.readUInt16BE(0x0A);
    const headerLength = 0x0C + (blockCount * 4);

    if (blockCount <= 0 || headerLength > buf.length) {
        return {
            hadToolWrapper: true,
            invalidToolWrapper: true,
            packageBuffer: buf,
            blocks: [{ index: 0, offset: 0, length: buf.length }]
        };
    }

    const blocks = [];
    let cursor = headerLength;
    for (let i = 0; i < blockCount; i++) {
        const length = buf.readUInt32BE(0x0C + (i * 4));
        blocks.push({ index: i, offset: cursor, length });
        cursor += length;
    }

    return {
        hadToolWrapper: true,
        packageBuffer: Buffer.concat(blocks.map((block) => buf.slice(block.offset, block.offset + block.length))),
        blocks
    };
}

function decodeModelPartFields(fields) {
    const named = {};
    fields.forEach((value, index) => {
        named[MODEL_PART_FIELD_MAP[index] || `field_${index}`] = value;
    });

    return {
        ...named,
        renderObjectOffset: oneBasedOffset(fields[0]),
        sectionAOffset: oneBasedOffset(fields[25]),
        sectionBOffset: oneBasedOffset(fields[32]),
        sectionCOffset: oneBasedOffset(fields[34]),
        sectionDOffset: oneBasedOffset(fields[39]),
        indexBufferDataOffset: oneBasedOffset(fields[43]),
        partHashOrIdHex: toHex32(fields[1]),
        boundingRadiusOrScale: readFloat32FromUInt32(fields[4]),
        boundsCenter: [
            readFloat32FromUInt32(fields[12]),
            readFloat32FromUInt32(fields[13]),
            readFloat32FromUInt32(fields[14])
        ],
        transformW: readFloat32FromUInt32(fields[15]),
        scale: [
            readFloat32FromUInt32(fields[19]),
            readFloat32FromUInt32(fields[20]),
            readFloat32FromUInt32(fields[21])
        ]
    };
}

function readFloat32FromUInt32(value) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value >>> 0, 0);
    return buf.readFloatBE(0);
}

function readIndexPreview(dataBlock, offset, count, maxValues = 32) {
    if (offset === null || offset < 0 || offset >= dataBlock.length || count <= 0) {
        return [];
    }

    const values = [];
    const limit = Math.min(count, maxValues, Math.floor((dataBlock.length - offset) / 2));
    for (let i = 0; i < limit; i++) {
        values.push(dataBlock.readUInt16BE(offset + (i * 2)));
    }

    return values;
}

function parseScnePackage(buf) {
    const unwrapped = unwrapToolWrapper(buf);
    const packageBuffer = unwrapped.packageBuffer;

    if (packageBuffer.length < PACKAGE_HEADER_SIZE) {
        throw new Error('SCNE package is too small to contain a package header.');
    }

    const header = {
        nameOffset: readUInt32Safe(packageBuffer, 0x00),
        unk1: readUInt32Safe(packageBuffer, 0x04),
        unk2: readUInt32Safe(packageBuffer, 0x08),
        unk3: readUInt32Safe(packageBuffer, 0x0C),
        unk4: readUInt32Safe(packageBuffer, 0x10),
        unk5: readUInt32Safe(packageBuffer, 0x14),
        unk6: readUInt32Safe(packageBuffer, 0x18),
        unk7: readUInt32Safe(packageBuffer, 0x1C),
        numberOfTextures: readUInt32Safe(packageBuffer, 0x20),
        relativeTextureOffset: readUInt32Safe(packageBuffer, 0x24),
        unk8: readUInt32Safe(packageBuffer, 0x28),
        unk9: readUInt32Safe(packageBuffer, 0x2C),
        unk10: readUInt32Safe(packageBuffer, 0x30),
        unk11: readUInt32Safe(packageBuffer, 0x34),
        unk12: readUInt32Safe(packageBuffer, 0x38),
        unk13: readUInt32Safe(packageBuffer, 0x3C),
        unk14: readUInt32Safe(packageBuffer, 0x40),
        numberOfModelParts: readUInt32Safe(packageBuffer, 0x44),
        relativeModelPartsOffset: readUInt32Safe(packageBuffer, 0x48),
        unk15: readUInt32Safe(packageBuffer, 0x4C),
        unk16: readUInt32Safe(packageBuffer, 0x50)
    };

    header.textureOffset = header.relativeTextureOffset + 0x23;
    header.modelPartsOffset = header.relativeModelPartsOffset + 0x47;
    header.packageNameOffset = header.nameOffset - 1;
    header.textureHeadersEnd = header.textureOffset + (header.numberOfTextures * TEXTURE_HEADER_SIZE);
    header.modelPartsEnd = header.modelPartsOffset + (header.numberOfModelParts * MODEL_PART_RECORD_SIZE);

    const headerBlockSize = unwrapped.blocks.length >= 2 ? unwrapped.blocks[0].length : header.packageNameOffset;
    const dataBlockOffset = headerBlockSize;
    const dataBlockSize = Math.max(0, packageBuffer.length - dataBlockOffset);
    const dataBlock = unwrapped.blocks.length >= 2 ? unwrapped.blocks[1] : packageBuffer.slice(dataBlockOffset);

    const modelParts = [];
    if (header.numberOfModelParts > 0 && header.modelPartsEnd <= packageBuffer.length) {
        for (let i = 0; i < header.numberOfModelParts; i++) {
            const recordOffset = header.modelPartsOffset + (i * MODEL_PART_RECORD_SIZE);
            const record = packageBuffer.slice(recordOffset, recordOffset + MODEL_PART_RECORD_SIZE);
            const fields = [];
            for (let fieldIndex = 0; fieldIndex < MODEL_PART_FIELD_COUNT; fieldIndex++) {
                fields.push(record.readUInt32BE(fieldIndex * 4));
            }

            const decoded = decodeModelPartFields(fields);

            const headerReferences = [
                { fieldIndex: 0, name: 'renderObjectOffset', offset: decoded.renderObjectOffset },
                { fieldIndex: 25, name: 'sectionAOffset', offset: decoded.sectionAOffset },
                { fieldIndex: 32, name: 'sectionBOffset', offset: decoded.sectionBOffset },
                { fieldIndex: 34, name: 'sectionCOffset', offset: decoded.sectionCOffset },
                { fieldIndex: 39, name: 'sectionDOffset', offset: decoded.sectionDOffset }
            ].filter((ref) => ref.offset !== null && ref.offset >= 0 && ref.offset < headerBlockSize);

            const indexBufferEnd = decoded.indexBufferDataOffset !== null
                ? decoded.indexBufferDataOffset + (decoded.indexCountU16 * 2)
                : null;

            modelParts.push({
                index: i,
                recordOffset,
                recordLength: MODEL_PART_RECORD_SIZE,
                hashOrId: decoded.partHashOrIdHex,
                fields,
                mapped: decoded,
                headerReferences,
                indexBuffer: {
                    offset: decoded.indexBufferDataOffset,
                    offsetPlusOne: decoded.indexBufferDataOffsetPlusOne,
                    countU16: decoded.indexCountU16,
                    byteLength: decoded.indexCountU16 * 2,
                    endOffset: indexBufferEnd,
                    formatOrStrideFlags: toHex32(decoded.indexBufferFormatOrStrideFlags),
                    previewU16BE: readIndexPreview(dataBlock, decoded.indexBufferDataOffset, decoded.indexCountU16)
                }
            });
        }
    }

    return {
        ...unwrapped,
        header,
        headerBlockSize,
        dataBlockOffset,
        dataBlockSize,
        dataBlock,
        modelParts
    };
}

async function dumpScneModelCandidates(scneBuffer, outputPath, options = {}) {
    await mkdir(outputPath);

    const parsed = parseScnePackage(scneBuffer);
    const packageBuffer = parsed.packageBuffer;
    const header = parsed.header;

    const manifest = {
        name: options.name || 'scne',
        hadToolWrapper: parsed.hadToolWrapper,
        packageSize: packageBuffer.length,
        headerBlockSize: parsed.headerBlockSize,
        dataBlockOffset: parsed.dataBlockOffset,
        dataBlockSize: parsed.dataBlockSize,
        header,
        modelPartRecordSize: MODEL_PART_RECORD_SIZE,
        modelPartFieldMap: MODEL_PART_FIELD_MAP,
        modelParts: parsed.modelParts,
        notes: [
            'SCNE model-part records are 0xB0 bytes / 44 BE u32 fields in s000 floor.scne and arena.scne.',
            'Offsets in the model-part record are 1-based: actual offset = stored value - 1.',
            'field42/indexCountU16 and field43/indexBufferDataOffsetPlusOne point to the 16-bit BE index buffer in data block 1.',
            'The current unknowns are the sectionA/B/C/D structures and exact vertex-buffer descriptors.'
        ]
    };

    await fs.writeFile(path.join(outputPath, 'scne_package_header.bin'), packageBuffer.slice(0, PACKAGE_HEADER_SIZE));

    if (header.textureOffset > 0 && header.textureHeadersEnd <= packageBuffer.length) {
        await fs.writeFile(
            path.join(outputPath, 'scne_texture_headers.bin'),
            packageBuffer.slice(header.textureOffset, header.textureHeadersEnd)
        );
    }

    if (header.modelPartsOffset > 0 && header.modelPartsEnd <= packageBuffer.length) {
        await fs.writeFile(
            path.join(outputPath, 'scne_model_part_records.bin'),
            packageBuffer.slice(header.modelPartsOffset, header.modelPartsEnd)
        );
    }

    if (header.modelPartsEnd < header.packageNameOffset && header.packageNameOffset <= packageBuffer.length) {
        await fs.writeFile(
            path.join(outputPath, 'scne_post_model_shader_region.bin'),
            packageBuffer.slice(header.modelPartsEnd, header.packageNameOffset)
        );
    }

    for (const part of parsed.modelParts) {
        const partDir = path.join(outputPath, `model_part_${String(part.index).padStart(3, '0')}_${safeName(part.hashOrId)}`);
        await mkdir(partDir);

        await fs.writeFile(
            path.join(partDir, 'record.bin'),
            packageBuffer.slice(part.recordOffset, part.recordOffset + part.recordLength)
        );

        if (part.indexBuffer.offset !== null && part.indexBuffer.endOffset <= parsed.dataBlock.length) {
            await fs.writeFile(
                path.join(partDir, 'index_buffer.u16be.bin'),
                parsed.dataBlock.slice(part.indexBuffer.offset, part.indexBuffer.endOffset)
            );
        }

        for (const ref of part.headerReferences) {
            const refEnd = Math.min(packageBuffer.length, ref.offset + 0x400);
            await fs.writeFile(
                path.join(partDir, `${ref.name}_0x${ref.offset.toString(16)}.bin`),
                packageBuffer.slice(ref.offset, refEnd)
            );
        }
    }

    manifest.firstBytes = {
        package: firstBytesHex(packageBuffer),
        modelPartRecords: header.modelPartsEnd <= packageBuffer.length
            ? firstBytesHex(packageBuffer.slice(header.modelPartsOffset, header.modelPartsEnd))
            : ''
    };

    await fs.writeFile(path.join(outputPath, 'scne_model_manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
}

module.exports = {
    MODEL_PART_FIELD_MAP,
    parseScnePackage,
    dumpScneModelCandidates,
    unwrapToolWrapper
};