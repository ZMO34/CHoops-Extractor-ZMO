const path = require('path');
const uuid = require('uuid').v4;
const fs = require('fs/promises');
const fsBase = require('fs');
const { execFile } = require('child_process');

class ChoopsTextureReader {
    constructor(options = {}) {
        this._gtf2ddsPathPromise = null;
        this.tempDir = options.tempDir || path.join(process.cwd(), '_choops_texture_temp');
    };

    _readUInt16BE(buf, offset, fallback = 0) {
        if (!buf || offset < 0 || offset + 2 > buf.length) { return fallback; }
        return buf.readUInt16BE(offset);
    };

    _readUInt32BE(buf, offset, fallback = 0) {
        if (!buf || offset < 0 || offset + 4 > buf.length) { return fallback; }
        return buf.readUInt32BE(offset);
    };

    _getAtlasInfo(file) {
        if (!file || !file.dataBlocks || file.dataBlocks.length < 1) return null;

        const firstBlock = file.dataBlocks[0].data;
        if (!firstBlock || firstBlock.length < 0x70) return null;

        const format = firstBlock.readUInt8(0x58);
        const width = this._readUInt16BE(firstBlock, 0x60);
        const height = this._readUInt16BE(firstBlock, 0x62);

        if (format <= 0 || width <= 0 || height <= 0 || width > 8192 || height > 8192) return null;

        if (file.dataBlocks.length === 1) {
            if (firstBlock.length <= 0xB0) return null;

            const storedLength = this._readUInt32BE(firstBlock, 0xA8);
            const remainingLength = firstBlock.length - 0xB0;
            const textureLength = storedLength > 0 && storedLength <= remainingLength ? storedLength : remainingLength;

            if (textureLength <= 0 || 0xB0 + textureLength > firstBlock.length) return null;

            return {
                format,
                width,
                height,
                textureLength,
                textureOffset: 0xB0,
                textureDataBlockIndex: 0,
                source: 'single-block-inline-txtr'
            };
        }

        const textureBlock = file.dataBlocks[1].data;
        if (!textureBlock || textureBlock.length <= 0) return null;

        return {
            format,
            width,
            height,
            textureLength: textureBlock.length,
            textureOffset: 0,
            textureDataBlockIndex: 1,
            source: 'split-txtr'
        };
    };

    async toGTFFromFile(file) {
        if (!file || !file.dataBlocks || file.dataBlocks.length < 1) return null;

        const textureGtfHeader = file.dataBlocks[0].data.slice(0x58, 0x70);
        const atlasInfo = this._getAtlasInfo(file);
        const textureDataBlockIndex = file.dataBlocks.length === 1 ? 0 : 1;

        let textureData = file.dataBlocks[textureDataBlockIndex].data;
        let textureLength = textureData.length;

        if (file.dataBlocks.length === 1) {
            if (atlasInfo) {
                textureData = textureData.slice(atlasInfo.textureOffset, atlasInfo.textureOffset + atlasInfo.textureLength);
                textureLength = atlasInfo.textureLength;
            }
            else {
                textureData = textureData.slice(0xB0);
                textureLength = textureData.length;
            }
        }

        const gtfHeader = Buffer.alloc(0x30);
        gtfHeader.writeUInt32BE(0x01080000, 0x0);
        gtfHeader.writeUInt32BE(textureLength + 0x30, 0x4);
        gtfHeader.writeUInt32BE(0x1, 0x8);
        gtfHeader.writeUInt32BE(0x0, 0xC);
        gtfHeader.writeUInt32BE(0x30, 0x10);
        gtfHeader.writeUInt32BE(textureLength, 0x14);
        textureGtfHeader.copy(gtfHeader, 0x18);

        return Buffer.concat([gtfHeader, textureData]);
    };

    _toLuminance8DDSFallback() {
        return null;
    };

    async toDDSFromFile(file) {
        try {
            const gtfBuffer = await this.toGTFFromFile(file);
            return await this.toDDSFromGTFBuffer(gtfBuffer, file.name);
        }
        catch (err) {
            console.error(err.message || err);
            return null;
        }
    };

    async toGTFFromTexture(texture) {
        if (!texture.header || !texture.data) { return null; }
        const textureGtfHeader = texture.header.slice(0x58, 0x70);

        const gtfHeader = Buffer.alloc(0x30);
        gtfHeader.writeUInt32BE(0x01080000, 0x0);
        gtfHeader.writeUInt32BE(texture.data.length + 0x30, 0x4);
        gtfHeader.writeUInt32BE(0x1, 0x8);
        gtfHeader.writeUInt32BE(0x0, 0xC);
        gtfHeader.writeUInt32BE(0x30, 0x10);
        gtfHeader.writeUInt32BE(texture.data.length, 0x14);
        textureGtfHeader.copy(gtfHeader, 0x18);

        return Buffer.concat([gtfHeader, texture.data]);
    };

    async toDDSFromTexture(texture) {
        try {
            const gtfBuffer = await this.toGTFFromTexture(texture);
            return await this.toDDSFromGTFBuffer(gtfBuffer, texture.name);
        }
        catch (err) {
            console.error(err.message || err);
            return null;
        }
    };

    async _getGtf2DdsPath() {
        if (this._gtf2ddsPathPromise) return this._gtf2ddsPathPromise;

        this._gtf2ddsPathPromise = (async () => {
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
                if (!fsBase.existsSync(candidate)) continue;
                if (process.pkg && candidate.toLowerCase().indexOf('snapshot') >= 0) {
                    const extractedExePath = path.join(this.tempDir, 'choops-extractor-gtf2dds.exe');
                    await fs.mkdir(this.tempDir, { recursive: true });
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
            const safeName = String(name || 'texture').replace(/[^a-zA-Z0-9_.-]/g, '_');
            const tempGtfFileName = path.join(this.tempDir, `${guid}_${safeName}.gtf`);
            const tempDdsFileName = path.join(this.tempDir, `${guid}_${safeName}.dds`);

            try {
                await fs.mkdir(this.tempDir, { recursive: true });
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
