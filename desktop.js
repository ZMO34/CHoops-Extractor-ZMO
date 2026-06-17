const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, dialog } = require('electron');

const { startGui } = require('./src/guiServer');

let mainWindow = null;
let guiRuntime = null;

function packagedCliPath() {
    if (!app.isPackaged) {
        return null;
    }

    const exeName = process.platform === 'win32' ? 'choops-extractor.exe' : 'choops-extractor';
    const candidates = [
        path.join(process.resourcesPath, exeName),
        path.join(path.dirname(process.execPath), exeName)
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function configureCliEnvironment() {
    const cliPath = packagedCliPath();
    if (cliPath) {
        process.env.CHOOPS_EXTRACTOR_CLI = cliPath;
    }
}

function isAllowedLocalUrl(targetUrl, appUrl) {
    try {
        const target = new URL(targetUrl);
        const base = new URL(appUrl);
        return target.protocol === base.protocol
            && target.hostname === base.hostname
            && target.port === base.port;
    }
    catch (err) {
        return false;
    }
}

async function createWindow() {
    configureCliEnvironment();

    guiRuntime = await startGui({
        open: false,
        port: 0,
        desktop: true
    });

    mainWindow = new BrowserWindow({
        width: 1380,
        height: 920,
        minWidth: 1100,
        minHeight: 720,
        title: 'CHoops Modding Suite',
        backgroundColor: '#0d1117',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    mainWindow.removeMenu();

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedLocalUrl(url, guiRuntime.url)) {
            mainWindow.loadURL(url);
        }
        else {
            shell.openExternal(url).catch(() => {});
        }
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedLocalUrl(url, guiRuntime.url)) {
            event.preventDefault();
            shell.openExternal(url).catch(() => {});
        }
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        dialog.showErrorBox(
            'CHoops Modding Suite failed to load',
            `The local desktop UI failed to load.\n\n${errorCode}: ${errorDescription}`
        );
    });

    await mainWindow.loadURL(guiRuntime.url);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow).catch((err) => {
    dialog.showErrorBox('CHoops Modding Suite startup failed', err.stack || err.message || String(err));
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => {
            dialog.showErrorBox('CHoops Modding Suite startup failed', err.stack || err.message || String(err));
        });
    }
});

app.on('before-quit', () => {
    if (guiRuntime && guiRuntime.server) {
        guiRuntime.server.close();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
