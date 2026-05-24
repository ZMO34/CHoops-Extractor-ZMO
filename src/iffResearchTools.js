const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const IFFReader = require('../2k-tools/src/parser/IFFReader');
const IFFType = require('../2k-tools/src/model/general/iff/IFFType');
const probeUtil = require('../2k-tools/src/util/iffCompressionProbe');
const smartScanner = require('./smartAssetScanner');

function safeName(value) {
    return String(value || 'asset').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function toHex(value, width = 8) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    return `0x${Number(value >>> 0).toString(16).padStart(width, '0')}`;
}

function firstBytesHex(buffer, length = 32) {
    return buffer.slice(0, Math.min(length, buffer.length)).toString('hex').match(/../g)?.join(' ') || '';
}

function getAsciiStrings(buffer, minLength = 4) {
    const results = [];
    let start = null;
    let chars = [];

    for (let i = 0; i <= buffer.length; i++) {
        const byte = i < buffer.length ? buffer[i] : 0;
        const printable = byte >= 0x20 && byte <= 0x7e;

        if (printable) {
            if (start === null) start = i;
            chars.push(String.fromCharCode(byte));
        }
        else {
            if (start !== null && chars.length >= minLength) {
                results.push({ encoding: 'ascii', offset: start, length: chars.length, value: chars.join('') });
            }
            start = null;
            chars = [];
        }
    }

    return results;
}

function getUtf16LeStrings(buffer, minChars = 4) {
    const results = [];
    let start = null;
    let chars = [];

    for (let i = 0; i + 1 <= buffer.length; i += 2) {
        const code = i + 1 < buffer.length ? buffer.readUInt16LE(i) : 0;
        const printable = code >= 0x20 && code <= 0x7e;

        if (printable) {
            if (start === null) start = i;
            chars.push(String.fromCharCode(code));
        }
        else {
            if (start !== null && chars.length >= minChars) {
                results.push({ encoding: 'utf16le', offset: start, byteLength: chars.length * 2, value: chars.join('') });
            }
            start = null;
            chars = [];
        }
    }

    return results;
}

function detectReferencePatterns(strings) {
    const patterns = [
        { name: 'uniform_home_or_away_name', regex: /^u[ha][0-9]{3,}/i },
        { name: 'uniform_alt_name', regex: /^ux[0-9]{3,}/i },
        { name: 'menu_uniform_name', regex: /^selu[ahx][0-9]{3,}/i },
        { name: 'iff_filename', regex: /^[a-z0-9_\-]+\.iff$/i },
        { name: 'cdf_filename', regex: /^[a-z0-9_\-]+\.cdf$/i },
        { name: 'bin_filename', regex: /^[a-z0-9_\-]+\.bin$/i }
    ];

    return strings.map((entry) => ({
        ...entry,
        patternMatches: patterns.filter((pattern) => pattern.regex.test(entry.value)).map((pattern) => pattern.name)
    }));
}

function summarizeStrings(strings) {
    const byEncoding = {};
    const patternCounts = {};

    for (const entry of strings) {
        byEncoding[entry.encoding] = (byEncoding[entry.encoding] || 0) + 1;
        for (const match of entry.patternMatches || []) {
            patternCounts[match] = (patternCounts[match] || 0) + 1;
        }
    }

    return { byEncoding, patternCounts };
}

function parseFallbackHeader(buffer) {
    const u32be = (offset) => offset + 4 <= buffer.length ? buffer.readUInt32BE(offset) : null;
    const u32le = (offset) => offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;

    return {
        magicBE: toHex(u32be(0)),
        magicLE: toHex(u32le(0)),
        firstWordsBE: Array.from({ length: Math.min(16, Math.floor(buffer.length / 4)) }, (_, i) => toHex(u32be(i * 4))),
        firstWordsLE: Array.from({ length: Math.min(16, Math.floor(buffer.length / 4)) }, (_, i) => toHex(u32le(i * 4))),
        fileSize: buffer.length
    };
}

