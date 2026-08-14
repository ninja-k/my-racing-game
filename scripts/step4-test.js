/* Step 4 测试：AI 路径跟随（不卡墙/完成圈数）、速度波动 70%~100%、车辆碰撞、排名 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(300);
  await page.click('#startBtn');

  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);
  console.log('--- Step 4: AI 行为 ---');

  // 玩家挪到赛道边缘（顶部直道上缘，离开赛车线），AI 自行比赛，模拟 30 秒
  // 注意：① 先 reset() 归一化状态（消除点击后真实 rAF 帧导致的随机性）
  //      ② 禁用道具箱（避免 AI 拾取/使用道具干扰纯驾驶速度测量）
  const aiData = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = false;
    PowerUp.boxes = []; // 彻底禁用道具箱（避免 AI 拾取道具干扰速度测量）
    g.ais.forEach(a => { a.item = null; a.mushroomTimer = 0; a.slipTimer = 0; a.slowTimer = 0; });
    g.shells = []; g.bananas = [];
    g.player.x = 500; g.player.y = 245; g.player.speed = 0; // 停在赛道边缘不挡路
    const samples = []; // 每 0.5s 采样所有 AI 速度
    for (let f = 0; f < 60 * 30; f++) {
      g.testStep(1 / 60, 1);
      if (f % 30 === 0) { // 每 0.5s
        samples.push(g.ais.map(ai => ai.speed));
      }
    }
    return {
      samples,
      ais: g.ais.map(ai => ({
        index: ai.index, lap: ai.lap,
        x: Math.round(ai.x), y: Math.round(ai.y),
        dist: +g.track.nearest(ai.x, ai.y).dist.toFixed(1),
        hw: +g.track.nearest(ai.x, ai.y).hw.toFixed(1),
        speed: Math.round(ai.speed)
      })),
      playerRank: g.rank,
      aiDifficulty: g.aiDifficulty
    };
  });

  // T07: AI 速度波动在 70%~100% 之间（跳过起步加速 + 车群压缩期前 5s）
  const speeds = aiData.samples.slice(10).flat(); // 从 5s 开始（稳态节奏）
  const minSp = Math.min(...speeds), maxSp = Math.max(...speeds);
  const MAX = 300;
  if (minSp >= MAX * 0.68 && maxSp <= MAX * 1.01)
    ok('AI 速度波动 ' + Math.round(minSp) + '~' + Math.round(maxSp) + ' km/h（70%~100% 区间）');
  else fail('AI 速度区间异常: ' + Math.round(minSp) + '~' + Math.round(maxSp));
  if (maxSp >= MAX * 0.9) ok('AI 直道上能达到接近全速 (' + Math.round(maxSp) + ')');
  else fail('AI 最高速不足: ' + Math.round(maxSp));

  // AI 完成整圈（30s 内至少 1 圈），且不卡墙（都在赛道内）
  let allOk = true;
  for (const a of aiData.ais) {
    const onTrack = a.dist <= a.hw + 6;
    if (a.lap >= 1) ok('AI ' + a.index + ' 完成 ' + a.lap + ' 圈');
    else { fail('AI ' + a.index + ' 未完成整圈'); allOk = false; }
    if (onTrack) ok('AI ' + a.index + ' 在赛道内 (距中心 ' + a.dist + ' ≤ 半宽 ' + a.hw + '+6)');
    else { fail('AI ' + a.index + ' 卡在赛道外 (' + a.x + ',' + a.y + ')'); allOk = false; }
  }

  // 排名 HUD 已更新（玩家静止，应至少是 2nd）
  const rankTxt = (await page.textContent('#rankText')).trim();
  if (['2nd', '3rd', '4th'].includes(rankTxt)) ok('玩家静止 → 排名 ' + rankTxt);
  else fail('排名异常: ' + rankTxt);

  console.log('--- Step 4: 车辆碰撞 ---');

  // 碰撞测试：把 AI1 放到玩家位置，双方高速 → 一步后分离且双方减速
  const col = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player, a = g.ais[0];
    p.x = 400; p.y = 475; p.angle = 0; p.speed = 200; p.lap = 0; p.progress = 0; p.nextCp = 1; p.wrapCount = 0; p.prevIdxRaw = null;
    a.x = 406; a.y = 475; a.angle = 0; a.speed = 200;
    g.testStep(1 / 60, 3);
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    return { d, pSpeed: p.speed, aSpeed: a.speed };
  });
  if (col.d >= 15) ok('碰撞后两车分离 (间距 ' + col.d.toFixed(1) + 'px ≥ 15)');
  else fail('碰撞后未分离: ' + col.d.toFixed(1));
  if (col.pSpeed < 180 && col.aSpeed < 180)
    ok('碰撞双方减速 (玩家 ' + col.pSpeed.toFixed(0) + ' / AI ' + col.aSpeed.toFixed(0) + '，均 <180)');
  else fail('碰撞未减速: ' + col.pSpeed.toFixed(0) + '/' + col.aSpeed.toFixed(0));

  console.log('--- Step 4: 动态难度 ---');
  // 单测 _updateDifficulty：玩家第 1 名累计 >10 秒 → 系数 1.1
  const diff = await page.evaluate(() => {
    const g = window.__GAME__;
    g.rank = 1;
    g.timeInFirst = 0;
    g.diffTimer = 0;
    for (let i = 0; i < 16; i++) g._updateDifficulty(1); // 16 秒：15s 时触发 1.1
    return { difficulty: g.aiDifficulty, timeInFirst: Math.round(g.timeInFirst) };
  });
  if (diff.difficulty === 1.1) ok('玩家第 1 名 >10s → AI 系数 1.1 (timeInFirst=' + diff.timeInFirst + 's)');
  else fail('动态难度未触发: ' + diff.difficulty + ' timeInFirst=' + diff.timeInFirst);

  // 玩家垫底 → 0.9
  const diff2 = await page.evaluate(() => {
    const g = window.__GAME__;
    g.rank = 4;
    g.timeInFirst = 0;
    g.diffTimer = 0;
    g._updateDifficulty(5); // 一次 5s 检测
    return g.aiDifficulty;
  });
  if (diff2 === 0.9) ok('玩家垫底 → AI 系数 0.9');
  else fail('垫底难度未触发: ' + diff2);

  if (errors.length) fail('页面错误: ' + errors.join('; ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 4 测试：未通过 ===' : '=== Step 4 测试：全部通过 ✅ ===');
})();
