function normalizeUnsigned32(value) {
    if (value === undefined || value === null) {
        return 0;
    }

    return Number(BigInt(value) & 0xffffffffn);
}

class CacheEntry {
    constructor() {
        this.id = 0;
        this.name = '';
        this.size = 0;
        this.offset = 0;
        this.location = null;
        this.isSplit = false;
        this.splitSecondFileSize = 0;
    };

    set size(value) {
        this._size = normalizeUnsigned32(value);
    };

    get size() {
        return this._size || 0;
    };

    set offset(value) {
        this._offset = normalizeUnsigned32(value);
    };

    get offset() {
        return this._offset || 0;
    };

    set rawOffset(value) {
        this._rawOffset = normalizeUnsigned32(value);
    };

    get rawOffset() {
        return this._rawOffset || 0;
    };

    set splitSecondFileSize(value) {
        this._splitSecondFileSize = normalizeUnsigned32(value);
    };

    get splitSecondFileSize() {
        return this._splitSecondFileSize || 0;
    };
};

module.exports = CacheEntry