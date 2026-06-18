#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const folders = ['release', 'dist', 'dist-native'];
const choopsProcesses = [
    'choops-native-desktop.exe',
    'choops-gui.exe',
    'choops-extractor.exe'
];

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function killKnownChoopsProcesses() {
    if (process.platform !== 'win32') return;
    for (const exe of choopsProcesses) {
        spawnSync('taskkill', ['/IM', exe, '/F', '/T'], {
            stdio: 'ignore',
            windowsHide: true
        });
    }
}

function removeWithRetries(target, label) {
    if (!fs.existsSync(target)) {
        console.log(`[CLEAN] ${label} does not exist`);
        return true;
    }

    if (isInside(process.cwd(), target)) {
        process.chdir(root);
        console.log(`[CLEAN] Changed working directory back to repo root before removing ${label}`);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
        try {
            fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
            console.log(`[CLEAN] Removed ${target}`);
            return true;
        } catch (error) {
            lastError = error;
            if (attempt === 1) {
                console.log(`[CLEAN] ${label} is locked. Closing running CHoops EXEs and retrying...`);
                killKnownChoopsProcesses();
            }
            sleep(350 * attempt);
        }
    }

    console.error(`[CLEAN] Could not remove ${target}`);
    console.error(`[CLEAN] Windows still has this folder or one of its EXEs locked: ${lastError && lastError.code ? lastError.code : 'UNKNOWN'}`);
    console.error('[CLEAN] Close the CHoops app, close any Command Prompt currently inside release/, and close Explorer preview/details panes pointing at release/.');
    console.error('[CLEAN] Then run: npm run pack');
    return false;
}

let ok = true;
for (const folder of folders) {
    ok = removeWithRetries(path.join(root, folder), folder) && ok;
}

process.exit(ok ? 0 : 1);
