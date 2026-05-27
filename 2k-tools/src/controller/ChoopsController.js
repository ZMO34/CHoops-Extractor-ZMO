const fs = require('fs');
const path = require('path');
const fsPromies = require('fs/promises');
const Multistream = require('multistream');
const { EventEmitter } = require('events');
const { pipeline, Readable } = require('stream');

const cacheUtil = require('../util/cacheUtil');
const hashUtil = require('../util/2kHashUtil');
const gameFileUtil = require('../util/choops/choopsGameFileUtil');

const IFFReader = require('../parser/IFFReader');
const IFFType = require('../model/general/iff/IFFType');
const Archive = require('../model/choops/archive/Archive');
const ChoopsReader = require('../parser/choops/ChoopsReader');
const ChoopsCache = require('../model/choops/general/ChoopsCache');
const ProgressTracker = require('../model/general/ProgressTracker');
const ChoopsArchiveWriter = require('../parser/choops/ChoopsArchiveWriter');
const ChoopsCacheEntry = require('../model/choops/general/ChoopsCacheEntry');

class ChoopsController extends EventEmitter {
    constructor(gameDirectoryPath, gameName) {
        super();

        this.data = [];
        this.cache = null;
        this.gameName = gameName;
        
        this.parser = new ChoopsReader({
            gameName: this.gameName
        });

        this.gameDirectoryPath = gameDirectoryPath;
        this.progressTracker = new ProgressTracker();
        this._archiveWriter = new ChoopsArchiveWriter(this);
    };

    async _resolveKnownEntryName(nameHash, fallbackId) {
        const resolved = await hashUtil.hashLookup(nameHash, { allowGenerated: false });
        return resolved && resolved.str ? resolved.str : fallbackId.toString();
    };

    async _resolveGeneratedAlias(nameHash) {
        const resolved = await hashUtil.hashLookup(nameHash, { allowGenerated: true });
        return resolved && resolved.str ? resolved.str : null;
    };

    _normalizeExactResourceName(name) {
        return String(name || '').toLowerCase();
    };

    _normalizeResourceName(name) {
        return String(name || '').replace(/\.(iff|cdf|bin)$/i, '').toLowerCase();
    };

    _addAlias(entry, alias) {
        if (!alias) {
            return;
        }

        if (!entry.aliases) {
            entry.aliases = [];
        }

        const normalizedAlias = this._normalizeResourceName(alias);
        if (!normalizedAlias) {
            return;
        }

        const exists = entry.aliases.some((existing) => {
            return this._normalizeResourceName(existing) === normalizedAlias;
        });

        if (!exists && this._normalizeResourceName(entry.name) !== normalizedAlias) {
            entry.aliases.push(alias);
        }
    };

    async _addGeneratedAliasIfKnown(entry) {
        if (!entry || !entry.nameHash) {
            return entry;
        }

        const generatedAlias = await this._resolveGeneratedAlias(entry.nameHash);
        if (generatedAlias) {
            this._addAlias(entry, generatedAlias);
        }

        return entry;
    };

    _normalizeUnsigned32(value) {
        if (value === undefined || value === null) {
            return 0;
        }

        return Number(BigInt(value) & 0xffffffffn);
    };

    _normalizeArchiveEntry(entry) {
        if (!entry) {
            return entry;
        }

        if (typeof entry.normalizeArchiveFields === 'function') {
            entry.normalizeArchiveFields();
        }
        else {
            entry.size = this._normalizeUnsigned32(entry.size);
            entry.offset = this._normalizeUnsigned32(entry.offset);
            entry.rawOffset = this._normalizeUnsigned32(entry.rawOffset || 0);
            entry.splitSecondFileSize = this._normalizeUnsigned32(entry.splitSecondFileSize || 0);
        }

        return entry;
    };

