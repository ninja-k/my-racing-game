# 马力欧赛车风格网页小游戏

一个纯 HTML + CSS + JavaScript（Canvas 2D）实现的马力欧赛车风格竞速小游戏。支持**单人（3 名 AI）与 2-4 人联机对战**（Playroom Kit），完成 **3 圈** 比赛。

## 快速开始

**直接运行（无需安装）：**

双击 `index.html` 用浏览器打开即可游玩**单人模式**（推荐 Chrome / Edge / Firefox 最新版）。

**本地静态服务（联机必须，因 Playroom 依赖 http(s) origin）：**

```bash
python3 -m http.server 8000
```

然后访问 http://localhost:8000

## 联机对战（Playroom Kit，2-4 人）

1. 打开 http://localhost:8000 点击 **"联机对战"** → 出现 Playroom 官方大厅（可创建/加入房间、邀请好友、房主点 **Launch** 开赛）
2. 好友在另一台设备/浏览器输入房间码加入；房主点 Launch 后全员进入比赛
3. **直连邀请链接**（跳过大厅）：
   - 房主：`http://localhost:8000/?mp=host`（自动建房间，房间码显示在菜单）
   - 加入：`http://localhost:8000/?mp=join&room=房间码`

> 联机说明：各端模拟自己的赛车并通过 `myPlayer().setState('car')` 同步位置/圈数/输入（约 15Hz，官方推荐模式）；道具使用事件（seq 序号）在所有客户端一致生成龟壳/香蕉；碰撞由各车所属端处理。联机模式不使用 AI。

## 操作说明

**PC（键盘）：**

| 按键 | 功能 |
|------|------|
| `↑` / `W` | 加速 |
| `↓` / `S` | 刹车 |
| `←` / `→` 或 `A` / `D` | 转向（速度越快转向越"重"） |
| `Space` | 漂移（转弯更灵，速度 -20%，松开获得 1.5 秒小喷） |
| `Z` | 使用道具（蘑菇 / 龟壳 / 香蕉） |

**手机（触屏，自动检测）：**

- **左下摇杆**：左右推动控制转向（半透明）
- **右下大圆"加速"按钮**：按住加速
- **右下小圆"漂移"按钮**：按住漂移
- 碰撞手机震动（50ms）、按钮轻触震动反馈
- 竖屏时提示"请横屏游玩"，旋转后自动隐藏
- HUD（速度表/排名/道具槽等）随屏幕宽度自动缩放

## 玩法要点

- **漂移小喷**：弯道按住 `Space` 漂移（车尾留下胎痕），漂移 ≥1 秒松手获得小喷 + 完美漂移 "DRIFT BOOST!" 提示；突破 300 km/h 上限
- **道具系统**：赛道上有 5 个"？"道具箱（拾取后 15 秒重生）——
  - 🍄 蘑菇：+40% 加速，持续 3 秒
  - 🐢 龟壳：向前发射，命中车辆使其打滑 1 秒
  - 🍌 香蕉皮：放在身后，踩中减速 60%（0.5 秒）
- **AI 也会用道具**，且使用频率随难度提升
- **动态难度**：玩家长期领先 → AI 变快；玩家垫底 → AI 变慢
- **反馈**：碰撞屏幕震动 + "轰"声、全速时速度线、超车弹 "NICE!"、引擎音随速度变化

## 自动化测试

```bash
# 安装依赖（首次）
npm install
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright install chromium

# 运行 T01~T11（单机）+ M1~M7（联机）全部测试
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright test

# 真实双浏览器联机 E2E（需先启动本地服务）
python3 -m http.server 8123 --bind 127.0.0.1 &
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" node scripts/mp-e2e-test.js
```

测试用例（`game.test.js` 单机 + `game-multiplayer.test.js` 联机）覆盖：

| 编号 | 用例 | 验证点 |
|------|------|--------|
| T01 | 页面加载 | 标题、联机/单人按钮、Canvas 可见 |
| T02 | 开始游戏 | HUD 初始数据（速度 0、圈数 0/3） |
| T03 | 玩家加速 | 按 ↑ 1 秒速度 > 0 |
| T04 | 边界碰撞 | 出界速度降低 ≥20% 并被拉回 |
| T05 | 圈数检测 | 绕行一圈圈数变为 1 |
| T06 | 3 圈结束 | 完成 3 圈胜利界面出现 |
| T07 | AI 行为 | AI 速度波动 70%~100%、不卡墙 |
| T08 | 道具拾取 | 经过道具箱道具槽显示图标 |
| T09 | 道具使用 | 蘑菇后速度增加 ≥30% |
| T10 | 排行榜存储 | 游戏结束 localStorage 有记录 |
| T11 | 重新开始 | 点击重开所有状态归零 |
| M1 | 加入房间 | insertCoin(maxPlayersPerRoom=4) → 进入比赛 |
| M2 | 两名玩家加入 | onPlayerJoin → 创建远程赛车实体 |
| M3 | 状态同步 | 远程位置同步 + 平滑渲染 |
| M4 | 玩家退出 | player.onQuit → 移除实体 |
| M5 | 房主守卫 | 仅 isHost() 可写全局状态 |
| M6 | 道具事件 | 远程龟壳/香蕉在所有客户端一致生成 |
| M7 | 本机断开 | onDisconnect → 返回菜单并可重连 |

## 技术架构

游戏主体在 `index.html` 内模块化组织（对应 PRD 五、技术架构）；联机逻辑在 `multiplayer.js`（Playroom Kit 封装）：

- **Game** — 主循环、状态机（menu / racing / finished）、联机模式（发布/拉取/排名/渲染远程车辆）
- **Vehicle / Player / AI** — 车辆基类、键盘输入 + 漂移 + 道具、路径跟随 + 速度策略
- **Track** — 赛道生成（Catmull-Rom 闭合曲线）、碰撞检测、圈数检测
- **PowerUp** — 道具箱、拾取、三种道具效果（联机道具事件广播）
- **HUD** — DOM + Canvas 混合 UI（指针速度表、小地图、分段计时等）
- **AudioManager** — Web Audio 合成音效（引擎音 / 碰撞 / 道具）
- **Storage** — localStorage 排行榜（最近 5 次最佳）
- **Multiplayer**（`multiplayer.js`）— Playroom Kit 封装：加入房间、状态同步（`myPlayer().setState('car')`）、玩家加入/退出、房主守卫全局状态（`isHost()` + `setState`）

## 项目文件

| 文件 | 说明 |
|------|------|
| `index.html` | 游戏本体（单机 + 联机模式） |
| `multiplayer.js` | Playroom Kit 联机模块（加入房间/状态同步/加入退出） |
| `game.test.js` | Playwright 单机自动化测试（T01~T11） |
| `game-multiplayer.test.js` | Playwright 联机自动化测试（M1~M7） |
| `playwright.config.js` | 测试配置 |
| `scripts/` | 开发期回归测试脚本（含 `mp-e2e-test.js` 真实双浏览器 E2E） |
