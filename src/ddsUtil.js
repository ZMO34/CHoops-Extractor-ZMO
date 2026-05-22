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

function blockBytesFor(fourCC) {
    return fourCC === 'DXT1' || fourCC === 'BC1 ' ? 8 : 16;
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

function part1By1(value) {
    let x = value & 0x0000ffff;
    x = (x | (x << 8)) & 0x00ff00ff;
    x = (x | (x << 4)) & 0x0f0f0f0f;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;
    return x >>> 0;
}

function morton2D(x, y) {
    return (part1By1(x) | (part1By1(y) << 1)) >>> 0;
}

function copyBlock(src, srcIndex, dst, dstIndex, blockBytes) {
    const srcOffset = srcIndex * blockBytes;
    const dstOffset = dstIndex * blockBytes;
    if (srcOffset + blockBytes <= src.length && dstOffset + blockBytes <= dst.length) {
        src.copy(dst, dstOffset, srcOffset, srcOffset + blockBytes);
    }
}

function deswizzleBcTopMip(swizzledPayload, width, height, fourCC) {
    const blockBytes = blockBytesFor(fourCC);
    const blocksWide = Math.max(1, Math.ceil(width / 4));
    const blocksHigh = Math.max(1, Math.ceil(height / 4));
    const blockCount = blocksWide * blocksHigh;
    const topMipSize = blockCount * blockBytes;
    const src = swizzledPayload.slice(0, topMipSize);
    const dst = Buffer.alloc(topMipSize, 0);

    for (let y = 0; y < blocksHigh; y++) {
        for (let x = 0; x < blocksWide; x++) {
            const linearIndex = y * blocksWide + x;
            const swizzledIndex = morton2D(x, y);
            copyBlock(src, swizzledIndex, dst, linearIndex, blockBytes);
        }
    }

    return dst;
}

function swizzleBcTopMip(linearPayload, width, height, fourCC) {
    const blockBytes = blockBytesFor(fourCC);
    const blocksWide = Math.max(1, Math.ceil(width / 4));
    const blocksHigh = Math.max(1, Math.ceil(height / 4));
    const blockCount = blocksWide * blocksHigh;
    const topMipSize = blockCount * blockBytes;
    const src = linearPayload.slice(0, topMipSize);
    const dst = Buffer.alloc(topMipSize, 0);

    for (let y = 0; y < blocksHigh; y++) {
        for (let x = 0; x < blocksWide; x++) {
            const linearIndex = y * blocksWide + x;
            const swizzledIndex = morton2D(x, y);
            copyBlock(src, linearIndex, dst, swizzledIndex, blockBytes);
        }
    }

    return dst;
}

module.exports = {
    makeDdsHeader,
    wrapDds,
    parseDds,
    payloadSizeFor,
    topMipSizeFor,
    blockBytesFor,
    deswizzleBcTopMip,
    swizzleBcTopMip
};
