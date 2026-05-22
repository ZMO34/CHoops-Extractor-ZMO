const path = require('path');
const fs = require('fs/promises');

const MAX_SEARCH_DEPTH = 6;

function normalizeInputPath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        throw new Error('A path to the game files is required.');
    }

    return path.resolve(inputPath.trim());
}

async function pathExists(inputPath) {
    try {
        await fs.access(inputPath);
        return true;
    }
    catch (err) {
        return false;
    }
}

async function getStats(inputPath) {
    try {
        return await fs.stat(inputPath);
    }
    catch (err) {
        return null;
    }
}

function isGameArchiveName(filename) {
    const baseName = path.basename(filename);
    return /^0/i.test(baseName) && !/\.bak$/i.test(baseName);
}

async function getCandidateFiles(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    return entries
        .filter((entry) => entry.isFile() && isGameArchiveName(entry.name))
        .map((entry) => path.join(directoryPath, entry.name))
        .sort((a, b) => {
            return path.basename(a).localeCompare(path.basename(b), undefined, {
                numeric: true,
                sensitivity: 'base'
            });
        });
}

async function directoryContainsGameFiles(directoryPath) {
    const candidates = await getCandidateFiles(directoryPath);
    return candidates.length > 0;
}

async function findGameFilesDirectory(startPath, depth = 0, visited = new Set()) {
    const resolved = path.resolve(startPath);

    if (visited.has(resolved) || depth > MAX_SEARCH_DEPTH) {
        return null;
    }
    visited.add(resolved);

    const stats = await getStats(resolved);
    if (!stats) {
        return null;
    }

    if (stats.isFile()) {
        if (isGameArchiveName(resolved)) {
            return path.dirname(resolved);
        }

        return findGameFilesDirectory(path.dirname(resolved), depth + 1, visited);
    }

    if (!stats.isDirectory()) {
        return null;
    }

    if (await directoryContainsGameFiles(resolved)) {
        return resolved;
    }

    const priorityChildren = [
        path.join(resolved, 'USRDIR'),
        path.join(resolved, 'PS3_GAME', 'USRDIR'),
        path.join(resolved, 'PS3_GAME')
    ];

    for (const childPath of priorityChildren) {
        if (!(await pathExists(childPath))) {
            continue;
        }

        const found = await findGameFilesDirectory(childPath, depth + 1, visited);
        if (found) {
            return found;
        }
    }

    let entries = [];
    try {
        entries = await fs.readdir(resolved, { withFileTypes: true });
    }
    catch (err) {
        return null;
    }

    const childDirectories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(resolved, entry.name))
        .sort((a, b) => {
            const aBase = path.basename(a).toUpperCase();
            const bBase = path.basename(b).toUpperCase();

            const score = (value) => {
                if (value === 'USRDIR') return 0;
                if (value === 'PS3_GAME') return 1;
                if (/^BL[EUJ][A-Z0-9]+$/.test(value)) return 2;
                return 10;
            };

            return score(aBase) - score(bBase) || aBase.localeCompare(bBase);
        });

    for (const childPath of childDirectories) {
        const found = await findGameFilesDirectory(childPath, depth + 1, visited);
        if (found) {
            return found;
        }
    }

    return null;
}

async function resolveGameFilesDirectory(inputPath) {
    const normalizedPath = normalizeInputPath(inputPath);
    const foundDirectory = await findGameFilesDirectory(normalizedPath);

    if (!foundDirectory) {
        throw new Error(
            `Could not find College Hoops/NBA 2K PS3 archive files from: ${inputPath}. `
            + 'Pass the disc root, PS3_GAME, USRDIR, an archive chunk, or any parent folder containing them.'
        );
    }

    return foundDirectory;
}

async function getGameFilePaths(inputPath) {
    const gameFilesDirectory = await resolveGameFilesDirectory(inputPath);
    const gameFilePaths = await getCandidateFiles(gameFilesDirectory);

    if (gameFilePaths.length <= 0) {
        throw new Error(`No game archive files were found in: ${gameFilesDirectory}`);
    }

    return gameFilePaths;
}

async function getGameFilePathByIndex(inputPath, index) {
    const paths = await getGameFilePaths(inputPath);
    const parsedIndex = Number.parseInt(index, 10);

    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= paths.length) {
        throw new Error(`Game archive index ${index} is out of range. Found ${paths.length} archive files.`);
    }

    return paths[parsedIndex];
}

module.exports = {
    resolveGameFilesDirectory,
    getGameFilePaths,
    getGameFilePathByIndex,
    _private: {
        isGameArchiveName,
        findGameFilesDirectory,
        getCandidateFiles
    }
};