const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const ChoopsController = require('../2k-tools/src/controller/ChoopsController');
const IFFType = require('../2k-tools/src/model/general/iff/IFFType');
const hashUtil = require('../2k-tools/src/util/2kHashUtil');
const probeUtil = require('../2k-tools/src/util/iffCompressionProbe');

const DEFAULT_CATEGORIES = ['models', 'database', 'rosters', 'animations'];

const TYPE_CATEGORY_HINTS = {
    [IFFType.TYPES.SCNE]: ['models'],
    [IFFType.TYPES.CLTH]: ['models'],
    [IFFType.TYPES.HILT]: ['models'],
    [IFFType.TYPES.CDAN]: ['animations'],
    [IFFType.TYPES.TXT]: ['database', 'rosters'],
    [IFFType.TYPES.NAME]: ['database', 'rosters'],
    [IFFType.TYPES.DRCT]: ['database'],
    [IFFType.TYPES.PRIV]: ['database'],
    [IFFType.TYPES.LAYT]: ['database']
};

const NAME_CATEGORY_PATTERNS = {
    models: [
        /scne/i,
        /model/i,
        /mesh/i,
        /geom/i,
        /body/i,
        /head/i,
        /face/i,
        /skeleton/i,
        /skel/i,
        /cloth/i,
        /clth/i,
        /hilt/i,
        /player/i,
        /arena/i,
        /stadium/i,
        /court/i
    ],
    database: [
        /database/i,
        /db/i,
        /data/i,
        /table/i,
        /csv/i,
        /txt/i,
        /name/i,
        /drct/i,
        /priv/i,
        /layt/i
    ],
    rosters: [
        /roster/i,
        /ros/i,
        /team/i,
        /player/i,
        /coach/i,
        /school/i,
        /rating/i,
        /name/i
    ],
    animations: [
        /anim/i,
        /animation/i,
        /mocap/i,
        /motion/i,
        /singlemocap/i,
        /cdan/i,
        /pose/i
    ]
};

