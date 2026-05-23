const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const IFF_MAGIC = 0xFF3BEF94;
const CDF_TEXTURE_MAGIC = 0x0E4837C3;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_DUMP_BYTES = 0x400000;
const DEFAULT_MIN_CANDIDATE_SIZE = 0x20;

const KNOWN_FOURCCS = [
    'TXTR', 'SCNE', 'AUDO', 'LAYT', 'MRKS', 'PRIV', 'DRCT', 'CLTH',
    'AMBO', 'HILT', 'NAME', 'CDAN', 'TXT', 'IFF', 'CDF', 'DDS', 'GTF'
];

function readUInt32BE(buffer, offset) {
    if (offset < 0 || offset + 4 > buffer.length) return null;
    return buffer.readUInt32BE(offset);
}

function readUInt32LE(buffer, offset) {
    if (offset < 0 || offset + 4 > buffer.length) return null;
    return buffer.readUInt32LE(offset);
}

function toHex(value, width = 8) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    return `0x${Number(value >>> 0).toString(16).padStart(width, '0')}`;
}

function safeName(value) {
    return String(value || 'asset').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function firstBytesHex(buffer, length = 24) {
    return buffer.slice(0, Math.min(length, buffer.length)).toString('hex').match(/../g)?.join(' ') || '';
}

function fourccToUInt32(value) {
    return Buffer.from(value, 'ascii').readUInt32BE(0);
}

function uint32ToAscii(value) {
    if (value === null || value === undefined) return null;
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value >>> 0, 0);
    const text = buf.toString('ascii');
    return /^[\x20-\x7E]{4}$/.test(text) ? text : null;
}

function pathExistsSyncish(statPromise) {
    return statPromise.then(() => true).catch(() => false);
}

async function collectInputFiles(inputPath) {
    const stats = await fs.stat(inputPath);
    if (stats.isFile()) return [inputPath];

    const out = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            }
            else if (/\.(iff|cdf|bin|dat|txtr|scne|audo)$/i.test(entry.name) || !path.extname(entry.name)) {
                out.push(full);
            }
        }
    }

    await walk(inputPath);
    return out;
}

function looksLikeIffAt(buffer, offset) {
    if (offset < 0 || offset + 0x20 > buffer.length) return false;
    if (readUInt32BE(buffer, offset) !== IFF_MAGIC) return false;

    const headerSize = readUInt32BE(buffer, offset + 4);
    const fileLength = readUInt32BE(buffer, offset + 8);
    const blockCount = readUInt32BE(buffer, offset + 16);
    const fileCount = readUInt32BE(buffer, offset + 24);

    return (
        headerSize >= 0x20
        && headerSize <= buffer.length - offset
        && fileLength > 0
        && fileLength <= buffer.length - offset
        && blockCount >= 0
        && blockCount < 0x10000
        && fileCount >= 0
        && fileCount < 0x100000
        && 0x20 + (blockCount * 0x20) <= headerSize
    );
}

function parseIffNames(iffBuffer, parsed) {
    const afterBlocks = parsed.blocks.reduce((max, block) => {
        return Math.max(max, block.startOffset + (block.isCompressed ? block.compressedLength : block.uncompressedLength));
    }, parsed.header.headerSize);

    if (afterBlocks + 8 > iffBuffer.length) return;

    const nameMagic = readUInt32BE(iffBuffer, afterBlocks);
    const nameSize = readUInt32LE(iffBuffer, afterBlocks + 4);
    const nameBodyOffset = afterBlocks + 8;

    if (!nameSize || nameSize <= 8 || nameBodyOffset + nameSize > iffBuffer.length) return;

    const buf = iffBuffer.slice(nameBodyOffset, nameBodyOffset + nameSize);
    if (buf.length < 8) return;

    const numNames = readUInt32LE(buf, 0);
    const offsetToNames = readUInt32LE(buf, 4) + 4 - 1;
    if (!numNames || numNames > parsed.files.length || offsetToNames < 0 || offsetToNames >= buf.length) return;

    let currentOffset = offsetToNames;
    for (let i = 0; i < numNames && i < parsed.files.length; i++) {
        if (currentOffset + 4 > buf.length) break;
        const offsetToFileNames = readUInt32LE(buf, currentOffset) + currentOffset - 1;
        if (offsetToFileNames < 0 || offsetToFileNames + 8 > buf.length) break;

        const offsetToName = readUInt32LE(buf, offsetToFileNames) + offsetToFileNames - 1;
        const offsetToType = readUInt32LE(buf, offsetToFileNames + 4) + offsetToFileNames + 4 - 1;
        if (offsetToName < 0 || offsetToType <= offsetToName || offsetToType + 10 > buf.length) break;

        parsed.files[i].name = buf.toString('utf16le', offsetToName, offsetToType).replace(/\u0000+$/g, '');
        parsed.files[i].typeName = buf.toString('utf16le', offsetToType, offsetToType + 10).replace(/\u0000+$/g, '');
        currentOffset += 4;
    }

    parsed.nameTable = {
        absoluteOffset: afterBlocks,
        magic: toHex(nameMagic),
        size: nameSize,
        count: numNames
    };
}

