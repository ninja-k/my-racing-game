/* Step 2 验证：加入房间流程（insertCoin → 大厅 → 进入游戏）
 * A. 桩测：insertCoin 被正确调用（maxPlayersPerRoom=4），resolve 后进入游戏
 * B. 桩测：insertCoin 失败 → 错误提示 + 按钮恢复 + 留在菜单
 * C. 真实联网：点击联机对战 → 探测 Playroom 默认大厅 UI 是否出现 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 100)); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 100)));
    await page.goto(URL);
    await page.waitForFunction(() => typeof window.Playroom !== 'undefined', null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(200);
    return page;
  };
  const fail = (msg) => { console.error('  ✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('  ✓ ' + msg);

  console.log('--- Step 2A: insertCoin 接线（桩 resolve） ---');
  {
    const page = await newPage();
    await page.evaluate(() => {
      window.__coinCalls = [];
      window.__resolveCoin = null;
      window.Playroom.insertCoin = (opts) => {
        window.__coinCalls.push(opts);
        return new Promise(res => { window.__resolveCoin = res; }); // 可控延迟
      };
      window.Playroom.getRoomCode = () => 'TEST12';
    });
    await page.click('#startBtn'); // 联机对战
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => ({
      btnText: document.getElementById('startBtn').textContent,
      disabled: document.getElementById('startBtn').disabled,
      calls: window.__coinCalls
    }));
    if (mid.calls.length === 1 && mid.calls[0].maxPlayersPerRoom === 4)
      ok('insertCoin 被调用且 maxPlayersPerRoom=4');
    else fail('insertCoin 调用异常: ' + JSON.stringify(mid.calls));
    if (mid.btnText.includes('正在加入') && mid.disabled) ok('按钮显示"正在加入房间…"并禁用');
    else fail('按钮状态异常: ' + JSON.stringify({ t: mid.btnText, d: mid.disabled }));
    // 让 insertCoin resolve → 应进入游戏
    await page.evaluate(() => window.__resolveCoin());
    await page.waitForFunction(() => document.body.getAttribute('data-state') === 'racing', null, { timeout: 5000 });
    const st = await page.getAttribute('body', 'data-state');
    if (st === 'racing') ok('insertCoin resolve 后进入游戏（state=racing）');
    else fail('未进入游戏: ' + st);
    const mpStatus = await page.textContent('#mpStatus');
    if (mpStatus.includes('TEST12')) ok('菜单提示房间码: "' + mpStatus + '"');
    else fail('房间码提示缺失: ' + mpStatus);
    await page.close();
  }

  console.log('--- Step 2B: insertCoin 失败处理 ---');
  {
    const page = await newPage();
    await page.evaluate(() => {
      window.Playroom.insertCoin = async () => { throw new Error('ROOM_FULL'); };
    });
    await page.click('#startBtn');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({
      state: document.body.getAttribute('data-state'),
      btnText: document.getElementById('startBtn').textContent,
      disabled: document.getElementById('startBtn').disabled,
      mpStatus: document.getElementById('mpStatus').textContent,
      isErr: document.getElementById('mpStatus').className.includes('err')
    }));
    if (r.state === 'menu') ok('失败后留在菜单'); else fail('失败后状态异常: ' + r.state);
    if (r.mpStatus.includes('失败') && r.isErr) ok('显示错误提示: "' + r.mpStatus + '"');
    else fail('错误提示异常: ' + r.mpStatus);
    if (!r.disabled && r.btnText.includes('联 机')) ok('按钮恢复可用'); else fail('按钮未恢复: ' + r.btnText);
    await page.close();
  }

  console.log('--- Step 2C: 真实联网大厅（经 http://127.0.0.1:8123，需服务已启动） ---');
  {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 100)); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 100)));
    await page.goto('http://127.0.0.1:8123/index.html');
    await page.waitForFunction(() => typeof window.Playroom !== 'undefined', null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const t0 = Date.now();
    await page.click('#startBtn');
    // 等待大厅 UI 或进入游戏（最长 25s）
    let lobbyFound = false, launched = false;
    for (let i = 0; i < 50 && !launched; i++) {
      await page.waitForTimeout(500);
      const state = await page.getAttribute('body', 'data-state');
      if (state === 'racing') { launched = true; break; }
      // 探测大厅 UI：查找含 Playroom/Launch/Create/Join 文本的元素
      const found = await page.evaluate(() => {
        const all = [...document.querySelectorAll('button, div, span, input, a')];
        const texts = all.filter(el => {
          const t = (el.textContent || '').trim();
          return t && t.length < 60 && /(launch|create room|join room|playroom|room code|player)/i.test(t);
        }).slice(0, 8).map(el => el.tagName + ':' + (el.textContent || '').trim().slice(0, 40));
        return texts;
      });
      if (found && found.length && !lobbyFound) { lobbyFound = true; }
      if (i % 10 === 0) console.log('    [探测] ' + ((Date.now() - t0) / 1000).toFixed(1) + 's ' + JSON.stringify(found));
    }
    if (lobbyFound) ok('Playroom 默认大厅 UI 已出现（可创建/加入房间）');
    if (launched) ok('大厅操作后成功进入游戏（state=racing）');
    if (!lobbyFound && !launched) {
      console.log('    [提示] 未探测到大厅 UI（网络受限或大厅为 Shadow DOM/iframe），截图供人工确认');
      const shot = path.resolve(__dirname, '..', 'artifacts');
      require('fs').mkdirSync(shot, { recursive: true });
      await page.screenshot({ path: path.join(shot, 'mp-lobby.png') });
      console.log('    [提示] 已保存截图 artifacts/mp-lobby.png');
    }
    await page.close();
  }

  if (errors.length) { fail('存在页面错误: ' + errors.join(' | ')); } else ok('无 console/页面错误');
  await browser.close();
  console.log(process.exitCode ? '=== Step 2 验证：未通过 ===' : '=== Step 2 验证：通过（C 为联网探测，结果仅供参考） ✅ ===');
})();
