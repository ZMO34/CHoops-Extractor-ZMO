const DDS_MAGIC = Buffer.from('DDS ');

const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_LINEARSIZE = 0x80000;
const DDSCAPS_TEXTURE = 0x1000;
const DDPF_FOURCC = 0x4;

function fourCc(value) {
    return Buffer.from(value, 'ascii').readUInt32LE(0);
}

function normalizedFourCC(value) {
    return String(value || '').trim().toUpperCase();
}

function blockBytesFor(fourCC) {
    const normalized = normalizedFourCC(fourCC);
    return normalized === 'DXT1' || normalized === 'BC1' ? 8 : 16;
}

function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
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

function topMipSizeFor(width, height, fourCC) {
    const blockBytes = blockBytesFor(fourCC);
    return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockBytes;
}

function makeDdsHeader({ width, height, fourCC, dataSize, mipMapCount = 1 }) {
    const header = Buffer.alloc(128, 0);
    DDS_MAGIC.copy(header, 0);
    header.writeUInt32LE(124, 4);
    header.writeUInt32LE(DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_LINEARSIZE, 8);
    header.writeUInt32LE(height, 12);
    header.writeUInt32LE(width, 16);
    header.writeUInt32LE(dataSize, 20);
    header.writeUInt32LE(0, 24);
    header.writeUInt32LE(mipMapCount, 28);

    const pf = 76;
    header.writeUInt32LE(32, pf + 0);
    header.writeUInt32LE(DDPF_FOURCC, pf + 4);
    header.writeUInt32LE(fourCc(fourCC), pf + 8);

    header.writeUInt32LE(DDSCAPS_TEXTURE, 108);
    return header;
}

function payloadSizeFor(width, height, fourCC, mipMapCount = 1) {
    const blockBytes = blockBytesFor(fourCC);
    let total = 0;
    let w = width;
    let h = height;
    const mipCount = Math.max(1, mipMapCount || 1);

    for (let i = 0; i < mipCount; i++) {
        total += Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes;
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
    }

    return total;
}

function wrapDds(payload, options) {
    return Buffer.concat([
        makeDdsHeader({ ...options, dataSize: payload.length }),
        payload
    ]);
}

function parseDds(buffer) {
    if (buffer.length < 128 || buffer.slice(0, 4).compare(DDS_MAGIC) !== 0) {
        throw new Error('Not a DDS file.');
    }

    const height = buffer.readUInt32LE(12);
    const width = buffer.readUInt32LE(16);
    const mipMapCount = buffer.readUInt32LE(28) || 1;
    const fourCCInt = buffer.readUInt32LE(84);
    const fourCC = Buffer.alloc(4);
    fourCC.writeUInt32LE(fourCCInt, 0);

    return {
        width,
        height,
        mipMapCount,
        fourCC: fourCC.toString('ascii'),
        payloadOffset: 128,
        payload: buffer.slice(128)
    };
}

function validateDdsImport(dds, options = {}) {
    const warnings = [];
    const errors = [];
    const label = options.label || 'DDS';
    const maxDimension = options.maxDimension || 4096;
    const allowNoMipmaps = options.allowNoMipmaps !== false;
    const supportedFormats = options.supportedFormats || ['DXT1', 'DXT3', 'DXT5', 'BC1', 'BC2', 'BC3'];
    const normalizedFormat = normalizedFourCC(dds && dds.fourCC);

    if (!dds) {
        errors.push(`${label}: missing DDS data.`);
        return { warnings, errors, normalizedFormat };
    }

    if (!Number.isInteger(dds.width) || !Number.isInteger(dds.height) || dds.width <= 0 || dds.height <= 0) {
        errors.push(`${label}: invalid DDS dimensions ${dds.width}x${dds.height}.`);
    }

    if (dds.width > maxDimension || dds.height > maxDimension) {
        errors.push(`${label}: ${dds.width}x${dds.height} exceeds the conservative PS3 import limit ${maxDimension}x${maxDimension}.`);
    }

    if (!isPowerOfTwo(dds.width) || !isPowerOfTwo(dds.height)) {
        errors.push(`${label}: dimensions must be powers of two for stable PS3 GTF conversion. Got ${dds.width}x${dds.height}.`);
    }

    if (!supportedFormats.includes(normalizedFormat)) {
        errors.push(`${label}: unsupported DDS compression ${normalizedFormat || '(none)'}. Use BC1/DXT1 or BC3/DXT5 for CH2K8 texture imports.`);
    }

    const mipMapCount = Math.max(1, dds.mipMapCount || 1);
    const fullMipCount = dds && dds.width && dds.height ? maxMipCountFor(dds.width, dds.height) : 1;

    if (mipMapCount > fullMipCount) {
        errors.push(`${label}: mip count ${mipMapCount} is impossible for ${dds.width}x${dds.height}; max is ${fullMipCount}.`);
    }

    if (mipMapCount === 1 && !allowNoMipmaps) {
        errors.push(`${label}: missing mipmaps. Save with generated mipmaps for stable in-game rendering.`);
    }
    else if (mipMapCount === 1) {
        warnings.push(`${label}: no mipmaps detected. Higher-resolution textures are more stable with full mipmaps.`);
    }
    else if (mipMapCount !== fullMipCount) {
        warnings.push(`${label}: partial mip chain detected (${mipMapCount}/${fullMipCount}). Full mipmaps are recommended for high-resolution imports.`);
    }

    if (supportedFormats.includes(normalizedFormat)) {
        const expectedPayloadSize = payloadSizeFor(dds.width, dds.height, normalizedFormat, mipMapCount);
        if (dds.payload.length !== expectedPayloadSize) {
            errors.push(
                `${label}: DDS payload size mismatch. Expected 0x${expectedPayloadSize.toString(16)} bytes for `
                + `${dds.width}x${dds.height} ${normalizedFormat} mips=${mipMapCount}, got 0x${dds.payload.length.toString(16)}.`
            );
        }
    }

    return { warnings, errors, normalizedFormat, fullMipCount };
}

