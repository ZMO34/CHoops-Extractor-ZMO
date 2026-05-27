const path = require('path');
const fs = require('fs/promises');
const mkdir = require('make-dir');

const ddsUtil = require('./ddsUtil');
const h7aCompressionUtil = require('../2k-tools/src/util/h7aCompressionUtil');

const CDF_BACKED_IFF_MAGIC = 0xF0985030;
const STANDARD_IFF_MAGIC = 0xFF3BEF94;
const NAME_TABLE_MAGIC = 0xAA171516;
const CDF_TEXTURE_MAGIC = 0x0E4837C3;
const GTF_MAGIC = 0x01080000;
const TYPE_HASHES = {
    0x1AEDDA1F: 'AUDO',
    0x5C36FB69: 'TXTR'
};

function safeName(value) {
    return String(value || 'record').replace(/[<>:"/\\|?*]/g, '_');
}

function readUInt32BE(buffer, offset, fallback = null) {
    if (!buffer || offset < 0 || offset + 4 > buffer.length) return fallback;
    return buffer.readUInt32BE(offset);
}

function readUInt32LE(buffer, offset, fallback = null) {
    if (!buffer || offset < 0 || offset + 4 > buffer.length) return fallback;
    return buffer.readUInt32LE(offset);
}

function toHex(value) {
    if (value === null || value === undefined) return null;
    return `0x${Number(value >>> 0).toString(16).padStart(8, '0')}`;
}

function readUtf16BeNull(buffer, offset) {
    if (offset < 0 || offset >= buffer.length) return '';

    let end = offset;
    while (end + 1 < buffer.length) {
        if (buffer.readUInt16BE(end) === 0) break;
        end += 2;
    }

    const chars = [];
    for (let cursor = offset; cursor + 1 < end; cursor += 2) {
        chars.push(String.fromCharCode(buffer.readUInt16BE(cursor)));
    }
    return chars.join('');
}

function readUtf16LeNull(buffer, offset) {
    if (offset < 0 || offset >= buffer.length) return '';

    let end = offset;
    while (end + 1 < buffer.length) {
        if (buffer.readUInt16LE(end) === 0) break;
        end += 2;
    }

    return buffer.toString('utf16le', offset, end);
}

function relativeTarget(pointerOffset, pointerValue) {
    if (!Number.isFinite(pointerValue) || pointerValue <= 0) return null;
    return pointerOffset + pointerValue - 1;
}

function parseNameTable(buffer, nameTableOffset, expectedCount) {
    const result = { present: false, offset: nameTableOffset, size: 0, names: [] };

    if (nameTableOffset === null || nameTableOffset < 0 || nameTableOffset + 8 > buffer.length) return result;
    if (readUInt32BE(buffer, nameTableOffset) !== NAME_TABLE_MAGIC) return result;

    const bodySize = readUInt32LE(buffer, nameTableOffset + 4, 0);
    const bodyOffset = nameTableOffset + 8;
    const bodyEnd = Math.min(buffer.length, bodyOffset + bodySize);
    const body = buffer.slice(bodyOffset, bodyEnd);

    result.present = true;
    result.size = bodySize;

    const count = readUInt32LE(body, 0, 0);
    const pointerTableStart = relativeTarget(4, readUInt32LE(body, 4, 0));
    const limit = Math.min(expectedCount || count, count);

    if (pointerTableStart === null || pointerTableStart < 0 || pointerTableStart >= body.length) return result;

    for (let i = 0; i < limit; i++) {
        const pointerOffset = pointerTableStart + (i * 4);
        if (pointerOffset + 4 > body.length) break;

        const entryOffset = relativeTarget(pointerOffset, readUInt32LE(body, pointerOffset, 0));
        if (entryOffset === null || entryOffset < 0 || entryOffset + 8 > body.length) {
            result.names.push(null);
            continue;
        }

        const nameOffset = relativeTarget(entryOffset, readUInt32LE(body, entryOffset, 0));
        const typeOffset = relativeTarget(entryOffset + 4, readUInt32LE(body, entryOffset + 4, 0));

        result.names.push({
            name: nameOffset === null ? `${i}` : readUtf16LeNull(body, nameOffset),
            type: typeOffset === null ? 'UNKNOWN' : readUtf16LeNull(body, typeOffset).replace(/\0+$/g, '')
        });
    }

    return result;
}

function parseCdfBackedIff(buffer) {
    const magic = readUInt32BE(buffer, 0);
    if (magic !== CDF_BACKED_IFF_MAGIC) {
        throw new Error(`Not a CDF-backed IFF. Magic=${toHex(magic)}`);
    }

    const metadataEnd = readUInt32BE(buffer, 0x04, 0);
    const blockCount = readUInt32BE(buffer, 0x10, 0);
    const recordCount = readUInt32BE(buffer, 0x18, 0);
    const segmentTablePointer = readUInt32BE(buffer, 0x20, 0);
    const cdfNamePointer = readUInt32BE(buffer, 0x24, 0);
    const segmentPointerTableOffset = relativeTarget(0x20, segmentTablePointer);
    const cdfNameOffset = relativeTarget(0x24, cdfNamePointer);
    const cdfName = cdfNameOffset === null ? null : readUtf16BeNull(buffer, cdfNameOffset);
    const nameTable = parseNameTable(buffer, metadataEnd, recordCount);

    const records = [];
    const primaryPointerTableOffset = 0x68;

    for (let i = 0; i < recordCount; i++) {
        const primaryPointerOffset = primaryPointerTableOffset + (i * 4);
        const primaryRecordOffset = relativeTarget(primaryPointerOffset, readUInt32BE(buffer, primaryPointerOffset, 0));

        let segmentDescriptorOffset = null;
        if (segmentPointerTableOffset !== null) {
            const segmentPointerOffset = segmentPointerTableOffset + (i * 4);
            segmentDescriptorOffset = relativeTarget(segmentPointerOffset, readUInt32BE(buffer, segmentPointerOffset, 0));
        }

        const nameEntry = nameTable.names[i] || null;
        const id = primaryRecordOffset === null ? null : readUInt32BE(buffer, primaryRecordOffset, null);
        const typeHash = primaryRecordOffset === null ? null : readUInt32BE(buffer, primaryRecordOffset + 4, null);
        const type = nameEntry && nameEntry.type ? nameEntry.type : (TYPE_HASHES[typeHash] || 'UNKNOWN');
        const name = nameEntry && nameEntry.name ? nameEntry.name : `${type.toLowerCase()}_${String(i).padStart(4, '0')}`;

        records.push({
            index: i,
            name,
            type,
            id,
            idHex: toHex(id),
            typeHash,
            typeHashHex: toHex(typeHash),
            primaryRecordOffset,
            offsetCount: primaryRecordOffset === null ? null : readUInt32BE(buffer, primaryRecordOffset + 8, null),
            virtualHeaderOffset: primaryRecordOffset === null ? null : readUInt32BE(buffer, primaryRecordOffset + 0x0C, null),
            virtualPayloadOffset: primaryRecordOffset === null ? null : readUInt32BE(buffer, primaryRecordOffset + 0x10, null),
            segmentDescriptorOffset,
            segmentHeaderOffset: segmentDescriptorOffset === null ? null : readUInt32BE(buffer, segmentDescriptorOffset, null),
            segmentHeaderLength: segmentDescriptorOffset === null ? null : readUInt32BE(buffer, segmentDescriptorOffset + 4, null),
            payloadOffset: segmentDescriptorOffset === null ? null : readUInt32BE(buffer, segmentDescriptorOffset + 8, null),
            payloadLength: segmentDescriptorOffset === null ? null : readUInt32BE(buffer, segmentDescriptorOffset + 0x0C, null)
        });
    }

    return {
        family: 'cdf-backed-iff',
        magic: toHex(magic),
        metadataEnd,
        blockCount,
        recordCount,
        segmentPointerTableOffset,
        cdfNameOffset,
        cdfName,
        nameTable,
        records
    };
}

function getCdfFamily(parsed) {
    const types = new Set(parsed.records.map((record) => record.type));
    if (types.size === 1 && types.has('AUDO')) return 'audio_interleaved_cdf';
    if (types.has('TXTR')) return 'texture_h7a_cdf';
    return 'unknown_cdf';
}

function validateRecordAgainstCdf(record, cdfBuffer) {
    const inBounds = record.segmentHeaderOffset !== null
        && record.segmentHeaderLength !== null
        && record.payloadOffset !== null
        && record.payloadLength !== null
        && record.segmentHeaderOffset >= 0
        && record.payloadOffset >= 0
        && record.segmentHeaderOffset + record.segmentHeaderLength <= cdfBuffer.length
        && record.payloadOffset + record.payloadLength <= cdfBuffer.length;

    const contiguous = inBounds && record.segmentHeaderOffset + record.segmentHeaderLength === record.payloadOffset;
    const h7aTexturePayload = inBounds && record.type === 'TXTR' && readUInt32BE(cdfBuffer, record.payloadOffset) === CDF_TEXTURE_MAGIC;
    const gtfPayload = inBounds && record.type === 'TXTR' && readUInt32BE(cdfBuffer, record.payloadOffset) === GTF_MAGIC;
    const audioLengthMatches = inBounds
        && record.type === 'AUDO'
        && record.segmentHeaderLength >= 0x24
        && readUInt32BE(cdfBuffer, record.segmentHeaderOffset + 0x18) === record.payloadLength;

    return { inBounds, contiguous, h7aTexturePayload, gtfPayload, audioLengthMatches };
}

function parseH7aWrapper(payload) {
    if (!payload || payload.length < 0x14 || readUInt32BE(payload, 0) !== CDF_TEXTURE_MAGIC) return null;

    const uncompressedLength = readUInt32BE(payload, 0x04, 0);
    const compressedLength = readUInt32BE(payload, 0x08, 0);
    const unknown0C = readUInt32BE(payload, 0x0C, 0);
    const shiftAmount = readUInt32BE(payload, 0x10, 0);
    const compressedDataOffset = 0x14;
    const compressedDataLength = Math.max(0, Math.min(payload.length, compressedLength) - compressedDataOffset);

    return {
        container: 'H7A-compressed texture payload',
        magic: toHex(CDF_TEXTURE_MAGIC),
        uncompressedLength,
        compressedLength,
        actualPayloadLength: payload.length,
        unknown0C,
        shiftAmount,
        compressedDataOffset,
        compressedDataLength,
        isCompressed: uncompressedLength !== compressedLength
    };
}

function mipPayloadSize(width, height, format, mipMapCount) {
    return ddsUtil.payloadSizeFor(width, height, format, mipMapCount);
}

function inferDdsLayoutFromDecodedLength(decodedLength) {
    const candidates = [
        { width: 256, height: 256, format: 'DXT5', mipMapCount: 9 },
        { width: 256, height: 128, format: 'DXT5', mipMapCount: 8 },
        { width: 256, height: 256, format: 'DXT1', mipMapCount: 9 },
        { width: 256, height: 128, format: 'DXT1', mipMapCount: 8 },
        { width: 512, height: 256, format: 'DXT5', mipMapCount: 10 },
        { width: 512, height: 256, format: 'DXT1', mipMapCount: 10 },
        { width: 128, height: 128, format: 'DXT5', mipMapCount: 8 },
        { width: 128, height: 128, format: 'DXT1', mipMapCount: 8 }
    ];

    return candidates.find((candidate) => {
        return mipPayloadSize(candidate.width, candidate.height, candidate.format, candidate.mipMapCount) === decodedLength;
    }) || null;
}

function decodeH7aTexturePayload(payload) {
    const h7a = parseH7aWrapper(payload);
    if (!h7a) return null;
    if (h7a.compressedLength !== payload.length) {
        throw new Error(`Invalid H7A compressed length: wrapper=0x${h7a.compressedLength.toString(16)}, actual=0x${payload.length.toString(16)}`);
    }

    const compressedBytes = payload.slice(h7a.compressedDataOffset, h7a.compressedDataOffset + h7a.compressedDataLength);
    const decoded = h7aCompressionUtil.decompress(compressedBytes, h7a.uncompressedLength, h7a.shiftAmount);
    const layout = inferDdsLayoutFromDecodedLength(decoded.length);

    return { h7a, decoded, layout };
}

async function extractCdfBackedPair({ iffName, iffBuffer, cdfBuffer, outputDir, textureReader, logger, rawType }) {
    const parsed = parseCdfBackedIff(iffBuffer);
    const family = getCdfFamily(parsed);
    const summary = {
        family,
        cdfName: parsed.cdfName,
        recordCount: parsed.recordCount,
        extractedRecords: 0,
        ddsConverted: 0,
        audioPayloads: 0,
        h7aCompressedTextures: 0,
        h7aDecompressedTextures: 0,
        errors: []
    };

    if (!cdfBuffer) {
        throw new Error(`CDF-backed IFF ${iffName} points to ${parsed.cdfName}, but the CDF payload was not provided.`);
    }

    for (const record of parsed.records) {
        const validation = validateRecordAgainstCdf(record, cdfBuffer);
        if (!validation.inBounds) {
            summary.errors.push(`${record.index}:${record.name}: segment out of bounds`);
            continue;
        }

        const typeFolder = safeName(record.type.toUpperCase());
        const recordDir = path.join(outputDir, typeFolder, safeName(record.name));
        await mkdir(recordDir);

        const header = cdfBuffer.slice(record.segmentHeaderOffset, record.segmentHeaderOffset + record.segmentHeaderLength);
        const payload = cdfBuffer.slice(record.payloadOffset, record.payloadOffset + record.payloadLength);
        await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.cdf_segment_header.bin`), header);

        if (record.type === 'TXTR') {
            await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.cdftex`), Buffer.concat([header, payload]));
            await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.h7a`), payload);

            let textureManifest = {
                index: record.index,
                name: record.name,
                id: record.idHex,
                type: record.type,
                cdfSegmentHeaderLength: header.length,
                cdfPayloadLength: payload.length
            };

            if (validation.h7aTexturePayload) {
                summary.h7aCompressedTextures += 1;
                try {
                    const decodedTexture = decodeH7aTexturePayload(payload);
                    if (decodedTexture) {
                        const decodedPath = path.join(recordDir, `${safeName(record.name)}.decoded_texture.bin`);
                        await fs.writeFile(decodedPath, decodedTexture.decoded);

                        textureManifest.h7a = decodedTexture.h7a;
                        textureManifest.decodedTextureLength = decodedTexture.decoded.length;
                        textureManifest.decodedTexturePath = path.basename(decodedPath);
                        textureManifest.ddsLayout = decodedTexture.layout;

                        summary.h7aDecompressedTextures += 1;

                        if (!rawType && decodedTexture.layout) {
                            const dds = ddsUtil.wrapDds(decodedTexture.decoded, {
                                width: decodedTexture.layout.width,
                                height: decodedTexture.layout.height,
                                fourCC: decodedTexture.layout.format,
                                mipMapCount: decodedTexture.layout.mipMapCount
                            });
                            await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.dds`), dds);
                            summary.ddsConverted += 1;
                        }
                        else if (!decodedTexture.layout) {
                            summary.errors.push(`${record.index}:${record.name}: H7A decoded, but DDS layout could not be inferred for length 0x${decodedTexture.decoded.length.toString(16)}`);
                        }
                    }
                }
                catch (err) {
                    textureManifest.h7aDecodeError = err.message || String(err);
                    summary.errors.push(`${record.index}:${record.name}: H7A decode failed: ${err.message || err}`);
                }
            }
            else if (!rawType && validation.gtfPayload && textureReader) {
                const dds = await textureReader.toDDSFromGTFBuffer(payload, record.name, { quiet: true });
                if (dds) {
                    await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.dds`), dds);
                    summary.ddsConverted += 1;
                }
            }

            await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.texture_manifest.json`), JSON.stringify(textureManifest, null, 2));
        }
        else if (record.type === 'AUDO') {
            await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.audio_payload.bin`), payload);
            summary.audioPayloads += 1;
        }
        else {
            await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.payload.bin`), payload);
        }

        summary.extractedRecords += 1;

        if (logger) {
            logger.info(`[CDF-IFF] ${iffName}/${record.name}.${record.type.toLowerCase()} id=${record.idHex} header=0x${record.segmentHeaderOffset.toString(16)}+${record.segmentHeaderLength} payload=0x${record.payloadOffset.toString(16)}+${record.payloadLength}`);
        }
    }

    return { parsed, summary };
}

module.exports = {
    CDF_BACKED_IFF_MAGIC,
    STANDARD_IFF_MAGIC,
    CDF_TEXTURE_MAGIC,
    parseCdfBackedIff,
    extractCdfBackedPair,
    getCdfFamily,
    parseH7aWrapper,
    decodeH7aTexturePayload,
    inferDdsLayoutFromDecodedLength
};