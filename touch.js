/* =========================================================================
 * touch.js — 手机触屏适配（移动端专用，PC 键盘控制不受影响）
 * 功能：
 *   1) navigator.userAgent 检测移动设备 → body.mobile
 *   2) 左下摇杆（转向）+ 右下加速/漂移按钮（半透明）
 *   3) --ui-scale 变量让 HUD/触屏控件随屏幕宽度缩放
 *   4) 竖屏提示“请横屏游玩”
 *   5) 轻触震动反馈（按钮 10ms；碰撞震动在 Game._shake 中 50ms）
 * ========================================================================= */
'use strict';

const TouchControls = {
  game: null,
  isMobile: false,
  el: {},
  _joyPointerId: null,
  _joyR: 66, // 摇杆有效半径（逻辑 px，随 --ui-scale 缩放后读取）

  /**
   * 初始化：检测设备 → 绑定触屏控件 → 竖屏检测 → 计算 UI 缩放
   * @param {Game} game 游戏实例（写入 game.keys）
   */
  init(game) {
    this.game = game;
    // 1) 设备检测（navigator.userAgent）
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent);
    if (this.isMobile) document.body.classList.add('mobile');

    this.el = {
      zone: document.getElementById('joystickZone'),
      base: document.getElementById('joystickBase'),
      knob: document.getElementById('joystickKnob'),
      gas: document.getElementById('btnGas'),
      drift: document.getElementById('btnDrift'),
      item: document.getElementById('btnItem'),
      rotate: document.getElementById('rotateOverlay')
    };

    this.updateScale(); // 3) UI 缩放（PC 亦无害，scale=1）

    if (!this.isMobile) return; // PC：不绑定触屏，保持键盘控制

    // 2) 摇杆 + 按钮（加速 / 漂移 / 道具）
    this._bindJoystick();
    this._bindButton(this.el.gas, 'up');
    this._bindButton(this.el.drift, 'drift');
    this._bindButton(this.el.item, 'item'); // 道具：等效 PC 的 Z 键

    // 4) 竖屏提示
    this._updateOrientation();
    window.addEventListener('resize', () => this._updateOrientation());
    window.addEventListener('orientationchange', () => this._updateOrientation());
    window.addEventListener('resize', () => this.updateScale());
  },

  /* ---------- 每帧更新（P0-2：道具按钮随持有状态置灰） ---------- */
  update(game) {
    if (!this.isMobile) return;
    const hasItem = !!(game && game.player && game.player.item);
    this.el.item.classList.toggle('disabled', !hasItem);
  },

  /* ---------- 跟随式摇杆（转向，P0-1） ---------- */
  _bindJoystick() {
    const zone = this.el.zone;
    const base = this.el.base;
    const knob = this.el.knob;
    const wrapper = () => document.getElementById('gameWrapper').getBoundingClientRect();
    const DEAD = 0.18; // 死区

    const onDown = (e) => {
      if (this._joyPointerId !== null) return; // 只跟踪一个触点
      e.preventDefault();
      this._joyPointerId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件忽略 */ }
      // 底座出现在触摸点（半径 = 底座半径 = 60px）
      this._joyR = base.offsetWidth / 2 || 60;
      const wr = wrapper();
      base.style.left = (e.clientX - wr.left) + 'px';
      base.style.top = (e.clientY - wr.top) + 'px';
      base.classList.add('active');
      this._joyBaseX = e.clientX;
      this._joyBaseY = e.clientY;
      this._joyMove(e.clientX, e.clientY);
    };
    const onMove = (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      e.preventDefault();
      this._joyMove(e.clientX, e.clientY);
    };
    const onUp = (e) => {
      if (e.pointerId !== this._joyPointerId) return;
      this._joyPointerId = null;
      this.game.keys.left = false;
      this.game.keys.right = false;
      this.game.keys.steer = 0;
      knob.style.transform = 'translate(-50%, -50%)'; // 平滑回中（CSS transition）
      base.classList.remove('active');                // 底座淡出
    };

    zone.addEventListener('pointerdown', onDown);
    zone.addEventListener('pointermove', onMove);
    zone.addEventListener('pointerup', onUp);
    zone.addEventListener('pointercancel', onUp);

    this._joyMove = (clientX, clientY) => {
      let dx = (clientX - this._joyBaseX) / this._joyR;
      let dy = (clientY - this._joyBaseY) / this._joyR;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; } // 限制在圆内
      knob.style.transform =
        'translate(calc(-50% + ' + (dx * this._joyR) + 'px), calc(-50% + ' + (dy * this._joyR) + 'px))';
      // 死区 0.18：内为 0，外按比例
      const s = Math.abs(dx) < DEAD ? 0 : dx;
      this.game.keys.left = s < 0;
      this.game.keys.right = s > 0;
      this.game.keys.steer = s; // 比例转向值（P1-8 灵敏度用）
    };
  },

  /* ---------- 右下按钮（加速 / 漂移，多指同时按下） ---------- */
  _bindButton(btn, keyName) {
    const onDown = (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件忽略 */ }
      this.game.keys[keyName] = true;
      this.vibrate(10); // 5) 轻触反馈
    };
    const onUp = () => { this.game.keys[keyName] = false; };
    btn.addEventListener('pointerdown', onDown);
    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', onUp);
    btn.addEventListener('lostpointercapture', onUp);
  },

  /* ---------- 震动 ---------- */
  vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
    }
  },

  /* ---------- 竖屏提示 ---------- */
  _updateOrientation() {
    if (!this.isMobile) return;
    const portrait = window.innerHeight > window.innerWidth;
    this.el.rotate.classList.toggle('hidden', !portrait);
  },

  /* ---------- UI 缩放（--ui-scale = 容器宽度 / 960） ---------- */
  updateScale() {
    const wrapper = document.getElementById('gameWrapper');
    if (!wrapper) return;
    const scale = Math.min(1, wrapper.clientWidth / 960);
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
  }
};

// 暴露给游戏主体与自动化测试
window.__TOUCH__ = TouchControls;
