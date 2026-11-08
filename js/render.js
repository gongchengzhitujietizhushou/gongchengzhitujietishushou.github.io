// ============================================================
// js/render.js
// 工程制图解题助手 —— 答案图渲染 (Canvas 2D, 通用/数据驱动)
// ------------------------------------------------------------
// 输入 result = {
//   view: 'top' | 'left' | 'front',          // 所求视图 (也可由 opts.answerView 指定)
//   views: { front:[prims], left:[prims], top:[prims] },   // 各视图图元(各自局部坐标)
//   labels?: { front, left, top },           // 视图名 (默认 主视图/左视图/俯视图)
//   title?, subtitle?, dims?: [string]       // 标题 / 副标题 / 尺寸标注
// }
// prim = { type:'line'|'poly'|'circle', kind:'visible'|'hidden'|'center',
//          a:[x,y]|b:[x,y] 或 pts:[[x,y]..] 或 c:[x,y], r }
// 布局: 主视图(前) 左上, 左视图 右上(同行), 俯视图 下 (第三角投影), 自动缩放。
// "所求"视图以黑/加粗绘制并标【所求 · 答案】。
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
    if (kind === 'center') return STYLE.cen;
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

  function label(ctx, x, y, s, size, weight, color, ha) {
    ctx.fillStyle = color || '#101010';
    ctx.font = `${weight || 'bold'} ${size}px "Noto Sans CJK SC", "Source Han Sans CN", sans-serif`;
    ctx.textAlign = ha || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }

  // 图元包围盒 (局部数据坐标)
  function viewBBox(prims) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of (prims || [])) {
      if (p.type === 'circle') {
        const cx = p.c[0], cy = p.c[1], r = p.r;
        minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
        minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
      } else if (p.type === 'line') {
        minX = Math.min(minX, p.a[0], p.b[0]); maxX = Math.max(maxX, p.a[0], p.b[0]);
        minY = Math.min(minY, p.a[1], p.b[1]); maxY = Math.max(maxY, p.a[1], p.b[1]);
      } else if (p.type === 'poly') {
        for (const pt of p.pts) {
          minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
          minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
        }
      }
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  }

  // 主渲染: 把通用 answer 描述画到 canvas
  function render(result, canvas, opts) {
    opts = opts || {};
    const views = (result && result.views) || {};
    const answerView = opts.answerView || (result && result.view) || 'top';
    const labels = (result && result.labels) ||
      { front: '主视图', left: '左视图', top: '俯视图' };
    const title = (result && result.title) || '工程制图 · 求解结果';
    const subtitle = (result && result.subtitle) || '黑色加粗部分为所求视图';
    const dims = (result && Array.isArray(result.dims)) ? result.dims : [];

    const names = ['front', 'left', 'top'];
    const boxes = {};
    for (const n of names) boxes[n] = viewBBox(views[n]);

    // 第三角布局: front 左上, left 右上(同行), top 下
    const unit = Math.max(boxes.front.w, boxes.front.h, boxes.left.w, boxes.left.h,
      boxes.top.w, boxes.top.h, 1);
    const GAP = 0.5 * unit;
    const f = boxes.front, l = boxes.left, t = boxes.top;
    const off = {
      front: { x: 0, y: 0 },
      left:  { x: f.maxX + GAP - l.minX, y: (f.minY + f.maxY) / 2 - (l.minY + l.maxY) / 2 },
      top:   { x: (f.minX + f.maxX) / 2 - (t.minX + t.maxX) / 2, y: f.minY - GAP - t.maxY },
    };

    function placed(b, o) {
      return { minX: b.minX + o.x, maxX: b.maxX + o.x, minY: b.minY + o.y, maxY: b.maxY + o.y };
    }
    const all = [placed(f, off.front), placed(l, off.left), placed(t, off.top)];
    let gminX = Math.min.apply(null, all.map(b => b.minX));
    let gmaxX = Math.max.apply(null, all.map(b => b.maxX));
    let gminY = Math.min.apply(null, all.map(b => b.minY));
    let gmaxY = Math.max.apply(null, all.map(b => b.maxY));

    // 留出标题/视图名/图例空间
    const padX = 0.5 * unit;
    const padTop = 0.95 * unit;
    const padBottom = 1.05 * unit;
    const xmin = gminX - padX, xmax = gmaxX + padX;
    const ymin = gminY - padBottom, ymax = gmaxY + padTop;

    const rangeX = xmax - xmin, rangeY = ymax - ymin;
    const scale = opts.scale || (760 / rangeX);
    const cw = Math.ceil(rangeX * scale);
    const ch = Math.ceil(rangeY * scale);
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    const tx = (x) => (x - xmin) * scale;
    const ty = (y) => (ymax - y) * scale;
    const fs = scale * unit * 0.11;

    // ---- 三个视图
    for (const n of names) {
      const o = off[n];
      const tvx = (x) => tx(x + o.x);
      const tvy = (y) => ty(y + o.y);
      drawPrims(ctx, views[n] || [], n === answerView, tvx, tvy);
    }

    // ---- 标题 / 副标题
    const titleX = tx(xmin + 0.05 * unit);
    label(ctx, titleX, ty(ymax - 0.28 * unit), title, fs * 1.7, 'bold', '#101010', 'left');
    label(ctx, titleX, ty(ymax - 0.62 * unit), subtitle, fs * 0.95, 'normal', '#4a5563', 'left');

    // ---- 视图名 (置于各视图下方) + 所求标记
    for (const n of names) {
      const b = placed(boxes[n], off[n]);
      const cx = tx((b.minX + b.maxX) / 2);
      const cy = ty(b.minY - 0.24 * unit);
      const isAns = (n === answerView);
      label(ctx, cx, cy, labels[n] || n, fs * 1.05, 'bold', isAns ? '#c0392b' : '#4a5563');
      if (isAns) {
        label(ctx, cx + (fs * 1.05 * (labels[n] || n).length * 0.55 + fs * 0.6), cy,
          '【所求 · 答案】', fs, 'bold', '#c0392b', 'left');
      }
    }

    // ---- 图例 + 尺寸
    const legY = ty(gminY - 0.42 * unit);
    const legX = tx(xmin + 0.05 * unit);
    const segW = 24;
    applyStyle(ctx, STYLE.vis);
    ctx.beginPath(); ctx.moveTo(legX, legY); ctx.lineTo(legX + segW, legY); ctx.stroke();
    label(ctx, legX + segW + 6, legY, '可见轮廓线', fs * 0.85, 'normal', '#101010', 'left');
    applyStyle(ctx, STYLE.hid);
    ctx.beginPath(); ctx.moveTo(legX + segW * 4.2, legY); ctx.lineTo(legX + segW * 5.2, legY); ctx.stroke();
    label(ctx, legX + segW * 5.2 + 6, legY, '不可见轮廓线', fs * 0.85, 'normal', '#101010', 'left');
    applyStyle(ctx, STYLE.cen);
    ctx.beginPath(); ctx.moveTo(legX, ty(gminY - 0.68 * unit)); ctx.lineTo(legX + segW, ty(gminY - 0.68 * unit)); ctx.stroke();
    label(ctx, legX + segW + 6, ty(gminY - 0.68 * unit), '中心线', fs * 0.85, 'normal', '#101010', 'left');
    dims.forEach(function (d, i) {
      label(ctx, legX + segW * 9.4, ty(gminY - (0.42 + 0.26 * i) * unit), d, fs * 0.85, 'normal', '#4a5563', 'left');
    });

    return canvas;
  }

  return { render, STYLE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Render;
