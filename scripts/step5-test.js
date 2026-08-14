/* Step 5 测试：非线性加速 / 漂移降速 20% / 漂移转向更灵 / 松手小喷 +30% / 短漂移无喷
 * 注意：物理测量段禁用 AI（避免 AI 碰撞干扰速度读数） */
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
  console.log('--- Step 5: 非线性加速 ---');

  const accel = await page.evaluate(() => {
    const g = window.__GAME__;
    g.ais = []; // 禁用 AI，纯物理测量
    const p = g.player;
    g.keys.up = true; g.keys.down = g.keys.left = g.keys.right = g.keys.drift = false;
    p.isDrifting = false; p.driftTime = 0; p.boost = 0;
    p.x = 300; p.y = 478; p.angle = 0; p.speed = 0;
    for (let f = 0; f < 60; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const s1 = p.speed;
    for (let f = 0; f < 60 * 3; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const s4 = p.speed;
    for (let f = 0; f < 60; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const s5 = p.speed;
    g.keys.up = false;
    return { s1: +s1.toFixed(1), s4: +s4.toFixed(1), s5: +s5.toFixed(1) };
  });
  if (accel.s1 >= 100 && accel.s1 <= 190) ok('起步段快（1s 达 ' + accel.s1 + ' km/h，0→60% 快速）');
  else fail('起步加速异常: ' + accel.s1);
  if (accel.s5 >= 270 && accel.s5 <= 300) ok('5s 后 ' + accel.s5 + ' km/h（60%→100% 缓慢爬升）');
  else fail('后段加速异常: ' + accel.s5);
  const d1 = accel.s1;
  const d5 = accel.s5 - accel.s4;
  if (d5 < d1 * 0.5) ok('加速度递减（Δ1s=' + d1.toFixed(0) + ' → Δ4-5s=' + d5.toFixed(1) + '，推背感曲线）');
  else fail('加速度未递减: Δ1s=' + d1.toFixed(0) + ' Δ4-5s=' + d5.toFixed(1));

  console.log('--- Step 5: 漂移 ---');
  const drift = await page.evaluate(() => {
    const g = window.__GAME__;
    g.ais = [];
    const p = g.player;
    g.keys.up = true; g.keys.drift = false; g.keys.left = g.keys.right = false;
    p.isDrifting = false; p.driftTime = 0; p.boost = 0;
    p.x = 300; p.y = 478; p.speed = 295; p.angle = 0;
    // 进入漂移 2s
    g.keys.drift = true;
    for (let f = 0; f < 60 * 2; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const driftSpeed = p.speed;
    const driftTime = p.driftTime;
    // 松开漂移（步进 1 帧处理松手事件）→ 小喷
    g.keys.drift = false;
    g.testStep(1 / 60, 1);
    const boostAfter = p.boost;
    // 小喷 1s 后
    for (let f = 0; f < 60; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const boostSpeed = p.speed;
    const boostLeft = p.boost;
    // 再等 1.2s → 小喷应结束
    for (let f = 0; f < 72; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const boostEnd = p.boost;
    const speedEnd = p.speed;
    g.keys.drift = false;
    return { driftSpeed: +driftSpeed.toFixed(1), driftTime: +driftTime.toFixed(2), boostAfter, boostSpeed: +boostSpeed.toFixed(1), boostLeft: +boostLeft.toFixed(2), boostEnd, speedEnd: +speedEnd.toFixed(1) };
  });
  if (drift.driftSpeed >= 230 && drift.driftSpeed <= 262)
    ok('漂移中速度向 80% 收敛: ' + drift.driftSpeed + ' km/h（原 295）');
  else fail('漂移降速异常: ' + drift.driftSpeed);
  if (drift.driftTime >= 1.9) ok('漂移计时累计 ' + drift.driftTime + 's'); else fail('漂移计时异常: ' + drift.driftTime);
  if (drift.boostAfter > 1.4) ok('松开漂移触发小喷（1.5s，当前剩余 ' + drift.boostAfter + 's）'); else fail('小喷未触发: ' + drift.boostAfter);
  if (drift.boostSpeed > 310) ok('小喷后速度 ' + drift.boostSpeed + ' km/h（突破 300 上限）');
  else fail('小喷提速不足: ' + drift.boostSpeed);
  if (drift.boostEnd <= 0 && drift.speedEnd < drift.boostSpeed)
    ok('1.5s 后小喷结束（boost=' + drift.boostEnd + '，速度回落 ' + drift.speedEnd + '）');
  else fail('小喷未按时结束: boost=' + drift.boostEnd + ' speed=' + drift.speedEnd);

  // 转向对比：普通 vs 漂移（同速 240，0.5s）
  const turnCmp = await page.evaluate(() => {
    const g = window.__GAME__;
    g.ais = [];
    const p = g.player;
    p.isDrifting = false; p.driftTime = 0; p.boost = 0;
    p.x = 300; p.y = 478; p.speed = 240;
    p.angle = 0; g.keys.drift = false; g.keys.right = true; g.keys.up = false;
    for (let f = 0; f < 30; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const normalTurn = p.angle;
    p.angle = 0; g.keys.drift = true; p.isDrifting = true; p.driftTime = 0;
    for (let f = 0; f < 30; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const driftTurn2 = p.angle;
    g.keys.right = false; g.keys.drift = false;
    return { normal: +normalTurn.toFixed(3), drift: +driftTurn2.toFixed(3) };
  });
  const ratio = turnCmp.drift / turnCmp.normal;
  if (ratio > 1.4 && ratio < 1.8)
    ok('漂移转向更灵（转向角比 ' + ratio.toFixed(2) + '×，转弯半径变小）');
  else fail('漂移转向倍率异常: ' + ratio.toFixed(2) + ' (normal=' + turnCmp.normal + ' drift=' + turnCmp.drift + ')');

  // 短漂移（<0.3s）无小喷
  const shortDrift = await page.evaluate(() => {
    const g = window.__GAME__;
    g.ais = [];
    const p = g.player;
    p.isDrifting = false; p.driftTime = 0; p.boost = 0;
    p.x = 300; p.y = 478; p.speed = 200;
    g.keys.drift = true;
    for (let f = 0; f < 10; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } } // 0.17s
    g.keys.drift = false;
    g.testStep(1 / 60, 1);
    return p.boost;
  });
  if (shortDrift === 0) ok('短漂移（0.17s）不触发小喷'); else fail('短漂移误触发: ' + shortDrift);

  if (errors.length) fail('页面错误: ' + errors.join('; ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 5 测试：未通过 ===' : '=== Step 5 测试：全部通过 ✅ ===');
})();
