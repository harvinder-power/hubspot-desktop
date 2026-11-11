const { app, Menu, shell } = require('electron');
const { baseUrl, portalPrefix } = require('./base-url');

function createMenu(mainWindow) {
  const isMac = process.platform === 'darwin';

  const template = [
    // App Menu (Mac only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: () => navigateTo(mainWindow, '/settings')
        },
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
        {
          label: 'New Contact',
          accelerator: 'CmdOrCtrl+N',
          click: () => navigateTo(mainWindow, '/contacts')
        },
        {
          label: 'New Company',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => navigateTo(mainWindow, '/companies')
        },
        {
          label: 'New Deal',
          accelerator: 'CmdOrCtrl+D',
          click: () => navigateTo(mainWindow, '/deals/board')
        },
        {
          label: 'New Task',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => navigateTo(mainWindow, '/tasks')
        },
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
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            mainWindow.webContents.executeJavaScript(`
              const searchBtn = document.querySelector('[data-test-id="global-search-input"]') ||
                               document.querySelector('[data-selenium="nav-search-button"]') ||
                               document.querySelector('button[aria-label*="Search"]');
              if (searchBtn) searchBtn.click();
            `);
          }
        }
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
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => navigateTo(mainWindow, '/reports-dashboard')
        },
        {
          label: 'Contacts',
          accelerator: 'CmdOrCtrl+2',
          click: () => navigateTo(mainWindow, '/contacts')
        },
        {
          label: 'Companies',
          accelerator: 'CmdOrCtrl+3',
          click: () => navigateTo(mainWindow, '/companies')
        },
        {
          label: 'Deals',
          accelerator: 'CmdOrCtrl+4',
          click: () => navigateTo(mainWindow, '/deals/board')
        },
        {
          label: 'Tasks',
          accelerator: 'CmdOrCtrl+5',
          click: () => navigateTo(mainWindow, '/tasks')
        },
        {
          label: 'Tickets',
          accelerator: 'CmdOrCtrl+6',
          click: () => navigateTo(mainWindow, '/tickets')
        },
        { type: 'separator' },
        {
          label: 'Inbox',
          accelerator: 'CmdOrCtrl+I',
          click: () => navigateTo(mainWindow, '/conversations/inbox')
        },
        {
          label: 'Calendar',
          accelerator: 'CmdOrCtrl+K',
          click: () => navigateTo(mainWindow, '/meetings')
        },
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            if (mainWindow.webContents.canGoBack()) {
              mainWindow.webContents.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            if (mainWindow.webContents.canGoForward()) {
              mainWindow.webContents.goForward();
            }
          }
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

function navigateTo(mainWindow, path) {
  // Get the current URL to extract the portal ID
  const currentUrl = mainWindow.webContents.getURL();

  // Try to extract the portal base URL (includes portal ID)
  const prefix = portalPrefix(currentUrl);

  if (prefix) {
    // Navigate within the same portal
    mainWindow.webContents.loadURL(`${prefix}${path}`);
  } else {
    // Fallback: just go to the main HubSpot page with the path
    mainWindow.webContents.loadURL(`${baseUrl()}${path}`);
  }
}

module.exports = { createMenu };
