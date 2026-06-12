const fs = require('fs/promises');
const path = require('path');

const rosterTool = require('./rosterTool');

async function exportRosterCopy(inputPath, outputPath, mode) {
  if (!inputPath) throw new Error('inputPath is required.');
  if (!outputPath) throw new Error('outputPath is required.');

  const loaded = await rosterTool.loadRosterPayload(inputPath);
  const payload = Buffer.from(loaded.payload);
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
    outputSize: out.length
  };
}

module.exports = { exportRosterCopy };
