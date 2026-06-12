const fs = require('fs/promises');
const path = require('path');

const rosterTool = require('./rosterTool');
const studioSchema = require('./rosterStudioSchema');

const TEAM_COLOR_START = studioSchema.TEAM_FIELDS.colorsAndMaterials.start;
const TEAM_COLOR_WORDS = studioSchema.TEAM_FIELDS.colorsAndMaterials.count;

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
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            if (out.length >= limit) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full, depth + 1);
            } else {
                out.push(full);
            }
        }
    }

    await walk(root, 0);
    return out;
}

async function scanAssetRoot(assetRoot) {
    const files = await walkFiles(assetRoot);
    const names = new Set(files.map(normalizeFileName));
    const byName = {};

    for (const file of files) {
        byName[normalizeFileName(file)] = file;
    }

    return {
        assetRoot: assetRoot || '',
        fileCount: files.length,
        names: Array.from(names),
        byName
    };
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
        result[family.key] = {
            label: family.label,
            prefix: family.prefix,
            fileName,
            found: names.has(fileName),
            path: byName[fileName] || ''
        };
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

function teamResearchFields(payload, team) {
    const base = studioSchema.teamRowOffset(team.team_index);
    const rivalOffsets = [0x4C, 0x50, 0x54, 0x58, 0x5C];
    const rosterStart = studioSchema.TEAM_FIELDS.roster.rosterSlots.offsetStart;
    const rotationStart = studioSchema.TEAM_FIELDS.roster.rotationSlots.offsetStart;

    return {
        rowStart: studioSchema.hex(base),
        rivals: rivalOffsets.map((offset, idx) => ({
            slot: idx + 1,
            offset: `+0x${offset.toString(16).toUpperCase()}`,
            teamIndex: pointerIndex(payload, base + offset, studioSchema.TEAM_TABLE)
        })),
        coaches: [0x60, 0x64, 0x68].map((offset, idx) => ({
            slot: idx === 0 ? 'Head Coach' : `Assistant ${idx}`,
            offset: `+0x${offset.toString(16).toUpperCase()}`,
            coachIndex: pointerIndex(payload, base + offset, studioSchema.COACH_TABLE)
        })),
        rosterSlots: Array.from({ length: 16 }, (_, i) => ({
            slot: i + 1,
            offset: `+0x${(rosterStart + i * 4).toString(16).toUpperCase()}`,
            playerIndex: pointerIndex(payload, base + rosterStart + i * 4, studioSchema.PLAYER_TABLE)
        })),
        rotationSlots: Array.from({ length: 9 }, (_, i) => ({
            slot: i + 1,
            offset: `+0x${(rotationStart + i * 4).toString(16).toUpperCase()}`,
            playerIndex: pointerIndex(payload, base + rotationStart + i * 4, studioSchema.PLAYER_TABLE)
        })),
        assetWords: [0x18C, 0x190, 0x194].map((offset) => ({
            offset: `+0x${offset.toString(16).toUpperCase()}`,
            value: hex(payload.readUInt32BE(base + offset))
        })),
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
            color: {
                r: payload[base + table.fields.colorR.offset],
                g: payload[base + table.fields.colorG.offset],
                b: payload[base + table.fields.colorB.offset]
            },
            row_offset: studioSchema.hex(base)
        });
    }
    return rows;
}

function buildEditorState(loaded, decoded, assetIndex) {
    const teams = decoded.teams.map((team) => ({
        ...team,
        assets: availabilityForAsset(team.asset_id, assetIndex),
        palette: teamPaletteFromPayload(loaded.payload, team.team_index),
        research: teamResearchFields(loaded.payload, team)
    }));

    return {
        source: {
            sourceType: loaded.sourceType,
            payloadSize: loaded.payload.length,
            lengthPrefix: loaded.lengthPrefix,
            note: 'Roster Studio now includes built-in CH2K8 Edit School schema findings. Write/save controls should save copies only and keep uncertain fields gated.'
        },
        counts: {
            players: decoded.players.length,
            teams: decoded.teams.length,
            arenas: decoded.arenas.length,
            coaches: decoded.coaches.length,
            rosterSlots: decoded.rosterSlots.length,
            conferences: studioSchema.CONFERENCE_TABLE.count
        },
        players: decoded.players,
        teams,
        arenas: decoded.arenas,
        coaches: decoded.coaches,
        conferences: decodeConferences(loaded.payload),
        rosterSlots: decoded.rosterSlots,
        assetIndex: assetIndex ? {
            assetRoot: assetIndex.assetRoot,
            fileCount: assetIndex.fileCount
        } : null,
        schema: {
            builtIn: studioSchema,
            tabs: ['Dashboard', 'School', 'Spirit', 'Floor', 'Basket', 'Coach', 'Cheerleader', 'Roster Slots', 'Depth Chart / Rotation', 'Uniforms & Assets', 'Conferences / Legacy Swaps', 'Unknown Fields / Research'],
            writeSafety: {
                green: ['same-length/shorter team strings once save-as is enabled', 'roster slots', 'rotation slots', 'rival pointers', 'RGB palette slots saved to a copy'],
                yellow: ['mascot model candidate', 'basket/floor/cheer exact label assignment', 'student/event strings', 'coach appearance bytes'],
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
    scanAssetRoot,
    availabilityForAsset,
    ASSET_FAMILIES
};
