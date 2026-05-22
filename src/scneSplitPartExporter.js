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

function readIndices(dataBlock, indexBuffer) {
    const indices = [];
    if (!indexBuffer || indexBuffer.offset === null || indexBuffer.byteLength <= 0) return indices;

    const limit = Math.min(indexBuffer.countU16, Math.floor((dataBlock.length - indexBuffer.offset) / 2));
    for (let i = 0; i < limit; i++) {
        indices.push(dataBlock.readUInt16BE(indexBuffer.offset + (i * 2)));
    }
    return indices;
}

function buildTriangleStripFaces(indices, hasUV, maxVertexIndex) {
    const faces = [];
    let strip = [];

    function validIndex(index) {
        return index !== 0xFFFF && index >= 0 && index <= maxVertexIndex;
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

            if (!validIndex(a) || !validIndex(b) || !validIndex(c) || a === b || b === c || a === c) {
                continue;
            }

            const ordered = (i % 2 === 0) ? [a, b, c] : [b, a, c];
            faces.push(ordered.map(faceElement));
        }
        strip = [];
    }

    for (const index of indices) {
        if (index === 0xFFFF) flushStrip();
        else strip.push(index);
    }
    flushStrip();

    return faces;
}

function buildTriangleListFaces(indices, hasUV, maxVertexIndex) {
    const faces = [];

    function faceElement(index) {
        const objIndex = index + 1;
        return hasUV ? `${objIndex}/${objIndex}` : `${objIndex}`;
    }

    for (let i = 0; i + 2 < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]];
        if (
            tri.some((index) => index === 0xFFFF || index < 0 || index > maxVertexIndex)
            || tri[0] === tri[1]
            || tri[1] === tri[2]
            || tri[0] === tri[2]
        ) {
            continue;
        }
        faces.push(tri.map(faceElement));
    }

    return faces;
}

function boundsForPositions(positions) {
    const valid = positions.filter((position) => position && position.length >= 3 && position.every(Number.isFinite));
    if (valid.length <= 0) {
        return null;
    }

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const position of valid) {
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], position[i]);
            max[i] = Math.max(max[i], position[i]);
        }
    }

    return {
        min,
        max,
        size: max.map((value, i) => value - min[i])
    };
}

async function writePartObj({ parsed, part, baseName, outputPath, options }) {
    const primitiveMode = options.primitiveMode || 'strip';
    const flipV = options.flipV === true || options.flipV === 'true';
    const positionMode = options.positionMode || 'declared';
    const uvMode = options.uvMode || 'declared';

    if (!part.vertexBuffer) {
        return { skipped: true, reason: 'No matching vertex buffer descriptor was found.' };
    }

    const vertexBuffer = part.vertexBuffer;
    const positionDeclaration = findDeclaration(vertexBuffer, 0x00);
    const uvDeclaration = findDeclaration(vertexBuffer, 0x08);

    if (!positionDeclaration) {
        return { skipped: true, reason: 'No POSITION declaration was found.' };
    }

    const indices = readIndices(parsed.dataBlock, part.indexBuffer);
    if (indices.length <= 0) {
        return { skipped: true, reason: 'No index buffer data was found.' };
    }

    const partName = `part_${String(part.index).padStart(3, '0')}_${safeName(part.hashOrId)}`;
    const partDir = path.join(outputPath, 'parts', partName);
    await mkdir(partDir);

    const objPath = path.join(partDir, `${partName}.obj`);
    const mtlPath = path.join(partDir, `${partName}.mtl`);
    const infoPath = path.join(partDir, `${partName}.json`);

    const objLines = [];
    const mtlLines = [];
    const positions = [];
    const uvs = [];

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
                uvs.push(null);
                objLines.push('vt 0 0');
            }
            else {
                const outUv = [uv[0], flipV ? 1 - uv[1] : uv[1]];
                uvs.push(outUv);
                objLines.push(`vt ${formatFloat(outUv[0])} ${formatFloat(outUv[1])}`);
            }
        }
    }

    const faces = primitiveMode === 'list'
        ? buildTriangleListFaces(indices, hasUV, vertexBuffer.vertexCount - 1)
        : buildTriangleStripFaces(indices, hasUV, vertexBuffer.vertexCount - 1);

    for (const face of faces) {
        objLines.push(`f ${face.join(' ')}`);
    }

    await fs.writeFile(objPath, `${objLines.join('\n')}\n`);
    await fs.writeFile(mtlPath, `${mtlLines.join('\n')}\n`);

    if (options.dumpRawBuffers) {
        await fs.writeFile(
            path.join(partDir, 'index_buffer.u16be.bin'),
            parsed.dataBlock.slice(part.indexBuffer.offset, part.indexBuffer.endOffset)
        );
        await fs.writeFile(
            path.join(partDir, 'vertex_buffer.bin'),
            parsed.dataBlock.slice(
                vertexBuffer.vertexBufferDataOffset,
                vertexBuffer.vertexBufferDataOffset + vertexBuffer.vertexBufferByteLength
            )
        );
    }

    const info = {
        index: part.index,
        hashOrId: part.hashOrId,
        objPath,
        mtlPath,
        primitiveMode,
        positionMode,
        uvMode,
        vertexCount: vertexBuffer.vertexCount,
        vertexStride: vertexBuffer.vertexStride,
        indexCount: indices.length,
        faceCount: faces.length,
        bounds: boundsForPositions(positions),
        badPositionCount,
        hasUV,
        badUvCount,
        positionDeclaration,
        uvDeclaration,
        vertexBufferDataOffset: vertexBuffer.vertexBufferDataOffset,
        indexBufferOffset: part.indexBuffer.offset,
        reviewStatus: 'unchecked',
        reviewNotes: ''
    };

    await fs.writeFile(infoPath, JSON.stringify(info, null, 2));
    return info;
}

async function exportScneSplitParts(scnePath, outputPath, options = {}) {
    await mkdir(outputPath);

    const scneBuffer = await fs.readFile(scnePath);
    const parsed = parseScnePackage(scneBuffer);
    const baseName = safeName(path.basename(scnePath, path.extname(scnePath)) || 'scne');

    const manifest = {
        source: scnePath,
        outputPath,
        baseName,
        mode: 'split-parts',
        primitiveMode: options.primitiveMode || 'strip',
        positionMode: options.positionMode || 'declared',
        uvMode: options.uvMode || 'declared',
        flipV: options.flipV === true || options.flipV === 'true',
        modelPartCount: parsed.modelParts.length,
        exportedParts: [],
        skippedParts: [],
        reviewInstructions: [
            'Open OBJ files under parts/*/*.obj one at a time in Blender or a model viewer.',
            'Mark each part JSON reviewStatus as good, bad-topology, bad-position, bad-uv, or unknown.',
            'Send the manifest or the edited per-part JSON files back so bad parts can be mapped to SCNE records.'
        ]
    };

    await mkdir(path.join(outputPath, 'parts'));

    for (const part of parsed.modelParts) {
        try {
            const result = await writePartObj({ parsed, part, baseName, outputPath, options });
            if (result.skipped) {
                manifest.skippedParts.push({
                    index: part.index,
                    hashOrId: part.hashOrId,
                    reason: result.reason
                });
            }
            else {
                manifest.exportedParts.push(result);
            }
        }
        catch (err) {
            manifest.skippedParts.push({
                index: part.index,
                hashOrId: part.hashOrId,
                reason: err.message
            });
        }
    }

    const manifestPath = path.join(outputPath, `${baseName}.split-parts-manifest.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
}

module.exports = {
    exportScneSplitParts
};