function parseIffBuffer(buffer, baseOffset = 0) {
    if (!looksLikeIffAt(buffer, 0)) return null;

    const header = {
        magic: toHex(readUInt32BE(buffer, 0)),
        headerSize: readUInt32BE(buffer, 4),
        fileLength: readUInt32BE(buffer, 8),
        zero: readUInt32BE(buffer, 12),
        blockCount: readUInt32BE(buffer, 16),
        unk1: readUInt32BE(buffer, 20),
        fileCount: readUInt32BE(buffer, 24),
        unk2: readUInt32BE(buffer, 28)
    };

    const blocks = [];
    let currentOffset = 0x20;
    for (let i = 0; i < header.blockCount; i++) {
        const block = {
            index: i,
            nameHash: toHex(readUInt32BE(buffer, currentOffset)),
            nameAscii: uint32ToAscii(readUInt32BE(buffer, currentOffset)),
            typeRaw: toHex(readUInt32BE(buffer, currentOffset + 4)),
            typeAscii: uint32ToAscii(readUInt32BE(buffer, currentOffset + 4)),
            unk1: readUInt32BE(buffer, currentOffset + 8),
            uncompressedLength: readUInt32BE(buffer, currentOffset + 12),
            unk2: readUInt32BE(buffer, currentOffset + 16),
            startOffset: readUInt32BE(buffer, currentOffset + 20),
            compressedLength: readUInt32BE(buffer, currentOffset + 24),
            isIndexed: readUInt32BE(buffer, currentOffset + 28),
            isCompressed: readUInt32BE(buffer, currentOffset + 24) !== readUInt32BE(buffer, currentOffset + 12)
        };
        blocks.push(block);
        currentOffset += 0x20;
    }

    const fileOffsetTableOffset = currentOffset;
    currentOffset += header.fileCount * 4;

    const files = [];
    for (let i = 0; i < header.fileCount && currentOffset + 12 <= header.headerSize; i++) {
        const id = readUInt32BE(buffer, currentOffset);
        const typeRaw = readUInt32BE(buffer, currentOffset + 4);
        const offsetCount = readUInt32BE(buffer, currentOffset + 8);
        const recordLength = 12 + (offsetCount * 4);

        if (offsetCount > header.blockCount || currentOffset + recordLength > header.headerSize) break;

        const file = {
            index: i,
            id,
            idHex: toHex(id),
            typeRaw: toHex(typeRaw),
            typeAscii: uint32ToAscii(typeRaw),
            name: String(i),
            typeName: uint32ToAscii(typeRaw) || 'UNKNOWN',
            offsetCount,
            blocks: []
        };

        for (let j = 0; j < offsetCount; j++) {
            file.blocks.push({
                blockIndex: j,
                relativeOffset: readUInt32BE(buffer, currentOffset + 12 + (j * 4))
            });
        }

        files.push(file);
        currentOffset += recordLength;
    }

    for (const block of blocks) {
        const filesInBlock = files.filter((file) => file.offsetCount >= block.index + 1);
        filesInBlock.sort((a, b) => a.blocks[block.index].relativeOffset - b.blocks[block.index].relativeOffset);

        for (let i = 0; i < filesInBlock.length; i++) {
            const file = filesInBlock[i];
            const rel = file.blocks[block.index].relativeOffset;
            const nextRel = i + 1 < filesInBlock.length
                ? filesInBlock[i + 1].blocks[block.index].relativeOffset
                : block.uncompressedLength;

            file.blocks[block.index].length = Math.max(0, nextRel - rel);
            file.blocks[block.index].absoluteOffset = baseOffset + block.startOffset + rel;
            file.blocks[block.index].blockStartOffset = baseOffset + block.startOffset;
        }
    }

    const parsed = {
        format: 'IFF',
        baseOffset,
        header,
        blocks,
        files,
        fileOffsetTableOffset,
        structuralWarnings: []
    };

    parseIffNames(buffer, parsed);
    return parsed;
}

