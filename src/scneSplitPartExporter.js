const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const { parseScnePackage } = require('./scneModelExtractor');
const { readAttributeComponents } = require('./scneObjExporter');

function safeName(name) {
    return String(name || 'part').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function formatFloat(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.abs(value) < 0.0000001 ? 0 : value;
    return Number.parseFloat(rounded.toFixed(7)).toString();
}

function findDeclaration(vertexBuffer, usage) {
    if (!vertexBuffer || !vertexBuffer.declarations) return null;
    return vertexBuffer.declarations.find((declaration) => declaration.usage === usage) || null;
}

function readIndices(dataBlock, indexBuffer, options = {}) {
    const indices = [];
    if (!indexBuffer || indexBuffer.offset === null || indexBuffer.byteLength <= 0) return indices;

    const startBiasBytes = Number.parseInt(options.indexStartBiasBytes || 0, 10);
    const offset = indexBuffer.offset + startBiasBytes;
    if (offset < 0 || offset >= dataBlock.length) return indices;

    const countBias = Number.parseInt(options.indexCountBias || 0, 10);
    const requestedCount = Math.max(0, indexBuffer.countU16 + countBias);
    const limit = Math.min(requestedCount, Math.floor((dataBlock.length - offset) / 2));
    for (let i = 0; i < limit; i++) {
        indices.push(dataBlock.readUInt16BE(offset + (i * 2)));
    }
    return indices;
}

function buildTriangleStripFaces(indices, hasUV, maxVertexIndex, options = {}) {
    const faces = [];
    let strip = [];
    const restartValues = new Set([0xFFFF]);
    if (options.treatZeroAsRestart) restartValues.add(0);

    function validIndex(index) {
        return !restartValues.has(index) && index >= 0 && index <= maxVertexIndex;
    }

    function faceElement(index) {
        const objIndex = index + 1;
        return hasUV ? `${objIndex}/${objIndex}` : `${objIndex}`;
    }

    function flushStrip() {
        for (let i = 2; i < strip.length; i++) {
            const a = strip[i - 2];
            const b = strip[i - 1];
            const c = strip[i];

            if (!validIndex(a) || !validIndex(b) || !validIndex(c) || a === b || b === c || a === c) continue;

            let ordered = (i % 2 === 0) ? [a, b, c] : [b, a, c];
            if (options.reverseWinding) ordered = [ordered[0], ordered[2], ordered[1]];
            faces.push(ordered.map(faceElement));
        }
        strip = [];
    }

    for (const index of indices) {
        if (restartValues.has(index)) flushStrip();
        else strip.push(index);
    }
    flushStrip();

    return faces;
}

function buildTriangleListFaces(indices, hasUV, maxVertexIndex, options = {}) {
    const faces = [];

    function faceElement(index) {
        const objIndex = index + 1;
        return hasUV ? `${objIndex}/${objIndex}` : `${objIndex}`;
    }

    for (let i = 0; i + 2 < indices.length; i += 3) {
        let tri = [indices[i], indices[i + 1], indices[i + 2]];
        if (tri.some((index) => index === 0xFFFF || index < 0 || index > maxVertexIndex) || tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
        if (options.reverseWinding) tri = [tri[0], tri[2], tri[1]];
        faces.push(tri.map(faceElement));
    }

    return faces;
}

function boundsForPositions(positions) {
    const valid = positions.filter((position) => position && position.length >= 3 && position.every(Number.isFinite));
    if (valid.length <= 0) return null;

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const position of valid) {
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], position[i]);
            max[i] = Math.max(max[i], position[i]);
        }
    }

    return { min, max, size: max.map((value, i) => value - min[i]) };
}

function parsePartFilter(partOption) {
    if (partOption === undefined || partOption === null || partOption === '') return null;
    const parts = String(partOption)
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value >= 0);
    return parts.length > 0 ? new Set(parts) : null;
}

function findAlternateVertexBuffers(parsed, part, limit = 8) {
    if (!part.indexBuffer || part.indexBuffer.endOffset === null) return [];

    const target = part.indexBuffer.alignedEndOffset || part.indexBuffer.endOffset;
    return parsed.vertexDescriptors
        .filter((descriptor) => descriptor.declarations && descriptor.declarations.some((decl) => decl.usage === 0x00))
        .map((descriptor) => ({
            descriptor,
            distance: Math.abs(descriptor.vertexBufferDataOffset - target),
            afterIndexBuffer: descriptor.vertexBufferDataOffset >= part.indexBuffer.offset
        }))
        .sort((a, b) => {
            if (a.afterIndexBuffer !== b.afterIndexBuffer) return a.afterIndexBuffer ? -1 : 1;
            return a.distance - b.distance;
        })
        .slice(0, limit)
        .map((entry) => entry.descriptor);
}

