/* Step 6 E2E：两个真实浏览器窗口加入同一房间（经本地 HTTP 服务 + Playroom 官方直连）
 * 前提：本地 http 服务运行（python3 -m http.server 8123 --directory .）
 * 流程：房主 ?mp=host 创建房间 → 取房间码 → 客人 ?mp=join&room=CODE 加入 → 验证互见与状态同步 */
const { chromium } = require('@playwright/test');

(async () => {
  const BASE = 'http://127.0.0.1:8123/index.html';
  const browser = await chromium.launch();
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  const errs = { A: [], B: [] };
  for (const [n, p] of [['A', pageA], ['B', pageB]]) {
    p.on('console', m => { if (m.type() === 'error') errs[n].push(m.text().slice(0, 100)); });
    p.on('pageerror', e => errs[n].push('pageerror: ' + e.message.slice(0, 100)));
  }
  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  console.log('--- E2E-1: 房主创建房间（?mp=host, skipLobby） ---');
  await pageA.goto(BASE + '?mp=host');
  await pageA.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 30000 });
  const host = await pageA.evaluate(() => ({
    roomCode: window.__MULTIPLAYER__.roomCode,
    myId: window.__GAME__.myPlayerId,
    mpMode: window.__GAME__.multiplayerMode
  }));
  if (host.roomCode && host.mpMode) ok('房主已创建房间，房间码: ' + host.roomCode);
  else fail('房主加入异常: ' + JSON.stringify(host));

  console.log('--- E2E-2: 客人加入同一房间（?mp=join&room=CODE） ---');
  await pageB.goto(BASE + '?mp=join&room=' + host.roomCode);
  await pageB.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 30000 });
  const guest = await pageB.evaluate(() => ({
    myId: window.__GAME__.myPlayerId,
    mpMode: window.__GAME__.multiplayerMode
  }));
  if (guest.mpMode) ok('客人已加入房间（' + host.roomCode + '）'); else fail('客人加入异常');

  console.log('--- E2E-3: 双方互见（onPlayerJoin 双向） ---');
  let seenA = [], seenB = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    seenA = await pageA.evaluate(() => Object.keys(window.__GAME__.remotePlayers));
    seenB = await pageB.evaluate(() => Object.keys(window.__GAME__.remotePlayers));
    if (seenA.length >= 1 && seenB.length >= 1) break;
    await pageA.waitForTimeout(500);
  }
  const aHasB = seenA.includes(guest.myId);
  const bHasA = seenB.includes(host.myId);
  if (aHasB && bHasA) ok('双方互见（A 看到客人 / B 看到房主）');
  else fail('互见异常: A=' + JSON.stringify(seenA) + ' B=' + JSON.stringify(seenB));

  console.log('--- E2E-4: 状态同步（房主移动 → 客人看到） ---');
  await pageA.evaluate(() => {
    const g = window.__GAME__;
    g.player.x = 500; g.player.y = 475; g.player.speed = 0; g.player.angle = 0;
    g._publishLocalState(); // 立即发布
  });
  let targetX = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    targetX = await pageB.evaluate((hostId) => {
      const rp = window.__GAME__.remotePlayers[hostId];
      return rp && rp.target ? rp.target.x : null;
    }, host.myId);
    if (targetX !== null && Math.abs(targetX - 500) < 3) break;
    await pageB.waitForTimeout(500);
  }
  if (targetX !== null && Math.abs(targetX - 500) < 3) ok('房主位置已同步到客人端（target.x=' + targetX + '）');
  else fail('状态未同步: targetX=' + targetX);

  console.log('--- E2E-5: 无页面错误 ---');
  if (errs.A.length === 0 && errs.B.length === 0) ok('A/B 均无 console/页面错误');
  else fail('存在错误: A=' + JSON.stringify(errs.A.slice(0, 3)) + ' B=' + JSON.stringify(errs.B.slice(0, 3)));

  await browser.close();
  console.log(process.exitCode ? '=== E2E 双浏览器测试：未通过 ===' : '=== E2E 双浏览器测试：全部通过 ✅ ===');
})();