function parseCdfTextureRecords(buffer, baseOffset = 0) {
    const records = [];
    let offset = 0;

    while (offset + 0xB0 <= buffer.length) {
        if (readUInt32BE(buffer, offset) !== CDF_TEXTURE_MAGIC) break;

        const recordHeaderSize = readUInt32BE(buffer, offset + 0x04);
        const headerASize = readUInt32BE(buffer, offset + 0x08);
        const headerBOffset = offset + headerASize;
        const headerBMagic = readUInt32BE(buffer, headerBOffset);
        const recordTailSize = readUInt32BE(buffer, headerBOffset + 0x08);
        const nextOffset = offset + headerASize + recordTailSize;
        const payloadOffset = offset + recordHeaderSize;

        if (
            recordHeaderSize <= 0
            || headerASize <= 0
            || headerBMagic !== CDF_TEXTURE_MAGIC
            || recordTailSize <= 0
            || nextOffset <= offset
            || nextOffset > buffer.length
            || payloadOffset > nextOffset
        ) {
            break;
        }

        records.push({
            index: records.length,
            absoluteOffset: baseOffset + offset,
            offset,
            size: nextOffset - offset,
            payloadOffset: baseOffset + payloadOffset,
            payloadSize: nextOffset - payloadOffset,
            recordId: toHex(readUInt32BE(buffer, offset + 0x15)),
            widthOrTileWidth: readUInt32BE(buffer, headerBOffset + 0x0C),
            heightOrTileHeight: readUInt32BE(buffer, headerBOffset + 0x10),
            formatOrMipInfo: toHex(readUInt32BE(buffer, headerBOffset + 0x14))
        });

        offset = nextOffset;
    }

    return records;
}

function findSignatures(buffer) {
    const signatures = [];
    const fourccValues = KNOWN_FOURCCS.map((fourcc) => ({ fourcc, value: fourccToUInt32(fourcc) }));

    for (let offset = 0; offset + 4 <= buffer.length; offset++) {
        const be = readUInt32BE(buffer, offset);

        if (be === IFF_MAGIC) {
            signatures.push({ kind: 'IFF_MAGIC', label: 'IFF', offset, confidence: looksLikeIffAt(buffer, offset) ? 'high' : 'low' });
        }
        else if (be === CDF_TEXTURE_MAGIC) {
            signatures.push({ kind: 'CDF_TEXTURE_MAGIC', label: 'CDF_TEXTURE_RECORD', offset, confidence: 'high' });
        }
        else {
            const fourcc = fourccValues.find((entry) => entry.value === be);
            if (fourcc) {
                signatures.push({ kind: 'FOURCC', label: fourcc.fourcc, offset, confidence: ['TXTR', 'SCNE', 'AUDO'].includes(fourcc.fourcc) ? 'medium' : 'low' });
            }
        }
    }

    return signatures;
}

function classifyFileName(fileName) {
    const lower = fileName.toLowerCase();
    const classes = [];

    if (/^u[ha]\d+/.test(lower)) classes.push('uniform_primary');
    if (/^ux\d+/.test(lower)) classes.push('uniform_alternate');
    if (/^selu[ha]/.test(lower)) classes.push('menu_uniform_primary');
    if (/^selux/.test(lower)) classes.push('menu_uniform_alternate');
    if (/^s\d+/.test(lower)) classes.push('stadium_or_court');
    if (/logo|teamselect|select/.test(lower)) classes.push('frontend_or_logo');
    if (/portrait|head|face|cf/.test(lower)) classes.push('portrait_or_cyberface');
    if (/global|frontend|menu/.test(lower)) classes.push('frontend_container');

    return classes.length ? classes : ['unknown'];
}

