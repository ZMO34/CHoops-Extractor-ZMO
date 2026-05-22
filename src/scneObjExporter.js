const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');

const { parseScnePackage } = require('./scneModelExtractor');

function safeName(name) {
    return String(name || 'scne').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function halfToFloat(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1F;
    const fraction = value & 0x03FF;

    if (exponent === 0) {
        if (fraction === 0) {
            return sign * 0;
        }
        return sign * Math.pow(2, -14) * (fraction / 1024);
    }

    if (exponent === 0x1F) {
        return fraction ? NaN : sign * Infinity;
    }

    return sign * Math.pow(2, exponent - 15) * (1 + (fraction / 1024));
}

function formatFloat(value) {
    if (!Number.isFinite(value)) {
        return '0';
    }

    const rounded = Math.abs(value) < 0.0000001 ? 0 : value;
    return Number.parseFloat(rounded.toFixed(7)).toString();
}

function readAttributeComponents(dataBlock, vertexBuffer, declaration, vertexIndex) {
    const baseOffset = vertexBuffer.vertexBufferDataOffset
        + (vertexIndex * vertexBuffer.vertexStride)
        + declaration.byteOffset;

    if (baseOffset < 0 || baseOffset >= dataBlock.length) {
        return null;
    }

    const components = [];
    for (let componentIndex = 0; componentIndex < declaration.componentCount; componentIndex++) {
        if (declaration.format === 0x02) {
            const offset = baseOffset + (componentIndex * 4);
            if (offset + 4 > dataBlock.length) {
                return null;
            }
            components.push(dataBlock.readFloatBE(offset));
        }
        else if (declaration.format === 0x03) {
            const offset = baseOffset + (componentIndex * 2);
            if (offset + 2 > dataBlock.length) {
                return null;
            }
            components.push(halfToFloat(dataBlock.readUInt16BE(offset)));
        }
        else if (declaration.format === 0x04) {
            const offset = baseOffset + componentIndex;
            if (offset >= dataBlock.length) {
                return null;
            }
            components.push(dataBlock[offset] / 255);
        }
        else {
            return null;
        }
    }

    return components;
}

function findDeclaration(vertexBuffer, usage) {
    if (!vertexBuffer || !vertexBuffer.declarations) {
        return null;
    }

    return vertexBuffer.declarations.find((declaration) => declaration.usage === usage) || null;
}

function buildTriangleStripFaces(indices, vertexBase, vtBase, hasUV) {
    const faces = [];
    let strip = [];

    function flushStrip() {
        for (let i = 2; i < strip.length; i++) {
            const a = strip[i - 2];
            const b = strip[i - 1];
            const c = strip[i];

            if (a === b || b === c || a === c) {
                continue;
            }

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
        if (index === 0xFFFF) {
            flushStrip();
        }
        else {
            strip.push(index);
        }
    }
    flushStrip();

    return faces;
}

function buildTriangleListFaces(indices, vertexBase, vtBase, hasUV) {
    const faces = [];
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]];
        if (tri.some((index) => index === 0xFFFF) || tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) {
            continue;
        }
        faces.push(tri.map((index) => {
            const v = vertexBase + index + 1;
            const vt = vtBase + index + 1;
            return hasUV ? `${v}/${vt}` : `${v}`;
        }));
    }
    return faces;
}

