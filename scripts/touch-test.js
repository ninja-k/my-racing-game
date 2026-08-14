/* Step 9 测试：手机触屏适配（Playwright 设备模拟 = Chrome DevTools 手机模式等价）
 * 覆盖：设备检测 / 摇杆转向 / 加速·漂移按钮 / UI 缩放 / 竖屏提示 / 震动 / PC 键盘共存 */
const { chromium } = require('@playwright/test');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

(async () => {
  const browser = await chromium.launch();
  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  console.log('--- 触屏适配 1: PC 端（键盘保留，触屏隐藏） ---');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      touchVisible: getComputedStyle(document.getElementById('touchControls')).display !== 'none',
      mobileClass: document.body.classList.contains('mobile'),
      scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim()
    }));
    if (!r.mobileClass) ok('桌面 UA → 不启用 mobile 模式'); else fail('桌面误判为移动: ' + r.mobileClass);
    if (!r.touchVisible) ok('触屏控件隐藏（PC）'); else fail('PC 显示触屏控件');
    if (r.scale === '1.000' || r.scale === '1') ok('PC 端 --ui-scale=1（UI 无缩放）'); else fail('PC 缩放异常: ' + r.scale);
    // 键盘仍然可用
    await page.click('#soloBtn');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(800);
    await page.keyboard.up('ArrowUp');
    const spd = Number(await page.textContent('#speedValue'));
    if (spd > 0) ok('PC 键盘控制正常（加速后 ' + spd + ' km/h）'); else fail('键盘失效');
    await ctx.close();
  }

  console.log('--- 触屏适配 2: 移动端横屏（设备检测/控件/缩放/摇杆/按钮/震动） ---');
  let screenShot;
  {
    const ctx = await browser.newContext({
      viewport: { width: 812, height: 375 },
      isMobile: true, hasTouch: true,
      userAgent: MOBILE_UA
    });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForTimeout(300);
    // 震动桩
    await page.evaluate(() => {
      window.__vibrations = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { window.__vibrations.push(ms); return true; } });
    });

    const base = await page.evaluate(() => ({
      mobileClass: document.body.classList.contains('mobile'),
      touchVisible: getComputedStyle(document.getElementById('touchControls')).display !== 'none',
      gasVisible: getComputedStyle(document.getElementById('btnGas')).display !== 'none',
      driftVisible: getComputedStyle(document.getElementById('btnDrift')).display !== 'none',
      zoneVisible: getComputedStyle(document.getElementById('joystickZone')).display !== 'none',
      scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
      wrapperW: Math.round(document.getElementById('gameWrapper').clientWidth),
      rotateHidden: document.getElementById('rotateOverlay').classList.contains('hidden')
    }));
    if (base.mobileClass) ok('移动 UA → body.mobile 已启用'); else fail('移动检测失败');
    if (base.touchVisible && base.gasVisible && base.driftVisible && base.zoneVisible)
      ok('触屏控件显示（摇杆/加速/漂移）');
    else fail('触屏控件未显示: ' + JSON.stringify(base));
    if (base.rotateHidden) ok('横屏（812×375）→ 无竖屏提示'); else fail('横屏误显示竖屏提示');
    const scaleVal = parseFloat(base.scale);
    const expectedScale = base.wrapperW / 960;
    if (scaleVal > 0.3 && scaleVal < 1 && Math.abs(scaleVal - expectedScale) < 0.05)
      ok('UI 按屏宽缩放（--ui-scale=' + scaleVal + '，容器 ' + base.wrapperW + 'px/960）');
    else fail('UI 缩放异常: ' + base.scale + ' (期望 ~' + expectedScale.toFixed(3) + ')');

    await page.click('#soloBtn');
    await page.waitForTimeout(200);

    // 加速按钮
    const gas = await page.evaluate(() => {
      const g = window.__GAME__;
      const btn = document.getElementById('btnGas');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, clientY: 0 }));
      const up = g.keys.up;
      for (let f = 0; f < 30; f++) g.testStep(1 / 60, 1);
      const spd = Math.round(g.player.speed);
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      return { up, spd, upAfter: g.keys.up, vibs: window.__vibrations.slice(0, 3) };
    });
    if (gas.up && gas.upAfter === false) ok('加速按钮：按下 keys.up=true，松开恢复 false');
    else fail('加速按钮异常: ' + JSON.stringify(gas));
    if (gas.spd > 0) ok('加速按钮驱动车辆（' + gas.spd + ' km/h）');
    else fail('加速无效: ' + gas.spd);
    if (gas.vibs.includes(10)) ok('轻触震动反馈 vibrate(10)'); else fail('轻触无震动: ' + JSON.stringify(gas.vibs));

    // 漂移按钮
    const drift = await page.evaluate(() => {
      const g = window.__GAME__;
      const btn = document.getElementById('btnDrift');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 0, clientY: 0 }));
      const d = g.keys.drift;
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
      return { d, dAfter: g.keys.drift };
    });
    if (drift.d && !drift.dAfter) ok('漂移按钮：按下 keys.drift=true，松开恢复 false'); else fail('漂移按钮异常');

    // 道具按钮
    const itemBtn = await page.evaluate(() => {
      const g = window.__GAME__;
      g.ais = []; // 禁用 AI，避免踩掉测试用的香蕉
      const p = g.player;
      const btn = document.getElementById('btnItem');
      const visible = getComputedStyle(btn).display !== 'none';
      p.x = 300; p.y = 478; p.speed = 0; p.angle = 0;
      p.item = 'banana';
      g.bananas.length = 0;
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4, clientX: 0, clientY: 0 }));
      const key = g.keys.item;
      g.testStep(1 / 60, 1); // 游戏消费 item 键 → 使用道具
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4 }));
      return { visible, key, itemAfter: p.item, bananaHere: g.bananas.length };
    });
    if (itemBtn.visible) ok('道具按钮可见'); else fail('道具按钮不可见');
    if (itemBtn.key && itemBtn.itemAfter === null && itemBtn.bananaHere === 1)
      ok('道具按钮：按下 → keys.item → 使用香蕉（槽位清空、香蕉生成）');
    else fail('道具按钮异常: ' + JSON.stringify(itemBtn));

    // 摇杆转向
    const joy = await page.evaluate(() => {
      const g = window.__GAME__;
      const zone = document.getElementById('joystickZone');
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      zone.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, clientX: cx, clientY: cy }));
      zone.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3, clientX: cx + rect.width * 0.35, clientY: cy }));
      const right = g.keys.right;
      const leftDuringRight = g.keys.left;
      zone.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 3, clientX: cx - rect.width * 0.35, clientY: cy }));
      const left = g.keys.left;
      zone.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
      return { right, leftDuringRight, left, after: g.keys.right || g.keys.left };
    });
    if (joy.right && !joy.leftDuringRight) ok('摇杆右推 → keys.right=true');
    else fail('摇杆右推异常: ' + JSON.stringify(joy));
    if (joy.left && !joy.after) ok('摇杆左推 → keys.left=true；松手归零');
    else fail('摇杆左推/复位异常: ' + JSON.stringify(joy));

    // 碰撞震动 50ms
    const shakeVib = await page.evaluate(() => {
      const g = window.__GAME__;
      window.__vibrations.length = 0;
      g.shakeT = 0; // 清零（避免真实 rAF 帧的碰撞残留）
      g._shake(0.15);
      return window.__vibrations.slice(0, 2);
    });
    if (shakeVib.includes(50)) ok('碰撞 → vibrate(50)'); else fail('碰撞无震动: ' + JSON.stringify(shakeVib));

    // 截图供人工查看
    screenShot = path.resolve(__dirname, '..', 'artifacts');
    require('fs').mkdirSync(screenShot, { recursive: true });
    await page.screenshot({ path: path.join(screenShot, 'touch-mobile.png') });
    ok('截图已保存 artifacts/touch-mobile.png');
    await ctx.close();
  }

  console.log('--- 触屏适配 3: 竖屏提示 ---');
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true,
      userAgent: MOBILE_UA
    });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      overlayVisible: !document.getElementById('rotateOverlay').classList.contains('hidden'),
      text: document.getElementById('rotateOverlay').textContent.trim()
    }));
    if (r.overlayVisible && r.text.includes('横屏')) ok('竖屏（390×844）→ 显示"请横屏游玩"');
    else fail('竖屏提示缺失: ' + JSON.stringify(r));
    // 旋转回横屏 → 提示消失
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(() => document.getElementById('rotateOverlay').classList.contains('hidden'));
    if (hidden) ok('旋转回横屏 → 提示自动隐藏'); else fail('横屏后提示未隐藏');
    await ctx.close();
  }

  await browser.close();
  console.log(process.exitCode ? '=== 触屏适配测试：未通过 ===' : '=== 触屏适配测试：全部通过 ✅ ===');
})();