async function inspectIff(iffPath, outputPath, options = {}) {
    await mkdir(outputPath);
    const buffer = await fs.readFile(iffPath);

    let parsed = null;
    let structuralError = null;
    try {
        parsed = smartScanner._internal.parseIffBuffer(buffer, 0);
    }
    catch (err) {
        structuralError = {
            message: err.message,
            stack: err.stack,
            likelyCause: 'The file does not match the standard archive-style IFF layout, or uses a metadata-only IFF variant.'
        };
    }

    const manifest = {
        source: iffPath,
        size: buffer.length,
        firstBytes: firstBytesHex(buffer),
        fallbackHeader: parseFallbackHeader(buffer),
        parsedByStructuralScanner: parsed,
        structuralError,
        parsedByIFFReader: null,
        readerError: null,
        compressionProbeHits: [],
        exportedSubfiles: [],
        notes: [
            'Only binary-derived IFF fields are recorded.',
            'Names/types come from IFF tables when present; otherwise raw/index fallback is preserved.',
            'No team IDs, roster IDs, or spreadsheet-derived assumptions are used.',
            'Metadata-only frontend IFF variants are expected to fail generic IFFReader parsing; that failure is recorded instead of treated as fatal.'
        ]
    };

    try {
        const parser = new IFFReader({ decompressBlocks: options.decompressBlocks !== false });
        await pipeline(Readable.from(buffer), parser);
        const file = parser.controller.file;

        manifest.parsedByIFFReader = {
            magic: toHex(file.magic),
            headerSize: file.headerSize,
            fileLength: file.fileLength,
            blockCount: file.blockCount,
            fileCount: file.fileCount,
            hasFileNameData: parser.hasFileNameData,
            blocks: file.blocks.map((block) => ({
                index: block.index,
                name: toHex(block.name),
                type: toHex(block.type),
                uncompressedLength: block.uncompressedLength,
                compressedLength: block.compressedLength,
                startOffset: block.startOffset,
                isIndexed: block.isIndexed,
                isCompressed: block.isCompressed,
                firstBytes: block.data ? firstBytesHex(block.data) : null
            })),
            files: file.files.map((subfile) => ({
                index: subfile.index,
                id: toHex(subfile.id),
                name: subfile.name,
                type: IFFType.typeToString(subfile.type),
                typeRaw: toHex(subfile.typeRaw),
                offsetCount: subfile.offsetCount,
                dataBlocks: subfile.dataBlocks.map((block) => ({
                    index: block.index,
                    offset: block.offset,
                    length: block.length,
                    firstBytes: block.data ? firstBytesHex(block.data) : null
                }))
            }))
        };

        if (options.dumpSubfiles) {
            const subDir = path.join(outputPath, 'subfiles');
            await mkdir(subDir);
            for (const subfile of file.files) {
                const typeName = IFFType.typeToString(subfile.type).toLowerCase();
                const base = `${String(subfile.index).padStart(4, '0')}_${safeName(subfile.name)}.${typeName}`;
                const chunks = subfile.dataBlocks.map((block) => block.data || Buffer.alloc(0));
                const combined = Buffer.concat(chunks);
                const outFile = path.join(subDir, `${base}.bin`);
                await fs.writeFile(outFile, combined);
                manifest.exportedSubfiles.push({ index: subfile.index, name: subfile.name, type: typeName, path: outFile, size: combined.length });
            }
        }
    }
    catch (err) {
        manifest.readerError = {
            message: err.message,
            stack: err.stack,
            likelyCause: 'Nonstandard metadata-only IFF layout or invalid generic block-table assumptions.'
        };
    }

    try {
        const probeHits = probeUtil.scanBuffer(buffer, { maxHits: Number(options.maxProbeHits || 250) });
        manifest.compressionProbeHits = probeHits.map((hit, index) => ({
            index,
            algorithm: hit.algorithm,
            label: hit.label,
            absoluteOffset: hit.absoluteOffset,
            decompressedLength: hit.data.length,
            firstBytes: firstBytesHex(hit.data)
        }));
    }
    catch (err) {
        manifest.probeError = { message: err.message, stack: err.stack };
    }

    await fs.writeFile(path.join(outputPath, 'iff_inspect_manifest.json'), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(outputPath, 'header.json'), JSON.stringify(parsed ? parsed.header : manifest.fallbackHeader, null, 2));
    await fs.writeFile(path.join(outputPath, 'blocks.json'), JSON.stringify(parsed ? parsed.blocks : [], null, 2));
    await fs.writeFile(path.join(outputPath, 'files.json'), JSON.stringify(parsed ? parsed.files : [], null, 2));

    return manifest;
}

async function collectFiles(inputPath) {
    const stats = await fs.stat(inputPath);
    if (stats.isFile()) return [inputPath];

    const files = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else files.push(full);
        }
    }

    await walk(inputPath);
    return files;
}

async function scanRefs(inputPath, outputPath, options = {}) {
    await mkdir(outputPath);
    const files = await collectFiles(inputPath);
    const minLength = Number(options.minLength || 4);
    const manifest = {
        generatedAt: new Date().toISOString(),
        inputPath,
        policy: { evidenceOnly: true, stringReferencesOnly: true, noTeamIdSheet: true, noRosterAssumptions: true },
        summary: { filesScanned: 0, totalStrings: 0, totalPatternMatches: 0 },
        files: []
    };

    for (const file of files) {
        try {
            const buffer = await fs.readFile(file);
            const strings = detectReferencePatterns([...getAsciiStrings(buffer, minLength), ...getUtf16LeStrings(buffer, minLength)]);
            const matches = strings.filter((entry) => entry.patternMatches && entry.patternMatches.length > 0);

            manifest.summary.filesScanned += 1;
            manifest.summary.totalStrings += strings.length;
            manifest.summary.totalPatternMatches += matches.length;
            manifest.files.push({
                path: file,
                size: buffer.length,
                firstBytes: firstBytesHex(buffer),
                stringSummary: summarizeStrings(strings),
                strings: options.onlyMatches ? matches : strings,
                matches
            });
        }
        catch (err) {
            manifest.files.push({ path: file, error: err.message });
        }
    }

    await fs.writeFile(path.join(outputPath, 'reference_strings_manifest.json'), JSON.stringify(manifest, null, 2));

    const lines = [];
    for (const file of manifest.files) {
        if (!file.matches || file.matches.length === 0) continue;
        lines.push(`FILE ${file.path}`);
        for (const match of file.matches) {
            lines.push(`${match.encoding} 0x${match.offset.toString(16)} ${match.patternMatches.join(',')} ${match.value}`);
        }
        lines.push('');
    }
    await fs.writeFile(path.join(outputPath, 'reference_matches.txt'), lines.join('\n'));

    return manifest;
}

module.exports = { inspectIff, scanRefs, _internal: { getAsciiStrings, getUtf16LeStrings, detectReferencePatterns } };
