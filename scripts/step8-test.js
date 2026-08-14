/* Step 8 测试：指针速度表 / 小地图（像素验证）/ 分段计时 / 排行榜 / 对手时间差 */
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

  console.log('--- Step 8: 指针式速度表 ---');
  const gauge = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player;
    const canvas = g.canvas;
    const ctx = g.ctx;
    function redAt(x, y) {
      // 在 (x,y) 周围 5×5 找红色像素（指针）
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const d = ctx.getImageData(x + dx, y + dy, 1, 1).data;
          if (d[0] > 170 && d[1] < 120 && d[2] < 120) return true;
        }
      }
      return false;
    }
    // 速度 0：指针指向左侧 (38,548)；速度 300：指向右侧 (146,548)
    p.speed = 0; p.x = 300; p.y = 478;
    g.render();
    const left = redAt(38, 548);
    p.speed = 300;
    g.render();
    const right = redAt(146, 548);
    p.speed = 0;
    return { left, right };
  });
  if (gauge.left) ok('速度表指针指向左侧（速度 0）');
  else fail('速度 0 指针位置异常');
  if (gauge.right) ok('速度表指针指向右侧（速度 300，0~300 刻度）');
  else fail('速度 300 指针位置异常');

  console.log('--- Step 8: 小地图 ---');
  const minimap = await page.evaluate(() => {
    const g = window.__GAME__;
    const ctx = g.ctx;
    const p = g.player;
    // 玩家红点映射 ≈ (830,140)；赛道线采样 (884,110)；背景 (800,54)
    p.x = 230; p.y = 475; p.speed = 0;
    g.render();
    const px = (x, y) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const playerDot = px(830, 140);
    const trackLine = px(884, 110);
    const bg = px(800, 54);
    return { playerDot, trackLine, bg };
  });
  if (minimap.playerDot[0] > 180 && minimap.playerDot[1] < 110)
    ok('小地图玩家红点渲染 (rgb ' + minimap.playerDot.join(',') + ')');
  else fail('小地图红点异常: ' + minimap.playerDot.join(','));
  if (minimap.trackLine[0] > 140 && minimap.trackLine[1] > 140)
    ok('小地图赛道线渲染 (rgb ' + minimap.trackLine.join(',') + ')');
  else fail('小地图赛道线异常: ' + minimap.trackLine.join(','));
  if (minimap.bg[0] < 60) ok('小地图深色背景'); else fail('小地图背景异常: ' + minimap.bg.join(','));

  console.log('--- Step 8: 分段计时 ---');
  const split = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.keys.up = true;
    const T = g.track;
    let lap1Text = '', lap2Text = '', lap2Color = '', afterHide = '';
    for (let f = 0; f < 60 * 200 && g.lap < 1; f++) {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      g.testStep(1 / 60, 1);
    }
    lap1Text = document.getElementById('splitText').textContent;
    for (let f = 0; f < 60 * 200 && g.lap < 2; f++) {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      g.testStep(1 / 60, 1);
    }
    lap2Text = document.getElementById('splitText').textContent;
    lap2Color = document.getElementById('splitText').className;
    // 4 秒后应隐藏
    for (let f = 0; f < 60 * 5; f++) g.testStep(1 / 60, 1);
    afterHide = document.getElementById('splitText').style.visibility;
    g.keys.up = g.keys.left = g.keys.right = false;
    return { lap1Text, lap2Text, lap2Color, afterHide };
  });
  if (/本圈 \d+\.\d+s/.test(split.lap1Text)) ok('首圈分段: "' + split.lap1Text + '"');
  else fail('首圈分段异常: ' + split.lap1Text);
  if (/▼|▲/.test(split.lap2Text)) ok('次圈分段对比: "' + split.lap2Text + '"（绿快/红慢）');
  else fail('次圈无对比箭头: ' + split.lap2Text);
  if (split.lap2Color === 'good' || split.lap2Color === 'bad')
    ok('颜色标记正确 (' + split.lap2Color + ')');
  else fail('颜色标记异常: ' + split.lap2Color);
  if (split.afterHide === 'hidden') ok('分段显示 4s 后自动隐藏'); else fail('未自动隐藏: ' + split.afterHide);

  console.log('--- Step 8: 对手相对位置 ---');
  const opp = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    // 让 AI 领先 20 采样
    g.ais.forEach(ai => { ai.progress += 20; ai.lap = 0; });
    g._updateOpponents();
    return document.getElementById('opponents').textContent;
  });
  if (/AI 1 [+\-]\d+\.\d+s/.test(opp)) ok('对手相对位置: "' + opp.trim() + '"');
  else fail('对手时间差异常: ' + opp);

  console.log('--- Step 8: 排行榜 ---');
  const lb = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset();
    g.keys.up = true;
    const T = g.track;
    for (let f = 0; f < 60 * 200 && g.state !== 'finished'; f++) {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      g.testStep(1 / 60, 1);
    }
    g.keys.up = g.keys.left = g.keys.right = false;
    const box = document.getElementById('leaderboardBox');
    return {
      state: g.state,
      visible: box.style.display !== 'none',
      html: box.innerHTML,
      records: JSON.parse(localStorage.getItem('marioKart.records') || '[]').length
    };
  });
  if (lb.state === 'finished' && lb.visible) ok('结束界面显示排行榜');
  else fail('排行榜未显示: state=' + lb.state + ' visible=' + lb.visible);
  if (/排行榜/.test(lb.html) && /圈/.test(lb.html)) ok('排行榜内容: "' + lb.html.replace(/<br>/g, ' | ').slice(0, 60) + '…"');
  else fail('排行榜内容异常: ' + lb.html);
  if (lb.records >= 1) ok('localStorage 排行记录 ' + lb.records + ' 条'); else fail('排行记录缺失');

  if (errors.length) fail('页面错误: ' + errors.join('; ')); else ok('无页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== Step 8 测试：未通过 ===' : '=== Step 8 测试：全部通过 ✅ ===');
})();
