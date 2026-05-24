const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs/promises');
const fsBase = require('fs');
const { execFile } = require('child_process');

const envPathUtil = require('../../util/envPathUtil');

class ChoopsTextureReader {
    constructor() {
        this._gtf2ddsPathPromise = null;
    };

    async toGTFFromFile(file) {
        if (file.dataBlocks.length < 1) { return null; }
        
        const textureDataBlockIndex = file.dataBlocks.length === 1 ? 0 : 1;
        const textureGtfHeader = file.dataBlocks[0].data.slice(0x58, 0x70);
        
        let gtfHeader = Buffer.alloc(0x30);
        
        let textureHeaderDataBlockLength = file.dataBlocks[textureDataBlockIndex].data.length;
        let fileHeaderDataBlockLength = textureHeaderDataBlockLength + 0x30;

        if (file.dataBlocks.length === 1) {
            textureHeaderDataBlockLength -= 0xB0;
            fileHeaderDataBlockLength -= 0xB0;
        }

        // file header
        gtfHeader.writeUInt32BE(0x01080000, 0x0);
        gtfHeader.writeUInt32BE(fileHeaderDataBlockLength, 0x4);
        gtfHeader.writeUInt32BE(0x1, 0x8);

        // texture header
        gtfHeader.writeUInt32BE(0x0, 0xC);
        gtfHeader.writeUInt32BE(0x30, 0x10);
        gtfHeader.writeUInt32BE(textureHeaderDataBlockLength, 0x14);
        gtfHeader.fill(textureGtfHeader, 0x18);

        let textureData = file.dataBlocks[textureDataBlockIndex].data;
        if (file.dataBlocks.length === 1) {
            textureData = textureData.slice(0xB0);
        }

        return Buffer.concat([gtfHeader, textureData]);
    };

    async toDDSFromFile(file) {
        try {
            const gtfBuffer = await this.toGTFFromFile(file);
            const result = await this.toDDSFromGTFBuffer(gtfBuffer, file.name);
            return result;
        }
        catch (err) {
            console.error(err.message || err);
            return null;
        }
    };

    async toGTFFromTexture(texture) {
        if (!texture.header || !texture.data) { return null; }
        const textureGtfHeader = texture.header.slice(0x58, 0x70);

        let gtfHeader = Buffer.alloc(0x30);

        // file header
        gtfHeader.writeUInt32BE(0x01080000, 0x0);
        gtfHeader.writeUInt32BE(texture.data.length + 0x30, 0x4);
        gtfHeader.writeUInt32BE(0x1, 0x8);

        // texture header
        gtfHeader.writeUInt32BE(0x0, 0xC);
        gtfHeader.writeUInt32BE(0x30, 0x10);
        gtfHeader.writeUInt32BE(texture.data.length, 0x14);
        gtfHeader.fill(textureGtfHeader, 0x18);

        return Buffer.concat([gtfHeader, texture.data]);
    };

    async toDDSFromTexture(texture) {
        try {
            const gtfBuffer = await this.toGTFFromTexture(texture);
            const result = await this.toDDSFromGTFBuffer(gtfBuffer, texture.name);
            return result;
        }
        catch (err) {
            console.error(err.message || err);
            return null;
        }
    };

    async _getGtf2DdsPath() {
        if (this._gtf2ddsPathPromise) {
            return this._gtf2ddsPathPromise;
        }

        this._gtf2ddsPathPromise = (async () => {
            const envPath = await envPathUtil.getEnvPath();
            const candidates = [];

            if (process.pkg) {
                const exeDir = path.dirname(process.execPath);
                candidates.push(path.join(exeDir, 'gtf2dds.exe'));
                candidates.push(path.join(exeDir, 'lib', 'gtf2dds.exe'));
                candidates.push(path.join(process.cwd(), 'gtf2dds.exe'));
                candidates.push(path.join(process.cwd(), 'lib', 'gtf2dds.exe'));
            }

            candidates.push(path.join(__dirname, '../../../lib/gtf2dds.exe'));

            for (const candidate of candidates) {
                if (!fsBase.existsSync(candidate)) {
                    continue;
                }

                // pkg assets live inside C:\snapshot and cannot be executed directly.
                // Copy bundled executables to the normal temp work area before execFile.
                if (process.pkg && candidate.toLowerCase().indexOf('\\snapshot\\') >= 0) {
                    const extractedExePath = path.join(envPath.temp, 'choops-extractor-gtf2dds.exe');
                    await fs.copyFile(candidate, extractedExePath);
                    return extractedExePath;
                }

                return candidate;
            }

            throw new Error(`Cannot find gtf2dds.exe. Checked: ${candidates.join(', ')}`);
        })();

        return this._gtf2ddsPathPromise;
    };

    toDDSFromGTFBuffer(gtfBuffer, name) {
        return new Promise(async (resolve) => {
            if (!gtfBuffer) {
                resolve(null);
                return;
            }

            const guid = uuid();
            const envPath = await envPathUtil.getEnvPath();

            const fileNameFormatted = `${guid}_${name}`;
            const tempGtfFileName = path.join(envPath.temp, `${fileNameFormatted}.gtf`);
            const tempDdsFileName = path.join(envPath.temp, `${fileNameFormatted}.dds`);

            try {
                await fs.writeFile(tempGtfFileName, gtfBuffer);
                const pathToGtfExe = await this._getGtf2DdsPath();

                execFile(pathToGtfExe, ['-v', '-z', '-o', tempDdsFileName, tempGtfFileName], async (err) => {
                    if (err) {
                        try { await fs.rm(tempGtfFileName, { force: true }); } catch (cleanupErr) {}
                        try { await fs.rm(tempDdsFileName, { force: true }); } catch (cleanupErr) {}
                        console.error(`gtf2dds failed for ${name}: ${err.message || err}`);
                        resolve(null);
                        return;
                    }

                    try {
                        const ddsData = await fs.readFile(tempDdsFileName);
                        await fs.rm(tempGtfFileName, { force: true });
                        await fs.rm(tempDdsFileName, { force: true });
                        resolve(ddsData);
                    }
                    catch (readErr) {
                        try { await fs.rm(tempGtfFileName, { force: true }); } catch (cleanupErr) {}
                        try { await fs.rm(tempDdsFileName, { force: true }); } catch (cleanupErr) {}
                        console.error(`Failed to read converted DDS for ${name}: ${readErr.message || readErr}`);
                        resolve(null);
                    }
                });
            }
            catch (err) {
                try { await fs.rm(tempGtfFileName, { force: true }); } catch (cleanupErr) {}
                try { await fs.rm(tempDdsFileName, { force: true }); } catch (cleanupErr) {}
                console.error(`Texture conversion setup failed for ${name}: ${err.message || err}`);
                resolve(null);
            }
        });
    };
};

module.exports = ChoopsTextureReader;