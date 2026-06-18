#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const NATIVE_EXE = path.join(ROOT, 'dist-native', 'choops-native-desktop.exe');
const CLI_EXE = path.join(ROOT, 'dist', 'choops-extractor.exe');
const NATIVE_PROJECT = path.join(ROOT, 'native-desktop', 'ChoopsModdingSuite', 'ChoopsModdingSuite.csproj');
const DOTNET_CHECK = path.join(ROOT, 'scripts', 'check-dotnet-sdk.js');

function runChecked(command, args, label) {
    console.log(`[GUI] ${label}...`);
    const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
    if (result.error) {
        console.error(`[GUI] Failed to ${label}: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        console.error(`[GUI] ${label} failed with exit code ${result.status}.`);
        process.exit(result.status || 1);
    }
}

function launchProcess(command, args, options = {}) {
    const child = spawn(command, args, { cwd: ROOT, stdio: options.stdio || 'inherit', shell: false, detached: Boolean(options.detached) });
    child.on('error', (error) => {
        console.error(`[GUI] Failed to launch native desktop app: ${error.message}`);
        process.exit(1);
    });
    if (options.detached) {
        child.unref();
        return;
    }
    child.on('exit', (code) => process.exit(code || 0));
}

function main() {
    console.log('[GUI] Launching CHoops native desktop app. This launcher does not open Chrome, a browser, Electron, or a webview.');

    if (fs.existsSync(NATIVE_EXE)) {
        console.log(`[GUI] Found packaged native app: ${NATIVE_EXE}`);
        launchProcess(NATIVE_EXE, [], { detached: true, stdio: 'ignore' });
        return;
    }

    if (!fs.existsSync(CLI_EXE)) {
        const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        runChecked(npmCommand, ['run', 'pack:cli'], 'building CLI backend');
    }

    runChecked(process.execPath, [DOTNET_CHECK], 'checking .NET SDK for native desktop development run');
    console.log('[GUI] Packaged native app was not found, so running the native WinForms project through dotnet.');
    launchProcess('dotnet', ['run', '--project', NATIVE_PROJECT], { stdio: 'inherit' });
}

main();