async function dumpCandidate(buffer, absoluteBaseOffset, hit, outputDir, sourceStem, options) {
    if (!options.dumpCandidates) return null;

    const maxDumpBytes = Number(options.maxDumpBytes || DEFAULT_MAX_DUMP_BYTES);
    const start = hit.offset;
    const end = Math.min(buffer.length, start + maxDumpBytes);
    const size = end - start;

    if (size < Number(options.minCandidateSize || DEFAULT_MIN_CANDIDATE_SIZE)) return null;

    const dir = path.join(outputDir, '_smart_candidates', safeName(sourceStem));
    await mkdir(dir);

    const fileName = `${String(hit.index).padStart(5, '0')}_0x${(absoluteBaseOffset + start).toString(16)}_${safeName(hit.label)}.bin`;
    const outPath = path.join(dir, fileName);
    await fs.writeFile(outPath, buffer.slice(start, end));
    return outPath;
}

async function scanBufferRecursive(buffer, context, options, manifest, depth = 0) {
    const maxDepth = Number(options.maxDepth || DEFAULT_MAX_DEPTH);
    const node = {
        id: manifest.nodes.length,
        source: context.source,
        sourceRelativePath: context.sourceRelativePath,
        containerPath: context.containerPath,
        depth,
        absoluteOffset: context.absoluteOffset || 0,
        size: buffer.length,
        firstBytes: firstBytesHex(buffer),
        classification: classifyFileName(path.basename(context.source || 'buffer')),
        parsed: null,
        signatures: [],
        children: []
    };

    manifest.nodes.push(node);

    const parsedIff = parseIffBuffer(buffer, node.absoluteOffset);
    if (parsedIff) {
        node.parsed = parsedIff;
        manifest.summary.iffParsed += 1;

        for (const file of parsedIff.files) {
            const asset = {
                source: context.source,
                containerPath: `${context.containerPath}/${safeName(file.name)}.${safeName(file.typeName)}`,
                fileIndex: file.index,
                name: file.name,
                typeName: file.typeName,
                typeRaw: file.typeRaw,
                idHex: file.idHex,
                offsetCount: file.offsetCount,
                blocks: file.blocks,
                classification: classifyFileName(file.name)
            };
            manifest.assets.push(asset);

            if (depth < maxDepth) {
                for (const blockRef of file.blocks) {
                    if (!blockRef.length || blockRef.length <= 0) continue;
                    const localStart = blockRef.absoluteOffset - node.absoluteOffset;
                    const localEnd = localStart + blockRef.length;
                    if (localStart < 0 || localEnd > buffer.length) continue;

                    const childBuffer = buffer.slice(localStart, localEnd);
                    const childNode = await scanBufferRecursive(childBuffer, {
                        source: context.source,
                        sourceRelativePath: context.sourceRelativePath,
                        containerPath: asset.containerPath + `/block_${blockRef.blockIndex}`,
                        absoluteOffset: blockRef.absoluteOffset
                    }, options, manifest, depth + 1);
                    node.children.push(childNode.id);
                }
            }
        }
    }

    const cdfRecords = parseCdfTextureRecords(buffer, node.absoluteOffset);
    if (cdfRecords.length > 0) {
        node.cdfTextureRecords = cdfRecords;
        manifest.summary.cdfTextureRecords += cdfRecords.length;
        for (const record of cdfRecords) {
            manifest.assets.push({
                source: context.source,
                containerPath: `${context.containerPath}/cdf_texture_${record.index}`,
                typeName: 'CDF_TEXTURE_RECORD',
                absoluteOffset: record.absoluteOffset,
                size: record.size,
                payloadOffset: record.payloadOffset,
                payloadSize: record.payloadSize,
                recordId: record.recordId,
                widthOrTileWidth: record.widthOrTileWidth,
                heightOrTileHeight: record.heightOrTileHeight,
                formatOrMipInfo: record.formatOrMipInfo,
                classification: ['texture']
            });
        }
    }

    const signatures = findSignatures(buffer)
        .filter((hit) => hit.offset !== 0 || !parsedIff)
        .slice(0, Number(options.maxHits || 2000))
        .map((hit, index) => ({ ...hit, index, absoluteOffset: node.absoluteOffset + hit.offset }));

    node.signatures = signatures;
    manifest.summary.signaturesFound += signatures.length;

    for (const hit of signatures) {
        const candidatePath = await dumpCandidate(buffer, node.absoluteOffset, hit, context.outputPath, path.basename(context.source), options);
        manifest.candidates.push({
            source: context.source,
            containerPath: context.containerPath,
            label: hit.label,
            kind: hit.kind,
            confidence: hit.confidence,
            offset: hit.offset,
            absoluteOffset: hit.absoluteOffset,
            dumpedPath: candidatePath
        });

        if (depth < maxDepth && hit.kind === 'IFF_MAGIC' && looksLikeIffAt(buffer, hit.offset)) {
            const length = readUInt32BE(buffer, hit.offset + 8);
            const childBuffer = buffer.slice(hit.offset, hit.offset + length);
            const childNode = await scanBufferRecursive(childBuffer, {
                source: context.source,
                sourceRelativePath: context.sourceRelativePath,
                containerPath: `${context.containerPath}/embedded_iff_0x${hit.absoluteOffset.toString(16)}`,
                absoluteOffset: hit.absoluteOffset,
                outputPath: context.outputPath
            }, options, manifest, depth + 1);
            node.children.push(childNode.id);
        }
    }

    return node;
}

