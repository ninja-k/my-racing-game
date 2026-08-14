/* Step 3 测试：圈数检测（4 检测点）/ 计时器 / 3 圈结束界面 / 排行榜存储 / 重开归零 */
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
  console.log('--- Step 3: 圈数 / 计时 / 结束 ---');

  // 初始：Lap 0/3，计时走动
  let lapTxt = (await page.textContent('#lapText')).trim();
  if (lapTxt === 'Lap 0/3') ok('初始圈数 Lap 0/3'); else fail('初始圈数错误: ' + lapTxt);

  // 自动导航 + testStep 快进，跑到第 1 圈
  const lap1 = await page.evaluate(() => {
    const g = window.__GAME__;
    g.keys.up = true;
    const T = g.track;
    let f = 0;
    for (; f < 60 * 60; f++) { // 最多模拟 60 秒
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      g.testStep(1 / 60, 1);
      if (g.lap >= 1) break;
    }
    return { lap: g.lap, frames: f, simTime: Math.round(g.raceTimeMs / 100) / 10 };
  });
  lapTxt = (await page.textContent('#lapText')).trim();
  if (lapTxt === 'Lap 1/3') ok('绕完一圈后 HUD 显示 Lap 1/3（模拟 ' + lap1.simTime + 's 完成首圈）');
  else fail('首圈后应为 Lap 1/3, 实际 ' + lapTxt + ' (lap=' + lap1.lap + ')');

  // 继续跑到结束（3 圈）
  const fin = await page.evaluate(() => {
    const g = window.__GAME__;
    const T = g.track;
    let f = 0;
    for (; f < 60 * 180; f++) {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      g.testStep(1 / 60, 1);
      if (g.state === 'finished') break;
    }
    return {
      state: g.state, lap: g.lap,
      lapTimes: g.lapTimes.map(t => Math.round(t / 100) / 10),
      simTime: Math.round(g.raceTimeMs / 100) / 10,
      frames: f
    };
  });

  const state = await page.getAttribute('body', 'data-state');
  const finVisible = await page.locator('#finishedOverlay').evaluate(el => !el.classList.contains('hidden'));
  if (state === 'finished' && finVisible) ok('3 圈完成 → 结束界面出现 (state=finished)');
  else fail('3 圈后未进入结束界面: state=' + state + ' visible=' + finVisible);
  if (fin.lap === 3) ok('完成 3 圈');
  else fail('圈数应为 3, 实际 ' + fin.lap);
  if (fin.lapTimes.length === 3) ok('记录了 3 段单圈用时: ' + fin.lapTimes.join('s / ') + 's');
  else fail('单圈用时数量错误: ' + fin.lapTimes.length);

  // 结果文字 + 排行榜存储
  const result = await page.textContent('#resultText');
  if (result.includes('总用时') && result.includes('各圈')) ok('结果面板显示名次/总用时/各圈用时');
  else fail('结果面板内容不完整: ' + result);
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('marioKart.records') || '[]'));
  if (records.length === 1 && records[0].laps === 3) ok('localStorage 已存排行榜记录 (laps=3, ' + (records[0].totalMs / 1000).toFixed(1) + 's)');
  else fail('排行榜记录异常: ' + JSON.stringify(records));

  // 重新开始：所有状态归零（先释放全部按键）
  await page.evaluate(() => {
    const k = window.__GAME__.keys;
    k.up = k.down = k.left = k.right = false;
  });
  await page.click('#restartBtn');
  await page.waitForTimeout(100);
  const st2 = await page.getAttribute('body', 'data-state');
  const lapTxt2 = (await page.textContent('#lapText')).trim();
  const timer2 = (await page.textContent('#timerText')).trim();
  const speed2 = (await page.textContent('#speedValue')).trim();
  const overlayHidden = await page.locator('#finishedOverlay').evaluate(el => el.classList.contains('hidden'));
  if (st2 === 'racing' && lapTxt2 === 'Lap 0/3' && speed2 === '0' && overlayHidden)
    ok('重新开始 → racing / Lap 0/3 / 速度 0 / 结束界面隐藏');
  else fail('重新开始未归零: ' + JSON.stringify({ st2, lapTxt2, timer2, speed2, overlayHidden }));
  await page.waitForTimeout(700);
  const timer3 = (await page.textContent('#timerText')).trim();
  if (timer3 !== '00:00.0') ok('计时器重新走时: ' + timer3); else fail('计时器未重新走动');

  if (errors.length) fail('页面错误: ' + errors.join('; ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 3 测试：未通过 ===' : '=== Step 3 测试：全部通过 ✅ ===');
})();
