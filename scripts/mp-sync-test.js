/* Step 3 验证：游戏状态同步（假 Playroom 模拟两名玩家）
 * 覆盖：发布本机状态 / 拉取远程状态并渲染 / 房主守卫全局写入 / 排名含远程 / 联机碰撞 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await page.goto(URL);
  // 等真实 CDN 加载完再覆盖，避免竞态
  await page.waitForFunction(() => typeof window.Playroom !== 'undefined', null, { timeout: 15000 });

  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  console.log('--- Step 3A: 注入假 Playroom（本机=房主）并加入房间 ---');
  await page.evaluate(() => {
    const state = {};
    const makePlayer = (id, name) => {
      const st = { car: null };
      return {
        id,
        getState: k => st[k],
        setState: (k, v) => { st[k] = v; },
        getProfile: () => ({ name }),
        __st: st
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
    P.onDisconnect = () => () => {};
    P.waitForState = () => Promise.resolve();
  });
  await page.click('#startBtn');
  await page.waitForSelector('#trackSelectOverlay:not(.hidden)', { timeout: 5000 });
  await page.click('.track-card'); // 房主选择赛道 → 开赛
  await page.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 5000 });

  const setup = await page.evaluate(() => {
    const g = window.__GAME__;
    const setCalls = window.__setCalls;
    const raceState = setCalls.find(c => c[0] === 'raceState');
    const grid = setCalls.find(c => c[0] === 'grid');
    return {
      multiplayerMode: g.multiplayerMode,
      aiCount: g.ais.length,
      myPlayerId: g.myPlayerId,
      playerName: g.playerName,
      raceState: raceState ? raceState[1] : null,
      grid: grid ? grid[1] : null,
      joined: window.__MULTIPLAYER__.joined
    };
  });
  if (setup.multiplayerMode && setup.joined) ok('联机模式开启（multiplayerMode=true, joined=true）');
  else fail('联机模式未开启: ' + JSON.stringify(setup));
  if (setup.aiCount === 0) ok('联机模式禁用 AI（ais=[]）'); else fail('AI 未禁用: ' + setup.aiCount);
  if (setup.raceState === 'racing') ok('房主 setGlobal(raceState, racing)（全局状态写入）');
  else fail('raceState 未写入: ' + setup.raceState);
  if (setup.grid && setup.grid.host1 === 0) ok('房主分配发车位 grid={host1:0}'); else fail('grid 异常: ' + JSON.stringify(setup.grid));

  console.log('--- Step 3B: 本机状态发布（publishCarState） ---');
  await page.evaluate(() => {
    const g = window.__GAME__;
    g.keys.up = true;
    g.testStep(1 / 60, 30); // 0.5s（约 8 次发布周期）
    g.keys.up = false;
  });
  const pub = await page.evaluate(() => {
    const me = window.__me;
    const p = window.__GAME__.player;
    return { car: me.__st.car, px: +p.x.toFixed(1) };
  });
  if (pub.car && typeof pub.car.x === 'number' && Math.abs(pub.car.x - pub.px) < 30)
    ok('本机状态已发布到 myPlayer().setState("car")（x=' + pub.car.x + '，含位置/圈数/速度）');
  else fail('发布异常: ' + JSON.stringify(pub).slice(0, 120));
  if (pub.car && typeof pub.car.lap === 'number' && typeof pub.car.speed === 'number' && pub.car.angle !== undefined)
    ok('发布数据结构完整（x/y/angle/speed/lap/progress/item…）');
  else fail('发布数据结构缺失: ' + JSON.stringify(pub.car));

  console.log('--- Step 3C: 远程玩家加入 → 状态拉取 → 渲染 ---');
  const remote = await page.evaluate(() => {
    const g = window.__GAME__;
    window.__joinCb(window.__p2); // 模拟玩家2加入
    const rp = g.remotePlayers['p2'];
    const before = rp ? { name: rp.name, x: rp.car.x } : null;
    // 模拟玩家2发布状态
    window.__p2.__st.car = { x: 400, y: 475, angle: 0, speed: 120, lap: 0, progress: 60, item: null, drifting: false, boosting: false, color: '#3aa0ff', name: '玩家2' };
    for (let f = 0; f < 8; f++) g.testStep(1 / 60, 1);
    const after = rp ? { name: rp.name, targetX: rp.target && rp.target.x, carX: +rp.car.x.toFixed(1), y: +rp.car.y.toFixed(1), lap: rp.car.lap, progress: rp.car.progress, color: rp.color } : null;
    // 渲染远程车辆（像素验证：按目标位置渲染，车在 (400,475)，颜色蓝 #3aa0ff）
    if (rp && rp.target) { rp.car.x = rp.target.x; rp.car.y = rp.target.y; }
    g.render();
    const d = g.ctx.getImageData(400, 475, 1, 1).data;
    return { before, after, pixel: [d[0], d[1], d[2]] };
  });
  if (remote.before && remote.before.name === '玩家2') ok('onPlayerJoin → 创建远程实体（name=玩家2）');
  else fail('远程实体未创建: ' + JSON.stringify(remote.before));
  if (remote.after && remote.after.targetX === 400 && remote.after.progress === 60)
    ok('远程状态拉取（精确值 targetX=400, progress=60, lap=' + remote.after.lap + '）');
  else fail('远程状态未同步: ' + JSON.stringify(remote.after));
  if (remote.after && remote.after.carX > 0 && remote.after.carX < 400)
    ok('渲染位置平滑插值逼近（carX=' + remote.after.carX + ' → 400）');
  else fail('插值异常: ' + remote.after.carX);
  if (remote.pixel[0] > 40 && remote.pixel[2] > 150)
    ok('远程车辆已渲染（(400,475) 像素=' + remote.pixel.join(',') + '，蓝色）');
  else fail('远程车辆未渲染: ' + remote.pixel.join(','));

  console.log('--- Step 3D: 房主守卫（仅 isHost 可写全局状态） ---');
  const guard = await page.evaluate(() => {
    const before = window.__setCalls.length;
    const ok1 = Multiplayer.setGlobal('testKey', 1);
    const calls = window.__setCalls.length - before;
    // 切到非房主
    const origHost = window.Playroom.isHost;
    window.Playroom.isHost = () => false;
    const ok2 = Multiplayer.setGlobal('testKey2', 2);
    const calls2 = window.__setCalls.length - before - calls;
    window.Playroom.isHost = origHost;
    return { ok1, ok2, calls, calls2 };
  });
  if (guard.ok1 && guard.calls === 1) ok('房主可写全局状态（setState 调用 1 次）');
  else fail('房主写入异常: ' + JSON.stringify(guard));
  if (!guard.ok2 && guard.calls2 === 0) ok('非房主写入被拒绝（isHost() 守卫生效）');
  else fail('房主守卫失效: ' + JSON.stringify(guard));

  console.log('--- Step 3E: 排名含远程玩家 + 联机碰撞 ---');
  const rank = await page.evaluate(() => {
    const g = window.__GAME__;
    // 玩家2 progress=60 领先玩家
    g.player.progress = 10; g.player.lap = 0;
    window.__p2.__st.car.progress = 60; window.__p2.__st.car.lap = 0;
    g._updateRank();
    const r1 = g.rank;
    // 碰撞：把玩家2放到玩家位置（直接设置实体位置，绕过插值，测碰撞逻辑）
    g.player.x = 300; g.player.y = 475; g.player.speed = 200;
    window.__p2.__st.car.x = 303; window.__p2.__st.car.y = 475;
    g.remotePlayers['p2'].car.x = 303;
    g.remotePlayers['p2'].car.y = 475;
    g.testStep(1 / 60, 2);
    return { rank: r1, playerSpeed: Math.round(g.player.speed), playerX: +g.player.x.toFixed(1) };
  });
  if (rank.rank === 2) ok('排名包含远程玩家（玩家2领先 → rank=2）');
  else fail('排名异常: ' + rank.rank);
  if (rank.playerSpeed < 200 * 0.9) ok('远程碰撞本机减速（' + rank.playerSpeed + ' km/h）');
  else fail('远程碰撞未减速: ' + rank.playerSpeed);

  if (errors.length) fail('页面错误: ' + errors.join(' | ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 3 验证：未通过 ===' : '=== Step 3 验证：全部通过 ✅ ===');
})();
