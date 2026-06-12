const fs = require('fs/promises');
const path = require('path');

const rosterTool = require('./rosterTool');
const studioSchema = require('./rosterStudioSchema');

const TEAM_COLOR_START = studioSchema.TEAM_FIELDS.colorsAndMaterials.start;
const TEAM_COLOR_WORDS = studioSchema.TEAM_FIELDS.colorsAndMaterials.count;
const STRING_APPEND_SEARCH_START = 0x003CBFDC;
const PLAYER_EMPTY_SENTINEL_INDEX = 0;
const PLAYER_EMPTY_UI_INDEX = -1;

const ASSET_FAMILIES = [
    { key: 'homeUniform', prefix: 'uh', label: 'Home uniform' },
    { key: 'awayUniform', prefix: 'ua', label: 'Away uniform' },
    { key: 'altUniform', prefix: 'ux', label: 'Alternate uniform' },
    { key: 'homePreview', prefix: 'seluh', label: 'Home menu preview' },
    { key: 'awayPreview', prefix: 'selua', label: 'Away menu preview' },
    { key: 'altPreview', prefix: 'selux', label: 'Alternate menu preview' },
    { key: 'arenaCourt', prefix: 's', label: 'Arena / court' },
    { key: 'mascotModel', prefix: 'm', label: 'Mascot / model' }
];

const PALETTE_HINTS = {
    0: 'Secondary / white candidate',
    1: 'Primary / school color candidate',
    14: 'School/floor material candidate from edited saves',
    15: 'School color candidate from primary/secondary saves',
    16: 'Duplicate/material route candidate',
    17: 'Duplicate/material route candidate',
    28: 'Late material candidate'
};

const STRING_FIELDS = {
    schoolNameShort: studioSchema.TEAM_FIELDS.school.schoolNameShort,
    abbreviation: studioSchema.TEAM_FIELDS.school.abbreviation,
    schoolNameFull: studioSchema.TEAM_FIELDS.school.schoolNameFull,
    nickname: studioSchema.TEAM_FIELDS.school.nickname,
    mascotNameText: studioSchema.TEAM_FIELDS.school.mascotNameText,
    studentSection: studioSchema.TEAM_FIELDS.spirit.studentSection,
    midnightMadness: studioSchema.TEAM_FIELDS.spirit.midnightMadness
};

function emptyPlayerOption() {
    return {
        player_index: PLAYER_EMPTY_UI_INDEX,
        row_offset: '',
        first_name: 'Empty',
        last_name: '/ None',
        display_name: 'Empty / None',
        jersey_number: '',
        height_inches: '',
        position_code: '',
        position: ''
    };
}

function pad3(value) {
    return String(Number(value) || 0).padStart(3, '0');
}

function normalizeFileName(fileName) {
    return String(fileName || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
}

async function walkFiles(root, limit = 25000) {
    const out = [];
    if (!root) return out;
    async function walk(dir, depth) {
        if (out.length >= limit || depth > 8) return;
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const entry of entries) {
            if (out.length >= limit) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full, depth + 1);
            else out.push(full);
        }
    }
    await walk(root, 0);
    return out;
}

async function scanAssetRoot(assetRoot) {
    const files = await walkFiles(assetRoot);
    const names = new Set(files.map(normalizeFileName));
    const byName = {};
    for (const file of files) byName[normalizeFileName(file)] = file;
    return { assetRoot: assetRoot || '', fileCount: files.length, names: Array.from(names), byName };
}

function assetNameFor(prefix, assetId) {
    return `${prefix}${pad3(assetId)}.iff`;
}

function availabilityForAsset(assetId, assetIndex) {
    const result = {};
    const names = assetIndex && assetIndex.names ? new Set(assetIndex.names) : new Set();
    const byName = assetIndex && assetIndex.byName ? assetIndex.byName : {};
    for (const family of ASSET_FAMILIES) {
        const fileName = assetNameFor(family.prefix, assetId);
        result[family.key] = { label: family.label, prefix: family.prefix, fileName, found: names.has(fileName), path: byName[fileName] || '' };
    }
    result.safeExistingAlternate = !!(result.altUniform.found && result.altPreview.found);
    result.hasGameplayAlternateOnly = !!(result.altUniform.found && !result.altPreview.found);
    result.hasPreviewAlternateOnly = !!(!result.altUniform.found && result.altPreview.found);
    return result;
}

function hex(value, width = 8) {
    return `0x${Number(value >>> 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function cssForRgbWord(value) {
    return `#${Number(value >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6)}`;
}

