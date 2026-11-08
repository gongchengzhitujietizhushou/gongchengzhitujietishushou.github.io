// ============================================================
// js/render.js
// 工程制图解题助手 —— 答案图渲染 (Canvas 2D 移植自 core/renderer.py)
// 绘制 主视图 + 左视图 (已知, 灰蓝) 与 俯视图 (所求, 黑色加粗)
// ============================================================
'use strict';

const Render = (() => {

  // 线型
  const STYLE = {
    vis:     { color: '#101010', width: 2.0, dash: [] },
    visAns:  { color: '#101010', width: 2.6, dash: [] },
    hid:     { color: '#101010', width: 1.25, dash: [6.5, 4.0] },
    hidAns:  { color: '#101010', width: 1.5, dash: [6.5, 4.0] },
    cen:     { color: '#8a8a8a', width: 0.95, dash: [16, 4, 3.5, 4] },
    given:   { color: '#4a5563', width: 1.7, dash: [] },
    givenH:  { color: '#4a5563', width: 1.15, dash: [6.5, 4.0] },
  };

  function styleFor(kind, answer) {
    if (kind === 'hidden') return answer ? STYLE.hidAns : STYLE.givenH;
    return answer ? STYLE.visAns : STYLE.given;
  }

  function applyStyle(ctx, st) {
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.setLineDash(st.dash);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  // 画图元 (tx,ty: 数据坐标 -> 画布像素)
  function drawPrims(ctx, prims, answer, tx, ty) {
    for (const p of prims) {
      const st = styleFor(p.kind, answer);
      applyStyle(ctx, st);
      ctx.beginPath();
      if (p.type === 'line') {
        const [x1, y1] = p.a, [x2, y2] = p.b;
        ctx.moveTo(tx(x1), ty(y1));
        ctx.lineTo(tx(x2), ty(y2));
      } else if (p.type === 'poly') {
        const pts = p.pts;
        if (!pts.length) continue;
        ctx.moveTo(tx(pts[0][0]), ty(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i][0]), ty(pts[i][1]));
      } else if (p.type === 'circle') {
        const [cx, cy] = p.c, r = p.r;
        ctx.arc(tx(cx), ty(cy), r * Math.abs(tx(cx + 1) - tx(cx)), 0, 2 * Math.PI);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 不可见线段 (实线 + 端点短刺)
  function hidSeg(ctx, x0, y0, x1, y1, st, tick) {
    tick = tick || 1.2;
    applyStyle(ctx, st);
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return;
    const ux = dx / len, uy = dy / len;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + ux * tick, y0 + uy * tick);
    ctx.moveTo(x1 - ux * tick, y1 - uy * tick); ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function label(ctx, x, y, s, size, weight, color, ha) {
    ctx.fillStyle = color || '#101010';
    ctx.font = `${weight || 'bold'} ${size}px "Noto Sans CJK SC", "Source Han Sans CN", sans-serif`;
    ctx.textAlign = ha || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }

  // 主渲染: 把 result (solver 输出) 画到 canvas
  function render(result, canvas, opts) {
    opts = opts || {};
    const geo = result.geometry;
    const R = geo.R, L = geo.L;
    const X1 = geo.X1, X2 = geo.X2, A = geo.A, W = geo.W;

    const GAP_LR = 0.55 * R;
    const GAP_TB = 0.85 * R;
    const OCX = 0, OCY = 0;
    const LVX = L + GAP_LR + R, LVY = R;
    const TVY = -(GAP_TB + R);

    // 数据范围
    const m = 0.9 * R;
    const xmin = -m, xmax = LVX + R + m;
    const ymin = TVY - R - 1.05 * R, ymax = 2 * R + 1.2 * R;

    // 画布尺寸: 自动缩放使输出宽度约 760px (可被 opts.scale 覆盖)
    const rangeX = xmax - xmin, rangeY = ymax - ymin;
    const scale = opts.scale || (760 / rangeX);
    const cw = Math.ceil(rangeX * scale);
    const ch = Math.ceil(rangeY * scale);
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    // 数据->像素 (y 翻转)
    const tx = (x) => (x - xmin) * scale;
    const ty = (y) => (ymax - y) * scale;

    // ---- 主视图 (已知)
    const front = result.views.front || [];
    drawPrims(ctx, front, false, tx, ty);
    const cenSt = STYLE.cen;
    applyStyle(ctx, cenSt);
    ctx.beginPath(); ctx.moveTo(tx(-12), ty(R)); ctx.lineTo(tx(L + 12), ty(R)); ctx.stroke();

    // ---- 左视图 (已知)
    const left = result.views.left || [];
    for (const p of left) {
      if (p.type === 'circle') {
        applyStyle(ctx, STYLE.given);
        ctx.beginPath();
        ctx.arc(tx(LVX), ty(LVY), p.r * scale, 0, 2 * Math.PI);
        ctx.stroke();
      } else {
        const [x1, y1] = p.a, [x2, y2] = p.b;
        hidSeg(ctx, tx(LVX + x1), ty(LVY + y1), tx(LVX + x2), ty(LVY + y2), STYLE.givenH);
      }
    }
    applyStyle(ctx, cenSt);
    ctx.beginPath(); ctx.moveTo(tx(LVX - R - 12), ty(LVY)); ctx.lineTo(tx(LVX + R + 12), ty(LVY)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx(LVX), ty(LVY - R - 12)); ctx.lineTo(tx(LVX), ty(LVY + R + 12)); ctx.stroke();

    // ---- 俯视图 (答案)
    const top = result.views.top || [];
    drawPrims(ctx, top, true, tx, ty);
    applyStyle(ctx, cenSt);
    ctx.beginPath(); ctx.moveTo(tx(-12), ty(TVY)); ctx.lineTo(tx(L + 12), ty(TVY)); ctx.stroke();

    // ---- 标注
    const fs = scale * 0.30;
    label(ctx, tx(0), ty(2 * R + 1.05 * R), '工程制图 · 求解结果', fs * 1.7, 'bold', '#101010', 'left');
    label(ctx, tx(0), ty(2 * R + 0.85 * R), '黑色加粗部分为所求视图', fs * 0.95, 'normal', '#4a5563', 'left');
    label(ctx, tx(L / 2), ty(2 * R + 0.45 * R), '主视图', fs * 1.05, 'bold', '#4a5563');
    label(ctx, tx(LVX), ty(2 * R + 0.45 * R), '左视图', fs * 1.05, 'bold', '#4a5563');
    label(ctx, tx(0), ty(TVY + R + 0.30 * R), '俯视图', fs * 1.15, 'bold', '#1b4f80', 'left');
    label(ctx, tx(L + 0.22 * R), ty(TVY + R + 0.30 * R), '【所求 · 答案】', fs, 'bold', '#c0392b', 'left');

    // 图例
    const lx = -m * 0.4, ly = TVY - R - 0.42 * R;
    const legY = ty(ly);
    const segW = 24;
    // 可见
    applyStyle(ctx, STYLE.vis);
    ctx.beginPath(); ctx.moveTo(tx(lx), legY); ctx.lineTo(tx(lx) + segW, legY); ctx.stroke();
    label(ctx, tx(lx) + segW + 6, legY, '可见轮廓线', fs * 0.85, 'normal', '#101010', 'left');
    // 不可见
    applyStyle(ctx, STYLE.hid);
    ctx.beginPath(); ctx.moveTo(tx(lx + 2.4 * R), legY); ctx.lineTo(tx(lx + 2.4 * R) + segW, legY); ctx.stroke();
    label(ctx, tx(lx + 2.4 * R) + segW + 6, legY, '不可见轮廓线', fs * 0.85, 'normal', '#101010', 'left');
    // 中心线
    applyStyle(ctx, STYLE.cen);
    ctx.beginPath(); ctx.moveTo(tx(lx), ty(ly - 0.35 * R)); ctx.lineTo(tx(lx) + segW, ty(ly - 0.35 * R)); ctx.stroke();
    label(ctx, tx(lx) + segW + 6, ty(ly - 0.35 * R), '中心线', fs * 0.85, 'normal', '#101010', 'left');
    label(ctx, tx(lx + 2.4 * R) + segW + 6, ty(ly - 0.35 * R),
          `尺寸: D=2R=${(2 * R).toFixed(0)}  L=${L.toFixed(0)}  孔口高 2A=${(2 * A).toFixed(0)}=${(2 * A / R).toFixed(2)}D  孔底弦长 2W=${(2 * W).toFixed(0)}=${(2 * W / R).toFixed(2)}D = 2√(R²−A²)`,
          fs * 0.85, 'normal', '#4a5563', 'left');

    return canvas;
  }

  return { render, STYLE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Render;
