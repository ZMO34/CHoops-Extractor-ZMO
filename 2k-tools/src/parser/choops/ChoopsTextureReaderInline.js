const Base = require('./ChoopsTextureReader');

class ChoopsTextureReaderInline extends Base {
    _getAtlasInfo(file) {
        if (!file || !file.dataBlocks || file.dataBlocks.length < 1) return null;
        const firstBlock = file.dataBlocks[0].data;
        if (!firstBlock || firstBlock.length < 0x70) return null;

        const format = firstBlock.readUInt8(0x58);
        const width = this._readUInt16BE(firstBlock, 0x64);
        const height = this._readUInt16BE(firstBlock, 0x66);
        if (format <= 0 || width <= 0 || height <= 0 || width > 8192 || height > 8192) return null;

        if (file.dataBlocks.length === 1) {
            if (firstBlock.length <= 0xB0) return null;
            const storedLength = this._readUInt32BE(firstBlock, 0xA8);
            const remainingLength = firstBlock.length - 0xB0;
            const textureLength = storedLength > 0 && storedLength <= remainingLength ? storedLength : remainingLength;
            if (textureLength <= 0 || 0xB0 + textureLength > firstBlock.length) return null;
            return { format, width, height, textureLength, textureOffset: 0xB0, textureDataBlockIndex: 0, source: 'single-block-atlas' };
        }

        const textureBlock = file.dataBlocks[1].data;
        if (!textureBlock || textureBlock.length <= 0) return null;
        return { format, width, height, textureLength: textureBlock.length, textureOffset: 0, textureDataBlockIndex: 1, source: 'multi-block-atlas' };
    }

    _toLuminance8DDSFallback() {
        return null;
    }
}

module.exports = ChoopsTextureReaderInline;
