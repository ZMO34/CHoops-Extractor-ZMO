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
    const blockBytes = fourCC === 'DXT1' || fourCC === 'BC1 ' ? 8 : 16;
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

module.exports = {
    makeDdsHeader,
    wrapDds,
    parseDds,
    payloadSizeFor
};
