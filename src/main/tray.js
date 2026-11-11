const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { baseUrl, portalPrefix } = require('./base-url');

class TrayManager {
  constructor(mainWindow, windowManager) {
    this.mainWindow = mainWindow;
    this.windowManager = windowManager;
    this.tray = null;
    this.createTray();
  }

  createTray() {
    // Create a smaller icon for the menu bar (22x22 is standard for macOS menu bar)
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    let trayIcon = nativeImage.createFromPath(iconPath);

    // Resize for menu bar (macOS uses 16x16 or 22x22 for retina)
    trayIcon = trayIcon.resize({ width: 18, height: 18 });

    // Set as template image for proper dark/light mode handling on macOS
    trayIcon.setTemplateImage(true);

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('HubSpot Desktop');

    // Click on tray icon shows/hides the app
    this.tray.on('click', () => {
      this.toggleWindow();
    });

    // Right-click shows the menu
    this.updateMenu();
  }

  toggleWindow() {
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.windowManager.focusOrCreate();
    }
  }

  updateMenu() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show HubSpot',
        click: () => this.windowManager.focusOrCreate()
      },
      { type: 'separator' },
      {
        label: 'Quick Actions',
        submenu: [
          {
            label: 'New Contact',
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => this.openQuickAction('/contacts')
          },
          {
            label: 'New Company',
            click: () => this.openQuickAction('/companies')
          },
          {
            label: 'New Deal',
            click: () => this.openQuickAction('/deals/board')
          },
          {
            label: 'New Task',
            click: () => this.openQuickAction('/tasks')
          },
          {
            label: 'New Ticket',
            click: () => this.openQuickAction('/tickets')
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'Go To',
        submenu: [
          {
            label: 'Dashboard',
            click: () => this.openQuickAction('/reports-dashboard')
          },
          {
            label: 'Inbox',
            click: () => this.openQuickAction('/conversations/inbox')
          },
          {
            label: 'Tasks',
            click: () => this.openQuickAction('/tasks')
          },
          {
            label: 'Calendar',
            click: () => this.openQuickAction('/meetings')
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'Quit HubSpot Desktop',
        accelerator: 'CmdOrCtrl+Q',
        click: () => app.quit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  openQuickAction(path) {
    // Show the window first
    this.windowManager.focusOrCreate();

    // Navigate to the path
    const currentUrl = this.mainWindow.webContents.getURL();
    const prefix = portalPrefix(currentUrl);

    if (prefix) {
      this.mainWindow.webContents.loadURL(`${prefix}${path}`);
    } else {
      this.mainWindow.webContents.loadURL(`${baseUrl()}${path}`);
    }
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
