class IFFDataFile {
    constructor() {
        this.id = 0;
        this.type = 0;
        this.name = '';
        this.index = 0;
        this.typeRaw = 0;
        this.offsetCount = 0;
        this.dataBlocks = [];
        this._isChanged = false;
    };

    get isChanged() {
        return this._isChanged || this.dataBlocks.some((block) => {
            return block && block.isChanged;
        });
    };

    set isChanged(isChanged) {
        this._isChanged = isChanged;
    };
};

module.exports = IFFDataFile;