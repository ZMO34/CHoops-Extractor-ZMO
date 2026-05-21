const zlib = require('zlib');

const ZLIB_HEADERS = [0x7801, 0x785e, 0x789c, 0x78da];

function reverseUInt32(value) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value >>> 0, 0);
    return buf.readUInt32LE(0);
}

function isPlausibleSize(value, maxSize) {
    return Number.isInteger(value) && value > 0 && value <= maxSize;
}

function tryInflate(buf) {
    try {
        return {
            algorithm: 'zlib',
            data: zlib.inflateSync(buf)
        };
    }
    catch (err) {}

    try {
        return {
            algorithm: 'raw-deflate',
            data: zlib.inflateRawSync(buf)
        };
    }
    catch (err) {}

    return null;
}

function hasZlibHeader(buf, offset = 0) {
    if (offset + 2 > buf.length) {
        return false;
    }

    return ZLIB_HEADERS.indexOf(buf.readUInt16BE(offset)) >= 0;
}

function probeBlock(buf, expectedUncompressedLength) {
    const attempts = [];

    function addAttempt(label, offset, length) {
        if (offset < 0 || offset >= buf.length) {
            return;
        }

        if (length === undefined || length === null) {
            length = buf.length - offset;
        }

        if (!isPlausibleSize(length, buf.length - offset)) {
            return;
        }

        attempts.push({ label, offset, length });
    }

    addAttempt('direct-full-buffer', 0, buf.length);

    // NBA2K9/Hades notes describe a 20-byte block header before compressed data:
    // flag, uncompressed length, compressed length, unknown, marker/hades.
    if (buf.length >= 20) {
        const headerBE = {
            flag: buf.readUInt32BE(0),
            uncompressedLength: buf.readUInt32BE(4),
            compressedLength: buf.readUInt32BE(8),
            unknown: buf.readUInt32BE(12),
            marker: buf.readUInt32BE(16)
        };

        const headerLE = {
            flag: buf.readUInt32LE(0),
            uncompressedLength: buf.readUInt32LE(4),
            compressedLength: buf.readUInt32LE(8),
            unknown: buf.readUInt32LE(12),
            marker: buf.readUInt32LE(16)
        };

        [
            ['maindata-be', headerBE.compressedLength],
            ['maindata-be-reversed-size', reverseUInt32(headerBE.compressedLength)],
            ['maindata-le', headerLE.compressedLength],
            ['maindata-le-reversed-size', reverseUInt32(headerLE.compressedLength)]
        ].forEach(([label, compressedLength]) => {
            if (isPlausibleSize(compressedLength, buf.length) && compressedLength >= 20) {
                addAttempt(label, 20, compressedLength - 20);
            }
        });
    }

    // If zlib-looking bytes exist inside a small wrapper, try common backoffs.
    for (let i = 0; i + 1 < buf.length; i++) {
        if (!hasZlibHeader(buf, i)) {
            continue;
        }

        [0, 2, 4, 8, 12, 16, 20, 24, 32].forEach((backoff) => {
            const offset = i - backoff;
            if (offset >= 0) {
                addAttempt(`zlib-scan-offset-${i.toString(16)}-backoff-${backoff}`, offset, buf.length - offset);
            }
        });
    }

    const seen = new Set();
    for (const attempt of attempts) {
        const key = `${attempt.offset}:${attempt.length}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const result = tryInflate(buf.slice(attempt.offset, attempt.offset + attempt.length));
        if (!result) {
            continue;
        }

        if (expectedUncompressedLength && result.data.length !== expectedUncompressedLength) {
            // Keep scanning. A successful inflate to the wrong size is usually a false positive.
            continue;
        }

        return {
            ...result,
            label: attempt.label,
            offset: attempt.offset,
            length: attempt.length
        };
    }

    return null;
}

function scanBuffer(buf, options = {}) {
    const maxHits = options.maxHits || 500;
    const results = [];

    for (let i = 0; i + 1 < buf.length && results.length < maxHits; i++) {
        if (!hasZlibHeader(buf, i)) {
            continue;
        }

        const result = probeBlock(buf.slice(i), options.expectedUncompressedLength);
        if (result) {
            results.push({
                absoluteOffset: i + result.offset,
                ...result
            });
        }
    }

    return results;
}

module.exports = {
    probeBlock,
    scanBuffer,
    tryInflate,
    reverseUInt32
};