async function writePartObj({ parsed, part, baseName, outputPath, options, overrideVertexBuffer = null, variantName = null }) {
    const primitiveMode = options.primitiveMode || 'strip';
    const flipV = options.flipV === true || options.flipV === 'true';
    const positionMode = options.positionMode || 'declared';
    const uvMode = options.uvMode || 'declared';

    const vertexBuffer = overrideVertexBuffer || part.vertexBuffer;
    if (!vertexBuffer) return { skipped: true, reason: 'No matching vertex buffer descriptor was found.' };

    const positionDeclaration = findDeclaration(vertexBuffer, 0x00);
    const uvDeclaration = findDeclaration(vertexBuffer, 0x08);
    if (!positionDeclaration) return { skipped: true, reason: 'No POSITION declaration was found.' };

    const indices = readIndices(parsed.dataBlock, part.indexBuffer, options);
    if (indices.length <= 0) return { skipped: true, reason: 'No index buffer data was found.' };

    const partNameBase = `part_${String(part.index).padStart(3, '0')}_${safeName(part.hashOrId)}`;
    const partName = variantName ? `${partNameBase}_${safeName(variantName)}` : partNameBase;
    const partDir = path.join(outputPath, 'parts', partName);
    await mkdir(partDir);

    const objPath = path.join(partDir, `${partName}.obj`);
    const mtlPath = path.join(partDir, `${partName}.mtl`);
    const infoPath = path.join(partDir, `${partName}.json`);

    const objLines = [];
    const mtlLines = [];
    const positions = [];

    objLines.push(`# ${partName} from ${baseName}`);
    objLines.push(`# Isolated SCNE model part for visual review`);
    objLines.push(`mtllib ${path.basename(mtlPath)}`);
    objLines.push(`o ${partName}`);
    objLines.push(`usemtl ${partName}`);

    mtlLines.push(`newmtl ${partName}`);
    mtlLines.push('Kd 0.8 0.8 0.8');
    mtlLines.push('Ka 0.2 0.2 0.2');
    mtlLines.push('Ks 0.0 0.0 0.0');

    let badPositionCount = 0;
    for (let vertexIndex = 0; vertexIndex < vertexBuffer.vertexCount; vertexIndex++) {
        const position = readAttributeComponents(parsed.dataBlock, vertexBuffer, positionDeclaration, vertexIndex, positionMode);
        if (!position || position.length < 3 || !position.slice(0, 3).every(Number.isFinite)) {
            badPositionCount++;
            positions.push(null);
            objLines.push('v 0 0 0');
        }
        else {
            const p = position.slice(0, 3);
            positions.push(p);
            objLines.push(`v ${formatFloat(p[0])} ${formatFloat(p[1])} ${formatFloat(p[2])}`);
        }
    }

    const hasUV = !!uvDeclaration;
    let badUvCount = 0;
    if (hasUV) {
        for (let vertexIndex = 0; vertexIndex < vertexBuffer.vertexCount; vertexIndex++) {
            const uv = readAttributeComponents(parsed.dataBlock, vertexBuffer, uvDeclaration, vertexIndex, uvMode);
            if (!uv || uv.length < 2 || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) {
                badUvCount++;
                objLines.push('vt 0 0');
            }
            else {
                const outUv = [uv[0], flipV ? 1 - uv[1] : uv[1]];
                objLines.push(`vt ${formatFloat(outUv[0])} ${formatFloat(outUv[1])}`);
            }
        }
    }

    const faces = primitiveMode === 'list'
        ? buildTriangleListFaces(indices, hasUV, vertexBuffer.vertexCount - 1, options)
        : buildTriangleStripFaces(indices, hasUV, vertexBuffer.vertexCount - 1, options);

    for (const face of faces) objLines.push(`f ${face.join(' ')}`);

    await fs.writeFile(objPath, `${objLines.join('\n')}\n`);
    await fs.writeFile(mtlPath, `${mtlLines.join('\n')}\n`);

    if (options.dumpRawBuffers) {
        await fs.writeFile(path.join(partDir, 'index_buffer.u16be.bin'), parsed.dataBlock.slice(part.indexBuffer.offset, part.indexBuffer.endOffset));
        await fs.writeFile(path.join(partDir, 'vertex_buffer.bin'), parsed.dataBlock.slice(vertexBuffer.vertexBufferDataOffset, vertexBuffer.vertexBufferDataOffset + vertexBuffer.vertexBufferByteLength));
    }

    const info = {
        index: part.index,
        hashOrId: part.hashOrId,
        variantName,
        objPath,
        mtlPath,
        primitiveMode,
        positionMode,
        uvMode,
        vertexCount: vertexBuffer.vertexCount,
        vertexStride: vertexBuffer.vertexStride,
        indexCount: indices.length,
        faceCount: faces.length,
        maxIndexSeen: indices.filter((v) => v !== 0xFFFF).reduce((max, v) => Math.max(max, v), 0),
        bounds: boundsForPositions(positions),
        badPositionCount,
        hasUV,
        badUvCount,
        positionDeclaration,
        uvDeclaration,
        vertexBufferDescriptorOffset: vertexBuffer.offset,
        vertexBufferDataOffset: vertexBuffer.vertexBufferDataOffset,
        indexBufferOffset: part.indexBuffer.offset,
        reviewStatus: 'unchecked',
        reviewNotes: ''
    };

    await fs.writeFile(infoPath, JSON.stringify(info, null, 2));
    return info;
}

