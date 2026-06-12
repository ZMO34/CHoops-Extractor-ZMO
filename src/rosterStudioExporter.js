const fs = require('fs/promises');
const path = require('path');

const rosterTool = require('./rosterTool');
const schema = require('./rosterStudioSchema');

function hex(value) {
  return `0x${Number(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function parseRgbWord(value) {
  if (typeof value === 'number') return value >>> 0;
  const text = String(value || '').trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(text)) {
    throw new Error(`Expected RRGGBB or RRGGBBAA, got ${value}`);
  }
  return parseInt(text.length === 6 ? `${text}FF` : text, 16) >>> 0;
}

function applyPaletteEdit(payload, edit) {
  const teamIndex = Number(edit.teamIndex);
  const slot = Number(edit.slot);
  if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= schema.TEAM_TABLE.count) {
    throw new Error(`Invalid teamIndex ${edit.teamIndex}`);
  }
  if (!Number.isInteger(slot) || slot < 0 || slot >= schema.TEAM_FIELDS.colorsAndMaterials.count) {
    throw new Error(`Invalid palette slot ${edit.slot}`);
  }
  const offset = schema.teamRowOffset(teamIndex) + schema.TEAM_FIELDS.colorsAndMaterials.start + slot * 4;
  const oldValue = payload.readUInt32BE(offset);
  const newValue = parseRgbWord(edit.value);
  payload.writeUInt32BE(newValue, offset);
  return { type: 'palette', teamIndex, slot, offset: hex(offset), oldValue: hex(oldValue), newValue: hex(newValue) };
}

function applyEdits(payload, edits) {
  const applied = [];
  for (const edit of edits || []) {
    if ((edit.type || 'palette') === 'palette') {
      applied.push(applyPaletteEdit(payload, edit));
    } else {
      throw new Error(`Unsupported edit type ${edit.type}`);
    }
  }
  return applied;
}

async function exportRosterCopy(inputPath, outputPath, mode, edits) {
  if (!inputPath) throw new Error('inputPath is required.');
  if (!outputPath) throw new Error('outputPath is required.');

  const loaded = await rosterTool.loadRosterPayload(inputPath);
  const payload = Buffer.from(loaded.payload);
  const applied = applyEdits(payload, edits || []);
  const outMode = mode || (loaded.sourceType === 'decrypted-save-userdata' ? 'userdata' : 'raw');
  let out;

  if (outMode === 'userdata') {
    out = Buffer.alloc(payload.length + 4);
    out.writeUInt32BE(payload.length, 0);
    payload.copy(out, 4);
  } else if (outMode === 'raw') {
    out = payload;
  } else {
    throw new Error('mode must be userdata or raw.');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, out);
  return {
    inputPath,
    outputPath,
    mode: outMode,
    sourceType: loaded.sourceType,
    payloadSize: payload.length,
    outputSize: out.length,
    applied
  };
}

module.exports = { exportRosterCopy, applyEdits, applyPaletteEdit, parseRgbWord };
