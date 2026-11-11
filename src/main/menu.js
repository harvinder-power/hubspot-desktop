const { app, Menu, shell } = require('electron');
const { baseUrl } = require('./base-url');
const { ROUTES, resolve, portalTracker } = require('./routes');

// Returns openRoute(id): shows the window and loads the route for the last portal it was on.
function createRouteOpener(mainWindow, show) {
  const base = baseUrl();
  const portal = portalTracker({ base });
  // did-navigate fires for the main frame only; did-navigate-in-page fires for every frame.
  mainWindow.webContents.on('did-navigate', (event, url) => portal.observe(url));
  mainWindow.webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (isMainFrame) portal.observe(url);
  });
  return (routeId) => {
    show();
    mainWindow.webContents.loadURL(resolve(routeId, portal.context, { base }));
  };
}

function createMenu(mainWindow, openRoute) {
  const isMac = process.platform === 'darwin';
  const history = mainWindow.webContents.navigationHistory;

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
          click: () => history.canGoBack() && history.goBack()
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => history.canGoForward() && history.goForward()
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
