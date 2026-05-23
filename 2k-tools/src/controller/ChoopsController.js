const fsPromies = require('fs').promises;
const { Readable, pipeline } = require('stream');
const path = require('path');

const ProgressTracker = require('../util/ProgressTracker');
const gameFileUtil = require('../util/choops/choopsGameFileUtil');
const hashUtil = require('../util/hashUtil');
const CacheEntry = require('../model/general/CacheEntry');

const IFFReader = require('../parser/iff/IFFReader');
const IFFType = require('../model/iff/IFFType');

class ChoopsController {
    constructor(gameDirectoryPath, entries) {
        this.gameDirectoryPath = gameDirectoryPath;
        this.entries = entries;

        this.progressTracker = new ProgressTracker();
        this.progressTracker.totalSteps = 1;
    };

    _emitProgress(msg) {
        this.emit && this.emit('progress', msg);
    };

    getEntryByName(name) {
        const entry = this.entries.find((entry) => entry.name === name);

        if (!entry) {
            return null;
        }

        if (typeof entry.normalizeArchiveFields === 'function') {
            entry.normalizeArchiveFields();
        }
        else {
            entry.size = CacheEntry.normalizeUnsigned32(entry.size);
            entry.offset = CacheEntry.normalizeUnsigned32(entry.offset);
            entry.rawOffset = CacheEntry.normalizeUnsigned32(entry.rawOffset || 0);
            entry.splitSecondFileSize = CacheEntry.normalizeUnsigned32(entry.splitSecondFileSize || 0);
        }

        return entry;
    };

    _normalizeUnsigned32(value) {
        if (value === undefined || value === null) {
            return 0;
        }

        return Number(BigInt(value) & 0xffffffffn);
    };

    _validateReadParameters(length, offset, pathName) {
        const normalizedLength = this._normalizeUnsigned32(length);
        const normalizedOffset = this._normalizeUnsigned32(offset);

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

        const maxNodeReadLength = 0x7fffffff;

        if (normalizedLength > maxNodeReadLength) {
            throw new Error(
                `Refusing oversized archive read for ${pathName}. `
                + `length=${normalizedLength.toString(16)} exceeds Node fs.read limit.`
            );
        }

        return {
            length: normalizedLength,
            offset: normalizedOffset
        };
    };

    async getFileRawData(name) {
        const entry = this.getEntryByName(name);

        if (!entry) {
            throw new Error(`Unable to find archive entry: ${name}`);
        }

        const validatedRead = this._validateReadParameters(entry.size, entry.offset, name);

        let entryBuf = Buffer.alloc(validatedRead.length);
        const entryPath = await gameFileUtil.getGameFilePathByIndex(this.gameDirectoryPath, entry.location);

        this.progressTracker.step();
        this._emitProgress(this.progressTracker.format(`Reading resource from path: ${entryPath} @ offset 0x${validatedRead.offset.toString(16)}.`));

        await this._openAndReadFile(entryPath, entryBuf, validatedRead.length, validatedRead.offset);

        if (entry.isSplit) {
            const splitValidatedRead = this._validateReadParameters(
                entry.splitSecondFileSize,
                0,
                `${name} (split archive)`
            );

            let entryBuf2 = Buffer.alloc(splitValidatedRead.length);
            const entryPath2 = await gameFileUtil.getGameFilePathByIndex(this.gameDirectoryPath, entry.location + 1);

            this.progressTracker.totalSteps += 1;
            this.progressTracker.step();
            this._emitProgress(this.progressTracker.format(`Data is split between two files. Continuing to read from path: ${entryPath2} @ offset 0x0.`));

            await this._openAndReadFile(entryPath2, entryBuf2, splitValidatedRead.length, 0);

            entryBuf = entryBuf.slice(0, validatedRead.length - splitValidatedRead.length);
            entryBuf = Buffer.concat([entryBuf, entryBuf2]);
        }

        this.progressTracker.step();
        this._emitProgress(this.progressTracker.format('Done reading resource.'));

        return entryBuf;
    };

    async _openAndReadFile(pathName, buf, length, offset) {
        const validatedRead = this._validateReadParameters(length, offset, pathName);

        const fd = await fsPromies.open(pathName, 'r');

        try {
            await fd.read({
                buffer: buf,
                offset: 0,
                length: validatedRead.length,
                position: validatedRead.offset
            });
        }
        finally {
            await fd.close();
        }
    };

    async getFileController(name) {
        let entry = this.getEntryByName(name);
        if (entry.controller) { return entry.controller; }
        
        const resourceRawData = await this.getFileRawData(name);
        if (resourceRawData.readUInt32BE(0) === 0xFF3BEF94) {
            const resourceDataStream = Readable.from(resourceRawData);
    
            this.progressTracker.totalSteps += 1;
            this._emitProgress(this.progressTracker.format('Parsing IFF...'));
    
            let controller = await new Promise((resolve, reject) => {
                const parser = new IFFReader();
                let pendingFilePromises = [];

                parser.on('file-data', (file) => {
                    pendingFilePromises.push((async () => {
                        if (file.type === IFFType.TYPES.UNKNOWN && file.typeRaw) {
                            const type = await hashUtil.hashLookup(file.typeRaw);
                            
                            if (type) {
                                file.type = IFFType.stringToType(type.str);
                            }
                        }
                    })());
                });
    
                pipeline(
                    resourceDataStream,
                    parser,
                    async (err) => {
                        if (err) reject(err);
                        else {
                            await Promise.all(pendingFilePromises);
                            resolve(parser.controller);
                        }
                    }
                );
            });

            entry.controller = controller;
            return controller;
        }

        return null;
    };
};

module.exports = ChoopsController;