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

function checkTeamIndex(teamIndex) {
  const n = Number(teamIndex);
  if (!Number.isInteger(n) || n < 0 || n >= schema.TEAM_TABLE.count) throw new Error(`Invalid teamIndex ${teamIndex}`);
  return n;
}

function teamFieldAbs(teamIndex, fieldOffset) {
  return schema.teamRowOffset(checkTeamIndex(teamIndex)) + Number(fieldOffset);
}

function readStringAt(buffer, offset) {
  const chars = [];
  let cursor = offset;
  while (cursor + 1 < buffer.length) {
    const code = buffer[cursor] | (buffer[cursor + 1] << 8);
    if (code === 0) return chars.join('');
    chars.push(String.fromCharCode(code));
    cursor += 2;
  }
  return chars.join('');
}

function stringSpan(buffer, offset) {
  let cursor = offset;
  while (cursor + 1 < buffer.length) {
    const code = buffer[cursor] | (buffer[cursor + 1] << 8);
    cursor += 2;
    if (code === 0) return cursor - offset;
  }
  throw new Error('String terminator not found.');
}

function applyPaletteEdit(payload, edit) {
  const teamIndex = checkTeamIndex(edit.teamIndex);
  const slot = Number(edit.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= schema.TEAM_FIELDS.colorsAndMaterials.count) {
    throw new Error(`Invalid palette slot ${edit.slot}`);
  }
  const offset = schema.teamRowOffset(teamIndex) + schema.TEAM_FIELDS.colorsAndMaterials.start + slot * 4;
  const oldValue = payload.readUInt32BE(offset);
  const newValue = parseRgbWord(edit.value);
  payload.writeUInt32BE(newValue, offset);
  return { type: 'palette', teamIndex, slot, offset: hex(offset), oldValue: hex(oldValue), newValue: hex(newValue) };
}

function applyStringEdit(payload, edit) {
  const teamIndex = checkTeamIndex(edit.teamIndex);
  const fieldName = String(edit.field || '');
  const field = schema.TEAM_FIELDS.school[fieldName] || schema.TEAM_FIELDS.spirit[fieldName];
  if (!field || typeof field.offset !== 'number' || field.type !== 'relativeUtf16LeString') {
    throw new Error(`Unsupported string field ${fieldName}`);
  }
  const value = String(edit.value || '');
  if (field.maxChars && value.length > field.maxChars) throw new Error(`${fieldName} max is ${field.maxChars} characters.`);
  const fieldAbs = teamFieldAbs(teamIndex, field.offset);
  const target = fieldAbs + payload.readInt32BE(fieldAbs);
  const oldValue = readStringAt(payload, target);
  const span = stringSpan(payload, target);
  const encoded = Buffer.from(`${value}\u0000`, 'utf16le');
  if (encoded.length > span) throw new Error(`New ${fieldName} is longer than existing storage. Use same-length/shorter text until string-pool append is enabled.`);
  encoded.copy(payload, target);
  payload.fill(0, target + encoded.length, target + span);
  return { type: 'string', teamIndex, field: fieldName, fieldOffset: hex(field.offset), target: hex(target), oldValue, newValue: value };
}

function pointerIndex(payload, fieldAbs, table) {
  const rel = payload.readInt32BE(fieldAbs);
  if (rel === 0 || rel === -1) return null;
  const target = fieldAbs + rel;
  const end = table.rawStart + table.rowSize * table.count;
  if (target < table.rawStart || target >= end) return null;
  return Math.floor((target - table.rawStart) / table.rowSize);
}

function writePointerIndex(payload, teamIndex, fieldOffset, targetIndex, table, typeName) {
  const idx = Number(targetIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= table.count) throw new Error(`Invalid ${typeName} index ${targetIndex}`);
  const fieldAbs = teamFieldAbs(teamIndex, fieldOffset);
  const oldIndex = pointerIndex(payload, fieldAbs, table);
  const target = table.rawStart + idx * table.rowSize;
  payload.writeInt32BE(target - fieldAbs, fieldAbs);
  return { fieldOffset: hex(fieldOffset), offset: hex(fieldAbs), oldIndex, newIndex: idx };
}

function applyRivalEdit(payload, edit) {
  const teamIndex = checkTeamIndex(edit.teamIndex);
  const rivalNumber = Number(edit.rivalNumber);
  if (!Number.isInteger(rivalNumber) || rivalNumber < 1 || rivalNumber > 5) throw new Error('rivalNumber must be 1..5.');
  const field = schema.TEAM_FIELDS.spirit[`rival${rivalNumber}`];
  return { type: 'rival', teamIndex, rivalNumber, ...writePointerIndex(payload, teamIndex, field.offset, edit.targetTeamIndex, schema.TEAM_TABLE, 'team') };
}

function applyRosterSlotEdit(payload, edit, rotation) {
  const teamIndex = checkTeamIndex(edit.teamIndex);
  const max = rotation ? 9 : 16;
  const slot = Number(edit.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= max) throw new Error(`slot must be 0..${max - 1}.`);
  const info = rotation ? schema.TEAM_FIELDS.roster.rotationSlots : schema.TEAM_FIELDS.roster.rosterSlots;
  const fieldOffset = info.offsetStart + slot * info.stride;
  return { type: rotation ? 'rotationSlot' : 'rosterSlot', teamIndex, slot, ...writePointerIndex(payload, teamIndex, fieldOffset, edit.playerIndex, schema.PLAYER_TABLE, 'player') };
}

function applyEdits(payload, edits) {
  const applied = [];
  for (const edit of edits || []) {
    const type = edit.type || 'palette';
    if (type === 'palette') applied.push(applyPaletteEdit(payload, edit));
    else if (type === 'string') applied.push(applyStringEdit(payload, edit));
    else if (type === 'rival') applied.push(applyRivalEdit(payload, edit));
    else if (type === 'rosterSlot') applied.push(applyRosterSlotEdit(payload, edit, false));
    else if (type === 'rotationSlot') applied.push(applyRosterSlotEdit(payload, edit, true));
    else throw new Error(`Unsupported edit type ${type}`);
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
  return { inputPath, outputPath, mode: outMode, sourceType: loaded.sourceType, payloadSize: payload.length, outputSize: out.length, applied };
}

module.exports = { exportRosterCopy, applyEdits, applyPaletteEdit, applyStringEdit, applyRivalEdit, parseRgbWord };
