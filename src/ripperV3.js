const path = require('path');
const fs = require('fs/promises');
const mkdir = require('make-dir');

const ripperV2 = require('./ripperV2');
const cdfBackedIffExtractor = require('./cdfBackedIffExtractor');
const ChoopsTextureReader = require('../2k-tools/src/parser/choops/ChoopsTextureReader');

function safeName(value) {
    return String(value || 'asset').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function readUInt32BE(buffer, offset, fallback = null) {
    if (!buffer || offset < 0 || offset + 4 > buffer.length) return fallback;
    return buffer.readUInt32BE(offset);
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch (err) {
        return false;
    }
}

async function walkFiles(root) {
    const files = [];

    async function walk(current) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(full);
            else files.push(full);
        }
    }

    await walk(root);
    return files;
}

async function appendLog(logPath, line) {
    await mkdir(path.dirname(logPath));
    await fs.appendFile(logPath, `${line}\n`);
}

function parseToolWrappedFile(buffer, filePath) {
    if (buffer.length < 0x0C || readUInt32BE(buffer, 0) !== 0x326B546C) return null;

    const headerLength = readUInt32BE(buffer, 0x04, 0);
    const typeCode = buffer.readUInt16BE(0x08);
    const numberOfBlocks = buffer.readUInt16BE(0x0A);

    if (headerLength !== 0x0C + (numberOfBlocks * 4) || headerLength > buffer.length) return null;

    const blocks = [];
    let cursor = headerLength;
    for (let i = 0; i < numberOfBlocks; i++) {
        const blockLength = readUInt32BE(buffer, 0x0C + (i * 4), 0);
        const data = buffer.slice(cursor, cursor + blockLength);
        blocks.push({ index: i, data, length: data.length, offset: 0, isChanged: false });
        cursor += blockLength;
    }

    return {
        name: path.basename(filePath).replace(/\.[^.]+$/, ''),
        type: typeCode,
        dataBlocks: blocks
    };
}

function decodeNameMetadata(buffer) {
    const wrapped = parseToolWrappedFile(buffer, 'metadata.name');
    if (!wrapped || wrapped.dataBlocks.length < 1) return null;

    const data = wrapped.dataBlocks[0].data;
    const pairs = [];
    for (let offset = 0; offset + 4 <= data.length; offset += 4) {
        const x = data.readUInt16BE(offset);
        const y = data.readUInt16BE(offset + 2);
        if (x === 0 && y === 0) break;
        pairs.push({ x, y });
    }

    return {
        length: data.length,
        pairCount: pairs.length,
        firstPairs: pairs.slice(0, 16)
    };
}

async function enhanceNameMetadataLogging(outputPath, logPath) {
    const files = await walkFiles(outputPath);
    let metadataFiles = 0;

    for (const filePath of files) {
        const lower = filePath.toLowerCase();

        if (lower.endsWith('.name')) {
            try {
                const metadata = decodeNameMetadata(await fs.readFile(filePath));
                if (!metadata) continue;
                metadataFiles += 1;
                await appendLog(
                    logPath,
                    `[NAME-META] ${path.relative(outputPath, filePath)} length=${metadata.length} pairCount=${metadata.pairCount} firstPairs=${metadata.firstPairs.map((pair) => `${pair.x}:${pair.y}`).join(' ')}`
                );
            }
            catch (err) {
                await appendLog(logPath, `[NAME-META] failed ${path.relative(outputPath, filePath)}: ${err.message || err}`);
            }
        }

        if (lower.endsWith('.audo')) {
            try {
                const wrapped = parseToolWrappedFile(await fs.readFile(filePath), filePath);
                if (!wrapped) continue;

                const outPath = filePath.replace(/\.audo$/i, '.audio_payload.bin');
                await fs.writeFile(outPath, Buffer.concat(wrapped.dataBlocks.map((block) => block.data || Buffer.alloc(0))));
                await appendLog(logPath, `[AUDO] ${path.relative(outputPath, outPath)}`);
            }
            catch (err) {
                await appendLog(logPath, `[AUDO] failed ${path.relative(outputPath, filePath)}: ${err.message || err}`);
            }
        }
    }

    await appendLog(logPath, `[SUMMARY] NAME metadata files logged=${metadataFiles}; NAME is coordinate metadata, not a DDS texture.`);
}

