const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for renderer to communicate with main
contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (title, body, tag) => {
    ipcRenderer.send('show-notification', { title, body, tag });
  },
  setUnreadCount: (count) => {
    ipcRenderer.send('set-unread-count', count);
  }
});

// DOM Ready - Set up page modifications
window.addEventListener('DOMContentLoaded', () => {
  // Override web notifications with native
  window.Notification = function(title, options = {}) {
    ipcRenderer.send('show-notification', {
      title,
      body: options.body || '',
      tag: options.tag || Date.now().toString()
    });

    return {
      close: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      onclick: null,
      onclose: null,
      onerror: null,
      onshow: null
    };
  };

  window.Notification.permission = 'granted';
  window.Notification.requestPermission = () => Promise.resolve('granted');

  // Watch for unread count changes in page title
  const updateUnreadCount = () => {
    const match = document.title.match(/\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    ipcRenderer.send('set-unread-count', count);
  };

  // Use MutationObserver for title changes
  const titleObserver = new MutationObserver(updateUnreadCount);
  const titleElement = document.querySelector('title');
  if (titleElement) {
    titleObserver.observe(titleElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  // Initial check after page loads
  setTimeout(updateUnreadCount, 3000);

  // Also poll periodically as backup
  setInterval(updateUnreadCount, 10000);
});
