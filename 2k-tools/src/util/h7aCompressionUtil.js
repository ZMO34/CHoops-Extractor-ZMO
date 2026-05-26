module.exports.decompress = (buf, decompressedSize, shiftAmount = 0x8) => {
    const maxNodeBufferLength = 0x7fffffff;

    if (!Buffer.isBuffer(buf)) {
        throw new Error('H7A decompress expected a Buffer input.');
    }

    if (!Number.isInteger(decompressedSize) || decompressedSize < 0 || decompressedSize > maxNodeBufferLength) {
        throw new Error(`Invalid H7A decompressed size: ${decompressedSize}`);
    }

    if (!Number.isInteger(shiftAmount) || shiftAmount < 1 || shiftAmount > 16) {
        throw new Error(`Invalid H7A shift amount: ${shiftAmount}`);
    }

    let currentCompressedOffset = 0;
    let currentDecompressedOffet = 0;
    let output = Buffer.alloc(decompressedSize);

    do {
        if (currentCompressedOffset >= buf.length) {
            break;
        }

        let descriptor = buf[currentCompressedOffset++];

        for (let bitOffset = 0; bitOffset <= 7; bitOffset++) {
            if (currentDecompressedOffet >= decompressedSize) {
                break;
            }

            if ((descriptor & 1) > 0) {
                if (currentCompressedOffset + 2 > buf.length) {
                    throw new Error(
                        `Truncated H7A back-reference at compressed offset 0x${(currentCompressedOffset - 1).toString(16)}`
                    );
                }

                let lookbackLength = buf[currentCompressedOffset++];
                let sequenceLength = buf[currentCompressedOffset++];

                lookbackLength = (lookbackLength << 8) + sequenceLength;
                
                sequenceLength = (lookbackLength >> shiftAmount & (1 << 15 - shiftAmount + 1) - 1) + 2;
                lookbackLength = lookbackLength >> 0 & (1 << (shiftAmount - 1) + 1) - 1;

                if (lookbackLength <= 0 || lookbackLength > currentDecompressedOffet) {
                    throw new Error(
                        `Invalid H7A lookback at output offset 0x${currentDecompressedOffet.toString(16)}: `
                        + `lookback=${lookbackLength}`
                    );
                }

                for (let i = 0; i <= sequenceLength; i++) {
                    if (currentDecompressedOffet >= decompressedSize) {
                        break;
                    }
                    output[currentDecompressedOffet] = output[currentDecompressedOffet - lookbackLength];
                    currentDecompressedOffet += 1;
                }
            }
            else {
                if (currentCompressedOffset >= buf.length) {
                    throw new Error(
                        `Truncated H7A literal at compressed offset 0x${currentCompressedOffset.toString(16)}`
                    );
                }

                output[currentDecompressedOffet++] = buf[currentCompressedOffset++];
            }

            descriptor >>= 1;
        }
    } while (currentCompressedOffset < buf.length);

    if (currentDecompressedOffet !== decompressedSize) {
        throw new Error(
            `H7A decompressed length mismatch: expected=0x${decompressedSize.toString(16)}, `
            + `actual=0x${currentDecompressedOffet.toString(16)}`
        );
    }

    return output;
};