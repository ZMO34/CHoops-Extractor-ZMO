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
    const body = buffer.slice(nameTableOffset + 8, Math.min(buffer.length, nameTableOffset + 8 + bodySize));
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
    const segmentPointerTableOffset = relativeTarget(0x20, readUInt32BE(buffer, 0x20, 0));
    const cdfNameOffset = relativeTarget(0x24, readUInt32BE(buffer, 0x24, 0));
    const cdfName = cdfNameOffset === null ? null : readUtf16BeNull(buffer, cdfNameOffset);
    const nameTable = parseNameTable(buffer, metadataEnd, recordCount);
    const records = [];

    for (let i = 0; i < recordCount; i++) {
        const primaryPointerOffset = 0x68 + (i * 4);
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
    if (types.has('TXTR')) return 'texture_cdf';
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
    const payloadMagic = inBounds ? readUInt32BE(cdfBuffer, record.payloadOffset) : null;
    return {
        inBounds,
        contiguous: inBounds && record.segmentHeaderOffset + record.segmentHeaderLength === record.payloadOffset,
        payloadMagic: toHex(payloadMagic),
        h7aTexturePayload: inBounds && record.type === 'TXTR' && payloadMagic === CDF_TEXTURE_MAGIC,
        gtfPayload: inBounds && record.type === 'TXTR' && payloadMagic === GTF_MAGIC,
        audioLengthMatches: inBounds && record.type === 'AUDO' && record.segmentHeaderLength >= 0x24
            && readUInt32BE(cdfBuffer, record.segmentHeaderOffset + 0x18) === record.payloadLength
    };
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

function maxMipCountFor(width, height) {
    let levels = 1;
    let w = width;
    let h = height;
    while (w > 1 || h > 1) {
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
        levels += 1;
    }
    return levels;
}

function scoreDdsLayoutCandidate(candidate) {
    const fullMipCount = maxMipCountFor(candidate.width, candidate.height);
    const aspectLog2 = Math.abs(Math.log2(candidate.width / candidate.height));
    const portraitPenalty = candidate.width < candidate.height ? 3 : 0;
    const extremeAspectPenalty = aspectLog2 > 3 ? 12 : (aspectLog2 > 2 ? 5 : 0);
    const formatPenalty = candidate.format === 'DXT5' ? 0 : 1;
    const mipPenalty = candidate.mipMapCount === fullMipCount ? 0 : (candidate.mipMapCount > 1 ? 1 : 2);
    const commonLongSidePenalty = [128, 256, 512, 1024].includes(Math.max(candidate.width, candidate.height)) ? 0 : 1;
    const commonShortSidePenalty = [64, 128, 256, 512].includes(Math.min(candidate.width, candidate.height)) ? 0 : 1;
    return (formatPenalty * 1000) + (mipPenalty * 100) + (aspectLog2 * 10) + portraitPenalty + extremeAspectPenalty + commonLongSidePenalty + commonShortSidePenalty;
}

function inferDdsLayoutsFromDecodedLength(decodedLength) {
    const widths = [32, 64, 128, 256, 512, 1024, 2048];
    const heights = [32, 64, 128, 256, 512, 1024, 2048];
    const formats = ['DXT5', 'DXT1'];
    const matches = [];
    for (const format of formats) {
        for (const width of widths) {
            for (const height of heights) {
                const maxMips = maxMipCountFor(width, height);
                for (let mipMapCount = 1; mipMapCount <= maxMips; mipMapCount++) {
                    const payloadSize = ddsUtil.payloadSizeFor(width, height, format, mipMapCount);
                    if (payloadSize !== decodedLength) continue;
                    const match = { width, height, format, mipMapCount, payloadSize };
                    match.score = scoreDdsLayoutCandidate(match);
                    matches.push(match);
                }
            }
        }
    }
    matches.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        if (areaA !== areaB) return areaA - areaB;
        return b.width - a.width;
    });
    return matches;
}

function inferDdsLayoutFromDecodedLength(decodedLength) {
    const matches = inferDdsLayoutsFromDecodedLength(decodedLength);
    return matches.length > 0 ? matches[0] : null;
}

