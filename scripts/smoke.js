/* 冒烟测试：Step 1 回归（菜单/状态机）+ Step 2（驾驶/转向/出界碰撞） */
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  await page.goto(url);
  await page.waitForTimeout(300);

  console.log('--- Step 1 回归 ---');
  const title = await page.title();
  if (title.includes('马力欧赛车')) ok('页面标题正确'); else fail('页面标题缺失');
  if (await page.locator('#startBtn').isVisible()) ok('开始按钮可见'); else fail('开始按钮不可见');
  if (await page.locator('#gameCanvas').isVisible()) ok('Canvas 可见'); else fail('Canvas 不可见');

  await page.click('#startBtn');
  await page.waitForTimeout(100);
  if ((await page.getAttribute('body', 'data-state')) === 'racing') ok('点击开始后状态 = racing'); else fail('状态应为 racing');
  if ((await page.textContent('#speedValue')).trim() === '0') ok('初始速度 = 0'); else fail('初始速度错误');
  if ((await page.textContent('#lapText')).trim() === 'Lap 0/3') ok('初始圈数 = Lap 0/3'); else fail('初始圈数错误');

  console.log('--- Step 2: 玩家驾驶 ---');

  // T-加速：按住 ↑ 1 秒 → 速度 > 0，位置向右移动
  const x0 = await page.evaluate(() => window.__GAME__.player.x);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowUp');
  const speed1 = Number(await page.textContent('#speedValue'));
  const x1 = await page.evaluate(() => window.__GAME__.player.x);
  if (speed1 > 50) ok('加速后速度 = ' + speed1 + ' km/h (>50)'); else fail('加速后速度不足: ' + speed1);
  if (x1 > x0 + 10) ok('车辆位置前移 ' + (x1 - x0).toFixed(1) + 'px'); else fail('车辆未前移: ' + x0 + '→' + x1);

  // T-转向：按住 → 0.4 秒 → 朝向角变化
  const a0 = await page.evaluate(() => window.__GAME__.player.angle);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  const a1 = await page.evaluate(() => window.__GAME__.player.angle);
  if (Math.abs(a1 - a0) > 0.3) ok('转向生效：角度变化 ' + Math.abs(a1 - a0).toFixed(2) + ' rad'); else fail('转向未生效: ' + a0 + '→' + a1);

  // T-刹车：按住 ↓ 1 秒 → 速度下降
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowDown');
  const speed2 = Number(await page.textContent('#speedValue'));
  if (speed2 < speed1 * 0.8) ok('刹车生效：' + speed1 + ' → ' + speed2); else fail('刹车无效: ' + speed1 + '→' + speed2);

  console.log('--- Step 2: 边界碰撞 ---');

  // T-出界：瞬移到草地上 + 高速 → 速度降 ≥20%，且位置被拉回赛道边缘
  await page.evaluate(() => {
    const p = window.__GAME__.player;
    p.x = 880; p.y = 210; p.angle = 0; p.speed = 200; // 右上角草地
  });
  await page.waitForTimeout(500);
  const off = await page.evaluate(() => {
    const p = window.__GAME__.player;
    const near = window.__GAME__.track.nearest(p.x, p.y);
    return { speed: p.speed, dist: near.dist, hw: near.hw, offTrack: p.offTrack };
  });
  if (off.speed <= 200 * 0.8) ok('出界速度骤降: 200 → ' + off.speed.toFixed(1) + ' (降 ' + (100 * (1 - off.speed / 200)).toFixed(0) + '%)');
  else fail('出界减速不足: ' + off.speed);
  if (off.dist <= off.hw + 4) ok('位置被拉回赛道边缘 (距中心 ' + off.dist.toFixed(1) + ' ≤ 半宽 ' + off.hw.toFixed(1) + '+4)');
  else fail('未被拉回赛道: dist=' + off.dist.toFixed(1) + ' hw=' + off.hw);

  // T-回到赛道内行驶无异常
  await page.evaluate(() => {
    const p = window.__GAME__.player;
    p.x = 300; p.y = 478; p.angle = 0; p.speed = 0;
  });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowUp');
  const onT = await page.evaluate(() => ({ speed: window.__GAME__.player.speed, off: window.__GAME__.player.offTrack }));
  if (onT.speed > 60 && !onT.off) ok('赛道内正常加速 (' + onT.speed.toFixed(0) + ' km/h, 非出界)'); else fail('赛道内异常: ' + JSON.stringify(onT));

  // 截图（人工视觉检查赛道形状/路肩/装饰）
  const shotDir = path.resolve(__dirname, '..', 'artifacts');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'step2-track.png') });
  ok('截图已保存 artifacts/step2-track.png');

  // 回归：finish/restart 状态机
  await page.evaluate(() => window.__GAME__.finish());
  await page.click('#restartBtn');
  await page.waitForTimeout(100);
  const st = await page.getAttribute('body', 'data-state');
  const sp = (await page.textContent('#speedValue')).trim();
  if (st === 'racing' && sp === '0') ok('重新开始归零'); else fail('重新开始异常: ' + st + '/' + sp);

  if (errors.length) fail('页面错误:\n' + errors.join('\n')); else ok('无 console/页面错误');

  await browser.close();
  console.log(process.exitCode ? '=== 冒烟测试：未通过 ===' : '=== 冒烟测试：全部通过 ✅ ===');
})();
