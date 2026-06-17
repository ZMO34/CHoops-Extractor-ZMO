const fs = require('fs/promises');
const path = require('path');

const builder = require('./builder');
const { copyTreeOptimized, pathExists } = require('./util/optimizedCopy');
const { createProgressReporter, mapProgress } = require('./util/progress');

async function findUsrdir(rootPath) {
    const root = path.resolve(rootPath);
    const candidates = [
        root,
        path.join(root, 'USRDIR'),
        path.join(root, 'PS3_GAME', 'USRDIR')
    ];

    for (const candidate of candidates) {
        if (path.basename(candidate).toUpperCase() !== 'USRDIR') {
            continue;
        }
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `Could not locate PS3_GAME/USRDIR in copied output: ${root}. `
        + 'Use an extracted game folder, PS3_GAME folder, or USRDIR folder. ISO rebuilding is not supported directly.'
    );
}

function rejectIsoInput(sourcePath) {
    if (path.extname(sourcePath).toLowerCase() === '.iso') {
        throw new Error(
            'build-copy works on extracted PS3 game folders, not raw ISO files. '
            + 'Extract the ISO first, then point this command at PS3_GAME or PS3_GAME/USRDIR.'
        );
    }
}

module.exports = async (vanillaGamePath, pathToMod, outputGamePath, options = {}) => {
    rejectIsoInput(vanillaGamePath);

    const progress = createProgressReporter(options);
    const source = path.resolve(vanillaGamePath);
    const mod = path.resolve(pathToMod);
    const output = path.resolve(outputGamePath);

    progress.percent('Preparing build copy', 0, 'Preparing safe build-copy workflow...', { force: true });

    if (!(await pathExists(mod))) {
        throw new Error(`Mod/rip folder does not exist: ${mod}`);
    }

    console.log('[BUILD-COPY] Creating a protected modded copy. Vanilla source will not be modified.');
    console.log(`[BUILD-COPY] Source: ${source}`);
    console.log(`[BUILD-COPY] Mod folder: ${mod}`);
    console.log(`[BUILD-COPY] Output copy: ${output}`);

    const copySummary = await copyTreeOptimized(source, output, {
        overwrite: !!options.overwrite,
        concurrency: Number(options.copyConcurrency || options.concurrency || 8),
        logger: (message) => console.log(message),
        onProgress: (event) => {
            const totalPercent = mapProgress(event.current, event.total, 0, 45);
            progress.percent(event.phase || 'Copying vanilla game', totalPercent, event.message || 'Copying vanilla game...', event);
        }
    });

    progress.percent('Locating copied USRDIR', 47, 'Locating copied USRDIR...', { force: true });
    const copiedUsrdir = await findUsrdir(output);
    console.log(`[BUILD-COPY] Copied USRDIR target: ${copiedUsrdir}`);
    console.log('[BUILD-COPY] Applying mod to copied game folder...');

    await builder(copiedUsrdir, mod, {
        gameName: options.gameName,
        progress: options.progress,
        progressBase: 50,
        progressSpan: 45
    });

    progress.percent('Writing build manifest', 97, 'Writing build-copy manifest...', { force: true });
    const summary = {
        source,
        mod,
        output,
        copiedUsrdir,
        copy: copySummary,
        gameName: options.gameName || 'choops2k8'
    };

    await fs.writeFile(path.join(output, 'choops_build_copy_manifest.json'), JSON.stringify(summary, null, 2));
    console.log('[BUILD-COPY] Complete. Vanilla source was not modified.');
    console.log(`[BUILD-COPY] Manifest: ${path.join(output, 'choops_build_copy_manifest.json')}`);
    progress.percent('Complete', 100, 'Build copy complete. Vanilla source was not modified.', { force: true });

    return summary;
};
