/* Step 6 测试：道具箱拾取 + 15s 重生 / 蘑菇加速 / 龟壳命中打滑 / 香蕉减速 / AI 使用道具 */
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
  await page.click('#soloBtn');
    await page.click('.track-card'); // 进入赛道选择 → 默认第一条赛道

  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);
  const resetKeys = (g) => { const k = g.keys; k.up = k.down = k.left = k.right = k.drift = k.item = false; };

  console.log('--- Step 6: 道具箱拾取 / 重生 ---');
  const pickup = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
    const p = g.player;
    const box = PowerUp.boxes[0];
    p.x = box.x; p.y = box.y; p.speed = 0; p.angle = 0;
    g.testStep(1 / 60, 2);
    const item = p.item;
    const icon = document.getElementById('powerupSlot').textContent;
    const boxInactive = !PowerUp.boxes[0].active;
    // 移开玩家，等 15s 重生
    p.x = 300; p.y = 478;
    for (let f = 0; f < 60 * 15; f++) g.testStep(1 / 60, 1);
    return { item, icon, boxInactive, boxActiveAfter: PowerUp.boxes[0].active };
  });
  if (pickup.item && ['mushroom', 'shell', 'banana'].includes(pickup.item))
    ok('经过道具箱拾取道具: ' + pickup.item);
  else fail('未拾取到道具: ' + pickup.item);
  const iconMap = { mushroom: '🍄', shell: '🐢', banana: '🍌' };
  if (pickup.icon === iconMap[pickup.item]) ok('道具槽显示图标 ' + pickup.icon);
  else fail('道具槽图标错误: ' + pickup.icon + ' (item=' + pickup.item + ')');
  if (pickup.boxInactive) ok('拾取后道具箱进入 15s 重生'); else fail('道具箱未失效');
  if (pickup.boxActiveAfter) ok('15s 后道具箱重生'); else fail('道具箱未重生');

  console.log('--- Step 6: 蘑菇（+40% 加速 3s） ---');
  const mush = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    const savedAis = g.ais;
    g.ais = [];
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 0; p.angle = 0;
    p.item = 'mushroom';
    g.keys.item = true;
    g.testStep(1 / 60, 1);
    const timerAfterUse = p.mushroomTimer;
    const itemAfter = p.item;
    for (let f = 0; f < 60 * 2; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    const speed = p.speed;
    const timerLeft = p.mushroomTimer;
    g.ais = savedAis;
    return { timerAfterUse: +timerAfterUse.toFixed(2), itemAfter, speed: +speed.toFixed(0), timerLeft: +timerLeft.toFixed(2) };
  });
  if (mush.timerAfterUse >= 2.9 && mush.itemAfter === null) ok('使用蘑菇（3s 计时开始，道具消耗）');
  else fail('蘑菇使用异常: timer=' + mush.timerAfterUse + ' item=' + mush.itemAfter);
  if (mush.speed > 310) ok('蘑菇加速生效: 2s 后 ' + mush.speed + ' km/h（突破 300）');
  else fail('蘑菇加速不足: ' + mush.speed);
  if (mush.timerLeft > 0.5) ok('蘑菇效果持续中（剩余 ' + mush.timerLeft + 's）'); else fail('蘑菇时长异常: ' + mush.timerLeft);

  console.log('--- Step 6: 龟壳（命中打滑 1s） ---');
  const shell = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    PowerUp.boxes = []; // 禁用道具箱（避免 AI 拾取/使用道具干扰本用例）
    const savedAis = g.ais;
    const ai0 = savedAis[0];
    g.ais = [ai0];
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 0; p.angle = 0;
    ai0.x = 345; ai0.y = 478; ai0.speed = 0; ai0.angle = 0; ai0.slipTimer = 0;
    p.item = 'shell';
    g.keys.item = true;
    let slipSeen = 0, shellsLeft = 99, slipSpeed = 999;
    for (let f = 0; f < 120; f++) {
      g.testStep(1 / 60, 1);
      if (ai0.slipTimer > 0.9) {
        slipSeen = Math.max(slipSeen, ai0.slipTimer);
        slipSpeed = Math.min(slipSpeed, ai0.speed);
      }
      if (f === 1) shellsLeft = g.shells.length;
    }
    const res = { slipSeen: +slipSeen.toFixed(2), shellsLeft, aiAngleChanged: Math.abs(ai0.angle) > 0.1, aiSpeed: +slipSpeed.toFixed(0), shellsRemaining: g.shells.length };
    g.ais = savedAis;
    return res;
  });
  if (shell.shellsLeft === 1) ok('使用龟壳发射（弹体生成）'); else fail('龟壳未发射: ' + shell.shellsLeft);
  if (shell.slipSeen > 0.9) ok('龟壳命中 AI → 打滑 ' + shell.slipSeen + 's');
  else fail('龟壳未命中: slip=' + shell.slipSeen);
  if (shell.shellsRemaining === 0) ok('命中后龟壳消失'); else fail('龟壳未消失: ' + shell.shellsRemaining);
  if (shell.aiSpeed < 60) ok('打滑中 AI 速度骤降 (' + shell.aiSpeed + ' km/h)'); else fail('AI 未减速: ' + shell.aiSpeed);

  console.log('--- Step 6: 香蕉皮（减速 60% 0.5s） ---');
  const banana = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    PowerUp.boxes = []; // 禁用道具箱（避免 AI 拾取/使用道具干扰本用例）
    const savedAis = g.ais;
    g.ais = [];
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 100; p.angle = 0;
    p.item = 'banana';
    g.keys.item = true;
    g.testStep(1 / 60, 1);
    const bananaPos = g.bananas[0] ? { x: +g.bananas[0].x.toFixed(0), y: +g.bananas[0].y.toFixed(0) } : null;
    // 玩家开回自己放的香蕉（允许自踩）
    p.x = bananaPos.x; p.y = bananaPos.y; p.speed = 200;
    for (let f = 0; f < 10; f++) g.testStep(1 / 60, 1);
    const res = { bananaPos, slowTimer: +p.slowTimer.toFixed(2), speed: +p.speed.toFixed(0), bananasLeft: g.bananas.length };
    g.ais = savedAis;
    return res;
  });
  if (banana.bananaPos) ok('使用香蕉放在身后 (' + banana.bananaPos.x + ',' + banana.bananaPos.y + ')');
  else fail('香蕉未放置');
  if (banana.slowTimer > 0.2) ok('踩中香蕉 → 减速 0.5s（剩余 ' + banana.slowTimer + 's）');
  else fail('香蕉减速未生效: ' + banana.slowTimer);
  if (banana.speed < 130) ok('速度降至 ' + banana.speed + ' km/h（原 200，减速 ≥60%）');
  else fail('减速不足: ' + banana.speed);
  if (banana.bananasLeft === 0) ok('踩中后香蕉消失'); else fail('香蕉未消失');

  console.log('--- Step 6: AI 使用道具 ---');
  const aiUse = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    PowerUp.boxes = []; // 禁用道具箱（避免 AI 拾取/使用道具干扰本用例）
    const savedAis = g.ais;
    const ai0 = savedAis[0];
    g.ais = [ai0];
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
    ai0.x = 300; ai0.y = 478; ai0.speed = 0; ai0.angle = 0;
    ai0.item = 'mushroom';
    const origRandom = Math.random;
    Math.random = () => 0; // 保证随机判定命中（0 < 0.4*difficulty*dt）
    for (let f = 0; f < 5; f++) g.testStep(1 / 60, 1);
    Math.random = origRandom;
    const res = { item: ai0.item, mushTimer: +ai0.mushroomTimer.toFixed(2) };
    g.ais = savedAis;
    return res;
  });
  if (aiUse.item === null && aiUse.mushTimer >= 2.9) ok('AI 随机使用道具（概率 40%×难度/秒，频率随难度提升）');
  else fail('AI 未使用道具: item=' + aiUse.item + ' timer=' + aiUse.mushTimer);

  // 无道具时使用为空操作
  const noop = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
    const p = g.player;
    p.item = null;
    g.keys.item = true;
    g.testStep(1 / 60, 1);
    return { item: p.item, mushroomTimer: p.mushroomTimer };
  });
  if (noop.item === null) ok('无道具时按 Z 为空操作（无报错）'); else fail('无道具使用异常');

  if (errors.length) fail('页面错误: ' + errors.join('; ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 6 测试：未通过 ===' : '=== Step 6 测试：全部通过 ✅ ===');
})();