    _validateReadParameters(length, offset, pathName) {
        const normalizedLength = this._normalizeUnsigned32(length);
        const normalizedOffset = this._normalizeUnsigned32(offset);
        const maxNodeReadLength = 0x7fffffff;

        if (!Number.isFinite(normalizedLength) || normalizedLength <= 0) {
            throw new Error(
                `Invalid archive read length detected for ${pathName}. `
                + `length=${length}, normalizedLength=${normalizedLength}`
            );
        }

        if (!Number.isFinite(normalizedOffset) || normalizedOffset < 0) {
            throw new Error(
                `Invalid archive read offset detected for ${pathName}. `
                + `offset=${offset}, normalizedOffset=${normalizedOffset}`
            );
        }

        if (normalizedLength > maxNodeReadLength) {
            throw new Error(
                `Refusing oversized archive read for ${pathName}. `
                + `length=0x${normalizedLength.toString(16)} exceeds Node fs.read limit.`
            );
        }

        return {
            length: normalizedLength,
            offset: normalizedOffset
        };
    };

    async _validateReadWindow(filePath, length, offset) {
        const stats = await fsPromies.stat(filePath);

        if (offset > stats.size) {
            throw new Error(
                `Invalid read offset for ${filePath}. `
                + `offset=0x${offset.toString(16)}, fileSize=0x${stats.size.toString(16)}`
            );
        }

        if (offset + length > stats.size) {
            const remainingSize = stats.size - offset;

            console.warn(
                `[WARN] Clamping invalid archive read for ${filePath}: `
                + `offset=0x${offset.toString(16)}, `
                + `requestedLength=0x${length.toString(16)}, `
                + `remainingLength=0x${remainingSize.toString(16)}`
            );

            return {
                length: remainingSize,
                offset
            };
        }

        return {
            length,
            offset
        };
    };

    async read(options) {
        this.progressTracker.totalSteps = 1;

        if (options && options.buildCache) {
            this._emitProgress(this.progressTracker.format('buildCache option passed in. Reading and building cache...'));
            await this.rebuildCache();
        }
        else {
            try {
                this._emitProgress(this.progressTracker.format('Cache found, reading data from cache...'));
                this.cache = await cacheUtil.getCache(cacheUtil.getFormattedCacheName(this.gameName));

                this.cache.archiveCache.archives = this.cache.archiveCache.archives.map((entry) => {
                    let archive = new Archive();
                    archive.name = entry.name;
                    archive.zero = entry.zero;
                    archive.sizeRaw = BigInt(entry.sizeRaw);

                    return archive;
                });

                this.cache.tocCache = this.cache.tocCache.map((rawCacheEntry) => {
                    let cacheEntry = new ChoopsCacheEntry();
                    Object.assign(cacheEntry, rawCacheEntry);
                    this._normalizeArchiveEntry(cacheEntry);
                    return cacheEntry;
                });

                this.data = this.cache.tocCache;
            }
            catch (err) {
                this._emitProgress(this.progressTracker.format('Cache not found or empty, reading and building cache...'));
                await this.rebuildCache();
            }
        }

        this._archiveWriter.cache = this.cache;

        this.progressTracker.step();
        this._emitProgress(this.progressTracker.format('Read complete.'));
    };

