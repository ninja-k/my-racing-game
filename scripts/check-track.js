/* 赛道几何与渲染校验（替代人工看图）：曲率分区 / 自相交 / 像素采样 */
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const T = window.__GAME__.track;
    const pts = T.pts;
    const out = {};

    // 1) 基本统计
    out.samples = pts.length;
    out.totalLen = Math.round(T.totalLen);
    out.startIdx = T.startIdx;

    // 2) 边界范围
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    out.bounds = { minX: Math.round(minX), maxX: Math.round(maxX), minY: Math.round(minY), maxY: Math.round(maxY) };
    out.fitsCanvas = minX > 0 && maxX < 960 && minY > 0 && maxY < 600;

    // 3) 曲率分区：U 弯（左右两端）应远大于 S 弯（中段）
    let uCurv = 0, sCurv = 0, straightCurv = 0;
    for (const p of pts) {
      const inU = (p.x > 760 || p.x < 170);
      const inS = (p.x > 380 && p.x < 620 && p.y > 280) || (p.x > 400 && p.x < 700 && p.y < 320);
      if (inU && p.curv > uCurv) uCurv = p.curv;
      if (inS && p.curv > sCurv) sCurv = p.curv;
      if (!inU && !inS && p.curv > straightCurv) straightCurv = p.curv;
    }
    out.curv = {
      uTurn: +uCurv.toFixed(5),      // 期望 ≈0.0125（红白路肩）
      sBend: +sCurv.toFixed(5),      // 期望 0.002~0.006（蓝白路肩）
      straight: +straightCurv.toFixed(5)
    };

    // 4) 宽度：直道 100 / 弯道 60（半宽 50 / 30）
    let maxHw = 0, minHw = 1e9;
    for (const p of pts) { if (p.hw > maxHw) maxHw = p.hw; if (p.hw < minHw) minHw = p.hw; }
    out.halfWidth = { min: +minHw.toFixed(1), max: +maxHw.toFixed(1) };

    // 5) 自相交检测（非相邻中心线段是否相交）
    function segInt(a, b, c, d) {
      const d1x = b.x - a.x, d1y = b.y - a.y;
      const d2x = d.x - c.x, d2y = d.y - c.y;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) return false;
      const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
      const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / den;
      return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
    }
    let selfCross = null;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 2; j < pts.length; j++) {
        const isAdjacentEnd = (i === 0 && j === pts.length - 1);
        if (isAdjacentEnd || j === i + 1) continue;
        if (segInt(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) {
          selfCross = [i, j]; break;
        }
      }
      if (selfCross) break;
    }
    out.selfIntersect = selfCross;

    // 6) 像素采样：验证路肩颜色渲染（沿路肩带采样一列像素统计颜色）
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    function pxAt(x, y) {
      const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [d[0], d[1], d[2]];
    }
    function classify(c) {
      // 红 (224,64,46) / 蓝 (58,160,255) / 白 (244) / 其他
      if (c[0] > 180 && c[1] < 120 && c[2] < 120) return 'red';
      if (c[2] > 180 && c[0] < 130 && c[1] > 100) return 'blue';
      if (c[0] > 220 && c[1] > 220 && c[2] > 220) return 'white';
      return 'other';
    }
    function curbColors(pts, pick, dir) {
      const counts = { red: 0, blue: 0, white: 0, other: 0 };
      for (const p of pick) {
        const off = p.hw + 5;
        const c = pxAt(p.x + p.nx * off * dir, p.y + p.ny * off * dir);
        counts[classify(c)]++;
      }
      return counts;
    }
    // U 弯（左 U 区域全部样本，外侧 +1 与内侧 -1 两个方向都采样）
    const uPts = pts.filter(p => p.x < 170);
    const lU = curbColors(pts, uPts, 1);
    const rU = curbColors(pts, uPts, -1);
    out.uCurb = { left: lU, right: rU };
    // S 弯（顶部 S2 区域）
    const sPts = pts.filter(p => p.y < 300 && p.x > 420 && p.x < 700);
    out.sCurb = { left: curbColors(pts, sPts, 1), right: curbColors(pts, sPts, -1) };
    // 直道外侧 → 应为草地绿（无路肩）
    const straight = pts[Math.round(pts.length * 0.35)]; // 底部直道附近
    out.straightEdgePx = pxAt(straight.x + 2, straight.y + straight.hw + 14).join(',');
    // 沥青采样（避开中线虚线：取偏离中心 15px 处）
    out.asphaltPx = pxAt(300, 463).join(',');

    return out;
  });

  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})();
