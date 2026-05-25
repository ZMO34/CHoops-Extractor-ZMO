const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const mkdir = require('make-dir');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const IFFReader = require('../2k-tools/src/parser/IFFReader');
const IFFType = require('../2k-tools/src/model/general/iff/IFFType');

const STANDARD_IFF_MAGIC = 0xFF3BEF94;
const ZIP_LOCAL_MAGIC = 0x04034B50;
const ZIP_CENTRAL_MAGIC = 0x02014B50;
const ZIP_EOCD_MAGIC = 0x06054B50;

const PLAYER_START = 0x000271AC;
const PLAYER_COUNT = 5685;
const PLAYER_ROW = 308;
const ARENA_START = 0x001D5C84;
const ARENA_COUNT = 379;
const ARENA_ROW = 28;
const TEAM_START = 0x001D85E0;
const TEAM_COUNT = 443;
const TEAM_ROW = 704;
const COACH_START = 0x0023F78C;
const COACH_COUNT = 1373;
const COACH_ROW = 44;

const POSITIONS = {
    0: 'PG',
    1: 'SG',
    2: 'SF',
    3: 'PF',
    4: 'C'
};

function u8(buffer, offset) {
    return buffer[offset];
}

function u16(buffer, offset) {
    return buffer.readUInt16BE(offset);
}

function u32(buffer, offset) {
    return buffer.readUInt32BE(offset);
}

function s32(buffer, offset) {
    return buffer.readInt32BE(offset);
}

function hex32(value) {
    return `0x${Number(value >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
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

function readUtf16LeNull(buffer, offset, maxChars = 256) {
    if (offset < 0 || offset >= buffer.length - 1) return null;

    const chars = [];
    let cursor = offset;

    for (let i = 0; i < maxChars; i++) {
        if (cursor + 1 >= buffer.length) return null;
        const code = buffer[cursor] | (buffer[cursor + 1] << 8);
        if (code === 0) return chars.join('');
        if (code < 32 || code > 126) return null;
        chars.push(String.fromCharCode(code));
        cursor += 2;
    }

    return chars.join('');
}

function relativeString(buffer, fieldOffset) {
    if (fieldOffset < 0 || fieldOffset + 4 > buffer.length) return null;
    const target = fieldOffset + u32(buffer, fieldOffset);
    return readUtf16LeNull(buffer, target);
}

function indexFromRelativePointer(buffer, fieldOffset, tableStart, rowSize, count) {
    if (fieldOffset < 0 || fieldOffset + 4 > buffer.length) return null;

    const value = s32(buffer, fieldOffset);
    if (value === 0 || value === -1) return null;

    const target = fieldOffset + value;
    const tableEnd = tableStart + (rowSize * count);

    if (target < tableStart || target >= tableEnd) return null;

    return Math.floor((target - tableStart) / rowSize);
}

function decodePlayer(buffer, index) {
    const offset = PLAYER_START + (index * PLAYER_ROW);
    const packed = u32(buffer, offset + 0x18);
    const firstName = relativeString(buffer, offset + 0x14) || '';
    const lastName = relativeString(buffer, offset + 0x10) || '';
    const positionCode = u8(buffer, offset + 0x3B);

    return {
        player_index: index,
        row_offset: hex32(offset),
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`.trim(),
        packed_id_jersey_hex: hex32(packed),
        packed_high: (packed >>> 16) & 0xFFFF,
        jersey_number: packed & 0xFFFF,
        height_inches: u8(buffer, offset + 0x3A),
        position_code: positionCode,
        position: POSITIONS[positionCode] || 'UNK'
    };
}

function decodeArena(buffer, index) {
    const offset = ARENA_START + (index * ARENA_ROW);

    return {
        arena_index: index,
        row_offset: hex32(offset),
        arena_code: relativeString(buffer, offset + 0x04) || '',
        arena_name: relativeString(buffer, offset + 0x18) || ''
    };
}

function decodeCoach(buffer, index) {
    const offset = COACH_START + (index * COACH_ROW);

    return {
        coach_index: index,
        row_offset: hex32(offset),
        coach_name: relativeString(buffer, offset + 0x14) || '',
        abbreviation: relativeString(buffer, offset + 0x18) || ''
    };
}

