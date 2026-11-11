const DEFAULT_BASE_URL = 'https://app.hubspot.com';

function baseUrl(app = require('electron').app, env = process.env) {
  if (!app.isPackaged && env.HUBSPOT_DESKTOP_BASE_URL) {
    return env.HUBSPOT_DESKTOP_BASE_URL.replace(/\/+$/, '');
  }
  return DEFAULT_BASE_URL;
}

function portalPrefix(url, base = baseUrl()) {
  if (!url.startsWith(base + '/')) return null;
  const match = url.slice(base.length).match(/^\/[^/]+\/\d+/);
  return match ? base + match[0] : null;
}

module.exports = { baseUrl, portalPrefix, DEFAULT_BASE_URL };