function assertDdsImportable(dds, options = {}) {
    const result = validateDdsImport(dds, options);
    if (result.errors.length > 0) {
        throw new Error(result.errors.join('\n'));
    }
    return result;
}

function part1By1(value) {
    let x = value & 0x0000ffff;
    x = (x | (x << 8)) & 0x00ff00ff;
    x = (x | (x << 4)) & 0x0f0f0f0f;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;
    return x >>> 0;
}

function morton2D(x, y) {
    return (part1By1(x) | (part1By1(x === x ? y : y) << 1)) >>> 0;
}

function mortonRectIndex(x, y, width, height) {
    const logW = Math.round(Math.log2(width));
    const logH = Math.round(Math.log2(height));
    const sharedBits = Math.min(logW, logH);
    const lowMask = (1 << sharedBits) - 1;
    const base = morton2D(x & lowMask, y & lowMask);

    if (logW > logH) {
        return ((x >> sharedBits) << (sharedBits * 2)) | base;
    }

    if (logH > logW) {
        return ((y >> sharedBits) << (sharedBits * 2)) | base;
    }

    return base;
}

function copyBlock(src, srcIndex, dst, dstIndex, blockBytes) {
    const srcOffset = srcIndex * blockBytes;
    const dstOffset = dstIndex * blockBytes;
    if (srcOffset + blockBytes <= src.length && dstOffset + blockBytes <= dst.length) {
        src.copy(dst, dstOffset, srcOffset, srcOffset + blockBytes);
    }
}

function transformBcTopMip(inputPayload, width, height, fourCC, mode, direction) {
    const blockBytes = blockBytesFor(fourCC);
    const blocksWide = Math.max(1, Math.ceil(width / 4));
    const blocksHigh = Math.max(1, Math.ceil(height / 4));
    const blockCount = blocksWide * blocksHigh;
    const topMipSize = blockCount * blockBytes;
    const src = inputPayload.slice(0, topMipSize);

    if (!mode || mode === 'none' || mode === 'linear') {
        return Buffer.from(src);
    }

    if (mode === 'byte-rect') {
        const rowBytes = blocksWide * blockBytes;
        const dst = Buffer.alloc(topMipSize, 0);
        for (let y = 0; y < blocksHigh; y++) {
            for (let x = 0; x < rowBytes; x++) {
                const linearIndex = y * rowBytes + x;
                const swizzledIndex = mortonRectIndex(x, y, rowBytes, blocksHigh);
                if (swizzledIndex < src.length) {
                    if (direction === 'deswizzle') {
                        dst[linearIndex] = src[swizzledIndex];
                    }
                    else {
                        dst[swizzledIndex] = src[linearIndex];
                    }
                }
            }
        }
        return dst;
    }

    const dst = Buffer.alloc(topMipSize, 0);
    for (let y = 0; y < blocksHigh; y++) {
        for (let x = 0; x < blocksWide; x++) {
            const linearIndex = y * blocksWide + x;
            let swizzledIndex;

            if (mode === 'morton-yx') {
                swizzledIndex = morton2D(y, x);
            }
            else if (mode === 'block-rect') {
                swizzledIndex = mortonRectIndex(x, y, blocksWide, blocksHigh);
            }
            else {
                swizzledIndex = morton2D(x, y);
            }

            if (direction === 'deswizzle') {
                copyBlock(src, swizzledIndex, dst, linearIndex, blockBytes);
            }
            else {
                copyBlock(src, linearIndex, dst, swizzledIndex, blockBytes);
            }
        }
    }

    return dst;
}

function deswizzleBcTopMip(swizzledPayload, width, height, fourCC, mode = 'morton') {
    return transformBcTopMip(swizzledPayload, width, height, fourCC, mode, 'deswizzle');
}

function swizzleBcTopMip(linearPayload, width, height, fourCC, mode = 'morton') {
    return transformBcTopMip(linearPayload, width, height, fourCC, mode, 'swizzle');
}

module.exports = {
    makeDdsHeader,
    wrapDds,
    parseDds,
    payloadSizeFor,
    topMipSizeFor,
    blockBytesFor,
    normalizedFourCC,
    isPowerOfTwo,
    maxMipCountFor,
    validateDdsImport,
    assertDdsImportable,
    deswizzleBcTopMip,
    swizzleBcTopMip
};