function decodeTeam(buffer, index) {
    const offset = TEAM_START + (index * TEAM_ROW);
    const assetWord = u32(buffer, offset + 0x18C);
    const assetWord190 = u32(buffer, offset + 0x190);
    const assetWord194 = u32(buffer, offset + 0x194);

    const rosterSlots = [];
    for (let slot = 0; slot < 16; slot++) {
        const fieldOffset = offset + 0x6C + (slot * 4);
        rosterSlots.push(indexFromRelativePointer(buffer, fieldOffset, PLAYER_START, PLAYER_ROW, PLAYER_COUNT));
    }

    return {
        team_index: index,
        row_offset: hex32(offset),
        team_code: relativeString(buffer, offset + 0x00) || '',
        short_name: relativeString(buffer, offset + 0x30) || '',
        abbreviation: relativeString(buffer, offset + 0x34) || '',
        school_name: relativeString(buffer, offset + 0x38) || '',
        mascot_plural: relativeString(buffer, offset + 0x3C) || '',
        mascot_name: relativeString(buffer, offset + 0x40) || '',
        arena_index: indexFromRelativePointer(buffer, offset + 0x44, ARENA_START, ARENA_ROW, ARENA_COUNT),
        rival1_index: indexFromRelativePointer(buffer, offset + 0x4C, TEAM_START, TEAM_ROW, TEAM_COUNT),
        rival2_index: indexFromRelativePointer(buffer, offset + 0x50, TEAM_START, TEAM_ROW, TEAM_COUNT),
        rival3_index: indexFromRelativePointer(buffer, offset + 0x54, TEAM_START, TEAM_ROW, TEAM_COUNT),
        coach_index: indexFromRelativePointer(buffer, offset + 0x60, COACH_START, COACH_ROW, COACH_COUNT),
        assistant1_index: indexFromRelativePointer(buffer, offset + 0x64, COACH_START, COACH_ROW, COACH_COUNT),
        assistant2_index: indexFromRelativePointer(buffer, offset + 0x68, COACH_START, COACH_ROW, COACH_COUNT),
        asset_id: (assetWord >>> 16) & 0xFFFF,
        team_index_check: assetWord & 0xFFFF,
        asset_id_repeat_190: (assetWord190 >>> 16) & 0xFFFF,
        mascot_asset_or_ffff: assetWord190 & 0xFFFF,
        asset_id_repeat_194: (assetWord194 >>> 16) & 0xFFFF,
        student_section: relativeString(buffer, offset + 0x198) || '',
        event_name: relativeString(buffer, offset + 0x19C) || '',
        roster_slots: rosterSlots
    };
}

function decodeRosterPayload(buffer) {
    const players = [];
    const teams = [];
    const arenas = [];
    const coaches = [];
    const rosterSlots = [];

    for (let i = 0; i < PLAYER_COUNT; i++) players.push(decodePlayer(buffer, i));
    for (let i = 0; i < ARENA_COUNT; i++) arenas.push(decodeArena(buffer, i));
    for (let i = 0; i < COACH_COUNT; i++) coaches.push(decodeCoach(buffer, i));

    for (let i = 0; i < TEAM_COUNT; i++) {
        const team = decodeTeam(buffer, i);
        teams.push({ ...team, roster_slots: undefined });

        team.roster_slots.forEach((playerIndex, slotIndex) => {
            const player = playerIndex === null || playerIndex === undefined ? null : players[playerIndex];
            rosterSlots.push({
                team_index: team.team_index,
                team_school: team.school_name,
                asset_id: team.asset_id,
                slot: slotIndex + 1,
                player_index: playerIndex === null || playerIndex === undefined ? '' : playerIndex,
                player_name: player ? player.display_name : '',
                jersey_number: player ? player.jersey_number : '',
                position: player ? player.position : '',
                height_inches: player ? player.height_inches : ''
            });
        });
    }

    return {
        payload_size: buffer.length,
        players,
        teams,
        arenas,
        coaches,
        rosterSlots
    };
}

function extractUserdataFromZip(buffer) {
    let eocdOffset = -1;
    for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 0xFFFF - 22; offset--) {
        if (buffer.readUInt32LE(offset) === ZIP_EOCD_MAGIC) {
            eocdOffset = offset;
            break;
        }
    }

    if (eocdOffset < 0) return null;

    const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    let cursor = centralDirectoryOffset;
    const end = centralDirectoryOffset + centralDirectorySize;

    while (cursor + 46 <= end && cursor + 46 <= buffer.length) {
        if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_MAGIC) break;

        const compressionMethod = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const uncompressedSize = buffer.readUInt32LE(cursor + 24);
        const fileNameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
        const fileName = buffer.toString('utf8', cursor + 46, cursor + 46 + fileNameLength);

        if (fileName.replace(/\\/g, '/').endsWith('/USERDATA') || fileName === 'USERDATA') {
            if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_MAGIC) {
                throw new Error('ZIP USERDATA local header is invalid.');
            }

            const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
            const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
            const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
            const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);

            if (compressionMethod === 0) return compressed;
            if (compressionMethod === 8) return zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).slice(0, uncompressedSize);

            throw new Error(`Unsupported ZIP compression method for USERDATA: ${compressionMethod}`);
        }

        cursor += 46 + fileNameLength + extraLength + commentLength;
    }

    return null;
}

