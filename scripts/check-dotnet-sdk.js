#!/usr/bin/env node

const { spawnSync } = require('child_process');

const minimumMajor = 8;

function printInstallHelp() {
    console.error('');
    console.error('[PACK] Native desktop packaging requires the .NET SDK, not just the .NET Runtime.');
    console.error(`[PACK] Install .NET SDK ${minimumMajor}.0 or newer, then open a new terminal and run npm run pack again.`);
    console.error('');
    console.error('[PACK] Fast install option on Windows:');
    console.error(`       winget install Microsoft.DotNet.SDK.${minimumMajor}`);
    console.error('');
    console.error('[PACK] Manual installer:');
    console.error('       https://dotnet.microsoft.com/download/dotnet');
    console.error('');
    console.error('[PACK] To verify after installing:');
    console.error('       dotnet --list-sdks');
    console.error('');
    console.error('[PACK] The CLI build already succeeded if dist\\choops-extractor.exe exists.');
}

const result = spawnSync('dotnet', ['--list-sdks'], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
});

if (result.error || result.status !== 0) {
    console.error('[PACK] dotnet SDK check failed: dotnet command is not available or no SDKs are installed.');
    printInstallHelp();
    process.exit(1);
}

const sdkLines = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const parsedSdks = sdkLines
    .map((line) => {
        const match = line.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!match) return null;
        return {
            major: Number(match[1]),
            minor: Number(match[2]),
            patch: Number(match[3]),
            raw: line
        };
    })
    .filter(Boolean);

const usableSdk = parsedSdks.find((sdk) => sdk.major >= minimumMajor);

if (!usableSdk) {
    console.error(`[PACK] Found dotnet, but no .NET SDK ${minimumMajor}.0 or newer was found.`);
    if (sdkLines.length) {
        console.error('[PACK] Installed SDKs:');
        for (const line of sdkLines) {
            console.error(`       ${line}`);
        }
    }
    printInstallHelp();
    process.exit(1);
}

console.log(`[PACK] .NET SDK check passed: ${usableSdk.raw}`);
