const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { ROUTES } = require('./routes');

class TrayManager {
  constructor(mainWindow, windowManager, openRoute) {
    this.mainWindow = mainWindow;
    this.windowManager = windowManager;
    this.openRoute = openRoute;
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
    const show = () => this.windowManager.focusOrCreate();
    this.tray.setContextMenu(Menu.buildFromTemplate(TrayManager.menuTemplate(show, this.openRoute)));
  }

  static menuTemplate(show, openRoute) {
    return [
      { label: 'Show HubSpot', click: show },
      { type: 'separator' },
      ...ROUTES.map(({ id, label }) => ({ label, click: () => openRoute(id) })),
      { type: 'separator' },
      {
        label: 'Quit HubSpot Desktop',
        accelerator: 'CmdOrCtrl+Q',
        click: () => app.quit()
      }
    ];
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
