const windowStateKeeper = require('electron-window-state');
const { BrowserWindow, app } = require('electron');
const path = require('path');

class WindowManager {
  constructor(partition) {
    this.mainWindow = null;
    this.windowState = null;
    this.partition = partition;
  }

  createMainWindow() {
    // Load saved window state
    this.windowState = windowStateKeeper({
      defaultWidth: 1400,
      defaultHeight: 900,
      file: 'window-state.json'
    });

    this.mainWindow = new BrowserWindow({
      x: this.windowState.x,
      y: this.windowState.y,
      width: this.windowState.width,
      height: this.windowState.height,
      minWidth: 800,
      minHeight: 600,

      // Standard Mac title bar with visible traffic lights
      titleBarStyle: 'default',

      backgroundColor: '#ffffff',
      show: false,

      webPreferences: {
        partition: this.partition,
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true
      }
    });

    // Register window state tracking
    this.windowState.manage(this.mainWindow);

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();

      if (this.windowState.isMaximized) {
        this.mainWindow.maximize();
      }
    });

    // Handle close to dock behavior
    this.setupCloseHandler();

    return this.mainWindow;
  }

  setupCloseHandler() {
    let forceQuit = false;

    app.on('before-quit', () => {
      forceQuit = true;
    });

    this.mainWindow.on('close', (event) => {
      // On Mac, hide to dock instead of quitting
      if (process.platform === 'darwin' && !forceQuit) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });

    app.on('activate', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
      }
    });
  }

  focusOrCreate() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }
}

module.exports = WindowManager;
