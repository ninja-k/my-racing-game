/* Step 5 验证：同步玩家操作（输入发布 / 道具事件一致应用 / 插值）
 * 假 Playroom 模拟：本机=房主（host1），远程=玩家2（p2） */
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

  console.log('--- Step 5A: 注入假 Playroom 并进入联机 ---');
  await page.evaluate(() => {
    const state = {};
    const makePlayer = (id, name) => {
      const st = { car: null };
      let quitCb = null;
      return {
        id, getState: k => st[k], setState: (k, v) => { st[k] = v; },
        getProfile: () => ({ name }),
        onQuit: cb => { quitCb = cb; return () => {}; },
        __st: st, __fireQuit() { if (quitCb) quitCb(this); }
      };
    };
    window.__me = makePlayer('host1', '房主');
    window.__p2 = makePlayer('p2', '玩家2');
    const P = window.Playroom;
    P.insertCoin = async () => {};
    P.getRoomCode = () => 'TEST';
    P.isHost = () => true;
    P.setState = (k, v) => { state[k] = v; };
    P.getState = k => state[k];
    P.myPlayer = () => window.__me;
    P.onPlayerJoin = cb => { window.__joinCb = cb; return () => {}; };
    P.onDisconnect = cb => { window.__disconnectCb = cb; return () => {}; };
    P.waitForState = () => Promise.resolve();
  });
  await page.click('#startBtn');
  await page.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 5000 });
  await page.evaluate(() => window.__joinCb(window.__p2));

  console.log('--- Step 5B: 键盘输入随状态发布 ---');
  const inputPub = await page.evaluate(() => {
    const g = window.__GAME__;
    g.keys.up = true; g.keys.left = true; g.keys.drift = true;
    for (let f = 0; f < 12; f++) g.testStep(1 / 60, 1); // 3 次发布周期
    g.keys.up = g.keys.left = g.keys.drift = false;
    const car = window.__me.__st.car;
    return { input: car && car.input, hasActionField: car && ('action' in car) };
  });
  if (inputPub.input && inputPub.input.up === true && inputPub.input.left === true && inputPub.input.drift === true)
    ok('键盘输入已随状态发布（up/left/drift=true）');
  else fail('输入未发布: ' + JSON.stringify(inputPub.input));
  if (inputPub.hasActionField) ok('状态含 action 字段（道具事件通道）'); else fail('action 字段缺失');

  console.log('--- Step 5C: 本机道具使用 → 广播事件 ---');
  const actionPub = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player;
    p.x = 300; p.y = 478; p.angle = 0; p.speed = 0;
    p.item = 'banana';
    g.keys.item = true;
    g.testStep(1 / 60, 1); // 使用香蕉 → 广播
    for (let f = 0; f < 8; f++) g.testStep(1 / 60, 1); // 等到下一个发布周期（每 4 帧）
    const car = window.__me.__st.car;
    return { action: car && car.action, bananaHere: g.bananas.length, seq: g._actionSeq };
  });
  if (actionPub.action && actionPub.action.type === 'banana' && actionPub.action.seq === 1)
    ok('道具使用已广播 action={seq:1, type:banana, x,y,angle}');
  else fail('action 广播异常: ' + JSON.stringify(actionPub.action));
  if (actionPub.bananaHere === 1) ok('本机同步生成香蕉实体'); else fail('本机香蕉未生成: ' + actionPub.bananaHere);

  console.log('--- Step 5D: 接收远程道具事件 → 一致生成实体 ---');
  const remoteAction = await page.evaluate(() => {
    const g = window.__GAME__;
    g.shells = []; g.bananas = [];
    // 玩家2 发布龟壳事件（seq=7）
    window.__p2.__st.car = {
      x: 350, y: 478, angle: 0, speed: 100, lap: 0, progress: 30,
      item: null, drifting: false, boosting: false, color: '#6fe36f', name: '玩家2',
      input: { up: true, down: false, left: false, right: false, drift: false },
      action: { seq: 7, type: 'shell', x: 350, y: 478, angle: 0 }
    };
    for (let f = 0; f < 4; f++) g.testStep(1 / 60, 1);
    const shellSpawned = g.shells.some(s => s.owner && s.owner.player && s.owner.player.id === 'p2' && s.x > 340 && s.x < 380);
    // 再发布香蕉事件（seq=8）
    window.__p2.__st.car.action = { seq: 8, type: 'banana', x: 360, y: 480, angle: 0 };
    for (let f = 0; f < 4; f++) g.testStep(1 / 60, 1);
    const bananaSpawned = g.bananas.some(b => b.owner && b.owner.player && b.owner.player.id === 'p2' && Math.round(b.x) === 360);
    // seq 相同不重复生成
    const before = g.shells.length;
    for (let f = 0; f < 4; f++) g.testStep(1 / 60, 1);
    return { shellSpawned, bananaSpawned, noDup: g.shells.length === before };
  });
  if (remoteAction.shellSpawned) ok('远程龟壳事件 → 本端一致生成（owner=p2, x=350）');
  else fail('远程龟壳未生成');
  if (remoteAction.bananaSpawned) ok('远程香蕉事件 → 本端一致生成（x=360）');
  else fail('远程香蕉未生成');
  if (remoteAction.noDup) ok('seq 去重：相同事件不重复生成'); else fail('事件重复应用');

  console.log('--- Step 5E: 远程龟壳可命中本机车辆 ---');
  const shellHit = await page.evaluate(() => {
    const g = window.__GAME__;
    g.shells = [];
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 100; p.slipTimer = 0;
    // 玩家2 发射龟壳（从 345 向前飞向本机 300）
    window.__p2.__st.car = {
      x: 345, y: 478, angle: Math.PI, speed: 100, lap: 0, progress: 30,
      item: null, drifting: false, boosting: false, color: '#6fe36f', name: '玩家2',
      input: { up: true, down: false, left: false, right: false, drift: false },
      action: { seq: 9, type: 'shell', x: 345, y: 478, angle: Math.PI }
    };
    for (let f = 0; f < 4; f++) g.testStep(1 / 60, 1);
    for (let f = 0; f < 60; f++) { g.testStep(1 / 60, 1); if (g.shells.length === 0) break; }
    return { slip: +p.slipTimer.toFixed(2), speed: Math.round(p.speed), shellsLeft: g.shells.length };
  });
  if (shellHit.slip > 0.5) ok('远程龟壳命中本机 → 打滑 ' + shellHit.slip + 's');
  else fail('远程龟壳未命中本机: ' + JSON.stringify(shellHit));

  if (errors.length) fail('页面错误: ' + errors.join(' | ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 5 验证：未通过 ===' : '=== Step 5 验证：全部通过 ✅ ===');
})();
