const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const TOOL_WRAPPER_MAGIC = 0x326b546c; // 2kTl
const PACKAGE_HEADER_SIZE = 0x54;
const TEXTURE_HEADER_SIZE = 0xB0;
const MODEL_PART_RECORD_SIZE = 0xB0;
const MODEL_PART_FIELD_COUNT = MODEL_PART_RECORD_SIZE / 4;
const MATERIAL_RECORD_SIZE = 0x30;
const DRAW_RUN_RECORD_SIZE = 0x30;
const VERTEX_BUFFER_DESCRIPTOR_SIZE = 0x30;
const VERTEX_ATTRIBUTE_RECORD_SIZE = 0x40;

const MODEL_PART_FIELD_MAP = [
    'renderObjectNameOffsetRelative',
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
    'sectionACount_materials',
    'sectionAOffsetRelative_materials',
    'zero26',
    'zero27',
    'zero28',
    'zero29',
    'zero30',
    'sectionBCount_drawRuns',
    'sectionBOffsetRelative_drawRuns',
    'sectionCCount_vertexBufferDescriptors',
    'sectionCOffsetRelative_vertexBufferDescriptors',
    'zero35',
    'zero36',
    'sectionDCount_vertexAttributeDeclarations',
    'zero38',
    'sectionDOffsetRelative_vertexAttributeDeclarations',
    'zero40',
    'indexBufferFormatOrPrimitiveFlags',
    'indexCountU16',
    'indexBufferDataOffsetPlusOne'
];

const VERTEX_USAGE_NAMES = {
    0x00: 'POSITION',
    0x03: 'COLOR_OR_NORMAL_TANGENT',
    0x07: 'PACKED_AUX_OR_COLOR',
    0x08: 'TEXCOORD0_UV',
    0x09: 'TEXCOORD1_UV_OR_LIGHTMAP'
};

const VERTEX_FORMAT_NAMES = {
    0x01: 'unknown_or_packed',
    0x02: 'float32',
    0x03: 'half_float_or_packed_u16',
    0x04: 'packed_color_or_packed_normal',
    0x07: 'packed_4byte_aux'
};

function readUInt32Safe(buf, offset) {
    if (!buf || offset < 0 || offset + 4 > buf.length) return null;
    return buf.readUInt32BE(offset);
}

function firstBytesHex(buf, length = 16) {
    return buf.slice(0, Math.min(length, buf.length)).toString('hex').match(/../g)?.join(' ') || '';
}

