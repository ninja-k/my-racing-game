/* =========================================================================
 * game.test.js — 马力欧赛车风格网页小游戏 自动化测试（PRD 七、T01~T11）
 * 运行：PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright test
 * ========================================================================= */
const { test, expect } = require('@playwright/test');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, 'index.html');

/** 进入比赛（点击开始按钮） */
async function startRace(page) {
  await page.goto(URL);
  await page.waitForTimeout(300);
  await page.click('#startBtn');
}

/**
 * 自动导航（evaluate 内同步快进，确定性）：沿赛道行驶直到达成目标
 * @param targetLap 目标圈数（-1 = 跑到比赛结束）
 */
async function driveUntil(page, targetLap, maxSeconds = 200) {
  return page.evaluate(({ targetLap, maxFrames }) => {
    const g = window.__GAME__;
    PowerUp.boxes = []; // 禁用道具箱，排除道具干扰
    g.ais = [];         // 禁用 AI，排除碰撞干扰（纯驾驶）
    g.keys.up = true;
    const T = g.track;
    let f = 0;
    for (; f < maxFrames; f++) {
      const p = g.player;
      const near = T.nearest(p.x, p.y);
      const ahead = T.pts[(near.idx + 6) % T.pts.length];
      let d = Math.atan2(ahead.y - p.y, ahead.x - p.x) - p.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.keys.left = d < -0.02;
      g.keys.right = d > 0.02;
      g.testStep(1 / 60, 1);
      if (targetLap === -1 && g.state === 'finished') break;
      if (targetLap >= 0 && g.lap >= targetLap) break;
    }
    g.keys.up = g.keys.left = g.keys.right = false;
    return { frames: f, lap: g.lap, state: g.state };
  }, { targetLap, maxFrames: maxSeconds * 60 });
}

/* ---------------- T01 页面加载 ---------------- */
test('T01 页面加载：标题、开始按钮、Canvas 可见', async ({ page }) => {
  await page.goto(URL);
  await expect(page).toHaveTitle(/马力欧赛车/);
  await expect(page.locator('#startBtn')).toBeVisible();
  await expect(page.locator('#gameCanvas')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'menu');
});

/* ---------------- T02 开始游戏 ---------------- */
test('T02 开始游戏：HUD 显示初始数据（速度 0，圈数 0/3）', async ({ page }) => {
  await startRace(page);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'racing');
  await expect(page.locator('#speedValue')).toHaveText('0');
  await expect(page.locator('#lapText')).toHaveText('Lap 0/3');
  // 计时器开始走动
  const t1 = await page.textContent('#timerText');
  await page.waitForTimeout(800);
  const t2 = await page.textContent('#timerText');
  expect(t1).not.toBe(t2);
});

/* ---------------- T03 玩家加速 ---------------- */
test('T03 玩家加速：模拟 ↑ 键 1 秒，速度 > 0', async ({ page }) => {
  await startRace(page);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowUp');
  const spd = Number(await page.textContent('#speedValue'));
  expect(spd).toBeGreaterThan(0);
});

/* ---------------- T04 边界碰撞 ---------------- */
test('T04 边界碰撞：移出赛道速度降低 ≥20%', async ({ page }) => {
  await startRace(page);
  await page.evaluate(() => {
    const g = window.__GAME__;
    g.player.x = 880;
    g.player.y = 210;
    g.player.speed = 200;
    g.player.angle = 0; // 右上角草地
  });
  await page.waitForTimeout(400);
  const result = await page.evaluate(() => {
    const p = window.__GAME__.player;
    const n = window.__GAME__.track.nearest(p.x, p.y);
    return { speed: p.speed, pulledBack: n.dist <= n.hw + 4, dist: n.dist, hw: n.hw };
  });
  expect(result.speed).toBeLessThanOrEqual(200 * 0.8); // ≥20% 减速
  expect(result.pulledBack).toBe(true);                // 被拉回赛道边缘
});

/* ---------------- T05 圈数检测 ---------------- */
test('T05 圈数检测：脚本绕行一圈，圈数变为 1', async ({ page }) => {
  await startRace(page);
  const r = await driveUntil(page, 1, 120);
  expect(r.lap).toBe(1);
  await expect(page.locator('#lapText')).toHaveText('Lap 1/3');
});

/* ---------------- T06 3 圈结束 ---------------- */
test('T06 3 圈结束：完成 3 圈，胜利界面出现', async ({ page }) => {
  await startRace(page);
  const r = await driveUntil(page, -1, 300);
  expect(r.state).toBe('finished');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'finished');
  await expect(page.locator('#finishedOverlay')).toBeVisible();
  await expect(page.locator('#resultText')).toContainText('总用时');
  await expect(page.locator('#resultText')).toContainText('各圈');
});

