/* =========================================================================
 * multiplayer.js — 多人联机模块（基于 Playroom Kit）
 * 官方文档：https://docs.joinplayroom.com
 * CDN：https://unpkg.com/playroomkit/multiplayer.full.umd.js → window.Playroom
 *
 * 本文件按步骤实现联机功能：
 *   Step 1（本步）：加载自检 + 模块骨架
 *   Step 2：insertCoin() 加入房间流程
 *   Step 3：状态同步（setState/getState/玩家状态）
 *   Step 4：玩家加入/退出（onPlayerJoin / player.onQuit）
 *   Step 5：玩家操作同步
 * ========================================================================= */
'use strict';

const Multiplayer = {
  available: false,   // Playroom Kit 是否加载成功
  joined: false,      // 是否已加入房间
  roomCode: null,     // 当前房间码
  players: {},        // 房间内玩家映射 { playerId: PlayerState }
  _err: null,

  /** 校验 Playroom Kit 是否加载成功（window.Playroom 及所需 API 是否齐全） */
  checkAvailable() {
    const P = window.Playroom;
    if (!P) {
      this._err = 'Playroom Kit 未加载（网络不可用或 CDN 被屏蔽）';
      this.available = false;
      return false;
    }
    // 官方 API 清单（v0.0.97，types.d.ts 核对）
    const required = [
      'insertCoin', 'onPlayerJoin', 'isHost', 'getState', 'setState',
      'myPlayer', 'getRoomCode', 'onDisconnect', 'waitForState'
    ];
    const missing = required.filter(k => typeof P[k] !== 'function');
    if (missing.length) {
      this._err = 'Playroom Kit API 缺失: ' + missing.join(', ');
      this.available = false;
      return false;
    }
    this.available = true;
    this._err = null;
    if (window.console) console.log('[Multiplayer] Playroom Kit 加载成功', P.VERSION || '');
    return true;
  },

  /**
   * 加入房间（Step 2）
   * 调用 Playroom.insertCoin() 展示官方默认大厅 UI（创建/加入房间，房主点击 Launch 后开赛）。
   * Promise 在玩家成功加入房间后 resolve（官方文档：await insertCoin()）。
   * @param {object} [opts] 额外 InitOptions（如 roomCode / skipLobby 等）
   */
  async join(opts) {
    if (!this.checkAvailable()) {
      throw new Error(this._err || 'Playroom Kit 不可用，无法联机');
    }
    if (this.joined) return true;
    const options = Object.assign({ maxPlayersPerRoom: 4 }, opts || {}); // 2-4 人房间
    await window.Playroom.insertCoin(options); // 展示大厅 UI，resolve 后已加入房间
    this.joined = true;
    try { this.roomCode = window.Playroom.getRoomCode(); } catch (e) { /* 忽略 */ }
    if (window.console) console.log('[Multiplayer] 已加入房间' + (this.roomCode ? '，房间码: ' + this.roomCode : ''));
    return true;
  },

  /* ================= Step 3: 状态同步 ================= */

  /** 注册玩家加入回调（官方 onPlayerJoin 包装），返回清理函数 */
  onPlayerJoin(cb) {
    if (!this.checkAvailable()) return () => {};
    return window.Playroom.onPlayerJoin(cb);
  },

  /** 发布本机车辆状态（调用频率由 Game 控制，约 15Hz） */
  publishCarState(state) {
    if (!this.joined) return false;
    try {
      window.Playroom.myPlayer().setState('car', state);
      return true;
    } catch (e) { return false; }
  },

  /** 读取某玩家的车辆状态（尚无数据时返回 null） */
  getCarState(player) {
    try { return player.getState('car') || null; } catch (e) { return null; }
  },

  /**
   * 房主守卫的全局状态写入：仅 isHost() 时执行 setState（官方推荐模式：
   * 全局状态由房主统一修改，避免冲突）
   */
  setGlobal(key, value, reliable) {
    if (!this.checkAvailable() || !this.joined) return false;
    if (!window.Playroom.isHost()) return false;
    window.Playroom.setState(key, value, reliable !== false);
    return true;
  },

  /** 读取全局状态 */
  getGlobal(key) {
    if (!this.checkAvailable()) return undefined;
    try { return window.Playroom.getState(key); } catch (e) { return undefined; }
  },

  /** 当前是否房主 */
  isHost() {
    return this.checkAvailable() && window.Playroom.isHost();
  },

  /** 本机 PlayerState（未加入时返回 null） */
  myPlayer() {
    if (!this.checkAvailable() || !this.joined) return null;
    try { return window.Playroom.myPlayer(); } catch (e) { return null; }
  },

  /** 玩家档案（名称/头像），失败时返回默认 */
  getPlayerProfile(player) {
    try { return player.getProfile(); } catch (e) { return { name: '玩家' }; }
  },

  /* ================= Step 4: 玩家加入与退出 ================= */

  /**
   * 监听某玩家退出（官方 PlayerState.onQuit，无全局 onQuit）。
   * 在 onPlayerJoin 回调中为每个玩家注册。
   */
  onPlayerQuit(player, cb) {
    try {
      const off = player.onQuit(cb);
      return typeof off === 'function' ? off : () => {};
    } catch (e) { return () => {}; }
  },

  /** 监听本机断开房间（官方顶层 onDisconnect，断线/关页时触发） */
  onDisconnect(cb) {
    if (!this.checkAvailable()) return () => {};
    try { return window.Playroom.onDisconnect(cb); } catch (e) { return () => {}; }
  },

  /** 重置加入状态（本机断开/退出后允许重新加入房间） */
  resetSession() {
    this.joined = false;
    this.roomCode = null;
    this.players = {};
  }
};

// 暴露给游戏主体与自动化测试
window.__MULTIPLAYER__ = Multiplayer;

// 页面加载后立即自检一次
window.addEventListener('DOMContentLoaded', () => Multiplayer.checkAvailable());