async function writeManifest(outputPath, manifest) {
    await mkdir(outputPath);
    const manifestPath = path.join(outputPath, 'smart_manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const summaryPath = path.join(outputPath, 'smart_scan_summary.txt');
    const lines = [
        'CHoops Smart Scan Summary',
        `Generated: ${manifest.generatedAt}`,
        `Input: ${manifest.inputPath}`,
        `Files scanned: ${manifest.summary.filesScanned}`,
        `IFF containers parsed: ${manifest.summary.iffParsed}`,
        `Assets indexed: ${manifest.assets.length}`,
        `Signatures found: ${manifest.summary.signaturesFound}`,
        `CDF texture records: ${manifest.summary.cdfTextureRecords}`,
        `Candidate dumps: ${manifest.candidates.filter((candidate) => candidate.dumpedPath).length}`,
        '',
        'Outputs:',
        '- smart_manifest.json: full recursive scan manifest',
        '- smart_scan_summary.txt: human-readable summary',
        '- _smart_candidates/: optional dumped candidate byte ranges when --dump-candidates is used'
    ];
    await fs.writeFile(summaryPath, lines.join('\n'));

    return { manifestPath, summaryPath };
}

module.exports = async function smartAssetScanner(inputPath, outputPath, options = {}) {
    await mkdir(outputPath);
    const files = await collectInputFiles(inputPath);

    const manifest = {
        generatedAt: new Date().toISOString(),
        inputPath,
        outputPath,
        options: {
            maxDepth: Number(options.maxDepth || DEFAULT_MAX_DEPTH),
            maxHits: Number(options.maxHits || 2000),
            dumpCandidates: !!options.dumpCandidates,
            maxDumpBytes: Number(options.maxDumpBytes || DEFAULT_MAX_DUMP_BYTES),
            minCandidateSize: Number(options.minCandidateSize || DEFAULT_MIN_CANDIDATE_SIZE)
        },
        summary: {
            filesScanned: 0,
            iffParsed: 0,
            signaturesFound: 0,
            cdfTextureRecords: 0,
            errors: 0
        },
        files: [],
        nodes: [],
        assets: [],
        candidates: [],
        errors: []
    };

    const inputRoot = (await fs.stat(inputPath)).isDirectory() ? inputPath : path.dirname(inputPath);

    for (const filePath of files) {
        try {
            const buffer = await fs.readFile(filePath);
            const sourceRelativePath = path.relative(inputRoot, filePath) || path.basename(filePath);
            manifest.summary.filesScanned += 1;
            manifest.files.push({
                path: filePath,
                relativePath: sourceRelativePath,
                size: buffer.length,
                firstBytes: firstBytesHex(buffer),
                classification: classifyFileName(path.basename(filePath))
            });

            await scanBufferRecursive(buffer, {
                source: filePath,
                sourceRelativePath,
                containerPath: safeName(sourceRelativePath),
                absoluteOffset: 0,
                outputPath
            }, options, manifest, 0);
        }
        catch (err) {
            manifest.summary.errors += 1;
            manifest.errors.push({ path: filePath, message: err.message, stack: err.stack });
        }
    }

    const outputs = await writeManifest(outputPath, manifest);
    return { manifest, outputs };
};

module.exports._internal = {
    parseIffBuffer,
    parseCdfTextureRecords,
    findSignatures,
    classifyFileName
};