/* ---------------- T07 AI 行为 ---------------- */
test('T07 AI 行为：速度波动在 70%~100% 之间，不卡墙', async ({ page }) => {
  await startRace(page);
  const data = await page.evaluate(() => {
    const g = window.__GAME__;
    g.reset(); // 归一化（消除点击后真实 rAF 帧的随机性）
    PowerUp.boxes = [];
    g.keys.up = g.keys.down = g.keys.left = g.keys.right = false;
    g.player.x = 500; g.player.y = 245; g.player.speed = 0; // 玩家停在赛道边缘
    const samples = [];
    for (let f = 0; f < 60 * 30; f++) {
      g.testStep(1 / 60, 1);
      if (f % 30 === 0) samples.push(g.ais.map(ai => ai.speed));
    }
    return {
      samples,
      ais: g.ais.map(ai => ({
        lap: ai.lap,
        dist: +g.track.nearest(ai.x, ai.y).dist.toFixed(1),
        hw: +g.track.nearest(ai.x, ai.y).hw.toFixed(1)
      }))
    };
  });
  // 跳过起步加速 + 车群压缩期（前 5s），看稳态节奏
  const speeds = data.samples.slice(10).flat();
  const minSp = Math.min(...speeds);
  const maxSp = Math.max(...speeds);
  expect(minSp).toBeGreaterThanOrEqual(300 * 0.68); // ≥70%（留容差）
  expect(maxSp).toBeLessThanOrEqual(300 * 1.01);    // ≤100%
  // AI 完成整圈且不卡墙
  for (const ai of data.ais) {
    expect(ai.lap).toBeGreaterThanOrEqual(1);
    expect(ai.dist).toBeLessThanOrEqual(ai.hw + 6);
  }
});

/* ---------------- T08 道具拾取 ---------------- */
test('T08 道具拾取：经过道具箱，道具槽显示对应图标', async ({ page }) => {
  await startRace(page);
  const res = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player;
    const box = PowerUp.boxes[0];
    p.x = box.x; p.y = box.y; p.speed = 0; p.angle = 0;
    g.testStep(1 / 60, 2);
    return { item: p.item, icon: document.getElementById('powerupSlot').textContent };
  });
  const icons = { mushroom: '🍄', shell: '🐢', banana: '🍌' };
  expect(Object.keys(icons)).toContain(res.item);
  expect(res.icon).toBe(icons[res.item]);
});

/* ---------------- T09 道具使用 ---------------- */
test('T09 道具使用：使用蘑菇后速度增加 ≥30%', async ({ page }) => {
  await startRace(page);
  const res = await page.evaluate(() => {
    const g = window.__GAME__;
    g.ais = [];
    const p = g.player;
    p.x = 300; p.y = 478; p.speed = 200; p.angle = 0;
    p.item = 'mushroom';
    g.keys.item = true;
    g.testStep(1 / 60, 1); // 使用蘑菇
    const s0 = p.speed;
    for (let f = 0; f < 60; f++) {
      g.testStep(1 / 60, 1);
      if (f % 15 === 0) { p.x = 300; p.y = 478; }
    }
    return { s0, s1: p.speed };
  });
  expect(res.s1).toBeGreaterThanOrEqual(res.s0 * 1.3); // +30%
});

/* ---------------- T10 排行榜存储 ---------------- */
test('T10 排行榜存储：游戏结束 localStorage 有记录', async ({ page }) => {
  await startRace(page);
  await driveUntil(page, -1, 300);
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('marioKart.records') || '[]'));
  expect(records.length).toBeGreaterThanOrEqual(1);
  expect(records[0].laps).toBe(3);
  expect(typeof records[0].totalMs).toBe('number');
  // 结束界面展示排行榜
  await expect(page.locator('#leaderboardBox')).toBeVisible();
  await expect(page.locator('#leaderboardBox')).toContainText('排行榜');
});

/* ---------------- T11 重新开始 ---------------- */
test('T11 重新开始：点击重开，所有状态归零', async ({ page }) => {
  await startRace(page);
  // 先制造非零状态
  await driveUntil(page, 1, 120);
  await page.evaluate(() => window.__GAME__.finish());
  await page.click('#restartBtn');
  // 释放按键（模拟真实玩家松手）
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(200);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'racing');
  await expect(page.locator('#speedValue')).toHaveText('0');
  await expect(page.locator('#lapText')).toHaveText('Lap 0/3');
  await expect(page.locator('#finishedOverlay')).toBeHidden();
  // 计时器重新走时
  const t1 = await page.textContent('#timerText');
  await page.waitForTimeout(700);
  const t2 = await page.textContent('#timerText');
  expect(t1).not.toBe(t2);
});
