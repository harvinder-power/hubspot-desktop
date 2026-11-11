const { app, Menu, shell } = require('electron');
const { baseUrl } = require('./base-url');
const { ROUTES, resolve, portalTracker } = require('./routes');

// One portal tracker fed by the main frame of every registry window.
// url(id) is the route for the last portal seen. open(id) loads it in the active window.
function createRouteOpener(registry) {
  const base = baseUrl();
  const portal = portalTracker({ base });
  // did-navigate fires for the main frame only; did-navigate-in-page fires for every frame.
  registry.onWindow(({ webContents }) => {
    webContents.on('did-navigate', (event, url) => portal.observe(url));
    webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
      if (isMainFrame) portal.observe(url);
    });
  });
  const url = (routeId) => resolve(routeId, portal.context, { base });
  return {
    url,
    open: (routeId) => registry.show().webContents.loadURL(url(routeId)),
  };
}

function createMenu({ registry, openRoute, newTab, newWindow }) {
  const isMac = process.platform === 'darwin';
  const history = () => registry.active()?.webContents.navigationHistory;

  const template = [
    // App Menu (Mac only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),

    // File Menu
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => newTab() },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => newWindow() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    // Edit Menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },

    // View Menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },

    // Navigate Menu
    {
      label: 'Navigate',
      submenu: [
        ...ROUTES.map(({ id, label, accelerator }) => ({ label, accelerator, click: () => openRoute(id) })),
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => history()?.canGoBack() && history().goBack()
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => history()?.canGoForward() && history().goForward()
        }
      ]
    },

    // Window Menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'selectNextTab' },
          { role: 'selectPreviousTab' },
          { role: 'showAllTabs' },
          { role: 'mergeAllWindows' },
          { role: 'moveTabToNewWindow' },
          { role: 'toggleTabBar' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },

    // Help Menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'HubSpot Knowledge Base',
          click: () => shell.openExternal('https://knowledge.hubspot.com')
        },
        {
          label: 'HubSpot Academy',
          click: () => shell.openExternal('https://academy.hubspot.com')
        },
        { type: 'separator' },
        {
          label: 'HubSpot Community',
          click: () => shell.openExternal('https://community.hubspot.com')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { createMenu, createRouteOpener };