function safeName(name) {
    return String(name || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function normalizeCategories(categories) {
    if (!categories || categories.length <= 0) {
        return DEFAULT_CATEGORIES;
    }

    return categories
        .flatMap((category) => String(category).split(','))
        .map((category) => category.trim().toLowerCase())
        .filter(Boolean);
}

function unique(values) {
    return [...new Set(values)];
}

function classifyAsset({ topLevelName, fileName, type }) {
    const categories = [];
    const typeHints = TYPE_CATEGORY_HINTS[type] || [];
    categories.push(...typeHints);

    const combinedName = `${topLevelName || ''} ${fileName || ''}`;
    for (const [category, patterns] of Object.entries(NAME_CATEGORY_PATTERNS)) {
        if (patterns.some((pattern) => pattern.test(combinedName))) {
            categories.push(category);
        }
    }

    return unique(categories);
}

function firstBytesHex(buf, length = 16) {
    return buf.slice(0, Math.min(length, buf.length)).toString('hex').match(/../g)?.join(' ') || '';
}

async function writeProbeOutputs(basePath, rawBuf, manifestEntry) {
    const result = probeUtil.probeBlock(rawBuf);

    if (!result) {
        return;
    }

    const outPath = `${basePath}.decompressed.${result.algorithm}.bin`;
    await fs.writeFile(outPath, result.data);

    manifestEntry.decompressed = {
        path: outPath,
        algorithm: result.algorithm,
        label: result.label,
        offset: result.offset,
        compressedLength: result.length,
        decompressedLength: result.data.length,
        firstBytes: firstBytesHex(result.data)
    };
}

async function dumpParsedIFF(controller, iffData, outputPath, selectedCategories, options, manifest) {
    const iffController = await controller.getFileController(iffData.name);

    if (Buffer.isBuffer(iffController)) {
        return false;
    }

    const iffBaseName = safeName(iffData.name.replace(/\.[^.]+$/, ''));
    const iffOutDir = path.join(outputPath, iffBaseName);
    await mkdir(iffOutDir);

    for (const file of iffController.file.files) {
        const typeString = IFFType.typeToString(file.type);
        const categories = classifyAsset({
            topLevelName: iffData.name,
            fileName: file.name,
            type: file.type
        });

        const matches = categories.some((category) => selectedCategories.indexOf(category) >= 0);
        if (!matches && !options.includeAllUnknown) {
            continue;
        }

        const effectiveCategories = categories.length > 0 ? categories : ['unknown'];
        const primaryCategory = effectiveCategories.find((category) => selectedCategories.indexOf(category) >= 0) || effectiveCategories[0];
        const assetDir = path.join(iffOutDir, primaryCategory, `${safeName(file.name)}.${typeString.toLowerCase()}`);
        await mkdir(assetDir);

        const dataBlocks = file.dataBlocks.map((block) => block.data || Buffer.alloc(0));
        const combined = Buffer.concat(dataBlocks);
        const combinedPath = path.join(assetDir, `${safeName(file.name)}.${typeString.toLowerCase()}.bin`);
        await fs.writeFile(combinedPath, combined);

        const entry = {
            sourceIff: iffData.name,
            sourceIndex: iffData.index,
            name: file.name,
            type: typeString,
            typeRaw: `0x${(file.typeRaw || 0).toString(16).padStart(8, '0')}`,
            categories: effectiveCategories,
            path: combinedPath,
            size: combined.length,
            firstBytes: firstBytesHex(combined),
            blocks: []
        };

        await writeProbeOutputs(combinedPath, combined, entry);

        for (let i = 0; i < dataBlocks.length; i++) {
            const blockBuf = dataBlocks[i];
            const blockPath = path.join(assetDir, `${safeName(file.name)}.block_${i}.bin`);
            await fs.writeFile(blockPath, blockBuf);

            const blockEntry = {
                index: i,
                path: blockPath,
                size: blockBuf.length,
                firstBytes: firstBytesHex(blockBuf)
            };

            await writeProbeOutputs(blockPath, blockBuf, blockEntry);
            entry.blocks.push(blockEntry);
        }

        manifest.assets.push(entry);
    }

    return true;
}

async function dumpRawTopLevel(controller, iffData, outputPath, selectedCategories, options, manifest) {
    const raw = await controller.getFileRawData(iffData.name);
    const topName = safeName(iffData.name);
    const nameCategories = classifyAsset({ topLevelName: iffData.name, fileName: iffData.name, type: IFFType.TYPES.UNKNOWN });
    const ext = path.extname(iffData.name).toLowerCase();
    const likelyCdf = ext === '.cdf';
    const likelyRosterOrDb = nameCategories.some((category) => ['database', 'rosters'].indexOf(category) >= 0);

    if (!likelyCdf && !likelyRosterOrDb && !options.dumpTopLevelRaw) {
        return;
    }

    const primaryCategory = likelyCdf ? 'database' : (nameCategories[0] || 'unknown');
    if (selectedCategories.indexOf(primaryCategory) < 0 && !options.includeAllUnknown) {
        return;
    }

    const rawDir = path.join(outputPath, '_top_level_raw', primaryCategory);
    await mkdir(rawDir);
    const rawPath = path.join(rawDir, topName);
    await fs.writeFile(rawPath, raw);

    const entry = {
        sourceIff: iffData.name,
        sourceIndex: iffData.index,
        name: iffData.name,
        type: likelyCdf ? 'CDF' : 'RAW',
        categories: nameCategories.length > 0 ? nameCategories : [primaryCategory],
        path: rawPath,
        size: raw.length,
        firstBytes: firstBytesHex(raw),
        probeHits: []
    };

    const hits = probeUtil.scanBuffer(raw, { maxHits: options.maxProbeHits || 500 });
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const hitPath = `${rawPath}.probe_${i}.0x${hit.absoluteOffset.toString(16)}.${hit.algorithm}.bin`;
        await fs.writeFile(hitPath, hit.data);
        entry.probeHits.push({
            path: hitPath,
            algorithm: hit.algorithm,
            label: hit.label,
            absoluteOffset: hit.absoluteOffset,
            decompressedLength: hit.data.length,
            firstBytes: firstBytesHex(hit.data)
        });
    }

    manifest.assets.push(entry);
}

module.exports = async (inputPath, outputPath, options = {}) => {
    await hashUtil.hashLookupPromise;
    await mkdir(outputPath);

    const selectedCategories = normalizeCategories(options.category);
    const controller = new ChoopsController(inputPath, options.gameName);

    await controller.read({
        buildCache: options.cache
    });

    let entries = controller.data.map((entry, index) => ({ ...entry, index }));

    if (options.index !== undefined) {
        entries = [entries[parseInt(options.index)]];
    }
    else if (options.file) {
        entries = entries.filter((entry) => entry.name.toLowerCase() === options.file.toLowerCase());
    }
    else {
        entries = entries.filter((entry) => {
            const categories = classifyAsset({ topLevelName: entry.name, fileName: entry.name, type: IFFType.TYPES.UNKNOWN });
            return options.scanAll || categories.some((category) => selectedCategories.indexOf(category) >= 0) || /\.(iff|cdf)$/i.test(entry.name);
        });
    }

    entries = entries.filter(Boolean);

    const manifest = {
        generatedAt: new Date().toISOString(),
        inputPath,
        selectedCategories,
        entriesScanned: entries.length,
        assets: [],
        notes: [
            'SCNE/CLTH/HILT assets are dumped as model candidates, not converted to FBX/OBJ yet.',
            'CDAN/name-matched mocap assets are dumped as animation candidates.',
            'CDF and roster/database candidates are dumped raw and probed for embedded compressed streams.',
            'Decompressed outputs are candidate payloads; exact inner model/database/animation schemas are still being reverse engineered.'
        ]
    };

    for (const entry of entries) {
        try {
            await dumpRawTopLevel(controller, entry, outputPath, selectedCategories, options, manifest);

            if (/\.iff$/i.test(entry.name) || !/\.cdf$/i.test(entry.name)) {
                await dumpParsedIFF(controller, entry, outputPath, selectedCategories, options, manifest);
            }
        }
        catch (err) {
            manifest.assets.push({
                sourceIff: entry.name,
                sourceIndex: entry.index,
                error: err.message
            });
        }
    }

    const manifestPath = path.join(outputPath, '_asset-extract-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return manifest;
};
