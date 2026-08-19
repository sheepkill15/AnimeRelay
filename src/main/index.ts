import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnimeCandidate, AppSettings, DashboardSnapshot, DiscordStatus, PlexClientStatus } from '../shared/types.js';
import { AppDatabase } from './database.js';
import { MalClient } from './mal-client.js';
import { EventProcessor } from './event-processor.js';
import { BridgeServer } from './bridge-server.js';
import { PlexClientDetector } from './plex-client-detector.js';
import { LocalDetector } from './local-detector.js';
import { DiscordPresence } from './discord-presence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_PORT = 3210;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let db: AppDatabase;
let bridge: BridgeServer;
let processor: EventProcessor;
let plex: PlexClientDetector;
let localDetector: LocalDetector;
let statusTimer: NodeJS.Timeout | null = null;
let extensionPath = '';
let discord: DiscordPresence;
const launchHidden = process.argv.includes('--hidden');
const STARTUP_ARGS = ['--hidden'];

function prepareExtensionFolder(): string {
  const source = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'extension')
    : join(app.getAppPath(), 'extension');
  if (!app.isPackaged) return source;
  const destination = join(app.getPath('userData'), 'browser-extension');
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
  return destination;
}

function makeIcon(): Electron.NativeImage {
  const iconPath = join(app.getAppPath(), 'assets', 'icon.png');
  return nativeImage.createFromPath(iconPath);
}

function effectiveSettings(): AppSettings {
  const settings = db.getSettings();
  if (!app.isPackaged || process.platform !== 'win32') return settings;
  return { ...settings, startWithWindows: app.getLoginItemSettings({ args: STARTUP_ARGS }).openAtLogin };
}

function setStartWithWindows(enabled: boolean): void {
  if (app.isPackaged && process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: STARTUP_ARGS, enabled, name: 'Anime Relay' });
  }
  db.setSetting('startWithWindows', String(enabled));
}

function snapshot(): DashboardSnapshot {
  const defaultPlexStatus: PlexClientStatus = { clientDetected: false, lastPlaybackAt: null, error: null };
  const defaultDiscordStatus: DiscordStatus = { connected: false, error: null };
  return {
    events: db.listEvents(),
    settings: effectiveSettings(),
    extensionConnected: bridge?.isExtensionConnected() ?? false,
    pairingCode: bridge?.pairingCode ?? '------',
    bridgePort: BRIDGE_PORT,
    plexStatus: plex?.getStatus() ?? defaultPlexStatus,
    library: db.listLibrary(),
    discordStatus: discord?.getStatus() ?? defaultDiscordStatus,
  };
}

function broadcast(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('snapshot', snapshot());
  discord?.refresh();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'Anime Relay',
    backgroundColor: '#0d0d12',
    icon: makeIcon(),
    show: !launchHidden,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  tray = new Tray(makeIcon().resize({ width: 20, height: 20 }));
  tray.setToolTip('Anime Relay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Anime Relay', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

function registerIpc(mal: MalClient): void {
  ipcMain.handle('snapshot:get', () => snapshot());
  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
    if (patch.startWithWindows !== undefined) setStartWithWindows(patch.startWithWindows);
    const updated = db.updateSettings(patch);
    if (updated.plexEnabled) void plex.scan();
    broadcast();
    return effectiveSettings();
  });
  ipcMain.handle('mal:connect', async () => {
    const url = mal.createAuthorizationUrl();
    await shell.openExternal(url);
  });
  ipcMain.handle('anime:search', (_event, query: string) => processor.search(query));
  ipcMain.handle('event:confirm', async (_event, eventId: number, candidate: AnimeCandidate) => {
    await processor.confirmMatch(eventId, candidate);
  });
  ipcMain.handle('event:ignore', (_event, eventId: number) => {
    db.setEventStatus(eventId, 'ignored');
    broadcast();
  });
  ipcMain.handle('extension:open', () => {
    return shell.openPath(extensionPath);
  });
  ipcMain.handle('discord:open-portal', () => shell.openExternal('https://discord.com/developers/applications'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    db = new AppDatabase(join(app.getPath('userData'), 'anime-relay.sqlite'));
    extensionPath = prepareExtensionFolder();
    discord = new DiscordPresence(db, broadcast);
    const mal = new MalClient(db, `http://127.0.0.1:${BRIDGE_PORT}/oauth/mal/callback`);
    processor = new EventProcessor(db, mal, broadcast);
    bridge = new BridgeServer(
      BRIDGE_PORT,
      db,
      processor,
      mal,
      (error) => {
        if (!error) void processor.hydrateLibrary();
        broadcast();
        if (Notification.isSupported()) {
          new Notification({
            title: error ? 'MyAnimeList connection failed' : 'MyAnimeList connected',
            body: error ?? `Connected as ${db.getSettings().malUsername ?? 'your account'}.`,
          }).show();
        }
      },
      broadcast,
    );
    try {
      await bridge.start();
    } catch {
      // The UI still opens and explains that the local bridge is unavailable.
    }
    plex = new PlexClientDetector(db, processor, broadcast);
    localDetector = new LocalDetector(db, processor);
    plex.start();
    localDetector.start();
    void processor.hydrateLibrary();
    registerIpc(mal);
    createWindow();
    createTray();
    statusTimer = setInterval(broadcast, 15_000);
    app.on('activate', () => mainWindow?.show());
  });
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && quitting) app.quit();
});
app.on('will-quit', () => {
  plex?.stop();
  localDetector?.stop();
  discord?.stop();
  if (statusTimer) clearInterval(statusTimer);
  void bridge?.stop();
  db?.close();
});