async function extractRostFromIff(buffer) {
    const parser = new IFFReader();
    const files = [];

    parser.on('file-data', (file) => {
        files.push(file);
    });

    await pipeline(Readable.from(buffer), parser);

    const rosterFile = files.find((file) => {
        return file.type === IFFType.TYPES.ROST
            || String(file.name || '').toLowerCase() === 'roster';
    }) || files[0];

    if (!rosterFile) {
        throw new Error('No subfile found inside ROST IFF.');
    }

    return Buffer.concat(rosterFile.dataBlocks.map((block) => block.data || Buffer.alloc(0)));
}

async function loadRosterPayload(inputPath) {
    let buffer = await fs.readFile(inputPath);

    if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_MAGIC) {
        const userdata = extractUserdataFromZip(buffer);
        if (!userdata) throw new Error('ZIP input did not contain USERDATA.');
        buffer = userdata;
    }

    if (buffer.length >= 4 && u32(buffer, 0) + 4 === buffer.length) {
        return {
            sourceType: 'decrypted-save-userdata',
            payload: buffer.slice(4),
            lengthPrefix: u32(buffer, 0)
        };
    }

    if (buffer.length >= 4 && u32(buffer, 0) === STANDARD_IFF_MAGIC) {
        return {
            sourceType: 'standard-iff-roster',
            payload: await extractRostFromIff(buffer),
            lengthPrefix: null
        };
    }

    return {
        sourceType: 'raw-rost-payload',
        payload: buffer,
        lengthPrefix: null
    };
}

async function decodeRoster(inputPath, outputPath) {
    await mkdir(outputPath);
    const loaded = await loadRosterPayload(inputPath);
    const decoded = decodeRosterPayload(loaded.payload);

    await writeCsv(path.join(outputPath, 'players.csv'), decoded.players);
    await writeCsv(path.join(outputPath, 'teams.csv'), decoded.teams);
    await writeCsv(path.join(outputPath, 'roster_slots.csv'), decoded.rosterSlots);
    await writeCsv(path.join(outputPath, 'arenas.csv'), decoded.arenas);
    await writeCsv(path.join(outputPath, 'coaches.csv'), decoded.coaches);

    const summary = {
        inputPath,
        sourceType: loaded.sourceType,
        lengthPrefix: loaded.lengthPrefix,
        payloadSize: loaded.payload.length,
        players: decoded.players.length,
        teams: decoded.teams.length,
        arenas: decoded.arenas.length,
        coaches: decoded.coaches.length,
        rosterSlots: decoded.rosterSlots.length,
        note: 'String edits longer than the original string require future string-heap rebuild support.'
    };

    await fs.writeFile(path.join(outputPath, 'roster_summary.json'), JSON.stringify(summary, null, 2));
    return summary;
}

function compareRowsByIndex(aRows, bRows, fields, indexField) {
    const diffs = [];

    for (let i = 0; i < Math.min(aRows.length, bRows.length); i++) {
        const changedFields = fields.filter((field) => aRows[i][field] !== bRows[i][field]);
        if (changedFields.length <= 0) continue;

        const row = { [indexField]: aRows[i][indexField] };
        for (const field of fields) {
            row[`vanilla_${field}`] = aRows[i][field];
            row[`custom_${field}`] = bRows[i][field];
        }
        row.changed_fields = changedFields.join(';');
        diffs.push(row);
    }

    return diffs;
}

async function compareRosters(basePath, customPath, outputPath) {
    await mkdir(outputPath);

    const baseLoaded = await loadRosterPayload(basePath);
    const customLoaded = await loadRosterPayload(customPath);
    const base = decodeRosterPayload(baseLoaded.payload);
    const custom = decodeRosterPayload(customLoaded.payload);

    const playerDiffs = compareRowsByIndex(
        base.players,
        custom.players,
        ['display_name', 'first_name', 'last_name', 'jersey_number', 'height_inches', 'position'],
        'player_index'
    );

    const teamDiffs = compareRowsByIndex(
        base.teams,
        custom.teams,
        ['short_name', 'abbreviation', 'school_name', 'mascot_plural', 'mascot_name', 'asset_id', 'team_index_check'],
        'team_index'
    );

    await writeCsv(path.join(outputPath, 'player_diffs.csv'), playerDiffs);
    await writeCsv(path.join(outputPath, 'team_diffs.csv'), teamDiffs);

    const summary = {
        basePath,
        customPath,
        baseSourceType: baseLoaded.sourceType,
        customSourceType: customLoaded.sourceType,
        basePayloadSize: baseLoaded.payload.length,
        customPayloadSize: customLoaded.payload.length,
        customExtraBytesVsBase: customLoaded.payload.length - baseLoaded.payload.length,
        playersChanged: playerDiffs.length,
        teamsChanged: teamDiffs.length
    };

    await fs.writeFile(path.join(outputPath, 'roster_compare_summary.json'), JSON.stringify(summary, null, 2));
    return summary;
}

module.exports = {
    loadRosterPayload,
    decodeRosterPayload,
    decodeRoster,
    compareRosters
};