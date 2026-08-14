const { chromium } = require('@playwright/test');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(process.cwd(), 'index.html'));
  await page.waitForTimeout(300);
  await page.click('#startBtn');
  let fails = 0;
  for (let run = 0; run < 20; run++) {
    const r = await page.evaluate(() => {
      const g = window.__GAME__;
      g.reset();
      const savedAis = g.ais;
      const ai0 = savedAis[0];
      g.ais = [ai0];
      g.keys.up = g.keys.down = g.keys.left = g.keys.right = g.keys.drift = g.keys.item = false;
      const p = g.player;
      p.x = 300; p.y = 478; p.speed = 0; p.angle = 0;
      ai0.x = 345; ai0.y = 478; ai0.speed = 0; ai0.angle = 0; ai0.slipTimer = 0;
      p.item = 'shell';
      g.keys.item = true;
      let slipSeen = 0;
      for (let f = 0; f < 120; f++) {
        g.testStep(1 / 60, 1);
        if (ai0.slipTimer > 0.9) slipSeen = Math.max(slipSeen, ai0.slipTimer);
      }
      const near = g.track.nearest(ai0.x, ai0.y);
      const res = {
        slipSeen: +slipSeen.toFixed(2),
        shellsRemaining: g.shells.length,
        aiPos: [Math.round(ai0.x), Math.round(ai0.y)],
        aiAngle: +ai0.angle.toFixed(2),
        aiSpeed: Math.round(ai0.speed),
        aiIdx: near.idx,
        shellPos: g.shells.length ? g.shells.map(s => [Math.round(s.x), Math.round(s.y), +s.life.toFixed(1)]) : []
      };
      g.ais = savedAis;
      return res;
    });
    if (r.shellsRemaining !== 0) { fails++; console.log('run', run, 'FAIL:', JSON.stringify(r)); }
  }
  console.log('fails:', fails, '/ 20');
  await browser.close();
})();
