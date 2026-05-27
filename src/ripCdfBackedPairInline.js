const path = require('path');
const fs = require('fs/promises');
const mkdir = require('make-dir');

const cdfBackedIffExtractor = require('./cdfBackedIffExtractor');

function readUInt32BE(buffer, offset, fallback = null) {
    if (!buffer || offset < 0 || offset + 4 > buffer.length) return fallback;
    return buffer.readUInt32BE(offset);
}

function cleanName(value) {
    return String(value || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (!value) continue;
        const normalized = String(value).toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(value);
    }
    return result;
}

function buildCdfNameCandidates(parsed, iffDataName, iffFileName) {
    const baseFromDataName = String(iffDataName || '').replace(/\.(iff|cdf)$/i, '');
    const baseFromFileName = String(iffFileName || '').replace(/\.(iff|cdf)$/i, '');

    return uniqueStrings([
        parsed && parsed.cdfName,
        `${baseFromDataName}.cdf`,
        `${baseFromFileName}.cdf`,
        baseFromDataName,
        baseFromFileName
    ]);
}

async function tryGetRawControllerFile(controller, name) {
    try {
        return await controller.getFileRawData(name);
    }
    catch (err) {
        if (/\.cdf$/i.test(name)) throw err;
        return await controller.getFileRawData(`${name}.cdf`);
    }
}

async function ripCdfBackedPairInline({
    iffDataName,
    iffFileName,
    iffBuffer,
    controller,
    outputDir,
    textureReader,
    logger,
    options = {}
}) {
    if (!iffBuffer || readUInt32BE(iffBuffer, 0) !== cdfBackedIffExtractor.CDF_BACKED_IFF_MAGIC) {
        return null;
    }

    const parsed = cdfBackedIffExtractor.parseCdfBackedIff(iffBuffer);
    const cdfCandidates = buildCdfNameCandidates(parsed, iffDataName, iffFileName);
    let cdfName = null;
    let cdfBuffer = null;
    let lastError = null;

    for (const candidate of cdfCandidates) {
        try {
            cdfBuffer = await tryGetRawControllerFile(controller, candidate);
            cdfName = /\.cdf$/i.test(candidate) ? candidate : `${candidate}.cdf`;
            break;
        }
        catch (err) {
            lastError = err;
        }
    }

    if (!cdfBuffer) {
        const message = `[CDF-IFF] ${iffFileName}: paired CDF not found. Tried ${cdfCandidates.join(', ')}. ${lastError ? lastError.message || lastError : ''}`;
        if (logger) logger.info(message);
        return {
            parsed,
            summary: {
                family: cdfBackedIffExtractor.getCdfFamily(parsed),
                cdfName: parsed.cdfName,
                recordCount: parsed.recordCount,
                extractedRecords: 0,
                ddsConverted: 0,
                audioPayloads: 0,
                errors: [message]
            }
        };
    }

    await mkdir(outputDir);
    const safeCdfName = cleanName(cdfName);
    await fs.writeFile(path.join(outputDir, safeCdfName), cdfBuffer);

    const result = await cdfBackedIffExtractor.extractCdfBackedPair({
        iffName: iffFileName,
        iffBuffer,
        cdfBuffer,
        outputDir,
        textureReader,
        logger,
        rawType: options.rawType
    });

    if (logger) {
        logger.info(`[CDF-IFF] ${iffFileName} paired with ${cdfName}: family=${result.summary.family} records=${result.summary.recordCount} extracted=${result.summary.extractedRecords} dds=${result.summary.ddsConverted} audio=${result.summary.audioPayloads}`);
    }

    return result;
}

module.exports = ripCdfBackedPairInline;
