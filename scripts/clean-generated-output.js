#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const folders = ['release', 'dist', 'dist-native'];

for (const folder of folders) {
    const target = path.join(root, folder);
    if (!fs.existsSync(target)) {
        console.log(`[CLEAN] ${folder} does not exist`);
        continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[CLEAN] Removed ${target}`);
}
