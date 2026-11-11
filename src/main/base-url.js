const DEFAULT_BASE_URL = 'https://app.hubspot.com';

function baseUrl(app = require('electron').app, env = process.env) {
  if (!app.isPackaged && env.HUBSPOT_DESKTOP_BASE_URL) {
    return env.HUBSPOT_DESKTOP_BASE_URL.replace(/\/+$/, '');
  }
  return DEFAULT_BASE_URL;
}

module.exports = { baseUrl, DEFAULT_BASE_URL };
