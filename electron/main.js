// LordTempsMart desktop app (Electron).
// Flow: splash screen with logo -> embedded Express server starts on a free
// port -> main window loads the app -> splash closes. Also checks GitHub
// Releases for a newer version and notifies the renderer ("Update Available").
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');

const REPO = 'BlackCircuit007/SuperMart';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check every 6 hours

let splash = null;
let mainWindow = null;
let serverPort = null;

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// ---------- helpers ----------
function getFreePort(start) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(getFreePort(start + 1)));
        srv.once('listening', () => srv.close(() => resolve(start)));
        srv.listen(start, '127.0.0.1');
    });
}

function waitHealthy(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tick = () => {
            fetch('http://127.0.0.1:' + port + '/api/health')
                .then((r) => (r.ok ? resolve() : retry()))
                .catch(retry);
        };
        const retry = () => {
            if (Date.now() > deadline) reject(new Error('Server did not become healthy in time'));
            else setTimeout(tick, 300);
        };
        tick();
    });
}

function startEmbeddedServer() {
    return getFreePort(3000).then((port) => {
        serverPort = port;
        process.env.PORT = String(port);
        // Load dotenv from the project root (packaged: inside app.asar)
        try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) { /* optional */ }
        require(path.join(__dirname, '..', 'server', 'index.js'));
        return waitHealthy(port, 45000);
    });
}

// ---------- windows ----------
function createSplash() {
    splash = new BrowserWindow({
        width: 420,
        height: 560,
        frame: false,
        resizable: false,
        movable: true,
        center: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    splash.loadFile(path.join(__dirname, 'splash.html'));
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 960,
        minHeight: 620,
        show: false,
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Open external links (e.g. update downloads) in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.loadURL('http://127.0.0.1:' + serverPort + '/');

    mainWindow.once('ready-to-show', () => {
        if (splash && !splash.isDestroyed()) splash.destroy();
        splash = null;
        mainWindow.show();
        checkForUpdates(); // first check right after the app is visible
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- update checker ----------
function parseVersion(v) {
    return String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(candidate, current) {
    const a = parseVersion(candidate);
    const b = parseVersion(current);
    for (let i = 0; i < 3; i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
}

async function checkForUpdates() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
            headers: { 'User-Agent': 'LordTempsMart-Desktop' }
        });
        if (!res.ok) return;
        const rel = await res.json();
        const tag = String(rel.tag_name || '').replace(/^v/i, '');
        if (tag && isNewer(tag, pkg.version) && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', {
                version: tag,
                url: rel.html_url || ('https://github.com/' + REPO + '/releases/latest')
            });
        }
    } catch (e) {
        // Offline or no releases yet — silently ignore.
    }
}

// ---------- ipc ----------
ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
        shell.openExternal(url);
        return true;
    }
    return false;
});

// ---------- lifecycle ----------
app.whenReady().then(async () => {
    createSplash();
    try {
        await startEmbeddedServer();
    } catch (err) {
        if (splash && !splash.isDestroyed()) {
            splash.loadFile(path.join(__dirname, 'splash.html'), { hash: 'error' });
        }
        console.error('Failed to start embedded server:', err);
        return;
    }
    createMainWindow();

    setInterval(checkForUpdates, UPDATE_INTERVAL_MS);
});

app.on('window-all-closed', () => {
    app.quit(); // even on macOS — single-window store app
});