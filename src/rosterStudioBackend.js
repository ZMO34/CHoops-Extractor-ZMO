const fs = require('fs/promises');
const path = require('path');

const rosterTool = require('./rosterTool');

const TEAM_COLOR_START = 0x1A0;
const TEAM_COLOR_WORDS = 31;

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

function teamPaletteFromPayload(payload, teamIndex) {
    const TEAM_START = 0x001D85E0;
    const TEAM_ROW = 704;
    const base = TEAM_START + (teamIndex * TEAM_ROW) + TEAM_COLOR_START;
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
            css: `#${value.toString(16).toUpperCase().padStart(8, '0').slice(0, 6)}`,
            alpha: value & 0xFF,
            label: `Palette Slot ${String(i).padStart(2, '0')}`,
            status: i === 1 || i === 5 || i === 14 || i === 16 || i === 28 ? 'strong candidate' : 'research'
        });
    }

    return colors;
}

function buildEditorState(loaded, decoded, assetIndex) {
    const teams = decoded.teams.map((team) => ({
        ...team,
        assets: availabilityForAsset(team.asset_id, assetIndex),
        palette: teamPaletteFromPayload(loaded.payload, team.team_index)
    }));

    return {
        source: {
            sourceType: loaded.sourceType,
            payloadSize: loaded.payload.length,
            lengthPrefix: loaded.lengthPrefix,
            note: 'Read-only Roster Studio preview. Save/write support is intentionally gated until validation and field mapping are complete.'
        },
        counts: {
            players: decoded.players.length,
            teams: decoded.teams.length,
            arenas: decoded.arenas.length,
            coaches: decoded.coaches.length,
            rosterSlots: decoded.rosterSlots.length
        },
        players: decoded.players,
        teams,
        arenas: decoded.arenas,
        coaches: decoded.coaches,
        rosterSlots: decoded.rosterSlots,
        assetIndex: assetIndex ? {
            assetRoot: assetIndex.assetRoot,
            fileCount: assetIndex.fileCount
        } : null,
        schema: {
            tabs: ['Dashboard', 'Players', 'Teams / School Data', 'Roster Slots', 'Uniforms & Assets', 'Alternates', 'Arenas / Courts', 'Colors / Court Palette', 'Conferences', 'Coaches', 'Unknown Fields / Research'],
            writeSafety: {
                green: ['jersey number', 'height', 'position', 'roster slots', 'arena/rival/coach pointers', 'asset id', 'same-length strings'],
                yellow: ['palette region', 'existing alternate assignment', 'student/event strings', 'appearance candidate bytes'],
                red: ['skin tone labels', 'conference affiliation', 'conference prestige', 'longer string heap rebuild', 'brand-new alternate archive creation']
            },
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