    async _read() {
        await hashUtil.hashLookupPromise;

        let cachePromises = [];

        this.parser.on('progress', function (data) {
            this._emitProgress(data);
        }.bind(this));

        this.parser.on('chunk', async function (data) {
            cachePromises.push(new Promise(async (resolve) => {
                let cacheEntry = new ChoopsCacheEntry();
                cacheEntry.id = data.meta.id;
                cacheEntry.size = data.meta.size;
                cacheEntry.nameHash = data.meta.nameHash;

                cacheEntry.name = await this._resolveKnownEntryName(
                    cacheEntry.nameHash,
                    data.meta.id
                );

                if (/^\d+$/.test(cacheEntry.name)) {
                    await this._addGeneratedAliasIfKnown(cacheEntry);
                }

                cacheEntry.rawOffset = data.meta.rawOffset;
                cacheEntry.offset = data.meta.archiveOffset;
                cacheEntry.location = data.meta.archiveIndex;
                cacheEntry.isSplit = data.meta.isSplit;
                cacheEntry.splitSecondFileSize = data.meta.splitSecondFileSize;
                cacheEntry.sizeWasDerived = data.meta.sizeWasDerived;
                cacheEntry.storedSize = data.meta.storedSize;
                cacheEntry.derivedSize = data.meta.derivedSize;
                cacheEntry.sizeDerivationReason = data.meta.sizeDerivationReason;

                this._normalizeArchiveEntry(cacheEntry);
                cacheEntry.setCurrentDataAsOriginal();

                resolve(cacheEntry);
            }));
        }.bind(this));

        const gameFilePaths = await gameFileUtil.getGameFilePaths(this.gameDirectoryPath);
        const gameReadStreams = gameFilePaths.map((gameFilePath) => fs.createReadStream(gameFilePath));

        await new Promise((resolve, reject) => {
            pipeline(
                new Multistream(gameReadStreams),
                this.parser,
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        this.data = await Promise.all(cachePromises);
    };

    async _buildCache() {
        this.cache = new ChoopsCache();
        this.cache.tocCache = this.data;
        this.cache.archiveCache = this.parser.archive;

        await this._saveCache();
    };

    async rebuildCache() {
        await this._read();
        await this._buildCache();
    };

    async _saveCache() {
        let cacheToSave = JSON.parse(JSON.stringify(this.cache));

        cacheToSave.tocCache.forEach((cacheEntry) => {
            delete cacheEntry.controller;
        });

        await cacheUtil.buildAndSaveCache(cacheUtil.getFormattedCacheName(this.gameName), cacheToSave);
    };

    getEntryByName(name) {
        const exactName = this._normalizeExactResourceName(name);
        const normalizedName = this._normalizeResourceName(name);

        // Exact names must win before extensionless aliases. CDF-backed pairs often
        // share the same base name, for example teamselectlogo.iff and
        // teamselectlogo.cdf. The old extensionless-first lookup could return the
        // CDF when callers explicitly asked for the IFF, which prevented paired-bank
        // extraction from ever seeing the 0xF0985030 metadata file.
        let entry = this.data.find((candidate) => {
            return this._normalizeExactResourceName(candidate.name) === exactName;
        });

        if (!entry) {
            entry = this.data.find((candidate) => {
                const aliases = candidate.aliases || [];
                return aliases.some((alias) => this._normalizeExactResourceName(alias) === exactName);
            });
        }

        if (!entry) {
            entry = this.data.find((candidate) => {
                const entryName = this._normalizeResourceName(candidate.name);
                const aliases = candidate.aliases || [];
                return entryName === normalizedName || aliases.some((alias) => {
                    return this._normalizeResourceName(alias) === normalizedName;
                });
            });
        }

        if (!entry) {
            throw new Error(`Cannot find a resource in the cache with name ${name}.`);
        }

        return this._normalizeArchiveEntry(entry);
    };

    async getFileRawData(name) {
        const entry = this.getEntryByName(name);
        const validatedRead = this._validateReadParameters(entry.size, entry.offset, name);
        const gameFilePaths = await gameFileUtil.getGameFilePaths(this.gameDirectoryPath);

        let entryBuf = Buffer.alloc(validatedRead.length);
        let remainingLength = validatedRead.length;
        let destinationOffset = 0;
        let archiveIndex = Number(entry.location);
        let archiveOffset = validatedRead.offset;

        this.progressTracker.reset();
        this.progressTracker.totalSteps = Math.max(1, entry.isSplit ? 2 : 1);

        while (remainingLength > 0) {
            if (!Number.isInteger(archiveIndex) || archiveIndex < 0 || archiveIndex >= gameFilePaths.length) {
                throw new Error(
                    `Resource ${name} extends past the available game archive files. `
                    + `archiveIndex=${archiveIndex}, remainingLength=0x${remainingLength.toString(16)}`
                );
            }

            const entryPath = gameFilePaths[archiveIndex];
            const stats = await fsPromies.stat(entryPath);

            if (archiveOffset > stats.size) {
                throw new Error(
                    `Invalid split archive read for ${name}. `
                    + `${entryPath} offset=0x${archiveOffset.toString(16)}, `
                    + `fileSize=0x${stats.size.toString(16)}`
                );
            }

            const availableInThisArchive = stats.size - archiveOffset;
            const chunkLength = Math.min(remainingLength, availableInThisArchive);

            if (chunkLength <= 0) {
                throw new Error(
                    `Invalid split archive read for ${name}. `
                    + `${entryPath} has no remaining bytes at offset=0x${archiveOffset.toString(16)}`
                );
            }

            this.progressTracker.step();
            this._emitProgress(this.progressTracker.format(
                `Reading resource from path: ${entryPath} @ offset 0x${archiveOffset.toString(16)} length 0x${chunkLength.toString(16)}.`
            ));

            await this._openAndReadFile(entryPath, entryBuf, chunkLength, archiveOffset, destinationOffset);

            remainingLength -= chunkLength;
            destinationOffset += chunkLength;
            archiveIndex += 1;
            archiveOffset = 0;
        }

        return entryBuf;
    };

    async _openAndReadFile(pathName, buf, length, offset, bufferOffset = 0) {
        const validatedRead = this._validateReadParameters(length, offset, pathName);
        const validatedWindow = await this._validateReadWindow(
            pathName,
            validatedRead.length,
            validatedRead.offset
        );

        const fd = await fsPromies.open(pathName, 'r');

        try {
            await fd.read({
                buffer: buf,
                offset: bufferOffset,
                length: validatedWindow.length,
                position: validatedWindow.offset
            });
        }
        finally {
            await fd.close();
        }

        return validatedWindow.length;
    };

    async getFileController(name) {
        let entry = this.getEntryByName(name);
        if (entry.controller) {
            return entry.controller;
        }

        const resourceRawData = await this.getFileRawData(name);

        if (resourceRawData.length >= 4 && resourceRawData.readUInt32BE(0) === 0xFF3BEF94) {
            const resourceDataStream = Readable.from(resourceRawData);

            this.progressTracker.totalSteps += 1;
            this._emitProgress(this.progressTracker.format('Parsing IFF...'));

            let controller = await new Promise((resolve, reject) => {
                const parser = new IFFReader();
                let pendingFilePromises = [];

                parser.on('file-data', (file) => {
                    pendingFilePromises.push((async () => {
                        if (file.type === IFFType.TYPES.UNKNOWN && file.typeRaw) {
                            const type = await hashUtil.hashLookup(file.typeRaw, { allowGenerated: false });

                            if (type) {
                                file.type = IFFType.stringToType(type.str);
                            }
                        }
                    })());
                });

                pipeline(resourceDataStream, parser, async (err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        await Promise.all(pendingFilePromises);
                        resolve(parser.controller);
                    }
                });
            });

            entry.controller = controller;

            this.progressTracker.step();
            this._emitProgress(this.progressTracker.format('Done parsing IFF.'));

            return controller;
        }

        return resourceRawData;
    };

    async repack(saveCache) {
        await this._archiveWriter.write();

        if (saveCache === undefined || saveCache === true) {
            await this._saveCache();
        }
    };

    async revert(name) {
        let entry = this.getEntryByName(name);
        entry.revert();

        let archiveCacheEntry = this.cache.archiveCache.toc.find((tocEntry) => {
            return tocEntry.id === entry.id;
        });

        archiveCacheEntry.offset = entry.originalOffset;
        archiveCacheEntry.size = entry.originalSize;
    };

    _emitProgress(message) {
        this.emit('progress', {
            message: message
        });
    };
};

module.exports = ChoopsController;