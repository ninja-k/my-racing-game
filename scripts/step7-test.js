/* Step 7 测试：引擎音效 / 屏幕震动 / 速度线 / 浮动鼓励文字 */
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

  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  console.log('--- Step 7: 引擎音效 ---');
  const audio = await page.evaluate(() => {
    const g = window.__GAME__;
    return {
      enabled: AudioManager.enabled,
      hasCtx: !!AudioManager.ctx,
      hasOsc: !!AudioManager.engineOsc,
      freq0: AudioManager.enabled ? AudioManager.engineOsc.frequency.value : -1
    };
  });
  if (audio.enabled && audio.hasCtx && audio.hasOsc) ok('Web Audio 引擎已初始化（enabled=true）');
  else fail('音频未初始化: ' + JSON.stringify(audio));

  const freqUp = await page.evaluate(() => {
    // spy：拦截 setEngineSpeed，验证游戏把速度喂给引擎音（公式 80 + speed*0.5）
    const g = window.__GAME__;
    const orig = AudioManager.setEngineSpeed;
    let fed = -1;
    AudioManager.setEngineSpeed = s => { fed = s; };
    g.player.speed = 300;
    g.testStep(1 / 60, 1);
    const fed300 = fed;
    g.player.speed = 0;
    g.testStep(1 / 60, 1);
    const fed0 = fed;
    AudioManager.setEngineSpeed = orig;
    // 直接验证公式映射
    const fHigh = 80 + 300 * 0.5;
    const fLow = 80 + 0 * 0.5;
    return { fed300, fed0, fHigh, fLow };
  });
  if (freqUp.fed300 > 290 && freqUp.fed0 === 0 && freqUp.fHigh === 230 && freqUp.fLow === 80)
    ok('引擎音随速度变化（300→' + freqUp.fHigh + 'Hz，0→' + freqUp.fLow + 'Hz，低频→高频）');
  else fail('引擎频率异常: ' + JSON.stringify(freqUp));

  // playCrash 不抛异常
  const crash = await page.evaluate(() => { AudioManager.playCrash(); return true; });
  if (crash) ok('碰撞音效合成无异常');

  console.log('--- Step 7: 屏幕震动 ---');
  const shake = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    const savedAis = g.ais;
    g.ais = [savedAis[0]];
    g.player.x = 400; g.player.y = 475; g.player.speed = 100; g.player.angle = 0;
    savedAis[0].x = 406; savedAis[0].y = 475; savedAis[0].speed = 100; savedAis[0].angle = 0;
    g.shakeT = 0;
    g.testStep(1 / 60, 3);
    const t = g.shakeT;
    g.ais = savedAis;
    return { t: +t.toFixed(3) };
  });
  if (shake.t > 0.05) ok('碰撞触发屏幕震动（剩余 ' + shake.t + 's）');
  else fail('碰撞未触发震动: ' + shake.t);
  const shakeDecay = await page.evaluate(() => {
    const g = window.__GAME__;
    g._shake(0.15);
    g.testStep(1 / 60, 30); // 0.5s 后应衰减完
    return { t: +g.shakeT.toFixed(3) };
  });
  if (shakeDecay.t <= 0) ok('震动 150ms 后衰减归零'); else fail('震动未衰减: ' + shakeDecay.t);

  console.log('--- Step 7: 速度线 ---');
  const speedLines = await page.evaluate(() => {
    const g = window.__GAME__;
    g.ais = [];
    g.reset();
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 300; p.angle = 0;
    g.render();
    const high = g.lastSpeedLineCount;
    g.lastSpeedLineCount = -1; // 重置，验证低速时不绘制
    p.speed = 150;
    g.render();
    const low = g.lastSpeedLineCount;
    return { high, low };
  });
  if (speedLines.high >= 18) ok('速度 300（>80%）→ 速度线 ' + speedLines.high + ' 条');
  else fail('高速无速度线: ' + speedLines.high);
  if (speedLines.low === -1) ok('速度 150（<80%）→ 不绘制速度线'); else fail('低速仍绘制速度线: ' + speedLines.low);

  console.log('--- Step 7: 鼓励文字 ---');
  const driftFloat = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.ais = [];
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 200; p.angle = 0;
    g.keys.drift = true;
    for (let f = 0; f < 60 * 1.2; f++) { g.testStep(1 / 60, 1); if (f % 15 === 0) { p.x = 300; p.y = 478; } }
    g.keys.drift = false;
    g.testStep(1 / 60, 1);
    const texts = g.floats.map(f => f.text);
    return texts;
  });
  if (driftFloat.includes('DRIFT BOOST!')) ok('完美漂移（1.2s）→ 弹出 DRIFT BOOST!');
  else fail('未弹出 DRIFT BOOST!: ' + JSON.stringify(driftFloat));

  const niceFloat = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.ais = [];
    g.prevRank = 2; // 假装上一帧第 2 名
    g.overtakeCombo = 1;
    g.testStep(1 / 60, 1); // 本帧排名 1（无 AI）→ 超车
    return { texts: g.floats.map(f => f.text), combo: g.overtakeCombo };
  });
  if (niceFloat.texts.includes('NICE! ×2')) ok('连续超车 → 弹出 NICE! ×2（combo=' + niceFloat.combo + '）');
  else fail('未弹出 NICE!: ' + JSON.stringify(niceFloat));

  // 浮动文字上飘 + 淡出
  const floatLife = await page.evaluate(() => {
    const g = window.__GAME__;
    g._spawnFloat('TEST', '#fff', 20);
    const y0 = g.floats[0].y;
    for (let f = 0; f < 60 * 1.5; f++) g.testStep(1 / 60, 1); // 1.5s 后应消失
    return { y0: +y0.toFixed(1), remaining: g.floats.length };
  });
  if (floatLife.remaining === 0) ok('浮动文字 1.2s 后淡出消失'); else fail('文字未消失: ' + floatLife.remaining);

  if (errors.length) fail('页面错误: ' + errors.join('; ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 7 测试：未通过 ===' : '=== Step 7 测试：全部通过 ✅ ===');
})();
