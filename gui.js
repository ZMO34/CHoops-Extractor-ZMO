#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const IS_PACKAGED_LAUNCHER = Boolean(process.pkg);
const LAUNCHER_DIR = IS_PACKAGED_LAUNCHER ? path.dirname(process.execPath) : __dirname;
const PROJECT_ROOT = IS_PACKAGED_LAUNCHER && path.basename(LAUNCHER_DIR).toLowerCase() === 'release'
    ? path.dirname(LAUNCHER_DIR)
    : LAUNCHER_DIR;

const NATIVE_PROJECT = path.join(PROJECT_ROOT, 'native-desktop', 'ChoopsModdingSuite', 'ChoopsModdingSuite.csproj');
const DOTNET_CHECK = path.join(PROJECT_ROOT, 'scripts', 'check-dotnet-sdk.js');
const CLI_EXE = path.join(PROJECT_ROOT, 'release', 'choops-extractor.exe');
const LOG_PATH = path.join(LAUNCHER_DIR, 'choops-gui-launch.log');

function writeLog(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
        fs.appendFileSync(LOG_PATH, line, 'utf8');
    } catch (_) {
        // Logging must never prevent the GUI from launching.
    }
    console.log(message);
}

function quoteForPowerShell(value) {
    return String(value || '').replace(/'/g, "''");
}

function showVisibleError(title, message) {
    writeLog(`${title}: ${message}`);
    if (process.platform !== 'win32') return;

    const ps = [
        'Add-Type -AssemblyName PresentationFramework;',
        `[System.Windows.MessageBox]::Show('${quoteForPowerShell(message)}','${quoteForPowerShell(title)}','OK','Error') | Out-Null`
    ].join(' ');

    try {
        spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
            windowsHide: true,
            stdio: 'ignore'
        });
    } catch (_) {
        // If PowerShell is unavailable, the launch log is still written.
    }
}

function existingPath(candidates) {
    for (const candidate of candidates) {
        const full = path.resolve(candidate);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

function nativeExePath() {
    return existingPath([
        path.join(LAUNCHER_DIR, 'choops-native-desktop.exe'),
        path.join(LAUNCHER_DIR, 'CHoopsModdingSuite.exe'),
        path.join(PROJECT_ROOT, 'release', 'choops-native-desktop.exe'),
        path.join(PROJECT_ROOT, 'release', 'CHoopsModdingSuite.exe'),
        path.join(process.cwd(), 'release', 'choops-native-desktop.exe'),
        path.join(process.cwd(), 'release', 'CHoopsModdingSuite.exe')
    ]);
}

function runChecked(command, args, label) {
    writeLog(`[GUI] ${label}...`);
    const result = spawnSync(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });
    if (result.error) {
        showVisibleError('CHoops GUI launch failed', `Failed to ${label}: ${result.error.message}\n\nLog: ${LOG_PATH}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        showVisibleError('CHoops GUI launch failed', `${label} failed with exit code ${result.status}.\n\nLog: ${LOG_PATH}`);
        process.exit(result.status || 1);
    }
}

function launchDevelopment(command, args) {
    const child = spawn(command, args, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        shell: false,
        windowsHide: false
    });
    child.on('error', (error) => {
        showVisibleError('CHoops GUI launch failed', `Failed to launch native desktop app: ${error.message}\n\nLog: ${LOG_PATH}`);
        process.exit(1);
    });
    child.on('exit', (code) => process.exit(code || 0));
}

function launchPackagedNative(nativeExe) {
    writeLog(`[GUI] Launching packaged native app: ${nativeExe}`);
    writeLog(`[GUI] Launcher dir: ${LAUNCHER_DIR}`);
    writeLog(`[GUI] Launch log: ${LOG_PATH}`);

    const captured = [];
    const child = spawn(nativeExe, [], {
        cwd: path.dirname(nativeExe),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: true,
        windowsHide: false
    });

    const remember = (data) => {
        const text = data.toString();
        captured.push(text);
        writeLog(text.trimEnd());
    };

    child.stdout.on('data', remember);
    child.stderr.on('data', remember);

    let settled = false;
    child.on('error', (error) => {
        if (settled) return;
        settled = true;
        showVisibleError('CHoops GUI launch failed', `Failed to launch native desktop app:\n${error.message}\n\nLog: ${LOG_PATH}`);
        process.exit(1);
    });

    child.on('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        const output = captured.join('').trim();
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        showVisibleError(
            'CHoops GUI closed immediately',
            `The native desktop app closed immediately (${reason}).\n\nTry launching release\\choops-native-desktop.exe directly to see the full error.\n\n${output ? `Output:\n${output}\n\n` : ''}Log: ${LOG_PATH}`
        );
        process.exit(code || 1);
    });

    setTimeout(() => {
        if (settled) return;
        settled = true;
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        process.exit(0);
    }, 2000).unref();
}

function main() {
    writeLog('[GUI] Launching CHoops native desktop app. This launcher does not open Chrome, a browser, Electron, or a webview.');

    const nativeExe = nativeExePath();
    if (nativeExe) {
        launchPackagedNative(nativeExe);
        return;
    }

    if (IS_PACKAGED_LAUNCHER) {
        showVisibleError(
            'CHoops GUI launch failed',
            `Could not find the packaged native desktop app.\n\nExpected one of:\n- release\\choops-native-desktop.exe\n- release\\CHoopsModdingSuite.exe\n\nRun npm run pack, then launch release\\choops-gui.exe again.\n\nLog: ${LOG_PATH}`
        );
        process.exit(1);
    }

    if (!fs.existsSync(CLI_EXE)) {
        const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        runChecked(npmCommand, ['run', 'pack:cli'], 'building CLI backend');
    }

    runChecked(process.execPath, [DOTNET_CHECK], 'checking .NET SDK for native desktop development run');
    writeLog('[GUI] Packaged native app was not found, so running the native WinForms project through dotnet.');
    launchDevelopment('dotnet', ['run', '--project', NATIVE_PROJECT]);
}

main();
