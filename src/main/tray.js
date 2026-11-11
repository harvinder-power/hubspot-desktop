const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { ROUTES } = require('./routes');

class TrayManager {
  // TrayClass lets a quiet test run the tray code without a real tray icon.
  constructor(registry, openRoute, { Tray: TrayClass = Tray } = {}) {
    this.registry = registry;
    this.openRoute = openRoute;
    this.tray = null;
    this.createTray(TrayClass);
  }

  createTray(TrayClass) {
    // Create a smaller icon for the menu bar (22x22 is standard for macOS menu bar)
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    let trayIcon = nativeImage.createFromPath(iconPath);

    // Resize for menu bar (macOS uses 16x16 or 22x22 for retina)
    trayIcon = trayIcon.resize({ width: 18, height: 18 });

    // Set as template image for proper dark/light mode handling on macOS
    trayIcon.setTemplateImage(true);

    this.tray = new TrayClass(trayIcon);
    this.tray.setToolTip('HubSpot Desktop');

    // A click shows the app and brings it to the front. It never hides a visible window that is behind others.
    this.tray.on('click', () => this.registry.show());

    // Right-click shows the menu
    this.updateMenu();
  }

  updateMenu() {
    const show = () => this.registry.show();
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