function parseRgbWord(value, oldWord = 0x000000FF) {
    if (typeof value === 'number') return value >>> 0;
    const raw = String(value || '').trim().replace(/^#/, '').replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) throw new Error(`Invalid RGB value: ${value}`);
    const alpha = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) : (oldWord & 0xFF);
    return ((parseInt(raw.slice(0, 2), 16) << 24) | (parseInt(raw.slice(2, 4), 16) << 16) | (parseInt(raw.slice(4, 6), 16) << 8) | alpha) >>> 0;
}

function teamPaletteFromPayload(payload, teamIndex) {
    const base = studioSchema.teamRowOffset(teamIndex) + TEAM_COLOR_START;
    const colors = [];
    for (let i = 0; i < TEAM_COLOR_WORDS; i++) {
        const offset = base + (i * 4);
        if (offset + 4 > payload.length) break;
        const value = payload.readUInt32BE(offset);
        colors.push({
            slot: i,
            offset: `+0x${(TEAM_COLOR_START + i * 4).toString(16).toUpperCase().padStart(3, '0')}`,
            absoluteOffset: `0x${offset.toString(16).toUpperCase().padStart(8, '0')}`,
            hex: value.toString(16).toUpperCase().padStart(8, '0'),
            css: cssForRgbWord(value),
            r: (value >>> 24) & 0xFF,
            g: (value >>> 16) & 0xFF,
            b: (value >>> 8) & 0xFF,
            alphaOrControl: value & 0xFF,
            label: `Palette Slot ${String(i).padStart(2, '0')}`,
            uiHint: PALETTE_HINTS[i] || 'Research slot',
            status: PALETTE_HINTS[i] ? 'strong candidate' : 'research'
        });
    }
    return colors;
}

function pointerIndex(buffer, fieldOffset, table) {
    if (fieldOffset < 0 || fieldOffset + 4 > buffer.length) return null;
    const value = buffer.readInt32BE(fieldOffset);
    if (value === 0 || value === -1) return null;
    const target = fieldOffset + value;
    const end = table.rawStart + table.rowSize * table.count;
    if (target < table.rawStart || target >= end) return null;
    return Math.floor((target - table.rawStart) / table.rowSize);
}

function playerSlotIndex(buffer, fieldOffset) {
    const index = pointerIndex(buffer, fieldOffset, studioSchema.PLAYER_TABLE);
    if (index === null || index === undefined) return PLAYER_EMPTY_UI_INDEX;
    if (index === PLAYER_EMPTY_SENTINEL_INDEX) return PLAYER_EMPTY_UI_INDEX;
    return index;
}

function teamResearchFields(payload, team) {
    const base = studioSchema.teamRowOffset(team.team_index);
    const rosterStart = studioSchema.TEAM_FIELDS.roster.rosterSlots.offsetStart;
    const rotationStart = studioSchema.TEAM_FIELDS.roster.rotationSlots.offsetStart;
    return {
        rowStart: studioSchema.hex(base),
        rivals: [0x4C, 0x50, 0x54, 0x58, 0x5C].map((offset, idx) => ({ slot: idx + 1, offset: `+0x${offset.toString(16).toUpperCase()}`, teamIndex: pointerIndex(payload, base + offset, studioSchema.TEAM_TABLE) })),
        coaches: [0x60, 0x64, 0x68].map((offset, idx) => ({ slot: idx === 0 ? 'Head Coach' : `Assistant ${idx}`, offset: `+0x${offset.toString(16).toUpperCase()}`, coachIndex: pointerIndex(payload, base + offset, studioSchema.COACH_TABLE) })),
        rosterSlots: Array.from({ length: 16 }, (_, i) => ({ slot: i + 1, offset: `+0x${(rosterStart + i * 4).toString(16).toUpperCase()}`, playerIndex: playerSlotIndex(payload, base + rosterStart + i * 4) })),
        rotationSlots: Array.from({ length: 9 }, (_, i) => ({ slot: i + 1, offset: `+0x${(rotationStart + i * 4).toString(16).toUpperCase()}`, playerIndex: playerSlotIndex(payload, base + rotationStart + i * 4) })),
        assetWords: [0x18C, 0x190, 0x194].map((offset) => ({ offset: `+0x${offset.toString(16).toUpperCase()}`, value: hex(payload.readUInt32BE(base + offset)) })),
        unknown188: hex(payload.readUInt32BE(base + 0x188))
    };
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
    const target = fieldOffset + buffer.readUInt32BE(fieldOffset);
    return readUtf16LeNull(buffer, target);
}

