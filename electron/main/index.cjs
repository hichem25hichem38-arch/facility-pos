const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { startSyncServer, getSyncServerInfo, stopSyncServer } = require('./sync-server.cjs');

/** Activation service host; the renderer may only send requests here. */
const ACTIVATION_ORIGIN = 'https://pos-license-center-p9p7wkgirfb.qoder.website';

/** Long-lived pairing token for the LAN sync server; shared with phones via the QR code. */
function getOrCreateSyncToken() {
  try {
    const tokenPath = path.join(app.getPath('userData'), 'sync.token');
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf8').trim();
      if (existing.length >= 16) return existing;
    }
    const token = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
    return token;
  } catch {
    return crypto.randomBytes(16).toString('hex');
  }
}

/**
 * Device code bound into every licence. It is derived from the Windows
 * installation id so a reinstall on the same PC maps to the same licence, while
 * another PC always produces a different one.
 */
function windowsMachineGuid() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    );
    const match = out.match(/MachineGuid\s+REG_\w+\s+([0-9a-fA-F-]{36})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getOrCreateMachineId() {
  const hardware = windowsMachineGuid();
  if (hardware) {
    return 'PC-' + crypto.createHash('sha256').update(hardware.toLowerCase()).digest('hex').slice(0, 12).toUpperCase();
  }
  try {
    const idPath = path.join(app.getPath('userData'), 'machine.id');
    if (fs.existsSync(idPath)) {
      const existing = fs.readFileSync(idPath, 'utf8').trim().toUpperCase();
      if (existing) return existing;
    }
    const raw = `${os.hostname()}|${os.platform()}|${os.arch()}|${app.getPath('userData')}|${Date.now()}|${crypto.randomUUID()}`;
    const id = 'DESKTOP-' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8).toUpperCase();
    fs.mkdirSync(path.dirname(idPath), { recursive: true });
    fs.writeFileSync(idPath, id, 'utf8');
    return id;
  } catch {
    return 'DESKTOP-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  }
}

/**
 * Posts to the activation service from the main process. The packaged app runs
 * from file://, so the gateway's same-origin rule cannot be met by the
 * renderer; this handler attaches the fixed site Origin and refuses any other
 * destination.
 */
async function postToActivation({ url, body, origin, timeoutMs, vendorToken }) {
  const target = new URL(String(url ?? ''));
  if (target.origin !== ACTIVATION_ORIGIN || target.pathname !== '/functions/v1/app') {
    throw new Error('UNTRUSTED_TARGET');
  }
  if (String(origin ?? '') !== ACTIVATION_ORIGIN) throw new Error('UNTRUSTED_ORIGIN');
  if (typeof body !== 'string' || body.length > 16_384) throw new Error('INVALID_BODY');
  const token = typeof vendorToken === 'string' && vendorToken.length <= 200 ? vendorToken : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Number(timeoutMs) || 20000, 30000));
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: ACTIVATION_ORIGIN,
        ...(token ? { 'x-vendor-token': token } : {}),
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, body: text.slice(0, 20_000) };
  } finally {
    clearTimeout(timer);
  }
}

let mainWindow = null;
let syncPort = Number(process.env.SYNC_PORT || 8080);
let syncToken = '';

function createWindow() {
  /* never open taller/wider than the screen — a frameless window that exceeds
     the work area loses its top edge (title bar + page headers) off-screen */
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1366, Math.max(1024, workArea.width - 32));
  const height = Math.min(800, Math.max(640, workArea.height - 32));

  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.max(0, Math.round((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.round((workArea.height - height) / 2)),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0E1729',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const pushMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', pushMaximized);
  mainWindow.on('unmaximize', pushMaximized);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
      : path.join(__dirname, '../../dist/index.html');
    const finalPath = fs.existsSync(indexPath) ? indexPath : path.join(__dirname, '../../dist/index.html');
    mainWindow.loadFile(finalPath);
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('did-fail-load', code, desc);
    });
  }
}

ipcMain.handle('win:minimize', () => mainWindow?.minimize());
ipcMain.handle('win:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('win:close', () => mainWindow?.close());
ipcMain.handle('win:isMaximized', () => !!mainWindow && mainWindow.isMaximized());

ipcMain.handle('app:print', async () => {
  if (mainWindow) mainWindow.webContents.print({ silent: false, printBackground: true });
});

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getMachineId', () => getOrCreateMachineId());
ipcMain.handle('license:request', (_e, args) => postToActivation(args || {}));
ipcMain.handle('sync:getInfo', () => getSyncServerInfo());
ipcMain.handle('sync:getWsUrl', () => {
  const info = getSyncServerInfo();
  return { localWsUrl: info.localWsUrl, lanWsUrls: info.wsUrls, primaryWsUrl: info.primaryWsUrl, ...info };
});
ipcMain.handle('sync:restart', (_e, port) => {
  stopSyncServer();
  syncPort = Number(port) || syncPort;
  startSyncServer(syncPort, syncToken);
  return getSyncServerInfo();
});

app.whenReady().then(() => {
  syncToken = getOrCreateSyncToken();
  try { startSyncServer(syncPort, syncToken); } catch (e) { console.error('[electron] failed to start sync server', e); }
  createWindow();
});
app.on('window-all-closed', () => {
  stopSyncServer();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => stopSyncServer());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
