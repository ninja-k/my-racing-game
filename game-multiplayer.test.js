/* =========================================================================
 * game-multiplayer.test.js — 多人联机自动化测试（M1~M7）
 * 基于假 Playroom（确定性，无网络依赖）；真实双浏览器 E2E 见 scripts/mp-e2e-test.js
 * 运行：PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright test
 * ========================================================================= */
const { test, expect } = require('@playwright/test');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, 'index.html');

/** 注入假 Playroom（默认本机=房主） */
async function injectFake(page, { isHostPlayer = true } = {}) {
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.Playroom !== 'undefined', null, { timeout: 15000 });
  await page.evaluate(({ isHostFlag }) => {
    const globalState = {};
    const makePlayer = (id, name) => {
      const st = { car: null };
      let qc = null;
      return {
        id,
        getState: k => st[k],
        setState: (k, v) => { st[k] = v; },
        getProfile: () => ({ name }),
        onQuit: cb => { qc = cb; return () => {}; },
        __st: st,
        __fireQuit() { if (qc) qc(this); }
      };
    };
    window.__me = makePlayer('host1', '房主');
    window.__p2 = makePlayer('p2', '玩家2');
    window.__setCalls = [];
    window.__coinOpts = null;
    const P = window.Playroom;
    P.insertCoin = async o => { window.__coinOpts = o; };
    P.getRoomCode = () => 'TEST';
    P.isHost = () => isHostFlag;
    P.setState = (k, v) => { globalState[k] = v; window.__setCalls.push([k, v]); };
    P.getState = k => globalState[k];
    P.myPlayer = () => window.__me;
    P.onPlayerJoin = cb => { window.__joinCb = cb; return () => {}; };
    P.onDisconnect = cb => { window.__disconnectCb = cb; return () => {}; };
    P.waitForState = () => Promise.resolve();
  }, { isHostFlag: isHostPlayer });
}

/** 点击联机对战并等待进入比赛 */
async function startMultiplayer(page) {
  await page.click('#startBtn');
  await page.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 5000 });
}

/* ---------------- M1 加入房间流程 ---------------- */
test('M1 加入房间：insertCoin(maxPlayersPerRoom=4) → 成功进入比赛', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  const r = await page.evaluate(() => ({
    state: document.body.getAttribute('data-state'),
    mpMode: window.__GAME__.multiplayerMode,
    coinOpts: window.__coinOpts,
    aiCount: window.__GAME__.ais.length
  }));
  expect(r.state).toBe('racing');
  expect(r.mpMode).toBe(true);
  expect(r.coinOpts).toEqual({ maxPlayersPerRoom: 4 });
  expect(r.aiCount).toBe(0); // 联机模式禁用 AI
});

/* ---------------- M2 两名玩家加入 ---------------- */
test('M2 两名玩家加入：onPlayerJoin → 创建远程赛车实体', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  await page.evaluate(() => window.__joinCb(window.__p2));
  const rp = await page.evaluate(() => {
    const g = window.__GAME__;
    const rp = g.remotePlayers['p2'];
    return { exists: !!rp, name: rp && rp.name, quitWired: !!(rp && rp.player && rp.player.onQuit) };
  });
  expect(rp.exists).toBe(true);
  expect(rp.name).toBe('玩家2');
  expect(rp.quitWired).toBe(true);
});

/* ---------------- M3 状态同步与渲染 ---------------- */
test('M3 状态同步：远程车辆位置同步 + 平滑渲染', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  const r = await page.evaluate(() => {
    const g = window.__GAME__;
    window.__joinCb(window.__p2);
    window.__p2.__st.car = { x: 420, y: 475, angle: 0, speed: 120, lap: 0, progress: 60, item: null, drifting: false, boosting: false, color: '#3aa0ff', name: '玩家2' };
    for (let f = 0; f < 8; f++) g.testStep(1 / 60, 1);
    const rp = g.remotePlayers['p2'];
    const exact = rp.target ? rp.target.x : -1;
    const smoothed = +rp.car.x.toFixed(1);
    return { exact, smoothed, lap: rp.car.lap, progress: rp.car.progress };
  });
  expect(r.exact).toBe(420);                       // 精确同步值
  expect(r.smoothed).toBeGreaterThan(0);
  expect(r.smoothed).toBeLessThan(420);            // 平滑插值中
  expect(r.lap).toBe(0);
  expect(r.progress).toBe(60);
});