function decodeConferences(payload) {
    const table = studioSchema.CONFERENCE_TABLE;
    const rows = [];
    for (let i = 0; i < table.count; i++) {
        const base = table.rawStart + i * table.rowSize;
        if (base + 0x24 > payload.length) break;
        rows.push({
            conference_index: i,
            name: relativeString(payload, base + table.fields.name.offset),
            abbreviation: relativeString(payload, base + table.fields.abbreviation.offset),
            type: payload.readUInt16BE(base + table.fields.type.offset),
            sort_order: payload.readUInt16BE(base + table.fields.sortOrder.offset),
            founded: payload.readUInt16BE(base + table.fields.founded.offset),
            champs_order: payload.readUInt16BE(base + table.fields.champsOrder.offset),
            final_fours: payload.readUInt16BE(base + table.fields.finalFours.offset),
            previous_year_bids: payload.readUInt16BE(base + table.fields.previousYearBids.offset),
            rank: payload.readUInt16BE(base + table.fields.rank.offset),
            last_champ_order: payload.readUInt16BE(base + table.fields.lastChampOrder.offset),
            presentation_id: payload.readUInt16BE(base + table.fields.presentationId.offset),
            tournament_slots: payload.readUInt16BE(base + table.fields.tournamentSlots.offset),
            tournament_day: payload.readUInt16BE(base + table.fields.tournamentDay.offset),
            color: { r: payload[base + table.fields.colorR.offset], g: payload[base + table.fields.colorG.offset], b: payload[base + table.fields.colorB.offset] },
            row_offset: studioSchema.hex(base)
        });
    }
    return rows;
}

function fieldTarget(buffer, fieldOffset) {
    return fieldOffset + buffer.readUInt32BE(fieldOffset);
}

function encodedUtf16(value) {
    const str = String(value || '');
    const out = Buffer.alloc((str.length + 1) * 2);
    for (let i = 0; i < str.length; i++) out.writeUInt16LE(str.charCodeAt(i), i * 2);
    out.writeUInt16LE(0, str.length * 2);
    return out;
}

function existingStringByteLength(buffer, target) {
    let cursor = target;
    while (cursor + 1 < buffer.length) {
        if (buffer.readUInt16LE(cursor) === 0) return cursor + 2 - target;
        cursor += 2;
    }
    throw new Error('Existing UTF-16 string is unterminated.');
}

function findZeroRun(buffer, start, needed) {
    for (let i = Math.max(0, start); i + needed <= buffer.length; i++) {
        let ok = true;
        for (let j = 0; j < needed; j++) {
            if (buffer[i + j] !== 0) { ok = false; i += j; break; }
        }
        if (ok) return i;
    }
    return -1;
}

function writeRelativePointer(buffer, fieldOffset, targetOffset) {
    const delta = targetOffset - fieldOffset;
    buffer.writeUInt32BE(delta >>> 0, fieldOffset);
}

function writeTeamString(buffer, teamIndex, key, value, changes) {
    const info = STRING_FIELDS[key];
    if (!info || info.offset === null) throw new Error(`Unsupported team string field: ${key}`);
    const str = String(value || '');
    if (info.maxChars && str.length > info.maxChars) throw new Error(`${info.label} max is ${info.maxChars} characters.`);
    const base = studioSchema.teamRowOffset(teamIndex);
    const fieldOffset = base + info.offset;
    const oldTarget = fieldTarget(buffer, fieldOffset);
    const oldValue = readUtf16LeNull(buffer, oldTarget) || '';
    const oldBytes = existingStringByteLength(buffer, oldTarget);
    const encoded = encodedUtf16(str);
    let target = oldTarget;
    let mode = 'overwrite-in-place';
    if (encoded.length > oldBytes) {
        target = findZeroRun(buffer, STRING_APPEND_SEARCH_START, encoded.length + 2);
        if (target < 0) throw new Error(`No free string space found for ${info.label}.`);
        writeRelativePointer(buffer, fieldOffset, target);
        mode = 'append-string-pool';
    }
    encoded.copy(buffer, target);
    if (encoded.length < oldBytes) buffer.fill(0, target + encoded.length, target + oldBytes);
    changes.push({ kind: 'teamString', key, label: info.label, teamIndex, fieldOffset: hex(fieldOffset), oldValue, newValue: str, mode });
}

