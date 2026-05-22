const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const cdfTextureExtractor = require('./cdfTextureExtractor');
const ddsUtil = require('./ddsUtil');

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 128;
const DEFAULT_FORMAT = 'DXT1';

function inferDimensions(record, payloadSize) {
    const candidates = [
        { width: 256, height: 128, format: 'DXT1' },
        { width: 128, height: 64, format: 'DXT1' },
        { width: 256, height: 256, format: 'DXT1' },
        { width: 512, height: 256, format: 'DXT1' },
        { width: 256, height: 128, format: 'DXT5' }
    ];

    for (const candidate of candidates) {
        const expected = ddsUtil.payloadSizeFor(candidate.width, candidate.height, candidate.format);
        if (Math.abs(expected - payloadSize) < 4096) {
            return candidate;
        }
    }

    return {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        format: DEFAULT_FORMAT
    };
}

async function exportTeamselectlogo(cdfPath, iffPath, outputPath, options = {}) {
    await mkdir(outputPath);

    const extractionPath = path.join(outputPath, 'raw_records');

    const manifest = await cdfTextureExtractor.extractCdfTextureRecords(
        cdfPath,
        extractionPath,
        {
            iffPath,
            dumpFullRecords: true,
            dumpHeaders: true,
            verbose: options.verbose
        }
    );

    const editableDir = path.join(outputPath, 'editable_dds');
    await mkdir(editableDir);

    const editableManifest = [];

    for (const record of manifest.records) {
        const recordName = `${String(record.index).padStart(4, '0')}_${record.recordIdHex}`;
        const payloadPath = path.join(
            extractionPath,
            'records',
            recordName,
            `${recordName}.payload.bin`
        );

        const payload = await fs.readFile(payloadPath);

        const inferred = inferDimensions(record, payload.length);

        const ddsBuffer = ddsUtil.wrapDds(payload, {
            width: inferred.width,
            height: inferred.height,
            fourCC: inferred.format
        });

        const ddsPath = path.join(editableDir, `${recordName}.dds`);
        await fs.writeFile(ddsPath, ddsBuffer);

        editableManifest.push({
            index: record.index,
            recordIdHex: record.recordIdHex,
            width: inferred.width,
            height: inferred.height,
            format: inferred.format,
            payloadOffset: record.payloadOffset,
            payloadSize: record.payloadSize,
            nextOffset: record.nextOffset,
            ddsPath: path.basename(ddsPath)
        });
    }

    await fs.writeFile(
        path.join(outputPath, 'teamselectlogo_manifest.json'),
        JSON.stringify(editableManifest, null, 2)
    );

    return {
        outputPath,
        extractedCount: editableManifest.length
    };
}

async function importTeamselectlogo(originalCdfPath, manifestPath, editedDdsDir, outputCdfPath) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    const cdfBuffer = await fs.readFile(originalCdfPath);

    for (const entry of manifest) {
        const ddsPath = path.join(editedDdsDir, entry.ddsPath);

        try {
            await fs.access(ddsPath);
        }
        catch (err) {
            continue;
        }

        const ddsBuffer = await fs.readFile(ddsPath);
        const parsed = ddsUtil.parseDds(ddsBuffer);

        if (parsed.payload.length !== entry.payloadSize) {
            throw new Error(
                `Edited DDS payload size mismatch for ${entry.ddsPath}. `
                + `Expected ${entry.payloadSize}, got ${parsed.payload.length}.`
            );
        }

        parsed.payload.copy(cdfBuffer, entry.payloadOffset);
    }

    await fs.writeFile(outputCdfPath, cdfBuffer);

    return {
        outputCdfPath,
        importedCount: manifest.length
    };
}

module.exports = {
    exportTeamselectlogo,
    importTeamselectlogo
};
