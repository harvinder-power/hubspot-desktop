const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test/e2e',
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
});
