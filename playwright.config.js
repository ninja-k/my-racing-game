/* Playwright 配置：马力欧赛车风格网页小游戏自动化测试 */
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: 'game.test.js',
  timeout: 120000,
  workers: 1, // 串行执行，避免资源竞争
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    viewport: { width: 1200, height: 800 }
  }
});
