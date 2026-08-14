/* Step 4 验证：玩家加入与退出（假 Playroom）
 * 覆盖：加入创建实体 / 立即读取晚加入者视角 / 退出移除实体 / 本机断开回菜单 / 重复加入幂等 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.Playroom !== 'undefined', null, { timeout: 15000 });

  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  console.log('--- Step 4A: 注入假 Playroom 并进入联机 ---');
  await page.evaluate(() => {
    const state = {};
    const makePlayer = (id, name) => {
      const st = { car: null };
      let quitCb = null;
      return {
        id,
        getState: k => st[k],
        setState: (k, v) => { st[k] = v; },
        getProfile: () => ({ name }),
        onQuit: cb => { quitCb = cb; return () => {}; },
        __st: st,
        __fireQuit() { if (quitCb) quitCb(this); }
      };
    };
    window.__me = makePlayer('host1', '房主');
    window.__p2 = makePlayer('p2', '玩家2');
    window.__setCalls = [];
    const P = window.Playroom;
    P.insertCoin = async () => {};
    P.getRoomCode = () => 'TEST';
    P.isHost = () => true;
    P.setState = (k, v) => { state[k] = v; window.__setCalls.push([k, v]); };
    P.getState = k => state[k];
    P.myPlayer = () => window.__me;
    P.onPlayerJoin = cb => { window.__joinCb = cb; return () => {}; };
    P.onDisconnect = cb => { window.__disconnectCb = cb; return () => {}; };
    P.waitForState = () => Promise.resolve();
  });
  await page.click('#startBtn');
  await page.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 5000 });

  console.log('--- Step 4B: 玩家加入 → 创建实体 + 晚加入者立即看到状态 ---');
  const join = await page.evaluate(() => {
    const g = window.__GAME__;
    // 玩家2加入前已发布状态（模拟晚加入者视角：加入瞬间能读到）
    window.__p2.__st.car = { x: 500, y: 400, angle: 0.5, speed: 150, lap: 1, progress: 120, item: 'mushroom', drifting: false, boosting: false, color: '#6fe36f', name: '玩家2' };
    window.__joinCb(window.__p2);
    const rp = g.remotePlayers['p2'];
    return {
      exists: !!rp,
      name: rp && rp.name,
      color: rp && rp.color,
      car: rp && rp.car,
      quitWired: !!(rp && rp.player && rp.player.onQuit)
    };
  });
  if (join.exists) ok('onPlayerJoin → 远程实体创建（name=' + join.name + '）');
  else fail('实体未创建');
  if (join.car && join.car.x === 500 && join.car.progress === 120)
    ok('加入瞬间即读到其状态（晚加入者视角，x=500, progress=120）');
  else fail('立即读状态失败: ' + JSON.stringify(join.car));
  if (join.color === '#6fe36f') ok('颜色沿用玩家发布的颜色'); else fail('颜色异常: ' + join.color);
  if (join.quitWired) ok('player.onQuit 已注册（官方 PlayerState.onQuit）'); else fail('onQuit 未注册');

  console.log('--- Step 4C: 玩家退出 → 移除实体 ---');
  const quit = await page.evaluate(() => {
    const g = window.__GAME__;
    window.__p2.__fireQuit(); // 触发 p2 的 onQuit
    return { remaining: Object.keys(g.remotePlayers).length, hasP2: !!g.remotePlayers['p2'] };
  });
  if (quit.remaining === 0 && !quit.hasP2) ok('退出后实体已移除（remotePlayers 清空）');
  else fail('退出移除失败: ' + JSON.stringify(quit));

  console.log('--- Step 4D: 重复加入幂等 ---');
  const dup = await page.evaluate(() => {
    const g = window.__GAME__;
    window.__joinCb(window.__p2);
    window.__joinCb(window.__p2); // 重复触发
    return Object.keys(g.remotePlayers).length;
  });
  if (dup === 1) ok('重复加入不会重复创建实体'); else fail('重复加入异常: ' + dup);

  console.log('--- Step 4E: 本机断开 → 返回菜单并重置 ---');
  const disc = await page.evaluate(() => {
    window.__disconnectCb({ code: 1006, reason: 'abnormal' });
    const g = window.__GAME__;
    return {
      state: document.body.getAttribute('data-state'),
      menuVisible: !document.getElementById('menuOverlay').classList.contains('hidden'),
      mpMode: g.multiplayerMode,
      joined: window.__MULTIPLAYER__.joined,
      mpStatus: document.getElementById('mpStatus').textContent
    };
  });
  if (disc.state === 'menu' && disc.menuVisible) ok('本机断开 → 返回菜单（state=menu）');
  else fail('未返回菜单: ' + JSON.stringify(disc));
  if (!disc.mpMode && !disc.joined) ok('联机状态重置（multiplayerMode=false, joined=false，可重新加入）');
  else fail('状态未重置: ' + JSON.stringify(disc));
  if (disc.mpStatus.includes('断开')) ok('提示断线信息: "' + disc.mpStatus + '"');
  else fail('断线提示缺失: ' + disc.mpStatus);

  if (errors.length) fail('页面错误: ' + errors.join(' | ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 4 验证：未通过 ===' : '=== Step 4 验证：全部通过 ✅ ===');
})();