/* ---------------- M4 玩家退出 ---------------- */
test('M4 玩家退出：player.onQuit → 移除赛车实体', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  await page.evaluate(() => window.__joinCb(window.__p2));
  const after = await page.evaluate(() => {
    const g = window.__GAME__;
    window.__p2.__fireQuit();
    return { hasP2: !!g.remotePlayers['p2'], count: Object.keys(g.remotePlayers).length };
  });
  expect(after.hasP2).toBe(false);
  expect(after.count).toBe(0);
});

/* ---------------- M5 房主守卫 ---------------- */
test('M5 房主守卫：仅 isHost() 可写全局状态', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  const r = await page.evaluate(() => {
    const before = window.__setCalls.length;
    const hostOk = Multiplayer.setGlobal('k1', 1);
    const hostCalls = window.__setCalls.length - before;
    const orig = window.Playroom.isHost;
    window.Playroom.isHost = () => false;
    const guestOk = Multiplayer.setGlobal('k2', 2);
    const guestCalls = window.__setCalls.length - before - hostCalls;
    window.Playroom.isHost = orig;
    return { hostOk, hostCalls, guestOk, guestCalls };
  });
  expect(r.hostOk).toBe(true);
  expect(r.hostCalls).toBe(1);
  expect(r.guestOk).toBe(false);
  expect(r.guestCalls).toBe(0);
});

/* ---------------- M6 道具事件一致应用 ---------------- */
test('M6 道具事件：远程龟壳/香蕉在所有客户端一致生成', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  const r = await page.evaluate(() => {
    const g = window.__GAME__;
    window.__joinCb(window.__p2);
    window.__p2.__st.car = {
      x: 350, y: 478, angle: 0, speed: 100, lap: 0, progress: 30,
      item: null, drifting: false, boosting: false, color: '#6fe36f', name: '玩家2',
      input: { up: true, down: false, left: false, right: false, drift: false },
      action: { seq: 3, type: 'shell', x: 350, y: 478, angle: 0 }
    };
    for (let f = 0; f < 4; f++) g.testStep(1 / 60, 1);
    const shellSpawned = g.shells.some(s => s.owner && s.owner.player && s.owner.player.id === 'p2' && s.x > 340 && s.x < 380);
    window.__p2.__st.car.action = { seq: 4, type: 'banana', x: 360, y: 480, angle: 0 };
    for (let f = 0; f < 4; f++) g.testStep(1 / 60, 1);
    const bananaSpawned = g.bananas.some(b => b.owner && b.owner.player && b.owner.player.id === 'p2' && Math.round(b.x) === 360);
    return { shellSpawned, bananaSpawned };
  });
  expect(r.shellSpawned).toBe(true);
  expect(r.bananaSpawned).toBe(true);
});

/* ---------------- M7 本机断开 ---------------- */
test('M7 本机断开：onDisconnect → 返回菜单并可重新加入', async ({ page }) => {
  await injectFake(page);
  await startMultiplayer(page);
  const r = await page.evaluate(() => {
    window.__disconnectCb({ code: 1006, reason: 'abnormal' });
    const g = window.__GAME__;
    return {
      state: document.body.getAttribute('data-state'),
      mpMode: g.multiplayerMode,
      joined: window.__MULTIPLAYER__.joined,
      menuVisible: !document.getElementById('menuOverlay').classList.contains('hidden')
    };
  });
  expect(r.state).toBe('menu');
  expect(r.mpMode).toBe(false);
  expect(r.joined).toBe(false);
  expect(r.menuVisible).toBe(true);
});