async function enhanceCdfBackedExtraction(outputPath, textureReader, logPath, options) {
    const files = await walkFiles(outputPath);
    const iffFiles = files.filter((file) => file.toLowerCase().endsWith('.iff'));
    let pairsExtracted = 0;

    const logger = { info: async (message) => appendLog(logPath, message) };

    for (const iffPath of iffFiles) {
        try {
            const iffBuffer = await fs.readFile(iffPath);
            if (readUInt32BE(iffBuffer, 0) !== cdfBackedIffExtractor.CDF_BACKED_IFF_MAGIC) continue;

            const parsed = cdfBackedIffExtractor.parseCdfBackedIff(iffBuffer);
            const baseDir = path.dirname(iffPath);
            const baseName = path.basename(iffPath, '.iff');
            const cdfCandidates = [
                parsed.cdfName ? path.join(baseDir, parsed.cdfName) : null,
                path.join(baseDir, `${baseName}.cdf`),
                path.join(outputPath, baseName, `${baseName}.cdf`)
            ].filter(Boolean);

            let cdfPath = null;
            for (const candidate of cdfCandidates) {
                if (await exists(candidate)) {
                    cdfPath = candidate;
                    break;
                }
            }

            if (!cdfPath) {
                await appendLog(logPath, `[CDF-IFF] ${path.relative(outputPath, iffPath)}: paired CDF not found`);
                continue;
            }

            const result = await cdfBackedIffExtractor.extractCdfBackedPair({
                iffName: path.basename(iffPath),
                iffBuffer,
                cdfBuffer: await fs.readFile(cdfPath),
                outputDir: baseDir,
                textureReader,
                logger,
                rawType: options.rawType
            });

            pairsExtracted += 1;
            await appendLog(logPath, `[CDF-IFF] ${path.relative(outputPath, iffPath)} + ${path.relative(outputPath, cdfPath)}: family=${result.summary.family} records=${result.summary.recordCount} extracted=${result.summary.extractedRecords} dds=${result.summary.ddsConverted} audio=${result.summary.audioPayloads}`);
        }
        catch (err) {
            await appendLog(logPath, `[CDF-IFF] failed ${path.relative(outputPath, iffPath)}: ${err.message || err}`);
        }
    }

    await appendLog(logPath, `[SUMMARY] CDF-backed pairs extracted=${pairsExtracted}`);
}

async function logStandardIffPreservation(outputPath, logPath) {
    const files = await walkFiles(outputPath);
    const iffFiles = files.filter((file) => file.toLowerCase().endsWith('.iff'));

    let standardCount = 0;
    for (const iffPath of iffFiles) {
        try {
            const buffer = await fs.readFile(iffPath);
            if (readUInt32BE(buffer, 0) !== cdfBackedIffExtractor.STANDARD_IFF_MAGIC) continue;

            const blockCount = readUInt32BE(buffer, 0x10, 0);
            const fileCount = readUInt32BE(buffer, 0x18, 0);
            const fileLength = readUInt32BE(buffer, 0x08, 0);
            const trailing = Math.max(0, buffer.length - fileLength);
            const hasNameTable = fileLength + 4 <= buffer.length && readUInt32BE(buffer, fileLength) === 0xAA171516;
            let compressed = 0;

            for (let i = 0; i < blockCount; i++) {
                const off = 0x20 + (i * 0x20);
                if (readUInt32BE(buffer, off + 0x0C, 0) !== readUInt32BE(buffer, off + 0x18, 0)) compressed += 1;
            }

            standardCount += 1;
            await appendLog(logPath, `[IFF] ${path.relative(outputPath, iffPath)} blocks=${blockCount} files=${fileCount} compressed=${compressed}/${blockCount} trailing=${trailing} nameTable=${hasNameTable ? 'yes' : 'no'}`);
        }
        catch (err) {
            await appendLog(logPath, `[IFF] failed ${path.relative(outputPath, iffPath)}: ${err.message || err}`);
        }
    }

    await appendLog(logPath, `[SUMMARY] Standard IFFs inspected=${standardCount}`);
}

module.exports = async (inputPath, outputPath, options = {}) => {
    await ripperV2(inputPath, outputPath, options);

    const enhancementLog = path.join(outputPath, '_logs', `choops-enhanced-rip_${Date.now().toString()}.txt`);
    const textureTempDir = path.join(outputPath, '_work', 'texture-conversion-enhanced');
    await mkdir(textureTempDir);

    const textureReader = new ChoopsTextureReader({ tempDir: textureTempDir });

    await appendLog(enhancementLog, '*** Choops enhanced rip pass ***');
    await appendLog(enhancementLog, 'Adds deterministic CDF/IFF extraction, audio payload extraction, NAME metadata logging, and preservation notes.');

    await logStandardIffPreservation(outputPath, enhancementLog);
    await enhanceCdfBackedExtraction(outputPath, textureReader, enhancementLog, options);
    await enhanceNameMetadataLogging(outputPath, enhancementLog);

    try {
        await fs.rm(textureTempDir, { recursive: true, force: true });
    }
    catch (err) {
        await appendLog(enhancementLog, `[WARN] Failed to clean enhanced temp directory: ${err.message || err}`);
    }
};