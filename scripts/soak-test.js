/* 5 分钟浸泡测试：真实时间运行游戏（自动导航），监控 console/页面错误与帧数
 * 验证验收标准「手动游戏 5 分钟无报错、无卡顿」 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const DURATION_MS = 5 * 60 * 1000; // 5 分钟
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(300);
  await page.click('#startBtn');

  // 自动导航 + 帧计数
  await page.evaluate(() => {
    const g = window.__GAME__;
    const T = g.track;
    PowerUp.boxes = []; // 禁用道具箱（浸泡测试专注稳定性，避免道具随机性）
    g.keys.up = true;
    g.__frames = 0;
    const prevLoop = g.loop.bind(g);
    g.loop = (now) => {
      g.__frames++;
      prevLoop(now);
    };
    g.__autopilot = setInterval(() => {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
    }, 16);
  });

  const start = Date.now();
  await page.waitForTimeout(DURATION_MS);

  const r = await page.evaluate(() => {
    const g = window.__GAME__;
    clearInterval(g.__autopilot);
    return {
      frames: g.__frames,
      playerLap: g.lap,
      aiLaps: g.ais.map(ai => ai.lap),
      state: g.state,
      raceTimeSec: Math.round(g.raceTimeMs / 100) / 10
    };
  });
  const elapsed = Date.now() - start;
  await browser.close();

  console.log('--- 5 分钟浸泡测试 ---');
  console.log('  运行时长:', Math.round(elapsed / 1000), 's  游戏帧数:', r.frames, '(≈' + Math.round(r.frames / (elapsed / 1000)) + ' fps)');
  console.log('  玩家圈数:', r.playerLap, ' AI 圈数:', r.aiLaps.join('/'), ' 状态:', r.state);
  let pass = true;
  if (errors.length === 0) console.log('  ✓ 无 console 错误 / 页面异常（5 分钟）');
  else { console.error('  ✗ 存在错误:\n' + errors.slice(0, 10).join('\n')); pass = false; }
  if (r.frames > (elapsed / 1000) * 50) console.log('  ✓ 帧率正常（≥50fps，无卡顿冻结）');
  else { console.error('  ✗ 帧数异常偏低: ' + r.frames); pass = false; }
  if (r.playerLap >= 2) console.log('  ✓ 游戏正常推进（玩家完成 ' + r.playerLap + ' 圈）');
  else { console.error('  ✗ 游戏未正常推进: lap=' + r.playerLap); pass = false; }
  console.log(pass ? '=== 浸泡测试通过 ✅ ===' : '=== 浸泡测试失败 ===');
  process.exit(pass ? 0 : 1);
})();
