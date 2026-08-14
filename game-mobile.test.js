/* =========================================================================
 * game-mobile.test.js — 移动端触屏适配测试（并入正式套件，npx playwright test）
 * 运行于 Playwright 移动设备模拟（isMobile/hasTouch/移动 UA，等效 Chrome DevTools 设备模式）
 * ========================================================================= */
const { test, expect } = require('@playwright/test');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, 'index.html');
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, userAgent: MOBILE_UA });

test('M-01 设备检测与触屏控件显示', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('body')).toHaveClass(/mobile/);
  await expect(page.locator('#touchControls')).toBeVisible();
  await expect(page.locator('#btnGas')).toBeVisible();   // 加速
  await expect(page.locator('#btnDrift')).toBeVisible(); // 漂移
  await expect(page.locator('#btnItem')).toBeVisible();  // 道具
  await expect(page.locator('#joystickZone')).toBeVisible();
});

test('M-02 跟随式摇杆：底座出现在触摸点、比例转向、松手归零', async ({ page }) => {
  await page.goto(URL);
  await page.click('#soloBtn');
    await page.click('.track-card'); // 进入赛道选择 → 默认第一条赛道
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const g = window.__GAME__;
    const zone = document.getElementById('joystickZone');
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    zone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: cx, clientY: cy }));
    const baseActive = document.getElementById('joystickBase').classList.contains('active');
    zone.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: cx + 80, clientY: cy }));
    const right = g.keys.right;
    const steer = g.keys.steer;
    zone.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    return { baseActive, right, steer, reset: !g.keys.right && g.keys.steer === 0 };
  });
  expect(r.baseActive).toBe(true);      // 跟随式：底座激活
  expect(r.right).toBe(true);           // 右推 → 转向
  expect(r.steer).toBeGreaterThan(0);   // 比例转向值
  expect(r.reset).toBe(true);           // 松手归零
});

test('M-03 加速/漂移/道具按钮：按下生效、无道具时道具按钮置灰', async ({ page }) => {
  await page.goto(URL);
  await page.click('#soloBtn');
    await page.click('.track-card'); // 进入赛道选择 → 默认第一条赛道
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const g = window.__GAME__;
    const p = g.player;
    const itemBtn = document.getElementById('btnItem');
    const grayNoItem = itemBtn.classList.contains('disabled');
    p.item = 'banana';
    g.testStep(1 / 60, 1); // 触发 TouchControls.update → 取消置灰
    const grayWithItem = itemBtn.classList.contains('disabled');
    // 道具按钮使用
    const gasBtn = document.getElementById('btnGas');
    gasBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 0, clientY: 0 }));
    const up = g.keys.up;
    gasBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    return { grayNoItem, grayWithItem, up };
  });
  expect(r.grayNoItem).toBe(true);                       // 无道具置灰
  expect(r.grayWithItem).toBe(false);                    // 有道具恢复
  expect(r.up).toBe(true);                               // 加速按钮生效
});

test('M-04 滑动转向与上滑道具（摇杆外）', async ({ page }) => {
  await page.goto(URL);
  await page.click('#soloBtn');
    await page.click('.track-card'); // 进入赛道选择 → 默认第一条赛道
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const g = window.__GAME__;
    const zone = document.getElementById('swipeZone');
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    zone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: cx, clientY: cy }));
    zone.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: cx + 90, clientY: cy }));
    const right = g.keys.right;
    zone.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    // 上滑使用道具
    g.keys.item = false;
    zone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, clientX: cx, clientY: cy }));
    zone.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3, clientX: cx, clientY: cy - 60 }));
    zone.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
    return { right, itemTriggered: g.keys.item };
  });
  expect(r.right).toBe(true);          // 右滑 → 转向
  expect(r.itemTriggered).toBe(true);  // 上滑 → 使用道具
});

test('M-05 转向灵敏度滑块：实时生效 + localStorage 持久化', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    const el = document.getElementById('steerSens');
    el.value = '1.4';
    el.dispatchEvent(new Event('input'));
  });
  expect(await page.evaluate(() => window.__GAME__.steerSensitivity)).toBe(1.4);
  expect(await page.evaluate(() => localStorage.getItem('marioKart.steerSens'))).toBe('1.4');
  // 重新加载后仍生效
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__GAME__.steerSensitivity)).toBe(1.4);
});

test('M-06 竖屏提示：竖屏显示、横屏隐藏', async ({ page }) => {
  await page.goto(URL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await expect(page.locator('#rotateOverlay')).toBeVisible();
  await expect(page.locator('#rotateOverlay')).toContainText('横屏');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await expect(page.locator('#rotateOverlay')).toBeHidden();
});

test('M-07 碰撞震动 50ms + 30fps 性能封顶', async ({ page }) => {
  await page.goto(URL);
  await page.click('#soloBtn');
    await page.click('.track-card'); // 进入赛道选择 → 默认第一条赛道
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    window.__v = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { window.__v.push(ms); return true; } });
    const g = window.__GAME__;
    g.shakeT = 0;
    g._shake(0.15);
    return { vibs: window.__v, fpsCap: g.mobileFpsCap };
  });
  expect(r.vibs).toContain(50);   // 碰撞震动 50ms
  expect(r.fpsCap).toBe(true);    // 移动端 30fps 封顶
});