function safeName(name) {
    return String(name || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function toHex32(value) {
    if (value === null || value === undefined) return null;
    return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

function oneBasedOffset(value) {
    return value > 0 && value !== 0xFFFFFFFF ? value - 1 : null;
}

function relativeOffset(pointerFieldAbsoluteOffset, value) {
    return value > 0 && value !== 0xFFFFFFFF ? pointerFieldAbsoluteOffset + value - 1 : null;
}

function align(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
}

function readFloat32FromUInt32(value) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value >>> 0, 0);
    return buf.readFloatBE(0);
}

function readUtf16BeNull(buf, offset) {
    if (offset === null || offset === undefined || offset < 0 || offset >= buf.length) return '';
    const chars = [];
    for (let cursor = offset; cursor + 1 < buf.length; cursor += 2) {
        const code = buf.readUInt16BE(cursor);
        if (code === 0) break;
        chars.push(String.fromCharCode(code));
    }
    return chars.join('');
}

function unwrapToolWrapper(buf) {
    if (buf.length < 0x0C || buf.readUInt32BE(0) !== TOOL_WRAPPER_MAGIC) {
        return {
            hadToolWrapper: false,
            packageBuffer: buf,
            blocks: [{ index: 0, offset: 0, length: buf.length, data: buf }]
        };
    }

    const blockCount = buf.readUInt16BE(0x0A);
    const headerLength = buf.readUInt32BE(0x04);
    const tableEnd = 0x0C + (blockCount * 4);

    if (blockCount <= 0 || tableEnd > buf.length || headerLength > buf.length) {
        return {
            hadToolWrapper: true,
            invalidToolWrapper: true,
            packageBuffer: buf,
            blocks: [{ index: 0, offset: 0, length: buf.length, data: buf }]
        };
    }

    const blocks = [];
    let cursor = headerLength;
    for (let i = 0; i < blockCount; i++) {
        const length = buf.readUInt32BE(0x0C + (i * 4));
        const data = buf.slice(cursor, cursor + length);
        blocks.push({ index: i, offset: cursor, length, data });
        cursor += length;
    }

    return {
        hadToolWrapper: true,
        packageBuffer: Buffer.concat(blocks.map((block) => block.data)),
        blocks
    };
}

function getBlockBuffer(unwrapped, index, fallbackOffset) {
    if (unwrapped.blocks.length > index && unwrapped.blocks[index].data) {
        return unwrapped.blocks[index].data;
    }

    return unwrapped.packageBuffer.slice(fallbackOffset);
}

function decodeModelPartFields(fields, recordOffset) {
    const named = {};
    fields.forEach((value, index) => {
        named[MODEL_PART_FIELD_MAP[index] || `field_${index}`] = value;
    });

    return {
        ...named,
        renderObjectNameOffset: relativeOffset(recordOffset + 0x00, fields[0]),
        sectionAOffset: relativeOffset(recordOffset + 0x64, fields[25]),
        sectionBOffset: relativeOffset(recordOffset + 0x80, fields[32]),
        sectionCOffset: relativeOffset(recordOffset + 0x88, fields[34]),
        sectionDOffset: relativeOffset(recordOffset + 0x9C, fields[39]),
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

function readIndexPreview(dataBlock, offset, count, maxValues = 32) {
    if (offset === null || offset < 0 || offset >= dataBlock.length || count <= 0) return [];
    const values = [];
    const limit = Math.min(count, maxValues, Math.floor((dataBlock.length - offset) / 2));
    for (let i = 0; i < limit; i++) values.push(dataBlock.readUInt16BE(offset + (i * 2)));
    return values;
}

function readMaxIndex(dataBlock, offset, count) {
    if (offset === null || offset < 0 || offset >= dataBlock.length || count <= 0) return null;
    let maxIndex = 0;
    const limit = Math.min(count, Math.floor((dataBlock.length - offset) / 2));
    for (let i = 0; i < limit; i++) {
        const value = dataBlock.readUInt16BE(offset + (i * 2));
        if (value !== 0xFFFF && value > maxIndex) maxIndex = value;
    }
    return maxIndex;
}

function parseMaterialRecords(packageBuffer, offset, count) {
    const records = [];
    if (offset === null || count <= 0) return records;

    for (let i = 0; i < count; i++) {
        const recordOffset = offset + (i * MATERIAL_RECORD_SIZE);
        if (recordOffset < 0 || recordOffset + MATERIAL_RECORD_SIZE > packageBuffer.length) break;
        const fields = [];
        for (let j = 0; j < MATERIAL_RECORD_SIZE / 4; j++) fields.push(packageBuffer.readUInt32BE(recordOffset + (j * 4)));
        const nameOffset = relativeOffset(recordOffset + 0x20, fields[8]);
        records.push({
            index: i,
            offset: recordOffset,
            fields,
            rgbaOrParams0: fields.slice(0, 4).map(toHex32),
            rgbaOrParams1: fields.slice(4, 8).map(toHex32),
            nameOffset,
            name: readUtf16BeNull(packageBuffer, nameOffset),
            hash: toHex32(fields[9]),
            flags28: toHex32(fields[10]),
            flags2C: toHex32(fields[11])
        });
    }

    return records;
}

function parseDrawRunRecords(packageBuffer, offset, count) {
    const records = [];
    if (offset === null || count <= 0) return records;

    for (let i = 0; i < count; i++) {
        const recordOffset = offset + (i * DRAW_RUN_RECORD_SIZE);
        if (recordOffset < 0 || recordOffset + DRAW_RUN_RECORD_SIZE > packageBuffer.length) break;
        const fields = [];
        for (let j = 0; j < DRAW_RUN_RECORD_SIZE / 4; j++) fields.push(packageBuffer.readUInt32BE(recordOffset + (j * 4)));
        records.push({
            index: i,
            offset: recordOffset,
            fields,
            constant00: fields[0],
            indexStart: fields[1],
            indexCount: fields[2],
            triangleStripSpan: fields[3],
            zero10: fields[4],
            vertexStart: fields[5],
            vertexCount: fields[6],
            zero1C: fields[7],
            drawPassId: fields[8],
            zero24: fields[9],
            zero28: fields[10],
            renderPassFlag: fields[11]
        });
    }

    return records;
}

function parseVertexBufferDescriptorRecord(packageBuffer, offset, index = 0) {
    if (offset === null || offset < 0 || offset + VERTEX_BUFFER_DESCRIPTOR_SIZE > packageBuffer.length) return null;

    const fields = [];
    for (let i = 0; i < VERTEX_BUFFER_DESCRIPTOR_SIZE / 4; i++) fields.push(packageBuffer.readUInt32BE(offset + (i * 4)));

    const vertexCount = fields[4];
    const streamOrBufferCount = fields[5];
    const attributeCount = fields[6];
    const primitiveOrFlags = fields[7];
    const vertexStride = fields[8];
    const vertexBufferByteLength = fields[9];
    const vertexBufferDataOffset = oneBasedOffset(fields[10]);

    return {
        index,
        offset,
        fields,
        vertexCount,
        streamOrBufferCount,
        attributeCount,
        primitiveOrFlags: toHex32(primitiveOrFlags),
        vertexStride,
        vertexBufferByteLength,
        vertexBufferDataOffset,
        vertexBufferDataOffsetPlusOne: fields[10],
        declarations: []
    };
}

function parseVertexBufferDescriptors(packageBuffer, offset, count) {
    const descriptors = [];
    if (offset === null || count <= 0) return descriptors;
    for (let i = 0; i < count; i++) {
        const descriptor = parseVertexBufferDescriptorRecord(packageBuffer, offset + (i * VERTEX_BUFFER_DESCRIPTOR_SIZE), i);
        if (descriptor) descriptors.push(descriptor);
    }
    return descriptors;
}

function parseVertexDescriptor(packageBuffer, offset) {
    // Compatibility scanner for old research manifests. This detects the compact
    // seven-word descriptor that starts at +0x10 inside the real 0x30 Section C record.
    if (offset < 0 || offset + 0x1C > packageBuffer.length) return null;
    const values = [];
    for (let i = 0; i < 7; i++) values.push(packageBuffer.readUInt32BE(offset + (i * 4)));
    const vertexCount = values[0];
    const streamOrBufferCount = values[1];
    const attributeCount = values[2];
    const primitiveOrFlags = values[3];
    const vertexStride = values[4];
    const vertexBufferByteLength = values[5];
    const vertexBufferDataOffset = oneBasedOffset(values[6]);

    if (
        vertexCount <= 0
        || vertexCount > 200000
        || ![0x20, 0x24, 0x18, 0x1C, 0x28, 0x30].includes(vertexStride)
        || vertexBufferByteLength !== vertexCount * vertexStride
        || vertexBufferDataOffset === null
    ) {
        return null;
    }

    return {
        offset,
        values,
        vertexCount,
        streamOrBufferCount,
        attributeCount,
        primitiveOrFlags: toHex32(primitiveOrFlags),
        vertexStride,
        vertexBufferByteLength,
        vertexBufferDataOffset,
        vertexBufferDataOffsetPlusOne: values[6],
        declarations: []
    };
}

function parseVertexDescriptors(packageBuffer) {
    const descriptors = [];
    for (let offset = 0; offset + 0x1C <= packageBuffer.length; offset += 4) {
        const descriptor = parseVertexDescriptor(packageBuffer, offset);
        if (descriptor) descriptors.push(descriptor);
    }
    return descriptors;
}

function parseVertexAttributeDeclaration(packageBuffer, offset, actualVertexStride = null, index = 0) {
    if (offset < 0 || offset + 0x10 > packageBuffer.length) return null;

    const semanticHashA = packageBuffer.readUInt32BE(offset);
    const semanticHashB = packageBuffer.readUInt32BE(offset + 4);
    const declarationPacked = packageBuffer.readUInt32BE(offset + 8);
    const formatPacked = packageBuffer.readUInt32BE(offset + 12);

    const declarationCode = (declarationPacked >>> 24) & 0xFF;
    const byteOffset = (declarationPacked >>> 16) & 0xFF;
    const format = (formatPacked >>> 24) & 0xFF;
    const componentCount = (formatPacked >>> 16) & 0xFF;
    const usage = (formatPacked >>> 8) & 0xFF;
    const usageIndex = formatPacked & 0xFF;
    const vertexStride = actualVertexStride || declarationCode;

    if (
        byteOffset >= Math.max(vertexStride, 1)
        || format <= 0
        || format > 8
        || componentCount <= 0
        || componentCount > 4
        || usage > 0x20
    ) {
        return null;
    }

    return {
        index,
        offset,
        recordSize: VERTEX_ATTRIBUTE_RECORD_SIZE,
        semanticHashA: toHex32(semanticHashA),
        semanticHashB: toHex32(semanticHashB),
        declarationPacked: toHex32(declarationPacked),
        formatPacked: toHex32(formatPacked),
        declarationCode,
        vertexStride,
        byteOffset,
        format,
        formatName: VERTEX_FORMAT_NAMES[format] || 'unknown',
        componentCount,
        usage,
        usageName: VERTEX_USAGE_NAMES[usage] || `USAGE_${usage}`,
        usageIndex
    };
}

function parseVertexAttributeDeclarations(packageBuffer, offset = null, count = null, actualVertexStride = null) {
    const declarations = [];

    if (offset !== null && count !== null) {
        for (let i = 0; i < count; i++) {
            const declaration = parseVertexAttributeDeclaration(
                packageBuffer,
                offset + (i * VERTEX_ATTRIBUTE_RECORD_SIZE),
                actualVertexStride,
                i
            );
            if (declaration) declarations.push(declaration);
        }
        return declarations;
    }

    // Compatibility scanner. Prefer the pointer-based path above for real parsing.
    for (let scanOffset = 0; scanOffset + 0x10 <= packageBuffer.length; scanOffset += 4) {
        const declaration = parseVertexAttributeDeclaration(packageBuffer, scanOffset, actualVertexStride, declarations.length);
        if (declaration) declarations.push(declaration);
    }
    return declarations;
}

function readAttributePreview(dataBlock, vertexDescriptor, declaration, maxVertices = 4) {
    const values = [];
    const vertexCount = Math.min(vertexDescriptor.vertexCount, maxVertices);

    for (let i = 0; i < vertexCount; i++) {
        const baseOffset = vertexDescriptor.vertexBufferDataOffset
            + (i * vertexDescriptor.vertexStride)
            + declaration.byteOffset;

        if (baseOffset < 0 || baseOffset >= dataBlock.length) break;

        const components = [];
        for (let c = 0; c < declaration.componentCount; c++) {
            const componentOffset = baseOffset + (c * 4);
            if (declaration.format === 0x02 && componentOffset + 4 <= dataBlock.length) {
                components.push(dataBlock.readFloatBE(componentOffset));
            }
            else if (declaration.format === 0x03 && baseOffset + (c * 2) + 2 <= dataBlock.length) {
                components.push(dataBlock.readUInt16BE(baseOffset + (c * 2)));
            }
            else if ((declaration.format === 0x04 || declaration.format === 0x07) && baseOffset + c < dataBlock.length) {
                components.push(dataBlock[baseOffset + c]);
            }
        }
        values.push(components);
    }

    return values;
}

function attachDeclarationPreviews(vertexDescriptor, dataBlock) {
    vertexDescriptor.declarations = (vertexDescriptor.declarations || []).map((declaration) => ({
        ...declaration,
        preview: readAttributePreview(dataBlock, vertexDescriptor, declaration)
    }));
    return vertexDescriptor;
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
    const dataBlock = getBlockBuffer(unwrapped, 1, dataBlockOffset);
    const dataBlockSize = dataBlock.length;

    const modelParts = [];
    if (header.numberOfModelParts > 0 && header.modelPartsEnd <= packageBuffer.length) {
        for (let i = 0; i < header.numberOfModelParts; i++) {
            const recordOffset = header.modelPartsOffset + (i * MODEL_PART_RECORD_SIZE);
            const record = packageBuffer.slice(recordOffset, recordOffset + MODEL_PART_RECORD_SIZE);
            const fields = [];
            for (let fieldIndex = 0; fieldIndex < MODEL_PART_FIELD_COUNT; fieldIndex++) {
                fields.push(record.readUInt32BE(fieldIndex * 4));
            }

            const decoded = decodeModelPartFields(fields, recordOffset);
            const materials = parseMaterialRecords(packageBuffer, decoded.sectionAOffset, decoded.sectionACount_materials);
            const drawRuns = parseDrawRunRecords(packageBuffer, decoded.sectionBOffset, decoded.sectionBCount_drawRuns);
            const vertexBuffers = parseVertexBufferDescriptors(packageBuffer, decoded.sectionCOffset, decoded.sectionCCount_vertexBufferDescriptors);

            vertexBuffers.forEach((vertexBuffer) => {
                vertexBuffer.declarations = parseVertexAttributeDeclarations(
                    packageBuffer,
                    decoded.sectionDOffset,
                    decoded.sectionDCount_vertexAttributeDeclarations,
                    vertexBuffer.vertexStride
                );
                attachDeclarationPreviews(vertexBuffer, dataBlock);
            });

            const headerReferences = [
                { fieldIndex: 0, name: 'renderObjectNameOffset', offset: decoded.renderObjectNameOffset },
                { fieldIndex: 25, name: 'sectionAOffset_materials', offset: decoded.sectionAOffset },
                { fieldIndex: 32, name: 'sectionBOffset_drawRuns', offset: decoded.sectionBOffset },
                { fieldIndex: 34, name: 'sectionCOffset_vertexBufferDescriptor', offset: decoded.sectionCOffset },
                { fieldIndex: 39, name: 'sectionDOffset_vertexAttributeDeclarations', offset: decoded.sectionDOffset }
            ].filter((ref) => ref.offset !== null && ref.offset >= 0 && ref.offset < headerBlockSize);

            const indexBufferEnd = decoded.indexBufferDataOffset !== null
                ? decoded.indexBufferDataOffset + (decoded.indexCountU16 * 2)
                : null;
            const maxIndex = readMaxIndex(dataBlock, decoded.indexBufferDataOffset, decoded.indexCountU16);

            const part = {
                index: i,
                name: readUtf16BeNull(packageBuffer, decoded.renderObjectNameOffset),
                recordOffset,
                recordLength: MODEL_PART_RECORD_SIZE,
                hashOrId: decoded.partHashOrIdHex,
                fields,
                mapped: decoded,
                materials,
                drawRuns,
                vertexBuffers,
                headerReferences,
                indexBuffer: {
                    offset: decoded.indexBufferDataOffset,
                    offsetPlusOne: decoded.indexBufferDataOffsetPlusOne,
                    countU16: decoded.indexCountU16,
                    byteLength: decoded.indexCountU16 * 2,
                    endOffset: indexBufferEnd,
                    alignedEndOffset: indexBufferEnd !== null ? align(indexBufferEnd, 4) : null,
                    maxIndex,
                    inferredVertexCountFromIndices: maxIndex !== null ? maxIndex + 1 : null,
                    formatOrStrideFlags: toHex32(decoded.indexBufferFormatOrPrimitiveFlags),
                    previewU16BE: readIndexPreview(dataBlock, decoded.indexBufferDataOffset, decoded.indexCountU16)
                }
            };

            if (vertexBuffers.length > 0) {
                part.vertexBuffer = vertexBuffers[0];
                part.uvDeclarations = part.vertexBuffer.declarations.filter((decl) => decl.usage === 0x08 || decl.usage === 0x09);
            }

            modelParts.push(part);
        }
    }

    const vertexDescriptors = modelParts.flatMap((part) => part.vertexBuffers || []);
    const vertexDeclarations = vertexDescriptors.flatMap((descriptor) => descriptor.declarations || []);

    return {
        ...unwrapped,
        header,
        headerBlockSize,
        dataBlockOffset,
        dataBlockSize,
        dataBlock,
        vertexDeclarations,
        vertexDescriptors,
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
        materialRecordLayout: [
            '0x00-0x1F material/color params',
            '0x20 relative UTF-16BE material name pointer',
            '0x24 material hash/id',
            '0x28 material/color-routing flags',
            '0x2C material/layer-routing flags'
        ],
        drawRunRecordLayout: [
            'constant00',
            'indexStart',
            'indexCount',
            'triangleStripSpan = indexCount - 2',
            'zero10',
            'vertexStart',
            'vertexCount',
            'zero1C',
            'drawPassId',
            'zero24',
            'zero28',
            'renderPassFlag'
        ],
        vertexBufferDescriptorLayout: [
            '0x00-0x0F zeros/reserved',
            '0x10 vertexCount',
            '0x14 streamOrBufferCount',
            '0x18 attributeCount',
            '0x1C primitiveOrFlags',
            '0x20 vertexStride',
            '0x24 vertexBufferByteLength',
            '0x28 vertexBufferDataOffsetPlusOne',
            '0x2C zero/reserved'
        ],
        vertexAttributeDeclarationLayout: [
            '0x00 semanticHashA',
            '0x04 semanticHashB',
            '0x08 packed declaration: declarationCode / attribute byteOffset / reserved',
            '0x0C packed format: format / componentCount / usage / usageIndex',
            '0x10-0x3F zero padding in floor.scne'
        ],
        vertexDescriptors: parsed.vertexDescriptors,
        modelParts: parsed.modelParts,
        notes: [
            'SCNE floor model-part records are 0xB0 bytes / 44 big-endian u32 fields.',
            'Section A is material records, Section B is draw-run records, Section C is vertex-buffer descriptors, Section D is vertex attribute declarations.',
            'Section pointers in model-part records are relative to the pointer field location: target = fieldOffset + storedValue - 1.',
            'Index-buffer data offsets are absolute one-based offsets into tool-wrapper data block 1.',
            'Section C records are 0x30 bytes. The useful vertex-buffer descriptor begins at +0x10 inside that record.',
            'Section D records are 0x40 bytes. The first 0x10 bytes contain the declaration; the rest is padding in known floor.scne samples.',
            'The stable floor vertex layout is stride 0x24: POSITION float3 at +0x00, float4 auxiliary at +0x0C, UV0 half2 at +0x1C, packed auxiliary/color at +0x20.',
            'Primary UV declarations use usage 0x08. Secondary UV/lightmap declarations, when present, use usage 0x09.'
        ]
    };

    await fs.writeFile(path.join(outputPath, 'scne_package_header.bin'), packageBuffer.slice(0, PACKAGE_HEADER_SIZE));

    if (header.textureOffset > 0 && header.textureHeadersEnd <= packageBuffer.length) {
        await fs.writeFile(path.join(outputPath, 'scne_texture_headers.bin'), packageBuffer.slice(header.textureOffset, header.textureHeadersEnd));
    }

    if (header.modelPartsOffset > 0 && header.modelPartsEnd <= packageBuffer.length) {
        await fs.writeFile(path.join(outputPath, 'scne_model_part_records.bin'), packageBuffer.slice(header.modelPartsOffset, header.modelPartsEnd));
    }

    if (header.modelPartsEnd < header.packageNameOffset && header.packageNameOffset <= packageBuffer.length) {
        await fs.writeFile(path.join(outputPath, 'scne_post_model_shader_region.bin'), packageBuffer.slice(header.modelPartsEnd, header.packageNameOffset));
    }

    for (const part of parsed.modelParts) {
        const partDir = path.join(outputPath, `model_part_${String(part.index).padStart(3, '0')}_${safeName(part.name || part.hashOrId)}`);
        await mkdir(partDir);

        await fs.writeFile(path.join(partDir, 'record.bin'), packageBuffer.slice(part.recordOffset, part.recordOffset + part.recordLength));

        if (part.indexBuffer.offset !== null && part.indexBuffer.endOffset <= parsed.dataBlock.length) {
            await fs.writeFile(path.join(partDir, 'index_buffer.u16be.bin'), parsed.dataBlock.slice(part.indexBuffer.offset, part.indexBuffer.endOffset));
        }

        if (part.vertexBuffer && part.vertexBuffer.vertexBufferDataOffset + part.vertexBuffer.vertexBufferByteLength <= parsed.dataBlock.length) {
            await fs.writeFile(
                path.join(partDir, 'vertex_buffer.bin'),
                parsed.dataBlock.slice(
                    part.vertexBuffer.vertexBufferDataOffset,
                    part.vertexBuffer.vertexBufferDataOffset + part.vertexBuffer.vertexBufferByteLength
                )
            );
        }

        for (const ref of part.headerReferences) {
            const refEnd = Math.min(packageBuffer.length, ref.offset + 0x400);
            await fs.writeFile(path.join(partDir, `${ref.name}_0x${ref.offset.toString(16)}.bin`), packageBuffer.slice(ref.offset, refEnd));
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
    VERTEX_USAGE_NAMES,
    VERTEX_FORMAT_NAMES,
    parseScnePackage,
    parseVertexDescriptors,
    parseVertexDescriptor,
    parseVertexAttributeDeclarations,
    parseVertexAttributeDeclaration,
    parseVertexBufferDescriptors,
    parseVertexBufferDescriptorRecord,
    parseMaterialRecords,
    parseDrawRunRecords,
    dumpScneModelCandidates,
    unwrapToolWrapper
};