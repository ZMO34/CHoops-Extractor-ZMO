const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs/promises');
const fsBase = require('fs');
const { execFile } = require('child_process');

const envPathUtil = require('../../util/envPathUtil');

class ChoopsTextureWriter {
    constructor(options = {}) {
        this._dds2gtfPathPromise = null;
        this.tempDir = options.tempDir || null;
    };

    async toFileFromGtf(gtfData, file) {
        if (file.dataBlocks.length < 1) throw new Error('File does not have expected number of data blocks.');

        const oldRemap = file.dataBlocks[0].data.readUInt16BE(0x9);

        file.dataBlocks[0].data.writeUInt32BE(0x0, 0x4C);
        file.dataBlocks[0].data.writeUInt32BE(0x0, 0x50);
        file.dataBlocks[0].data.writeUInt32BE(0x0, 0x54);
        file.dataBlocks[0].data.writeUInt32BE(gtfData.readUInt32BE(0x18), 0x58);
        file.dataBlocks[0].data.writeUInt32BE(oldRemap, 0x5C);
        file.dataBlocks[0].data.writeUInt32BE(gtfData.readUInt32BE(0x20), 0x60);
        file.dataBlocks[0].data.writeUInt32BE(gtfData.readUInt32BE(0x24), 0x64);
        file.dataBlocks[0].data.writeUInt32BE(gtfData.readUInt32BE(0x28), 0x68);
        file.dataBlocks[0].data.writeUInt32BE(gtfData.readUInt32BE(0x2C), 0x6C);
        file.dataBlocks[0].isChanged = true;

        const offsetToTexture = gtfData.readUInt32BE(0x10);

        const textureDataBlockIndex = file.dataBlocks.length === 1 ? 0 : 1;
        file.dataBlocks[textureDataBlockIndex].length = gtfData.length - offsetToTexture;

        if (textureDataBlockIndex === 0) {
            file.dataBlocks[textureDataBlockIndex].data = 
                Buffer.concat([file.dataBlocks[textureDataBlockIndex].data.slice(0, 0xB0), gtfData.slice(offsetToTexture)]);
        }
        else {
            file.dataBlocks[textureDataBlockIndex].data = gtfData.slice(offsetToTexture);
        }

        file.dataBlocks[textureDataBlockIndex].isChanged = true;
        
        file.isChanged = true;
    };

    async toFileFromDDSPath(ddsPath, file) {
        const tempGtfFileName = await this.toGtfFromDDS(ddsPath, file.name)
        const gtfData = await fs.readFile(tempGtfFileName);

        try {
            await fs.rm(tempGtfFileName, { force: true });
        }
        catch (err) {
            console.error(err);
        }

        return this.toFileFromGtf(gtfData, file);
    };

    async toPackageFileFromGtf(gtfData, packageFile) {
        if (!packageFile.header || !packageFile.data) throw new Error('Package file is missing header and/or data.');

        const oldRemap = packageFile.header.readUInt16BE(0x9);

        packageFile.header.writeUInt32BE(0x0, 0x4C);
        packageFile.header.writeUInt32BE(0x0, 0x50);
        packageFile.header.writeUInt32BE(0x0, 0x54);
        packageFile.header.writeUInt32BE(gtfData.readUInt32BE(0x18), 0x58);
        packageFile.header.writeUInt32BE(oldRemap, 0x5C);
        packageFile.header.writeUInt32BE(gtfData.readUInt32BE(0x20), 0x60);
        packageFile.header.writeUInt32BE(gtfData.readUInt32BE(0x24), 0x64);
        packageFile.header.writeUInt32BE(gtfData.readUInt32BE(0x28), 0x68);
        packageFile.header.writeUInt32BE(gtfData.readUInt32BE(0x2C), 0x6C);

        packageFile.header.writeUInt32BE(gtfData.readUInt32BE(0x20), 0x90);

        const offsetToTexture = gtfData.readUInt32BE(0x10);
        packageFile.data = gtfData.slice(offsetToTexture);
    };

    async toPackageFileFromDDSPath(ddsPath, packageFile) {
        const tempGtfFileName = await this.toGtfFromDDS(ddsPath, packageFile.name)
        const gtfData = await fs.readFile(tempGtfFileName);

        try {
            await fs.rm(tempGtfFileName, { force: true });
        }
        catch (err) {
            console.error(err);
        }

        return this.toPackageFileFromGtf(gtfData, packageFile);
    };

    async _getTempDir() {
        if (this.tempDir) return this.tempDir;
        const envPath = await envPathUtil.getEnvPath();
        this.tempDir = envPath.temp;
        return this.tempDir;
    };

    async _getDds2GtfPath() {
        if (this._dds2gtfPathPromise) return this._dds2gtfPathPromise;

        this._dds2gtfPathPromise = (async () => {
            const candidates = [];

            if (process.pkg) {
                const exeDir = path.dirname(process.execPath);
                candidates.push(path.join(exeDir, 'dds2gtf.exe'));
                candidates.push(path.join(exeDir, 'lib', 'dds2gtf.exe'));
                candidates.push(path.join(process.cwd(), 'dds2gtf.exe'));
                candidates.push(path.join(process.cwd(), 'lib', 'dds2gtf.exe'));
            }

            candidates.push(path.join(__dirname, '../../../lib/dds2gtf.exe'));
            candidates.push(path.join(__dirname, '../../../../2k-tools/lib/dds2gtf.exe'));

            for (const candidate of candidates) {
                if (!fsBase.existsSync(candidate)) continue;

                // pkg assets inside /snapshot are not directly executable by Windows.
                // If a future packaging change exposes the asset only there, copy it
                // out to the writable temp directory first.
                if (process.pkg && candidate.toLowerCase().indexOf('snapshot') >= 0) {
                    const tempDir = await this._getTempDir();
                    const extractedExePath = path.join(tempDir, 'choops-extractor-dds2gtf.exe');
                    await fs.mkdir(tempDir, { recursive: true });
                    await fs.copyFile(candidate, extractedExePath);
                    return extractedExePath;
                }

                return candidate;
            }

            throw new Error(`Cannot find dds2gtf.exe. Checked: ${candidates.join(', ')}`);
        })();

        return this._dds2gtfPathPromise;
    };

    async toGtfFromDDS(ddsPath, name) {
        const guid = uuid();
        const tempDir = await this._getTempDir();
        await fs.mkdir(tempDir, { recursive: true });

        const safeName = String(name || 'texture').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const tempGtfFileName = path.join(tempDir, `${guid}_${safeName}.gtf`);
        const pathToGtfExe = await this._getDds2GtfPath();

        return new Promise((resolve, reject) => {
            execFile(pathToGtfExe, ['-v', '-z', '-o', tempGtfFileName, ddsPath], (err) => {
                if (err) {
                    reject(new Error(
                        `dds2gtf failed for ${ddsPath}. `
                        + `${err.message || err}. `
                        + `Resolved dds2gtf path: ${pathToGtfExe}`
                    ));
                    return;
                }

                resolve(tempGtfFileName);
            });
        });
    };
};

module.exports = ChoopsTextureWriter;