function readIndices(dataBlock, indexBuffer) {
    const indices = [];
    if (!indexBuffer || indexBuffer.offset === null || indexBuffer.byteLength <= 0) {
        return indices;
    }

    const limit = Math.min(indexBuffer.countU16, Math.floor((dataBlock.length - indexBuffer.offset) / 2));
    for (let i = 0; i < limit; i++) {
        indices.push(dataBlock.readUInt16BE(indexBuffer.offset + (i * 2)));
    }
    return indices;
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

    if (options.dumpRawBuffers) {
        await mkdir(rawDir);
    }

    const primitiveMode = options.primitiveMode || 'strip';
    const flipV = options.flipV === true || options.flipV === 'true';

    const objLines = [];
    const mtlLines = [];
    const manifest = {
        source: scnePath,
        objPath,
        mtlPath,
        primitiveMode,
        flipV,
        modelPartCount: parsed.modelParts.length,
        exportedParts: [],
        skippedParts: [],
        notes: [
            'Initial SCNE OBJ export. Geometry is exported from mapped vertex/index buffers.',
            'OBJ import is intended for Blender inspection and UV editing; SCNE reimport is not implemented here.',
            'Normals/material bindings are still under reverse engineering, so generated materials are per model part.',
            'UV0 usage 0x08 is exported when present; secondary UV/lightmap usage 0x09 is ignored for OBJ.'
        ]
    };

    objLines.push(`# ${baseName} exported from SCNE`);
    objLines.push(`mtllib ${path.basename(mtlPath)}`);
    objLines.push('');

    let vertexBase = 0;
    let vtBase = 0;

    for (const part of parsed.modelParts) {
        if (!part.vertexBuffer) {
            manifest.skippedParts.push({
                index: part.index,
                hashOrId: part.hashOrId,
                reason: 'No matching vertex buffer descriptor was found.'
            });
            continue;
        }

        const vertexBuffer = part.vertexBuffer;
        const positionDeclaration = findDeclaration(vertexBuffer, 0x00);
        const uvDeclaration = findDeclaration(vertexBuffer, 0x08);

        if (!positionDeclaration) {
            manifest.skippedParts.push({
                index: part.index,
                hashOrId: part.hashOrId,
                reason: 'No POSITION vertex declaration was found.'
            });
            continue;
        }

        const indices = readIndices(parsed.dataBlock, part.indexBuffer);
        if (indices.length <= 0) {
            manifest.skippedParts.push({
                index: part.index,
                hashOrId: part.hashOrId,
                reason: 'No index buffer data was found.'
            });
            continue;
        }

        const materialName = `part_${String(part.index).padStart(3, '0')}_${safeName(part.hashOrId)}`;
        mtlLines.push(`newmtl ${materialName}`);
        mtlLines.push('Kd 0.8 0.8 0.8');
        mtlLines.push('Ka 0.2 0.2 0.2');
        mtlLines.push('Ks 0.0 0.0 0.0');
        mtlLines.push('');

        objLines.push(`o ${materialName}`);
        objLines.push(`usemtl ${materialName}`);

        let exportedVertexCount = 0;
        let exportedUvCount = 0;
        let hadBadVertex = false;

        for (let vertexIndex = 0; vertexIndex < vertexBuffer.vertexCount; vertexIndex++) {
            const position = readAttributeComponents(parsed.dataBlock, vertexBuffer, positionDeclaration, vertexIndex);
            if (!position || position.length < 3) {
                hadBadVertex = true;
                objLines.push('v 0 0 0');
            }
            else {
                objLines.push(`v ${formatFloat(position[0])} ${formatFloat(position[1])} ${formatFloat(position[2])}`);
            }
            exportedVertexCount++;
        }

        const hasUV = !!uvDeclaration;
        if (hasUV) {
            for (let vertexIndex = 0; vertexIndex < vertexBuffer.vertexCount; vertexIndex++) {
                const uv = readAttributeComponents(parsed.dataBlock, vertexBuffer, uvDeclaration, vertexIndex);
                if (!uv || uv.length < 2) {
                    objLines.push('vt 0 0');
                }
                else {
                    const u = uv[0];
                    const v = flipV ? 1 - uv[1] : uv[1];
                    objLines.push(`vt ${formatFloat(u)} ${formatFloat(v)}`);
                }
                exportedUvCount++;
            }
        }

        const faces = primitiveMode === 'list'
            ? buildTriangleListFaces(indices, vertexBase, vtBase, hasUV)
            : buildTriangleStripFaces(indices, vertexBase, vtBase, hasUV);

        for (const face of faces) {
            objLines.push(`f ${face.join(' ')}`);
        }
        objLines.push('');

        if (options.dumpRawBuffers) {
            const partDir = path.join(rawDir, materialName);
            await mkdir(partDir);
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

        manifest.exportedParts.push({
            index: part.index,
            hashOrId: part.hashOrId,
            materialName,
            vertexCount: vertexBuffer.vertexCount,
            vertexStride: vertexBuffer.vertexStride,
            indexCount: indices.length,
            faceCount: faces.length,
            hasUV,
            uvDeclaration: uvDeclaration || null,
            positionDeclaration,
            vertexBufferDataOffset: vertexBuffer.vertexBufferDataOffset,
            indexBufferOffset: part.indexBuffer.offset,
            hadBadVertex
        });

        vertexBase += vertexBuffer.vertexCount;
        if (hasUV) {
            vtBase += vertexBuffer.vertexCount;
        }
    }

    await fs.writeFile(objPath, `${objLines.join('\n')}\n`);
    await fs.writeFile(mtlPath, `${mtlLines.join('\n')}\n`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    return manifest;
}

module.exports = {
    exportScneObj,
    halfToFloat,
    readAttributeComponents
};
