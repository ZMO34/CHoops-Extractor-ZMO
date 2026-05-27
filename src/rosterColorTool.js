const fs = require('fs/promises');
const path = require('path');
const mkdir = require('make-dir');
const rosterTool = require('./rosterTool');

const TEAM_START = 0x001D85E0;
const TEAM_COUNT = 443;
const TEAM_ROW = 704;
const TEAM_COLOR_START = 0x1A0;
const TEAM_COLOR_COUNT = 32;

function u32(buffer, offset) {
    return buffer.readUInt32BE(offset);
}

function s32(buffer, offset) {
    return buffer.readInt32BE(offset);
}

function hex(value, digits = 8) {
    return `0x${Number(value >>> 0).toString(16).padStart(digits, '0').toUpperCase()}`;
}

function colorWordToRgba(value) {
    return {
        hex_rgba: value.toString(16).padStart(8, '0').toUpperCase(),
        r: (value >>> 24) & 0xFF,
        g: (value >>> 16) & 0xFF,
        b: (value >>> 8) & 0xFF,
        a: value & 0xFF
    };
}

function readUtf16LeNull(buffer, offset, maxChars = 256) {
    if (offset < 0 || offset >= buffer.length - 1) return '';

    const chars = [];
    let cursor = offset;
    for (let i = 0; i < maxChars; i++) {
        if (cursor + 1 >= buffer.length) return '';
        const code = buffer[cursor] | (buffer[cursor + 1] << 8);
        if (code === 0) return chars.join('');
        if (code < 32 || code > 126) return '';
        chars.push(String.fromCharCode(code));
        cursor += 2;
    }

    return chars.join('');
}

function relativeString(buffer, fieldOffset) {
    if (fieldOffset < 0 || fieldOffset + 4 > buffer.length) return '';
    const value = s32(buffer, fieldOffset);
    if (value === 0 || value === -1) return '';
    return readUtf16LeNull(buffer, fieldOffset + value);
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

async function writeCsv(filePath, rows) {
    await mkdir(path.dirname(filePath));
    if (!rows || rows.length <= 0) {
        await fs.writeFile(filePath, '');
        return;
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
        lines.push(headers.map((header) => csvEscape(row[header])).join(','));
    }

    await fs.writeFile(filePath, lines.join('\n'));
}

function decodeTeamHeader(buffer, teamIndex) {
    const rowOffset = TEAM_START + (teamIndex * TEAM_ROW);
    const assetWord = u32(buffer, rowOffset + 0x18C);

    return {
        team_index: teamIndex,
        row_offset: hex(rowOffset),
        short_name: relativeString(buffer, rowOffset + 0x30),
        abbreviation: relativeString(buffer, rowOffset + 0x34),
        school_name: relativeString(buffer, rowOffset + 0x38),
        mascot_name: relativeString(buffer, rowOffset + 0x40),
        asset_id: (assetWord >>> 16) & 0xFFFF,
        team_index_check: assetWord & 0xFFFF
    };
}

function decodeTeamColors(buffer) {
    const rows = [];

    for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
        const team = decodeTeamHeader(buffer, teamIndex);
        const rowBase = TEAM_START + (teamIndex * TEAM_ROW);

        for (let slot = 0; slot < TEAM_COLOR_COUNT; slot++) {
            const relativeOffset = TEAM_COLOR_START + (slot * 4);
            const absoluteOffset = rowBase + relativeOffset;
            const color = colorWordToRgba(u32(buffer, absoluteOffset));

            rows.push({
                ...team,
                color_slot: slot,
                team_relative_offset: hex(relativeOffset, 3),
                absolute_offset: hex(absoluteOffset),
                hex_rgba: color.hex_rgba,
                r: color.r,
                g: color.g,
                b: color.b,
                a: color.a
            });
        }
    }

    return rows;
}

async function dumpTeamColors(inputPath, outputPath) {
    await mkdir(outputPath);
    const loaded = await rosterTool.loadRosterPayload(inputPath);
    const rows = decodeTeamColors(loaded.payload);

    await writeCsv(path.join(outputPath, 'team_colors.csv'), rows);

    const summary = {
        inputPath,
        sourceType: loaded.sourceType,
        payloadSize: loaded.payload.length,
        teamColorStart: hex(TEAM_COLOR_START, 3),
        teamColorCount: TEAM_COLOR_COUNT,
        rows: rows.length,
        note: 'Colors are stored as RGBA words in each team row. Slot labels are not finalized yet; use controlled edits to map each slot to home/away/alternate number/name/body roles.'
    };

    await fs.writeFile(path.join(outputPath, 'team_colors_summary.json'), JSON.stringify(summary, null, 2));
    return summary;
}

module.exports = {
    dumpTeamColors,
    decodeTeamColors
};