function decodeH7aTexturePayload(payload) {
    const h7a = parseH7aWrapper(payload);
    if (!h7a) return null;
    if (h7a.compressedLength !== payload.length) {
        throw new Error(`Invalid H7A compressed length: wrapper=0x${h7a.compressedLength.toString(16)}, actual=0x${payload.length.toString(16)}`);
    }
    const compressedBytes = payload.slice(h7a.compressedDataOffset, h7a.compressedDataOffset + h7a.compressedDataLength);
    const decoded = h7aCompressionUtil.decompress(compressedBytes, h7a.uncompressedLength, h7a.shiftAmount);
    const layoutCandidates = inferDdsLayoutsFromDecodedLength(decoded.length);
    const layout = layoutCandidates.length > 0 ? layoutCandidates[0] : null;
    return { h7a, decoded, layout, layoutCandidates };
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
        gtfTextures: 0,
        h7aCompressedTextures: 0,
        h7aDecompressedTextures: 0,
        unknownTexturePayloads: 0,
        errors: []
    };

    if (!cdfBuffer) throw new Error(`CDF-backed IFF ${iffName} points to ${parsed.cdfName}, but the CDF payload was not provided.`);

    for (const record of parsed.records) {
        const validation = validateRecordAgainstCdf(record, cdfBuffer);
        if (!validation.inBounds) {
            summary.errors.push(`${record.index}:${record.name}: segment out of bounds`);
            continue;
        }
        const header = cdfBuffer.slice(record.segmentHeaderOffset, record.segmentHeaderOffset + record.segmentHeaderLength);
        const payload = cdfBuffer.slice(record.payloadOffset, record.payloadOffset + record.payloadLength);

        if (record.type !== 'TXTR') {
            if (record.type === 'AUDO') summary.audioPayloads += 1;
            summary.extractedRecords += 1;
            continue;
        }

        const recordDir = path.join(outputDir, safeName(record.type.toUpperCase()), safeName(record.name));
        await mkdir(recordDir);
        let wroteDds = false;

        if (validation.h7aTexturePayload) {
            summary.h7aCompressedTextures += 1;
            try {
                const decodedTexture = decodeH7aTexturePayload(payload);
                if (decodedTexture && decodedTexture.layout && !rawType) {
                    const dds = ddsUtil.wrapDds(decodedTexture.decoded, {
                        width: decodedTexture.layout.width,
                        height: decodedTexture.layout.height,
                        fourCC: decodedTexture.layout.format,
                        mipMapCount: decodedTexture.layout.mipMapCount
                    });
                    await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.dds`), dds);
                    summary.ddsConverted += 1;
                    wroteDds = true;
                }
                if (decodedTexture) summary.h7aDecompressedTextures += 1;
                if (decodedTexture && !decodedTexture.layout) {
                    summary.errors.push(`${record.index}:${record.name}: H7A decoded, but DDS layout could not be inferred for length 0x${decodedTexture.decoded.length.toString(16)}`);
                }
            }
            catch (err) {
                summary.errors.push(`${record.index}:${record.name}: H7A decode failed: ${err.message || err}`);
            }
        }
        else if (validation.gtfPayload) {
            summary.gtfTextures += 1;
            if (!rawType && textureReader) {
                const dds = await textureReader.toDDSFromGTFBuffer(payload, record.name, { quiet: true });
                if (dds) {
                    await fs.writeFile(path.join(recordDir, `${safeName(record.name)}.dds`), dds);
                    summary.ddsConverted += 1;
                    wroteDds = true;
                }
                else {
                    summary.errors.push(`${record.index}:${record.name}: GTF to DDS conversion failed`);
                }
            }
        }
        else {
            summary.unknownTexturePayloads += 1;
            summary.errors.push(`${record.index}:${record.name}: unknown TXTR CDF payload magic ${validation.payloadMagic}`);
        }

        if (!wroteDds && logger) {
            logger.info(`[CDF-IFF] ${iffName}/${record.name}.txtr did not produce DDS; payloadMagic=${validation.payloadMagic}`);
        }

        summary.extractedRecords += 1;
        if (logger) {
            logger.info(`[CDF-IFF] ${iffName}/${record.name}.txtr header=0x${record.segmentHeaderOffset.toString(16)}+${header.length} payload=0x${record.payloadOffset.toString(16)}+${payload.length}`);
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
    inferDdsLayoutFromDecodedLength,
    inferDdsLayoutsFromDecodedLength
};