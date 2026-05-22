const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const { parseScnePackage } = require('./scneModelExtractor');

const POSITION_DECODE_MODES = [
    'declared',
    'float32-be',
    'float32-le',
    'half3-be',
    'half3-le',
    's16norm3-be',
    's16norm3-le',
    's16fixed3-1024-be',
    's16fixed3-1024-le',
    's16fixed3-256-be',
    's16fixed3-256-le'
];

const UV_DECODE_MODES = [
    'declared',
    'half2-be',
    'half2-le',
    'u16norm2-be',
    'u16norm2-le',
    's16norm2-be',
    's16norm2-le',
    'float2-be',
    'float2-le'
];

function safeName(name) {
    return String(name || 'scne').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function halfToFloat(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1F;
    const fraction = value & 0x03FF;

    if (exponent === 0) {
        if (fraction === 0) return sign * 0;
        return sign * Math.pow(2, -14) * (fraction / 1024);
    }

    if (exponent === 0x1F) {
        return fraction ? NaN : sign * Infinity;
    }

    return sign * Math.pow(2, exponent - 15) * (1 + (fraction / 1024));
}

function formatFloat(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.abs(value) < 0.0000001 ? 0 : value;
    return Number.parseFloat(rounded.toFixed(7)).toString();
}

function readS16(buf, offset, endian) {
    return endian === 'le' ? buf.readInt16LE(offset) : buf.readInt16BE(offset);
}

function readU16(buf, offset, endian) {
    return endian === 'le' ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
}

function readF32(buf, offset, endian) {
    return endian === 'le' ? buf.readFloatLE(offset) : buf.readFloatBE(offset);
}

function readHalf(buf, offset, endian) {
    return halfToFloat(readU16(buf, offset, endian));
}

function baseVertexOffset(vertexBuffer, declaration, vertexIndex) {
    return vertexBuffer.vertexBufferDataOffset
        + (vertexIndex * vertexBuffer.vertexStride)
        + declaration.byteOffset;
}

function readAttributeComponents(dataBlock, vertexBuffer, declaration, vertexIndex, forcedMode = 'declared') {
    const baseOffset = baseVertexOffset(vertexBuffer, declaration, vertexIndex);
    if (baseOffset < 0 || baseOffset >= dataBlock.length) return null;

    const mode = forcedMode === 'declared'
        ? declaredModeForAttribute(declaration)
        : forcedMode;

    return readComponentsByMode(dataBlock, baseOffset, declaration.componentCount, mode);
}

function declaredModeForAttribute(declaration) {
    if (declaration.format === 0x02) return 'float32-be';
    if (declaration.format === 0x03) return 'half2-be';
    if (declaration.format === 0x04) return 'u8norm4';
    return 'unknown';
}

function readComponentsByMode(dataBlock, baseOffset, componentCount, mode) {
    const components = [];
    const count = Math.max(2, componentCount || 2);

    if (mode === 'float32-be' || mode === 'float2-be') {
        const needed = mode === 'float2-be' ? 2 : count;
        for (let i = 0; i < needed; i++) {
            const offset = baseOffset + (i * 4);
            if (offset + 4 > dataBlock.length) return null;
            components.push(readF32(dataBlock, offset, 'be'));
        }
        return components;
    }

    if (mode === 'float32-le' || mode === 'float2-le') {
        const needed = mode === 'float2-le' ? 2 : count;
        for (let i = 0; i < needed; i++) {
            const offset = baseOffset + (i * 4);
            if (offset + 4 > dataBlock.length) return null;
            components.push(readF32(dataBlock, offset, 'le'));
        }
        return components;
    }

    if (mode === 'half3-be' || mode === 'half2-be') {
        const needed = mode === 'half3-be' ? 3 : 2;
        for (let i = 0; i < needed; i++) {
            const offset = baseOffset + (i * 2);
            if (offset + 2 > dataBlock.length) return null;
            components.push(readHalf(dataBlock, offset, 'be'));
        }
        return components;
    }

    if (mode === 'half3-le' || mode === 'half2-le') {
        const needed = mode === 'half3-le' ? 3 : 2;
        for (let i = 0; i < needed; i++) {
            const offset = baseOffset + (i * 2);
            if (offset + 2 > dataBlock.length) return null;
            components.push(readHalf(dataBlock, offset, 'le'));
        }
        return components;
    }

    if (mode === 's16norm3-be' || mode === 's16norm2-be') {
        const needed = mode === 's16norm3-be' ? 3 : 2;
        for (let i = 0; i < needed; i++) {
            const offset = baseOffset + (i * 2);
            if (offset + 2 > dataBlock.length) return null;
            components.push(readS16(dataBlock, offset, 'be') / 32767);
        }
        return components;
    }

    if (mode === 's16norm3-le' || mode === 's16norm2-le') {
        const needed = mode === 's16norm3-le' ? 3 : 2;
        for (let i = 0; i < needed; i++) {
            const offset = baseOffset + (i * 2);
            if (offset + 2 > dataBlock.length) return null;
            components.push(readS16(dataBlock, offset, 'le') / 32767);
        }
        return components;
    }

    if (mode === 'u16norm2-be' || mode === 'u16norm2-le') {
        const endian = mode.endsWith('-le') ? 'le' : 'be';
        for (let i = 0; i < 2; i++) {
            const offset = baseOffset + (i * 2);
            if (offset + 2 > dataBlock.length) return null;
            components.push(readU16(dataBlock, offset, endian) / 65535);
        }
        return components;
    }

    if (mode.startsWith('s16fixed3-')) {
        const parts = mode.split('-');
        const scale = Number.parseFloat(parts[1]);
        const endian = parts[2] || 'be';
        for (let i = 0; i < 3; i++) {
            const offset = baseOffset + (i * 2);
            if (offset + 2 > dataBlock.length) return null;
            components.push(readS16(dataBlock, offset, endian) / scale);
        }
        return components;
    }

    if (mode === 'u8norm4') {
        for (let i = 0; i < Math.min(count, 4); i++) {
            const offset = baseOffset + i;
            if (offset >= dataBlock.length) return null;
            components.push(dataBlock[offset] / 255);
        }
        return components;
    }

    return null;
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

function buildTriangleStripFaces(indices, vertexBase, vtBase, hasUV, maxVertexIndex) {
    const faces = [];
    let strip = [];

    function validIndex(index) {
        return index !== 0xFFFF && index >= 0 && index <= maxVertexIndex;
    }

    function flushStrip() {
        for (let i = 2; i < strip.length; i++) {
            const a = strip[i - 2];
            const b = strip[i - 1];
            const c = strip[i];
            if (!validIndex(a) || !validIndex(b) || !validIndex(c) || a === b || b === c || a === c) continue;
            const ordered = (i % 2 === 0) ? [a, b, c] : [b, a, c];
            faces.push(ordered.map((index) => {
                const v = vertexBase + index + 1;
                const vt = vtBase + index + 1;
                return hasUV ? `${v}/${vt}` : `${v}`;
            }));
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

function buildTriangleListFaces(indices, vertexBase, vtBase, hasUV, maxVertexIndex) {
    const faces = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]];
        if (tri.some((index) => index === 0xFFFF || index < 0 || index > maxVertexIndex) || tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
        faces.push(tri.map((index) => {
            const v = vertexBase + index + 1;
            const vt = vtBase + index + 1;
            return hasUV ? `${v}/${vt}` : `${v}`;
        }));
    }
    return faces;
}

function scorePositions(positions) {
    const valid = positions.filter((p) => p && p.length >= 3 && p.every(Number.isFinite));
    if (valid.length < Math.max(4, positions.length * 0.75)) return { score: -Infinity, validCount: valid.length };

    const mins = [Infinity, Infinity, Infinity];
    const maxs = [-Infinity, -Infinity, -Infinity];
    for (const p of valid) {
        for (let i = 0; i < 3; i++) {
            mins[i] = Math.min(mins[i], p[i]);
            maxs[i] = Math.max(maxs[i], p[i]);
        }
    }

    const extents = maxs.map((max, i) => max - mins[i]);
    const maxAbs = Math.max(...valid.flatMap((p) => p.slice(0, 3).map((v) => Math.abs(v))));
    const finitePenalty = Number.isFinite(maxAbs) ? 0 : 1000000;
    const hugePenalty = maxAbs > 100000 ? 100000 : 0;
    const tinyPenalty = extents.filter((e) => e < 0.0001).length * 500;
    const balancePenalty = Math.max(...extents) / Math.max(0.0001, extents.filter((e) => e > 0.0001).sort((a, b) => b - a)[1] || 0.0001);
    const reasonableScaleBonus = maxAbs > 0.01 && maxAbs < 10000 ? 500 : 0;
    const score = reasonableScaleBonus - finitePenalty - hugePenalty - tinyPenalty - Math.min(balancePenalty, 10000);

    return { score, validCount: valid.length, mins, maxs, extents, maxAbs };
}

function decodePositionsForMode(dataBlock, vertexBuffer, positionDeclaration, mode) {
    const positions = [];
    for (let vertexIndex = 0; vertexIndex < vertexBuffer.vertexCount; vertexIndex++) {
        const p = readAttributeComponents(dataBlock, vertexBuffer, positionDeclaration, vertexIndex, mode);
        positions.push(p && p.length >= 3 ? p.slice(0, 3) : null);
    }
    return positions;
}

function chooseBestPositionDecode(dataBlock, vertexBuffer, positionDeclaration, requestedMode) {
    const modes = requestedMode && requestedMode !== 'auto' ? [requestedMode] : POSITION_DECODE_MODES;
    const candidates = modes.map((mode) => {
        const positions = decodePositionsForMode(dataBlock, vertexBuffer, positionDeclaration, mode);
        return { mode, positions, metrics: scorePositions(positions) };
    }).sort((a, b) => b.metrics.score - a.metrics.score);
    return { best: candidates[0], candidates };
}

function decodeUVsForMode(dataBlock, vertexBuffer, uvDeclaration, mode, flipV) {
    const uvs = [];
    for (let vertexIndex = 0; vertexIndex < vertexBuffer.vertexCount; vertexIndex++) {
        const uv = readAttributeComponents(dataBlock, vertexBuffer, uvDeclaration, vertexIndex, mode);
        if (!uv || uv.length < 2 || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) {
            uvs.push(null);
        }
        else {
            uvs.push([uv[0], flipV ? 1 - uv[1] : uv[1]]);
        }
    }
    return uvs;
}

function scoreUVs(uvs) {
    const valid = uvs.filter((uv) => uv && uv.length >= 2 && uv.every(Number.isFinite));
    if (valid.length < Math.max(4, uvs.length * 0.75)) return { score: -Infinity, validCount: valid.length };
    const outOfRange = valid.filter(([u, v]) => Math.abs(u) > 32 || Math.abs(v) > 32).length;
    const allZero = valid.filter(([u, v]) => Math.abs(u) < 0.00001 && Math.abs(v) < 0.00001).length;
    return { score: 1000 - outOfRange * 20 - allZero, validCount: valid.length, outOfRange, allZero };
}

function chooseBestUVDecode(dataBlock, vertexBuffer, uvDeclaration, requestedMode, flipV) {
    if (!uvDeclaration) return null;
    const modes = requestedMode && requestedMode !== 'auto' ? [requestedMode] : UV_DECODE_MODES;
    const candidates = modes.map((mode) => {
        const uvs = decodeUVsForMode(dataBlock, vertexBuffer, uvDeclaration, mode, flipV);
        return { mode, uvs, metrics: scoreUVs(uvs) };
    }).sort((a, b) => b.metrics.score - a.metrics.score);
    return { best: candidates[0], candidates };
}

async function exportScneObj(scnePath, outputPath, options = {}) {
    await mkdir(outputPath);

    const scneBuffer = await fs.readFile(scnePath);
    const parsed = parseScnePackage(scneBuffer);
    const baseName = safeName(path.basename(scnePath, path.extname(scnePath)) || 'scne');
    const objPath = path.join(outputPath, `${baseName}.obj`);
    const mtlPath = path.join(outputPath, `${baseName}.mtl`);
    const manifestPath = path.join(outputPath, `${baseName}.obj-export-manifest.json`);
    const rawDir = path.join(outputPath, `${baseName}_raw_buffers`);

    if (options.dumpRawBuffers) await mkdir(rawDir);

    const primitiveMode = options.primitiveMode || 'strip';
    const flipV = options.flipV === true || options.flipV === 'true';
    const requestedPositionMode = options.positionMode || 'auto';
    const requestedUvMode = options.uvMode || 'auto';
    const minPositionScore = Number.parseFloat(options.minPositionScore || '-5000');

    const objLines = [];
    const mtlLines = [];
    const manifest = {
        source: scnePath,
        objPath,
        mtlPath,
        primitiveMode,
        flipV,
        positionMode: requestedPositionMode,
        uvMode: requestedUvMode,
        modelPartCount: parsed.modelParts.length,
        exportedParts: [],
        skippedParts: [],
        notes: [
            'SCNE OBJ export uses scored position/UV decode candidates to reduce exploded geometry.',
            'Use --position-mode or --uv-mode to force a candidate from the manifest if auto-pick is wrong.',
            'Normals/material bindings remain partial; materials are still grouped per model part.',
            'This is now suitable for iterative court UV/model inspection, not guaranteed final SCNE reimport.'
        ]
    };

    objLines.push(`# ${baseName} exported from SCNE`);
    objLines.push(`mtllib ${path.basename(mtlPath)}`);
    objLines.push('');

    let vertexBase = 0;
    let vtBase = 0;

    for (const part of parsed.modelParts) {
        if (!part.vertexBuffer) {
            manifest.skippedParts.push({ index: part.index, hashOrId: part.hashOrId, reason: 'No matching vertex buffer descriptor was found.' });
            continue;
        }

        const vertexBuffer = part.vertexBuffer;
        const positionDeclaration = findDeclaration(vertexBuffer, 0x00);
        const uvDeclaration = findDeclaration(vertexBuffer, 0x08);
        if (!positionDeclaration) {
            manifest.skippedParts.push({ index: part.index, hashOrId: part.hashOrId, reason: 'No POSITION declaration found.' });
            continue;
        }

        const indices = readIndices(parsed.dataBlock, part.indexBuffer);
        if (indices.length <= 0) {
            manifest.skippedParts.push({ index: part.index, hashOrId: part.hashOrId, reason: 'No index buffer data found.' });
            continue;
        }

        const positionChoice = chooseBestPositionDecode(parsed.dataBlock, vertexBuffer, positionDeclaration, requestedPositionMode);
        if (!positionChoice.best || positionChoice.best.metrics.score < minPositionScore) {
            manifest.skippedParts.push({
                index: part.index,
                hashOrId: part.hashOrId,
                reason: 'No plausible position decode found.',
                positionCandidates: positionChoice.candidates.map((c) => ({ mode: c.mode, metrics: c.metrics })).slice(0, 6)
            });
            continue;
        }

        const uvChoice = chooseBestUVDecode(parsed.dataBlock, vertexBuffer, uvDeclaration, requestedUvMode, flipV);
        const hasUV = !!(uvChoice && uvChoice.best && uvChoice.best.metrics.score > -Infinity);

        const materialName = `part_${String(part.index).padStart(3, '0')}_${safeName(part.hashOrId)}`;
        mtlLines.push(`newmtl ${materialName}`);
        mtlLines.push('Kd 0.8 0.8 0.8');
        mtlLines.push('Ka 0.2 0.2 0.2');
        mtlLines.push('Ks 0.0 0.0 0.0');
        mtlLines.push('');

        objLines.push(`o ${materialName}`);
        objLines.push(`usemtl ${materialName}`);

        for (const position of positionChoice.best.positions) {
            if (!position || position.length < 3) objLines.push('v 0 0 0');
            else objLines.push(`v ${formatFloat(position[0])} ${formatFloat(position[1])} ${formatFloat(position[2])}`);
        }

        if (hasUV) {
            for (const uv of uvChoice.best.uvs) {
                if (!uv || uv.length < 2) objLines.push('vt 0 0');
                else objLines.push(`vt ${formatFloat(uv[0])} ${formatFloat(uv[1])}`);
            }
        }

        const faces = primitiveMode === 'list'
            ? buildTriangleListFaces(indices, vertexBase, vtBase, hasUV, vertexBuffer.vertexCount - 1)
            : buildTriangleStripFaces(indices, vertexBase, vtBase, hasUV, vertexBuffer.vertexCount - 1);

        for (const face of faces) objLines.push(`f ${face.join(' ')}`);
        objLines.push('');

        if (options.dumpRawBuffers) {
            const partDir = path.join(rawDir, materialName);
            await mkdir(partDir);
            await fs.writeFile(path.join(partDir, 'index_buffer.u16be.bin'), parsed.dataBlock.slice(part.indexBuffer.offset, part.indexBuffer.endOffset));
            await fs.writeFile(
                path.join(partDir, 'vertex_buffer.bin'),
                parsed.dataBlock.slice(vertexBuffer.vertexBufferDataOffset, vertexBuffer.vertexBufferDataOffset + vertexBuffer.vertexBufferByteLength)
            );
        }

        manifest.exportedParts.push({
            index: part.index,
            hashOrId: part.hashOrId,
            materialName,
            vertexCount: vertexBuffer.vertexCount,
            vertexStride: vertexBuffer.vertexStride,
            indexCount: indices.length,
            faceCount: faces.length,
            hasUV,
            selectedPositionMode: positionChoice.best.mode,
            selectedPositionMetrics: positionChoice.best.metrics,
            positionCandidates: positionChoice.candidates.map((c) => ({ mode: c.mode, metrics: c.metrics })).slice(0, 8),
            selectedUvMode: hasUV ? uvChoice.best.mode : null,
            selectedUvMetrics: hasUV ? uvChoice.best.metrics : null,
            uvCandidates: uvChoice ? uvChoice.candidates.map((c) => ({ mode: c.mode, metrics: c.metrics })).slice(0, 8) : [],
            uvDeclaration: uvDeclaration || null,
            positionDeclaration,
            vertexBufferDataOffset: vertexBuffer.vertexBufferDataOffset,
            indexBufferOffset: part.indexBuffer.offset
        });

        vertexBase += vertexBuffer.vertexCount;
        if (hasUV) vtBase += vertexBuffer.vertexCount;
    }

    await fs.writeFile(objPath, `${objLines.join('\n')}\n`);
    await fs.writeFile(mtlPath, `${mtlLines.join('\n')}\n`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
}

module.exports = {
    exportScneObj,
    halfToFloat,
    readAttributeComponents,
    POSITION_DECODE_MODES,
    UV_DECODE_MODES
};
