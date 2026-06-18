#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const IS_PACKAGED_LAUNCHER = Boolean(process.pkg);
const LAUNCHER_DIR = IS_PACKAGED_LAUNCHER ? path.dirname(process.execPath) : __dirname;
const PROJECT_ROOT = IS_PACKAGED_LAUNCHER && path.basename(LAUNCHER_DIR).toLowerCase() === 'dist'
    ? path.dirname(LAUNCHER_DIR)
    : LAUNCHER_DIR;

const NATIVE_PROJECT = path.join(PROJECT_ROOT, 'native-desktop', 'ChoopsModdingSuite', 'ChoopsModdingSuite.csproj');
const DOTNET_CHECK = path.join(PROJECT_ROOT, 'scripts', 'check-dotnet-sdk.js');
const CLI_EXE = path.join(PROJECT_ROOT, 'dist', 'choops-extractor.exe');

function existingPath(candidates) {
    for (const candidate of candidates) {
        const full = path.resolve(candidate);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

function nativeExePath() {
    return existingPath([
        path.join(PROJECT_ROOT, 'dist-native', 'choops-native-desktop.exe'),
        path.join(PROJECT_ROOT, 'dist-native', 'CHoopsModdingSuite.exe'),
        path.join(LAUNCHER_DIR, '..', 'dist-native', 'choops-native-desktop.exe'),
        path.join(LAUNCHER_DIR, '..', 'dist-native', 'CHoopsModdingSuite.exe'),
        path.join(LAUNCHER_DIR, 'choops-native-desktop.exe'),
        path.join(LAUNCHER_DIR, 'CHoopsModdingSuite.exe'),
        path.join(process.cwd(), 'dist-native', 'choops-native-desktop.exe'),
        path.join(process.cwd(), 'dist-native', 'CHoopsModdingSuite.exe')
    ]);
}

function runChecked(command, args, label) {
    console.log(`[GUI] ${label}...`);
    const result = spawnSync(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });
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
    const child = spawn(command, args, {
        cwd: PROJECT_ROOT,
        stdio: options.stdio || 'inherit',
        shell: false,
        detached: Boolean(options.detached),
        windowsHide: Boolean(options.detached)
    });
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
    console.log(`[GUI] Launcher dir: ${LAUNCHER_DIR}`);
    console.log(`[GUI] Project root: ${PROJECT_ROOT}`);

    const nativeExe = nativeExePath();
    if (nativeExe) {
        console.log(`[GUI] Found packaged native app: ${nativeExe}`);
        launchProcess(nativeExe, [], { detached: true, stdio: 'ignore' });
        return;
    }

    if (IS_PACKAGED_LAUNCHER) {
        console.error('[GUI] Could not find the packaged native desktop app.');
        console.error('[GUI] Run `npm run pack`, then launch either:');
        console.error('      dist-native\\choops-native-desktop.exe');
        console.error('      dist\\choops-gui.exe');
        process.exit(1);
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
