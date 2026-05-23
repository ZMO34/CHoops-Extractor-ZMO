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
        this.rawOffset = 0;
    };

    normalizeArchiveFields() {
        this.size = normalizeUnsigned32(this.size);
        this.offset = normalizeUnsigned32(this.offset);
        this.rawOffset = normalizeUnsigned32(this.rawOffset);
        this.splitSecondFileSize = normalizeUnsigned32(this.splitSecondFileSize);
        return this;
    };
};

CacheEntry.normalizeUnsigned32 = normalizeUnsigned32;

module.exports = CacheEntry