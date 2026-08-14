/* 赛道可驾驶性验证：自动导航跑圈，统计跨线次数（应为 ≥1 圈） */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(300);
  await page.click('#startBtn');

  await page.evaluate(() => {
    const g = window.__GAME__;
    const T = g.track;
    PowerUp.boxes = []; // 禁用道具箱（避免 AI 道具干扰纯驾驶验证）
    g.ais.forEach(a => { a.item = null; a.mushroomTimer = 0; a.slipTimer = 0; a.slowTimer = 0; });
    g.shells = []; g.bananas = [];
    g.keys.up = true; // 持续加速
    let prevIdx = g.player.lastOnIdx;
    g.__wraps = 0;
    g.__maxSpeedSeen = 0;
    g.__autopilot = setInterval(() => {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      // 跨线检测：索引从大(>200)跳回小(<50) 说明过了起点
      if (prevIdx > 200 && near.idx < 50) g.__wraps++;
      prevIdx = near.idx;
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      const targetAng = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      let d = targetAng - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      if (p.speed > g.__maxSpeedSeen) g.__maxSpeedSeen = p.speed;
    }, 16);
  });

  await page.waitForTimeout(45000);

  const r = await page.evaluate(() => {
    clearInterval(window.__GAME__.__autopilot);
    const p = window.__GAME__.player;
    const near = window.__GAME__.track.nearest(p.x, p.y);
    return {
      wraps: window.__GAME__.__wraps,
      maxSpeed: Math.round(window.__GAME__.__maxSpeedSeen),
      finalSpeed: Math.round(p.speed),
      finalDist: +near.dist.toFixed(1),
      finalHw: +near.hw.toFixed(1),
      raceTime: Math.round(window.__GAME__.raceTimeMs / 100) / 10
    };
  });

  console.log('--- 自动导航跑圈测试 (45s) ---');
  console.log('  跨线次数 (圈数):', r.wraps);
  console.log('  全程最高速度:', r.maxSpeed, 'km/h');
  console.log('  结束时位置: 距赛道中心', r.finalDist, '/ 半宽', r.finalHw);
  console.log('  比赛计时:', r.raceTime, 's');

  let pass = true;
  if (r.wraps >= 1) console.log('  ✓ 完成 ≥1 圈，赛道可完整驾驶');
  else { console.error('  ✗ 未完成整圈'); pass = false; }
  if (r.finalDist <= r.finalHw + 6) console.log('  ✓ 结束时车辆在赛道内');
  else { console.error('  ✗ 结束时车辆卡在赛道外'); pass = false; }

  await browser.close();
  console.log(pass ? '=== 可驾驶性验证通过 ✅ ===' : '=== 可驾驶性验证失败 ===');
  process.exit(pass ? 0 : 1);
})();
