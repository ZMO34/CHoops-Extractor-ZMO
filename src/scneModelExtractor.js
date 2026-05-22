const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const TOOL_WRAPPER_MAGIC = 0x326b546c; // 2kTl
const PACKAGE_HEADER_SIZE = 0x54;
const TEXTURE_HEADER_SIZE = 0xB0;
const MODEL_PART_RECORD_SIZE = 0xB0;

function readUInt32Safe(buf, offset) {
    if (!buf || offset < 0 || offset + 4 > buf.length) {
        return null;
    }

    return buf.readUInt32BE(offset);
}

function firstBytesHex(buf, length = 16) {
    return buf.slice(0, Math.min(length, buf.length)).toString('hex').match(/../g)?.join(' ') || '';
}

function safeName(name) {
    return String(name || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
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

    const modelParts = [];
    if (header.numberOfModelParts > 0 && header.modelPartsEnd <= packageBuffer.length) {
        for (let i = 0; i < header.numberOfModelParts; i++) {
            const recordOffset = header.modelPartsOffset + (i * MODEL_PART_RECORD_SIZE);
            const record = packageBuffer.slice(recordOffset, recordOffset + MODEL_PART_RECORD_SIZE);
            const fields = [];
            for (let fieldIndex = 0; fieldIndex < MODEL_PART_RECORD_SIZE / 4; fieldIndex++) {
                fields.push(record.readUInt32BE(fieldIndex * 4));
            }

            const headerReferences = [];
            fields.forEach((value, fieldIndex) => {
                if (value > 0 && value < headerBlockSize) {
                    headerReferences.push({ fieldIndex, offset: value });
                }
            });

            const dataReferences = [];
            fields.forEach((value, fieldIndex) => {
                if (value > 0 && value < dataBlockSize) {
                    dataReferences.push({ fieldIndex, offset: value });
                }
            });

            modelParts.push({
                index: i,
                recordOffset,
                recordLength: MODEL_PART_RECORD_SIZE,
                possibleNameOrDataOffset: fields[0],
                hashOrId: `0x${fields[1].toString(16).padStart(8, '0')}`,
                fields,
                headerReferences,
                dataReferences
            });
        }
    }

    return {
        ...unwrapped,
        header,
        headerBlockSize,
        dataBlockOffset,
        dataBlockSize,
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
        modelParts: parsed.modelParts,
        notes: [
            'This is a diagnostic SCNE model-part export, not a final OBJ/FBX converter yet.',
            'The current known SCNE reader extracts textures but did not parse these model part records.',
            'Model part records are 0xB0 bytes in the tested s000 floor.scne and arena.scne files.',
            'The dumped regions are intended for mapping vertex/index buffer layout next.'
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

        const refOffsets = [...new Set(part.headerReferences.map((ref) => ref.offset))]
            .filter((offset) => offset >= 0 && offset < packageBuffer.length)
            .sort((a, b) => a - b)
            .slice(0, 32);

        for (let i = 0; i < refOffsets.length; i++) {
            const refOffset = refOffsets[i];
            const refEnd = Math.min(packageBuffer.length, refOffset + 0x400);
            await fs.writeFile(
                path.join(partDir, `header_ref_${String(i).padStart(2, '0')}_0x${refOffset.toString(16)}.bin`),
                packageBuffer.slice(refOffset, refEnd)
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
    parseScnePackage,
    dumpScneModelCandidates,
    unwrapToolWrapper
};