function writePaletteColor(buffer, teamIndex, slot, value, changes) {
    const numericSlot = Number(slot);
    if (!Number.isInteger(numericSlot) || numericSlot < 0 || numericSlot >= TEAM_COLOR_WORDS) throw new Error(`Palette slot must be 0-${TEAM_COLOR_WORDS - 1}.`);
    const offset = studioSchema.teamRowOffset(teamIndex) + TEAM_COLOR_START + numericSlot * 4;
    const oldWord = buffer.readUInt32BE(offset);
    const newWord = parseRgbWord(value, oldWord);
    buffer.writeUInt32BE(newWord >>> 0, offset);
    changes.push({ kind: 'paletteColor', teamIndex, slot: numericSlot, offset: hex(offset), oldValue: hex(oldWord), newValue: hex(newWord), confidence: PALETTE_HINTS[numericSlot] ? 'strong candidate' : 'research' });
}

function writeTablePointer(buffer, fieldOffset, table, index, plus, changes, kind) {
    const oldIndex = pointerIndex(buffer, fieldOffset, table);
    const numericIndex = Number(index);
    if (index === null || index === undefined || index === '' || numericIndex === PLAYER_EMPTY_UI_INDEX) {
        buffer.writeUInt32BE(0, fieldOffset);
        changes.push({ kind, fieldOffset: hex(fieldOffset), oldIndex, newIndex: null, empty: true });
        return;
    }
    if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= table.count) throw new Error(`${kind} index out of range.`);
    const target = table.rawStart + numericIndex * table.rowSize + (plus || 0);
    writeRelativePointer(buffer, fieldOffset, target);
    changes.push({ kind, fieldOffset: hex(fieldOffset), oldIndex, newIndex: numericIndex });
}

function applyEdit(buffer, edit, changes) {
    const teamIndex = Number(edit.teamIndex);
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= studioSchema.TEAM_TABLE.count) throw new Error('teamIndex is required and must be valid.');
    const base = studioSchema.teamRowOffset(teamIndex);
    if (edit.kind === 'teamString') return writeTeamString(buffer, teamIndex, edit.key, edit.value, changes);
    if (edit.kind === 'paletteColor') return writePaletteColor(buffer, teamIndex, edit.slot, edit.value, changes);
    if (edit.kind === 'rival') {
        const slot = Number(edit.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('Rival slot must be 1-5.');
        return writeTablePointer(buffer, base + 0x4C + (slot - 1) * 4, studioSchema.TEAM_TABLE, edit.targetTeamIndex, 0, changes, `rival${slot}`);
    }
    if (edit.kind === 'rosterSlot') {
        const slot = Number(edit.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 16) throw new Error('Roster slot must be 1-16.');
        return writeTablePointer(buffer, base + studioSchema.TEAM_FIELDS.roster.rosterSlots.offsetStart + (slot - 1) * 4, studioSchema.PLAYER_TABLE, edit.playerIndex, 0x11, changes, 'rosterSlot');
    }
    if (edit.kind === 'rotationSlot') {
        const slot = Number(edit.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 9) throw new Error('Rotation slot must be 1-9.');
        return writeTablePointer(buffer, base + studioSchema.TEAM_FIELDS.roster.rotationSlots.offsetStart + (slot - 1) * 4, studioSchema.PLAYER_TABLE, edit.playerIndex, 0x11, changes, 'rotationSlot');
    }
    if (edit.kind === 'rawTeamU32') {
        const rel = Number(edit.offset);
        if (!edit.experimental) throw new Error('rawTeamU32 edits require experimental=true.');
        if (!Number.isInteger(rel) || rel < 0 || rel + 4 > studioSchema.TEAM_TABLE.rowSize) throw new Error('rawTeamU32 offset is outside the team row.');
        const fieldOffset = base + rel;
        const oldWord = buffer.readUInt32BE(fieldOffset);
        const raw = String(edit.value || '').replace(/^0x/i, '');
        if (!/^[0-9a-fA-F]{1,8}$/.test(raw)) throw new Error('rawTeamU32 value must be hex.');
        const newWord = parseInt(raw, 16) >>> 0;
        buffer.writeUInt32BE(newWord, fieldOffset);
        changes.push({ kind: 'rawTeamU32', teamIndex, offset: `+0x${rel.toString(16).toUpperCase()}`, absoluteOffset: hex(fieldOffset), oldValue: hex(oldWord), newValue: hex(newWord), experimental: true });
        return;
    }
    throw new Error(`Unsupported edit kind: ${edit.kind}`);
}

