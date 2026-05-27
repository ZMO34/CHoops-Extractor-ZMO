const Base = require('./ChoopsTextureReader');

class ChoopsTextureReaderInline extends Base {
    _getAtlasInfo(file) {
        if (!file || !file.dataBlocks || file.dataBlocks.length < 1) return null;
        const firstBlock = file.dataBlocks[0].data;
        if (!firstBlock || firstBlock.length < 0x70) return null;

        const format = firstBlock.readUInt8(0x58);
        const mipCount = firstBlock.readUInt8(0x59);
        const width = this._readUInt16BE(firstBlock, 0x60);
        const height = this._readUInt16BE(firstBlock, 0x62);
        if (format <= 0 || width <= 0 || height <= 0 || width > 8192 || height > 8192) return null;

        if (file.dataBlocks.length === 1) {
            if (firstBlock.length <= 0xB0) return null;
            const storedLength = this._readUInt32BE(firstBlock, 0xA8);
            const remainingLength = firstBlock.length - 0xB0;
            const textureLength = storedLength > 0 && storedLength <= remainingLength ? storedLength : remainingLength;
            if (textureLength <= 0 || 0xB0 + textureLength > firstBlock.length) return null;
            return { format, mipCount, width, height, textureLength, textureOffset: 0xB0, textureDataBlockIndex: 0, source: 'single-block-atlas' };
        }

        const textureBlock = file.dataBlocks[1].data;
        if (!textureBlock || textureBlock.length <= 0) return null;
        return { format, mipCount, width, height, textureLength: textureBlock.length, textureOffset: 0, textureDataBlockIndex: 1, source: 'multi-block-atlas' };
    }

    _getMipLevels(width, height, mipCount) {
        const levels = [];
        let w = width;
        let h = height;
        const count = mipCount > 0 ? mipCount : 1;
        for (let i = 0; i < count; i++) {
            levels.push({ width: w, height: h, length: w * h });
            if (w === 1 && h === 1) break;
            w = Math.max(1, w >> 1);
            h = Math.max(1, h >> 1);
        }
        return levels;
    }

    _buildLinearB8DDS(width, height, textureData, mipCount) {
        const mipLevels = this._getMipLevels(width, height, mipCount);
        const expectedLength = mipLevels.reduce((sum, level) => sum + level.length, 0);
        let payload = textureData.slice(0, expectedLength);
        if (payload.length < expectedLength) payload = Buffer.concat([payload, Buffer.alloc(expectedLength - payload.length)]);

        const header = Buffer.alloc(128);
        header.write('DDS ', 0, 'ascii');
        header.writeUInt32LE(124, 4);
        header.writeUInt32LE(0x0002100F, 8);
        header.writeUInt32LE(height, 12);
        header.writeUInt32LE(width, 16);
        header.writeUInt32LE(width, 20);
        header.writeUInt32LE(0, 24);
        header.writeUInt32LE(mipLevels.length, 28);
        header.writeUInt32LE(32, 76);
        header.writeUInt32LE(0x00020000, 80);
        header.writeUInt32LE(0, 84);
        header.writeUInt32LE(8, 88);
        header.writeUInt32LE(0x000000FF, 92);
        header.writeUInt32LE(0, 96);
        header.writeUInt32LE(0, 100);
        header.writeUInt32LE(0, 104);
        header.writeUInt32LE(mipLevels.length > 1 ? 0x00401008 : 0x00001000, 108);
        return Buffer.concat([header, payload]);
    }

    async toDDSFromFile(file) {
        try {
            const atlasInfo = this._getAtlasInfo(file);
            if (atlasInfo && atlasInfo.format === 0xA1 && atlasInfo.source === 'single-block-atlas') {
                const data = file.dataBlocks[atlasInfo.textureDataBlockIndex].data;
                const textureData = data.slice(atlasInfo.textureOffset, atlasInfo.textureOffset + atlasInfo.textureLength);
                return this._buildLinearB8DDS(atlasInfo.width, atlasInfo.height, textureData, atlasInfo.mipCount);
            }
            return await super.toDDSFromFile(file);
        }
        catch (err) {
            console.error(err.message || err);
            return null;
        }
    }

    _toLuminance8DDSFallback() {
        return null;
    }
}

module.exports = ChoopsTextureReaderInline;
