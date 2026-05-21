const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const probeUtil = require('../2k-tools/src/util/iffCompressionProbe');

function safeName(name) {
    return String(name || 'cdf').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function firstBytesHex(buf, length = 16) {
    return buf.slice(0, Math.min(length, buf.length)).toString('hex').match(/../g)?.join(' ') || '';
}

function entropy(buf) {
    if (!buf || buf.length <= 0) {
        return 0;
    }

    const counts = new Array(256).fill(0);
    for (const b of buf) {
        counts[b] += 1;
    }

    return counts.reduce((sum, count) => {
        if (!count) {
            return sum;
        }

        const p = count / buf.length;
        return sum - (p * Math.log2(p));
    }, 0);
}

function readUInt32Safe(buf, offset, littleEndian) {
    if (offset < 0 || offset + 4 > buf.length) {
        return null;
    }

    return littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

function collectTableCandidates(buf) {
    const candidates = [];

    // Many 2K containers start with count/size-ish 32-bit fields. This routine
    // tries conservative offset-table interpretations so CDFs with non-zlib
    // chunk tables still get split into usable candidate chunks.
    for (const littleEndian of [false, true]) {
        const endianName = littleEndian ? 'le' : 'be';
        for (const tableOffset of [0, 4, 8, 12, 16, 20, 24, 32]) {
            const count = readUInt32Safe(buf, tableOffset, littleEndian);
            if (!count || count <= 0 || count > 100000) {
                continue;
            }

            const offsetsStart = tableOffset + 4;
            const tableBytes = count * 4;
            if (offsetsStart + tableBytes > buf.length) {
                continue;
            }

            const offsets = [];
            let valid = true;
            for (let i = 0; i < count; i++) {
                const off = readUInt32Safe(buf, offsetsStart + (i * 4), littleEndian);
                if (off === null || off < 0 || off > buf.length) {
                    valid = false;
                    break;
                }
                offsets.push(off);
            }

            if (!valid) {
                continue;
            }

            const sorted = [...offsets].sort((a, b) => a - b);
            const unique = [...new Set(sorted)];
            if (unique.length < 2) {
                continue;
            }

            const monotonic = offsets.every((off, i) => i === 0 || off >= offsets[i - 1]);
            const alignedEnough = unique.filter((off) => off % 4 === 0 || off % 0x10 === 0).length / unique.length;
            const inDataRegion = unique[0] >= offsetsStart + tableBytes || unique[0] >= tableOffset;

            if (!monotonic || alignedEnough < 0.75 || !inDataRegion) {
                continue;
            }

            candidates.push({
                label: `offset-table-${endianName}-0x${tableOffset.toString(16)}`,
                endian: endianName,
                tableOffset,
                count,
                offsets: unique
            });
        }
    }

    return candidates;
}

function extractChunksFromTable(buf, table) {
    const chunks = [];
    for (let i = 0; i < table.offsets.length; i++) {
        const start = table.offsets[i];
        const end = i + 1 < table.offsets.length ? table.offsets[i + 1] : buf.length;
        if (end <= start || start < 0 || end > buf.length) {
            continue;
        }
        chunks.push({
            index: i,
            offset: start,
            length: end - start,
            data: buf.slice(start, end)
        });
    }
    return chunks;
}

async function writeHit(outDir, baseName, hit, index, manifest) {
    const outName = `${baseName}.stream_${String(index).padStart(4, '0')}.0x${hit.absoluteOffset.toString(16)}.${hit.algorithm}.bin`;
    const outPath = path.join(outDir, outName);
    await fs.writeFile(outPath, hit.data);

    manifest.decompressedStreams.push({
        index,
        path: outPath,
        algorithm: hit.algorithm,
        label: hit.label,
        absoluteOffset: hit.absoluteOffset,
        decompressedLength: hit.data.length,
        firstBytes: firstBytesHex(hit.data),
        entropy: entropy(hit.data)
    });
}

async function decompressCdfBuffer(buf, outputPath, options = {}) {
    await mkdir(outputPath);

    const baseName = safeName(options.name || 'input.cdf');
    const rawPath = path.join(outputPath, `${baseName}.raw.cdf`);
    await fs.writeFile(rawPath, buf);

    const manifest = {
        name: options.name || baseName,
        rawPath,
        rawSize: buf.length,
        rawFirstBytes: firstBytesHex(buf),
        rawEntropy: entropy(buf),
        decompressedStreams: [],
        tableCandidates: [],
        notes: [
            'CDF decompression is heuristic until the exact CDF directory/schema is fully decoded.',
            'Outputs are candidate decompressed chunks and table-split chunks for database/roster reverse engineering.',
            'If no streams are found and entropy is near 8.0, the file may use a non-zlib codec or an obfuscation layer.'
        ]
    };

    const maxHits = parseInt(options.maxHits || options.maxProbeHits || 1000);
    const hits = probeUtil.scanBuffer(buf, { maxHits });
    for (let i = 0; i < hits.length; i++) {
        await writeHit(outputPath, baseName, hits[i], i, manifest);
    }

    const tableCandidates = collectTableCandidates(buf);
    manifest.tableCandidates = tableCandidates.map((candidate) => ({
        label: candidate.label,
        endian: candidate.endian,
        tableOffset: candidate.tableOffset,
        count: candidate.count,
        firstOffsets: candidate.offsets.slice(0, 32)
    }));

    if (options.dumpTableChunks && tableCandidates.length > 0) {
        const best = tableCandidates[0];
        const chunkDir = path.join(outputPath, `${baseName}.table_chunks`);
        await mkdir(chunkDir);

        const chunks = extractChunksFromTable(buf, best);
        manifest.tableChunkDump = {
            label: best.label,
            path: chunkDir,
            count: chunks.length,
            chunks: []
        };

        for (const chunk of chunks) {
            const chunkPath = path.join(chunkDir, `chunk_${String(chunk.index).padStart(4, '0')}_0x${chunk.offset.toString(16)}.bin`);
            await fs.writeFile(chunkPath, chunk.data);

            const chunkEntry = {
                index: chunk.index,
                path: chunkPath,
                offset: chunk.offset,
                length: chunk.length,
                firstBytes: firstBytesHex(chunk.data),
                entropy: entropy(chunk.data)
            };

            const result = probeUtil.probeBlock(chunk.data);
            if (result) {
                const decPath = `${chunkPath}.decompressed.${result.algorithm}.bin`;
                await fs.writeFile(decPath, result.data);
                chunkEntry.decompressed = {
                    path: decPath,
                    algorithm: result.algorithm,
                    label: result.label,
                    decompressedLength: result.data.length,
                    firstBytes: firstBytesHex(result.data),
                    entropy: entropy(result.data)
                };
            }

            manifest.tableChunkDump.chunks.push(chunkEntry);
        }
    }

    const manifestPath = path.join(outputPath, `${baseName}.cdf-decompress-manifest.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return manifest;
}

async function decompressCdfFile(filePath, outputPath, options = {}) {
    const buf = await fs.readFile(filePath);
    return decompressCdfBuffer(buf, outputPath, {
        ...options,
        name: options.name || path.basename(filePath)
    });
}

module.exports = {
    decompressCdfBuffer,
    decompressCdfFile,
    collectTableCandidates,
    extractChunksFromTable,
    entropy
};