function normalizeEdit(edit) {
    if (edit && !edit.kind && edit.type) {
        const out = { ...edit };
        if (out.type === 'paletteSlot') out.kind = 'paletteColor';
        else out.kind = out.type;
        if (out.field && !out.key) out.key = out.field;
        return out;
    }
    return edit;
}

function buildOutputBuffer(loaded, editedPayload) {
    if (loaded.sourceType === 'decrypted-save-userdata') {
        const out = Buffer.alloc(editedPayload.length + 4);
        out.writeUInt32BE(editedPayload.length, 0);
        editedPayload.copy(out, 4);
        return out;
    }
    return editedPayload;
}

async function saveRosterCopy(rosterPath, outputPath, edits) {
    if (!rosterPath) throw new Error('rosterPath is required.');
    if (!outputPath) throw new Error('outputPath is required. Always save to a new copy, never overwrite the original.');
    const loaded = await rosterTool.loadRosterPayload(rosterPath);
    const payload = Buffer.from(loaded.payload);
    const changes = [];
    for (const edit of edits || []) applyEdit(payload, normalizeEdit(edit), changes);
    const out = buildOutputBuffer(loaded, payload);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, out);
    return { outputPath, sourceType: loaded.sourceType, payloadSize: payload.length, outputSize: out.length, changes, applied: changes, warning: 'Saved copy only. Test in-game before using as a base.' };
}

function buildEditorState(loaded, decoded, assetIndex) {
    const teams = decoded.teams.map((team) => ({ ...team, rosterIndex: team.team_index, rowIndex: team.team_index, assets: availabilityForAsset(team.asset_id, assetIndex), palette: teamPaletteFromPayload(loaded.payload, team.team_index), research: teamResearchFields(loaded.payload, team) }));
    return {
        source: { sourceType: loaded.sourceType, payloadSize: loaded.payload.length, lengthPrefix: loaded.lengthPrefix, note: 'Roster Studio includes built-in CH2K8 Edit School schema findings and save-copy research edits.' },
        counts: { players: decoded.players.length, teams: decoded.teams.length, arenas: decoded.arenas.length, coaches: decoded.coaches.length, rosterSlots: decoded.rosterSlots.length, conferences: studioSchema.CONFERENCE_TABLE.count },
        players: [emptyPlayerOption()].concat(decoded.players),
        teams,
        arenas: decoded.arenas,
        coaches: decoded.coaches,
        conferences: decodeConferences(loaded.payload),
        rosterSlots: decoded.rosterSlots,
        assetIndex: assetIndex ? { assetRoot: assetIndex.assetRoot, fileCount: assetIndex.fileCount } : null,
        schema: {
            builtIn: studioSchema,
            tabs: ['Dashboard', 'School', 'Spirit', 'Floor', 'Basket', 'Coach', 'Cheerleader', 'Roster Slots', 'Depth Chart / Rotation', 'Uniforms & Assets', 'Conferences / Legacy Swaps', 'Unknown Fields / Research'],
            writableEditKinds: ['teamString', 'paletteColor', 'rival', 'rosterSlot', 'rotationSlot', 'rawTeamU32'],
            writeSafety: {
                green: ['team strings up to max length using in-place or appended UTF-16 strings', 'roster slots', 'rotation slots', 'rival pointers', 'RGB palette slots saved to a copy'],
                yellow: ['mascot model candidate through rawTeamU32', 'basket/floor/cheer exact label assignment', 'student/event strings', 'coach appearance bytes'],
                red: ['city/state storage', 'fight song storage', 'conference affiliation', 'conference prestige', 'brand-new alternate archive creation', 'in-place overwrite of original save']
            },
            editSchoolTabs: studioSchema.EDIT_SCHOOL_TABS,
            assetFamilies: ASSET_FAMILIES
        }
    };
}

async function openRosterStudio(rosterPath, assetRoot) {
    if (!rosterPath) throw new Error('rosterPath is required.');
    const loaded = await rosterTool.loadRosterPayload(rosterPath);
    const decoded = rosterTool.decodeRosterPayload(loaded.payload);
    const assetIndex = assetRoot ? await scanAssetRoot(assetRoot) : null;
    return buildEditorState(loaded, decoded, assetIndex);
}

module.exports = {
    openRosterStudio,
    saveRosterCopy,
    scanAssetRoot,
    availabilityForAsset,
    ASSET_FAMILIES,
    STRING_FIELDS
};