const scneObjExporter = require('./scneObjExporter');

/**
 * Stable export wrapper.
 *
 * The experimental decode scorer is useful for reverse engineering alternate
 * vertex formats, but for known s000 floor.scne-style court meshes it can pick
 * a mathematically plausible packed decode that visually scrambles the model.
 *
 * Default behavior should therefore preserve the declared SCNE vertex layout:
 *   - POSITION usage 0x00 using the declaration's stored format
 *   - UV0 usage 0x08 using the declaration's stored format
 *
 * Opt into experimental searching with --experimental-auto-decode.
 */
async function exportScneObj(scnePath, outputPath, options = {}) {
    const experimentalAutoDecode = options.experimentalAutoDecode === true || options.experimentalAutoDecode === 'true';

    const stableOptions = {
        ...options,
        positionMode: experimentalAutoDecode
            ? (options.positionMode || 'auto')
            : (options.positionMode || 'declared'),
        uvMode: experimentalAutoDecode
            ? (options.uvMode || 'auto')
            : (options.uvMode || 'declared')
    };

    return scneObjExporter.exportScneObj(scnePath, outputPath, stableOptions);
}

module.exports = {
    ...scneObjExporter,
    exportScneObj
};
