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
        if (!buf || offset + 2 > buf.length) { return fallback; }
        return buf.readUInt16BE(offset);
    };

    _readUInt32BE(buf, offset, fallback = 0) {
        if (!buf || offset + 4 > buf.length) { return fallback; }
        return buf.readUInt32BE(offset);
    };

    _getAtlasInfo(file) {
        if (!file || !file.dataBlocks || file.dataBlocks.length < 1) {
            return null;
        }

        const firstBlock = file.dataBlocks[0].data;
        if (!firstBlock || firstBlock.length < 0x70) {
            return null;
        }

        const format = firstBlock.readUInt8(0x58);
        const width = this._readUInt16BE(firstBlock, 0x64);
        const height = this._readUInt16BE(firstBlock, 0x66);

        if (format !== 0xA1 || width <= 0 || height <= 0) {
            return null;
        }

        if (file.dataBlocks.length === 1) {
            if (firstBlock.length < 0xB0) {
                return null;
            }

            const storedLength = this._readUInt32BE(firstBlock, 0xA8);
            const remainingLength = Math.max(0, firstBlock.length - 0xB0);
            const textureLength = storedLength > 0 && storedLength <= remainingLength
                ? storedLength
                : remainingLength;

            if (textureLength <= 0 || 0xB0 + textureLength > firstBlock.length) {
                return null;
            }

            return {
                format,
                width,
                height,
                textureLength,
                textureOffset: 0xB0,
                textureDataBlockIndex: 0,
                source: 'single-block-atlas'
            };
        }

        const textureBlock = file.dataBlocks[1].data;
        if (!textureBlock || textureBlock.length <= 0) {
            return null;
        }

        return {
            format,
            width,
            height,
            textureLength: textureBlock.length,
            textureOffset: 0,
            textureDataBlockIndex: 1,
            source: 'multi-block-atlas'
        };
    };

    _isSingleBlockAtlasTexture(file) {
        const atlasInfo = this._getAtlasInfo(file);
        return !!atlasInfo && atlasInfo.source === 'single-block-atlas';
    };

    _getSingleBlockAtlasInfo(file) {
        return this._getAtlasInfo(file);
    };

    _buildLuminance8DDS(width, height, textureData) {
        const dds = Buffer.alloc(128);

        // DDS magic
        dds.write('DDS ', 0, 'ascii');

        // DDS_HEADER
        dds.writeUInt32LE(124, 4); // dwSize
        dds.writeUInt32LE(0x0002100F, 8); // CAPS | HEIGHT | WIDTH | PITCH | PIXELFORMAT
        dds.writeUInt32LE(height, 12);
        dds.writeUInt32LE(width, 16);
        dds.writeUInt32LE(width, 20); // pitch for 8-bit uncompressed luminance
        dds.writeUInt32LE(0, 24); // depth
        dds.writeUInt32LE(1, 28); // mip count: export top level only

        // DDS_PIXELFORMAT at offset 76
        dds.writeUInt32LE(32, 76); // pfSize
        dds.writeUInt32LE(0x00020000, 80); // DDPF_LUMINANCE
        dds.writeUInt32LE(0, 84); // fourCC
        dds.writeUInt32LE(8, 88); // RGBBitCount
        dds.writeUInt32LE(0x000000FF, 92); // RBitMask / luminance mask
        dds.writeUInt32LE(0, 96); // GBitMask
        dds.writeUInt32LE(0, 100); // BBitMask
        dds.writeUInt32LE(0, 104); // ABitMask

        // caps
        dds.writeUInt32LE(0x1000, 108); // DDSCAPS_TEXTURE

        const topLevelLength = width * height;
        let topLevelData = textureData.slice(0, topLevelLength);
        if (topLevelData.length < topLevelLength) {
            topLevelData = Buffer.concat([topLevelData, Buffer.alloc(topLevelLength - topLevelData.length)]);
        }

        return Buffer.concat([dds, topLevelData]);
    };

    async toGTFFromFile(file) {
        if (file.dataBlocks.length < 1) { return null; }
        
        const textureDataBlockIndex = file.dataBlocks.length === 1 ? 0 : 1;
        const textureGtfHeader = file.dataBlocks[0].data.slice(0x58, 0x70);
        
        let gtfHeader = Buffer.alloc(0x30);
        
        let textureHeaderDataBlockLength = file.dataBlocks[textureDataBlockIndex].data.length;
        let fileHeaderDataBlockLength = textureHeaderDataBlockLength + 0x30;

        if (file.dataBlocks.length === 1) {
            const atlasInfo = this._getAtlasInfo(file);
            if (atlasInfo && atlasInfo.source === 'single-block-atlas') {
                textureHeaderDataBlockLength = atlasInfo.textureLength;
                fileHeaderDataBlockLength = textureHeaderDataBlockLength + 0x30;
            }
            else {
                textureHeaderDataBlockLength -= 0xB0;
                fileHeaderDataBlockLength -= 0xB0;
            }
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
            const atlasInfo = this._getAtlasInfo(file);
            if (atlasInfo && atlasInfo.source === 'single-block-atlas') {
                textureData = textureData.slice(
                    atlasInfo.textureOffset,
                    atlasInfo.textureOffset + atlasInfo.textureLength
                );
            }
            else {
                textureData = textureData.slice(0xB0);
            }
        }

        return Buffer.concat([gtfHeader, textureData]);
    };

    _toLuminance8DDSFallback(file) {
        const atlasInfo = this._getAtlasInfo(file);
        if (!atlasInfo) {
            return null;
        }

        const data = file.dataBlocks[atlasInfo.textureDataBlockIndex].data;
        const textureData = data.slice(
            atlasInfo.textureOffset,
            atlasInfo.textureOffset + atlasInfo.textureLength
        );

        console.error(`gtf2dds rejected ${file.name}; exporting 8-bit atlas DDS fallback ${atlasInfo.width}x${atlasInfo.height} (${atlasInfo.source}).`);
        return this._buildLuminance8DDS(atlasInfo.width, atlasInfo.height, textureData);
    };

    async toDDSFromFile(file) {
        try {
            const gtfBuffer = await this.toGTFFromFile(file);
            const result = await this.toDDSFromGTFBuffer(gtfBuffer, file.name, { quiet: !!this._getAtlasInfo(file) });
            if (result) {
                return result;
            }

            return this._toLuminance8DDSFallback(file);
        }
        catch (err) {
            console.error(err.message || err);
            return this._toLuminance8DDSFallback(file);
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

                if (process.pkg && candidate.toLowerCase().indexOf('\\snapshot\\') >= 0) {
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

    toDDSFromGTFBuffer(gtfBuffer, name, options = {}) {
        return new Promise(async (resolve) => {
            if (!gtfBuffer) {
                resolve(null);
                return;
            }

            const guid = uuid();
            const safeName = String(name || 'texture').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
            const fileNameFormatted = `${guid}_${safeName}`;
            const tempGtfFileName = path.join(this.tempDir, `${fileNameFormatted}.gtf`);
            const tempDdsFileName = path.join(this.tempDir, `${fileNameFormatted}.dds`);

            try {
                await fs.mkdir(this.tempDir, { recursive: true });
                await fs.writeFile(tempGtfFileName, gtfBuffer);
                const pathToGtfExe = await this._getGtf2DdsPath();

                execFile(pathToGtfExe, ['-v', '-z', '-o', tempDdsFileName, tempGtfFileName], async (err) => {
                    if (err) {
                        try { await fs.rm(tempGtfFileName, { force: true }); } catch (cleanupErr) {}
                        try { await fs.rm(tempDdsFileName, { force: true }); } catch (cleanupErr) {}
                        if (!options.quiet) {
                            console.error(`gtf2dds failed for ${name}: ${err.message || err}`);
                        }
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