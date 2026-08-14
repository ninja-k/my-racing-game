/* Step 1 验证：Playroom Kit 是否通过 CDN 成功加载 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 120)));

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  // 等待 CDN 脚本加载（最多 15s）
  await page.waitForFunction(() => typeof window.Playroom !== 'undefined', null, { timeout: 15000 }).catch(() => {});

  const r = await page.evaluate(() => {
    const P = window.Playroom;
    const m = window.__MULTIPLAYER__;
    const game = window.__GAME__;
    return {
      playroomLoaded: !!P,
      version: (P && P.VERSION) || null,
      api: P ? {
        insertCoin: typeof P.insertCoin,
        onPlayerJoin: typeof P.onPlayerJoin,
        isHost: typeof P.isHost,
        setState: typeof P.setState,
        getState: typeof P.getState,
        myPlayer: typeof P.myPlayer,
        getRoomCode: typeof P.getRoomCode,
        onDisconnect: typeof P.onDisconnect,
        waitForState: typeof P.waitForState
      } : null,
      multiplayerAvailable: !!m && m.available,
      multiplayerErr: (m && m._err) || null,
      gameFlag: !!game && game.multiplayerAvailable
    };
  });

  console.log('--- Step 1: Playroom Kit 加载验证 ---');
  console.log('  window.Playroom 已定义:', r.playroomLoaded, r.version ? '(version: ' + r.version + ')' : '');
  if (r.api) {
    const allFunc = Object.values(r.api).every(t => t === 'function');
    console.log('  所需 API 齐全:', allFunc ? '是' : '否', JSON.stringify(r.api));
  }
  console.log('  Multiplayer.checkAvailable():', r.multiplayerAvailable, r.multiplayerErr ? '(' + r.multiplayerErr + ')' : '');
  console.log('  游戏启动自检 game.multiplayerAvailable:', r.gameFlag);
  console.log('  console/page 错误:', errors.length ? errors : '无');

  const pass = r.playroomLoaded && r.multiplayerAvailable && r.gameFlag &&
    (!r.api || Object.values(r.api).every(t => t === 'function')) && errors.length === 0;
  await browser.close();
  console.log(pass ? '=== Step 1 验证通过 ✅ ===' : '=== Step 1 验证未通过 ===');
  process.exit(pass ? 0 : 1);
})();