async function exportVariantsForPart({ parsed, part, baseName, outputPath, options }) {
    const variantRoot = path.join(outputPath, 'part_variants');
    await mkdir(variantRoot);

    const variants = [];
    const vertexBuffers = findAlternateVertexBuffers(parsed, part, Number.parseInt(options.variantVertexLimit || 8, 10));
    const primitiveModes = ['strip', 'list'];
    const restartModes = [false, true];
    const reverseModes = [false, true];

    for (let vbIndex = 0; vbIndex < vertexBuffers.length; vbIndex++) {
        for (const primitiveMode of primitiveModes) {
            for (const treatZeroAsRestart of restartModes) {
                for (const reverseWinding of reverseModes) {
                    const variantName = `vb${vbIndex}_desc0x${vertexBuffers[vbIndex].offset.toString(16)}_${primitiveMode}${treatZeroAsRestart ? '_zeroRestart' : ''}${reverseWinding ? '_rev' : ''}`;
                    const result = await writePartObj({
                        parsed,
                        part,
                        baseName,
                        outputPath: variantRoot,
                        overrideVertexBuffer: vertexBuffers[vbIndex],
                        variantName,
                        options: {
                            ...options,
                            primitiveMode,
                            treatZeroAsRestart,
                            reverseWinding
                        }
                    });
                    if (!result.skipped) variants.push(result);
                }
            }
        }
    }

    return variants;
}

async function exportScneSplitParts(scnePath, outputPath, options = {}) {
    await mkdir(outputPath);

    const scneBuffer = await fs.readFile(scnePath);
    const parsed = parseScnePackage(scneBuffer);
    const baseName = safeName(path.basename(scnePath, path.extname(scnePath)) || 'scne');
    const partFilter = parsePartFilter(options.part);

    const manifest = {
        source: scnePath,
        outputPath,
        baseName,
        mode: options.partVariants ? 'part-variants' : 'split-parts',
        primitiveMode: options.primitiveMode || 'strip',
        positionMode: options.positionMode || 'declared',
        uvMode: options.uvMode || 'declared',
        partFilter: partFilter ? [...partFilter] : null,
        flipV: options.flipV === true || options.flipV === 'true',
        modelPartCount: parsed.modelParts.length,
        exportedParts: [],
        variantParts: [],
        skippedParts: [],
        reviewInstructions: [
            'Open OBJ files under parts/*/*.obj or part_variants/parts/*/*.obj one at a time.',
            'For part_009, pick the variant that removes the jagged center/court-crossing bars, then report its variantName.',
            'The variantName records descriptor offset, primitive mode, restart mode, and winding mode.'
        ]
    };

    await mkdir(path.join(outputPath, 'parts'));

    for (const part of parsed.modelParts) {
        if (partFilter && !partFilter.has(part.index)) continue;
        try {
            if (options.partVariants) {
                const variants = await exportVariantsForPart({ parsed, part, baseName, outputPath, options });
                manifest.variantParts.push({ index: part.index, hashOrId: part.hashOrId, variants });
            }
            else {
                const result = await writePartObj({ parsed, part, baseName, outputPath, options });
                if (result.skipped) manifest.skippedParts.push({ index: part.index, hashOrId: part.hashOrId, reason: result.reason });
                else manifest.exportedParts.push(result);
            }
        }
        catch (err) {
            manifest.skippedParts.push({ index: part.index, hashOrId: part.hashOrId, reason: err.message });
        }
    }

    const manifestPath = path.join(outputPath, `${baseName}.${options.partVariants ? 'part-variants' : 'split-parts'}-manifest.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
}

module.exports = {
    exportScneSplitParts,
    writePartObj,
    findAlternateVertexBuffers
};
