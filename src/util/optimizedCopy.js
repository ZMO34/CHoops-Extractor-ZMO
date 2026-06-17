const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch (_err) {
        return false;
    }
}

function assertDestinationIsSafe(sourceRoot, destinationRoot) {
    const source = path.resolve(sourceRoot);
    const destination = path.resolve(destinationRoot);

    if (source === destination) {
        throw new Error('Output path must be different from the vanilla/source game path.');
    }

    const relative = path.relative(source, destination);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        throw new Error('Output path cannot be inside the vanilla/source game folder. Choose a separate folder.');
    }
}

async function collectEntries(root) {
    const files = [];
    const directories = [];
    const links = [];

    async function walk(current) {
        const dirents = await fs.readdir(current, { withFileTypes: true });
        for (const dirent of dirents) {
            const fullPath = path.join(current, dirent.name);
            if (dirent.isDirectory()) {
                directories.push(fullPath);
                await walk(fullPath);
            }
            else if (dirent.isSymbolicLink()) {
                links.push(fullPath);
            }
            else if (dirent.isFile()) {
                files.push(fullPath);
            }
        }
    }

    await walk(root);
    return { files, directories, links };
}

async function copyFileFast(source, destination) {
    await fs.mkdir(path.dirname(destination), { recursive: true });

    try {
        await fs.copyFile(source, destination, fsSync.constants.COPYFILE_FICLONE);
    }
    catch (err) {
        // COPYFILE_FICLONE is a best-effort copy-on-write/offloaded copy request.
        // If the filesystem rejects it, fall back to a normal safe byte-for-byte copy.
        if (err && ['ENOSYS', 'ENOTSUP', 'EINVAL', 'EXDEV'].includes(err.code)) {
            await fs.copyFile(source, destination);
        }
        else {
            throw err;
        }
    }

    try {
        const stat = await fs.stat(source);
        await fs.chmod(destination, stat.mode);
        await fs.utimes(destination, stat.atime, stat.mtime);
        return stat.size;
    }
    catch (_err) {
        return 0;
    }
}

async function runLimited(items, limit, worker) {
    let next = 0;
    const count = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
    const workers = Array.from({ length: count }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await worker(item);
        }
    });
    await Promise.all(workers);
}

async function copyTreeOptimized(sourceRoot, destinationRoot, options = {}) {
    const source = path.resolve(sourceRoot);
    const destination = path.resolve(destinationRoot);
    const concurrency = Math.max(1, Number(options.concurrency || 8));
    const logger = typeof options.logger === 'function' ? options.logger : () => {};

    assertDestinationIsSafe(source, destination);

    if (!(await pathExists(source))) {
        throw new Error(`Source game folder does not exist: ${source}`);
    }

    if (await pathExists(destination)) {
        if (!options.overwrite) {
            throw new Error(`Output folder already exists: ${destination}. Choose an empty path or pass --overwrite.`);
        }
        logger(`[COPY] Removing existing output folder: ${destination}`);
        await fs.rm(destination, { recursive: true, force: true });
    }

    logger(`[COPY] Indexing source tree: ${source}`);
    const { files, directories, links } = await collectEntries(source);
    await fs.mkdir(destination, { recursive: true });

    for (const dir of directories) {
        const relative = path.relative(source, dir);
        await fs.mkdir(path.join(destination, relative), { recursive: true });
    }

    for (const link of links) {
        const relative = path.relative(source, link);
        const target = await fs.readlink(link);
        await fs.symlink(target, path.join(destination, relative));
    }

    let copiedBytes = 0;
    let copiedFiles = 0;
    const startedAt = Date.now();

    logger(`[COPY] Copying ${files.length} files with concurrency=${concurrency}...`);
    await runLimited(files, concurrency, async (file) => {
        const relative = path.relative(source, file);
        copiedBytes += await copyFileFast(file, path.join(destination, relative));
        copiedFiles += 1;
        if (copiedFiles % 100 === 0) {
            logger(`[COPY] Copied ${copiedFiles}/${files.length} files...`);
        }
    });

    const elapsedMs = Date.now() - startedAt;
    logger(`[COPY] Complete. files=${copiedFiles}, bytes=${copiedBytes}, elapsedMs=${elapsedMs}`);

    return {
        source,
        destination,
        files: copiedFiles,
        directories: directories.length + 1,
        links: links.length,
        bytes: copiedBytes,
        elapsedMs
    };
}

module.exports = {
    copyTreeOptimized,
    pathExists
};
