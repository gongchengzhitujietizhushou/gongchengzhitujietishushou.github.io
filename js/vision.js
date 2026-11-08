// ============================================================
// js/vision.js
// 工程制图解题助手 —— 前端图像处理 / 参数提取 (纯 Canvas/JS, 无服务器)
// 流程: 载入图片 -> 灰度 -> 锐化(unsharp) -> 自适应二值化 -> 检测 点/线/圆 -> 参数
// ============================================================
'use strict';

const Vision = (() => {

  // ---------------- 基本工具 ----------------
  function toGray(imageData) {
    const d = imageData.data;
    const n = imageData.width * imageData.height;
    const g = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }
    return g;
  }

  function gaussKernel(r) {
    const k = 2 * r + 1;
    const ker = new Float32Array(k);
    const sigma = Math.max(r / 1.6, 0.7);
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      ker[i + r] = v; sum += v;
    }
    for (let i = 0; i < k; i++) ker[i] /= sum;
    return ker;
  }

  // 可分离高斯模糊
  function blur(src, w, h, r) {
    const ker = gaussKernel(r);
    const tmp = new Float32Array(w * h);
    const dst = new Float32Array(w * h);
    // 水平
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0, ws = 0;
        for (let i = -r; i <= r; i++) {
          const xx = x + i;
          if (xx < 0 || xx >= w) continue;
          acc += src[row + xx] * ker[i + r]; ws += ker[i + r];
        }
        tmp[row + x] = acc / (ws || 1);
      }
    }
    // 垂直
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0, ws = 0;
        for (let i = -r; i <= r; i++) {
          const yy = y + i;
          if (yy < 0 || yy >= h) continue;
          acc += tmp[yy * w + x] * ker[i + r]; ws += ker[i + r];
        }
        dst[row + x] = acc / (ws || 1);
      }
    }
    return dst;
  }

  // 非锐化掩模
  function sharpen(gray, w, h, amount, radius) {
    const b = blur(gray, w, h, radius);
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      out[i] = gray[i] + amount * (gray[i] - b[i]);
    }
    return out;
  }

  // 盒式均值 (积分图), 返回均值数组
  function boxMean(src, w, h, r) {
    const intg = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      const row = y * w, irow = (y + 1) * (w + 1), irow0 = y * (w + 1);
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += src[row + x];
        intg[irow + x + 1] = intg[irow0 + x + 1] + rowSum;
      }
    }
    const mean = new Float32Array(w * h);
    const r2 = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const area = (x1 - x0) * (y1 - y0);
        const sum = intg[y1 * (w + 1) + x1] - intg[y0 * (w + 1) + x1]
                  - intg[y1 * (w + 1) + x0] + intg[y0 * (w + 1) + x0];
        mean[row + x] = sum / (area || 1);
      }
    }
    return mean;
  }

  // 自适应二值化: ink = 1 当 (局部均值 - 灰度) > C
  function adaptiveThreshold(gray, w, h, radius, C) {
    const mean = boxMean(gray, w, h, radius);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      mask[i] = (mean[i] - gray[i]) > C ? 255 : 0;
    }
    return mask;
  }

  // 二值形态学: 膨胀 (3x3 椭圆核)
  function dilate(mask, w, h, k) {
    k = k || 1;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = 0;
        for (let dy = -k; dy <= k && !hit; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -k; dx <= k && !hit; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            // 椭圆核近似
            if (dx * dx + dy * dy <= k * k + 1 && mask[yy * w + xx]) hit = 1;
          }
        }
        out[y * w + x] = hit ? 255 : 0;
      }
    }
    return out;
  }

  // 二值形态学: 腐蚀
  function erode(mask, w, h, k) {
    k = k || 1;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let all = 1;
        for (let dy = -k; dy <= k && all; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { all = 0; break; }
          for (let dx = -k; dx <= k && all; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) { all = 0; break; }
            if (dx * dx + dy * dy <= k * k + 1 && !mask[yy * w + xx]) all = 0;
          }
        }
        out[y * w + x] = all ? 255 : 0;
      }
    }
    return out;
  }

  // 开运算 (去噪): 先腐蚀后膨胀
  function morphOpen(mask, w, h, k) {
    return dilate(erode(mask, w, h, k), w, h, k);
  }

  // 闭运算: 先膨胀后腐蚀
  function morphClose(mask, w, h, k) {
    return erode(dilate(mask, w, h, k), w, h, k);
  }

  // Sobel 梯度
  function sobel(gray, w, h) {
    const gx = new Float32Array(w * h);
    const gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        const a = gray[i - w - 1], b = gray[i - w], c = gray[i - w + 1];
        const d = gray[i - 1], e = gray[i + 1];
        const f = gray[i + w - 1], g = gray[i + w], hh = gray[i + w + 1];
        gx[i] = (c + 2 * e + hh) - (a + 2 * d + f);
        gy[i] = (f + 2 * g + hh) - (a + 2 * b + c);
      }
    }
    return { gx, gy };
  }

  // Canny 边缘检测 (高斯模糊 -> sobel -> 非极大抑制 -> 双阈值滞回)
  function canny(gray, w, h, lowRatio, highRatio) {
    lowRatio = lowRatio || 0.4; highRatio = highRatio || 0.9;
    const g = blur(gray, w, h, 1);
    const { gx, gy } = sobel(g, w, h);
    const mag = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) mag[i] = Math.hypot(gx[i], gy[i]);
    // 非极大抑制
    const nms = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x, m = mag[i];
        if (m <= 0) continue;
        const a = Math.atan2(gy[i], gx[i]) * 180 / Math.PI;
        const ang = a < 0 ? a + 180 : a;
        let m1 = 0, m2 = 0;
        if (ang < 22.5 || ang >= 157.5) { m1 = mag[i - 1]; m2 = mag[i + 1]; }
        else if (ang < 67.5) { m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; }
        else if (ang < 112.5) { m1 = mag[i - w]; m2 = mag[i + w]; }
        else { m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; }
        if (m >= m1 && m >= m2) nms[i] = m;
      }
    }
    // 阈值 (分位数)
    const vals = [];
    for (let i = 0; i < w * h; i++) if (nms[i] > 0) vals.push(nms[i]);
    vals.sort((a, b) => a - b);
    const hi = vals[Math.floor(highRatio * (vals.length - 1))] || 1;
    const lo = hi * lowRatio;
    const edges = new Uint8Array(w * h);
    // 标记强/弱
    const strong = new Uint8Array(w * h);
    const weak = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (nms[i] >= hi) strong[i] = 1;
      else if (nms[i] >= lo) weak[i] = 1;
    }
    // 滞回: BFS 从强边扩展到相邻弱边
    const stack = [];
    for (let i = 0; i < w * h; i++) if (strong[i]) { edges[i] = 255; stack.push(i); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const j = yy * w + xx;
        if (weak[j] && !edges[j]) { edges[j] = 255; stack.push(j); }
      }
    }
    return edges;
  }

  // 环形墨迹覆盖率, 验证候选圆
  function ringCoverage(mask, w, h, cx, cy, r, band) {
    const n = 72;
    if (cx - r < 0 || cx + r >= w || cy - r < 0 || cy + r >= h) return 0;
    let hit = 0;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const px = Math.round(cx + r * Math.cos(a));
      const py = Math.round(cy + r * Math.sin(a));
      let found = 0;
      for (let dy = -band; dy <= band && !found; dy++)
        for (let dx = -band; dx <= band && !found; dx++) {
          const xx = px + dx, yy = py + dy;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[yy * w + xx]) found = 1;
        }
      hit += found;
    }
    return hit / n;
  }

  // ---------------- 圆检测 (忠实移植 OpenCV HoughCircles / HOUGH_GRADIENT) ----------------
  // 步骤: Canny 边缘 -> 沿梯度方向双投票累加 (dp=1.5 降采样累加器)
  //       -> param2 阈值 + minDist 非极大抑制 -> 半径直方图精修
  function detectCircle(gray, mask, w, h) {
    // 1) Canny 边缘 (Python: Canny(GaussianBlur(gray, sigma=2), 50, 150))
    const blurEdge = blur(gray, w, h, 3);             // sigma~1.9
    const edges = canny(blurEdge, w, h, 0.4, 0.9);
    // 2) 梯度 (OpenCV 对输入图做 Sobel)
    const { gx, gy } = sobel(gray, w, h);

    const minR = Math.max(40, Math.round(0.04 * Math.min(w, h)));
    const maxR = Math.round(0.30 * Math.min(w, h));
    const dp = 1.5;
    const accW = Math.ceil(w / dp), accH = Math.ceil(h / dp);
    const acc = new Float32Array(accW * accH);

    // 收集 Canny 边缘点 + 梯度方向
    const P = [];
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        if (!edges[i]) continue;
        const vx = gx[i], vy = gy[i];
        const m = Math.hypot(vx, vy);
        if (m < 1) continue;
        const nx = vx / m, ny = vy / m;
        P.push({ x, y, nx, ny });
        // 双方向投票, 沿半径
        for (let r = minR; r <= maxR; r++) {
          const x1 = Math.round(x - nx * r), y1 = Math.round(y - ny * r);
          const x2 = Math.round(x + nx * r), y2 = Math.round(y + ny * r);
          const ax1 = Math.floor(x1 / dp), ay1 = Math.floor(y1 / dp);
          const ax2 = Math.floor(x2 / dp), ay2 = Math.floor(y2 / dp);
          if (ax1 >= 0 && ax1 < accW && ay1 >= 0 && ay1 < accH) acc[ay1 * accW + ax1] += 1;
          if (ax2 >= 0 && ax2 < accW && ay2 >= 0 && ay2 < accH) acc[ay2 * accW + ax2] += 1;
        }
      }
    }

    // 3) 找中心: param2 阈值 + minDist 非极大抑制
    const param2 = 36, minDist = Math.max(40, Math.round(h / 4));
    const cands = [];
    const accArr = Array.from(acc);
    const order = [];
    for (let i = 0; i < accArr.length; i++) order.push(i);
    order.sort((a, b) => accArr[b] - accArr[a]);
    const taken = [];
    for (const i of order) {
      const v = accArr[i];
      if (v < param2) break;
      const cx = Math.floor(i % accW * dp), cy = Math.floor((i / accW | 0) * dp);
      if (taken.some(t => Math.hypot(t[0] - cx, t[1] - cy) < minDist)) continue;
      taken.push([cx, cy]);
      // 4) 半径直方图 (用边缘点距离)
      const hist = new Float32Array(maxR + 1);
      for (const p of P) {
        const d = Math.round(Math.hypot(p.x - cx, p.y - cy));
        if (d >= minR && d <= maxR) hist[d] += 1;
      }
      let br = 0, bv = 0;
      for (let d = minR; d <= maxR; d++) if (hist[d] > bv) { bv = hist[d]; br = d; }
      const cov = ringCoverage(mask, w, h, cx, cy, br, Math.max(4, Math.round(br * 0.04)));
      cands.push({ x: cx, y: cy, r: br, cov, votes: v });
      if (cands.length >= 8) break;
    }
    return cands;
  }

  function quantile(arr, q) {
    const s = Array.from(arr).sort((a, b) => a - b);
    return s[Math.floor(q * (s.length - 1))];
  }

  // ---------------- 连通域 (等价 OpenCV findContours + boundingRect for solid) ----------------
  function connectedComponents(mask, w, h) {
    const labels = new Int32Array(w * h).fill(0);
    const comps = [];
    const stack = new Int32Array(w * h);
    let next = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i] || labels[i]) continue;
        const id = ++next;
        let sp = 0; stack[sp++] = i; labels[i] = id;
        let area = 0, minX = x, maxX = x, minY = y, maxY = y;
        while (sp) {
          const j = stack[--sp]; area++;
          const jx = j % w, jy = (j / w) | 0;
          if (jx < minX) minX = jx; if (jx > maxX) maxX = jx;
          if (jy < minY) minY = jy; if (jy > maxY) maxY = jy;
          if (jx > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = id; stack[sp++] = j - 1; }
          if (jx < w - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = id; stack[sp++] = j + 1; }
          if (jy > 0 && mask[j - w] && !labels[j - w]) { labels[j - w] = id; stack[sp++] = j - w; }
          if (jy < h - 1 && mask[j + w] && !labels[j + w]) { labels[j + w] = id; stack[sp++] = j + w; }
        }
        comps.push({ id, area, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
    return { labels, comps };
  }

  // 封闭面积: bbox 内从边缘 flood fill 背景, 封闭 = 总面积 - 可达背景 (近似 contourArea)
  function enclosedArea(mask, w, h, comp) {
    const x0 = comp.x, x1 = comp.x + comp.w, y0 = comp.y, y1 = comp.y + comp.h;
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 2 || bh <= 2) return 0;
    const seen = new Uint8Array(bw * bh);
    const qx = new Int32Array(bw * bh), qy = new Int32Array(bw * bh);
    let qh = 0, qt = 0;
    for (let x = x0; x < x1; x++) {
      for (const yy of [y0, y1 - 1]) {
        const li = (yy - y0) * bw + (x - x0);
        if (!mask[yy * w + x] && !seen[li]) { seen[li] = 1; qx[qt] = x - x0; qy[qt] = yy - y0; qt++; }
      }
    }
    for (let y = y0; y < y1; y++) {
      for (const xx of [x0, x1 - 1]) {
        const li = (y - y0) * bw + (xx - x0);
        if (!mask[y * w + xx] && !seen[li]) { seen[li] = 1; qx[qt] = xx - x0; qy[qt] = y - y0; qt++; }
      }
    }
    while (qh < qt) {
      const cx = qx[qh], cy = qy[qh]; qh++;
      const nbs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [dx, dy] of nbs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue;
        const li = ny * bw + nx;
        if (!seen[li] && !mask[(y0 + ny) * w + (x0 + nx)]) { seen[li] = 1; qx[qt] = nx; qy[qt] = ny; qt++; }
      }
    }
    let reachable = 0;
    for (let i = 0; i < bw * bh; i++) if (seen[i]) reachable++;
    return bw * bh - reachable;
  }

  // 行列投影精化矩形边缘 (等价 Python _refine_rect_edges)
  function refineRectEdges(mask, w, h, rect) {
    const x = rect.x, y = rect.y, rw = rect.w, rh = rect.h;
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(w, x + rw), y1 = Math.min(h, y + rh);
    if (x1 - x0 <= 0 || y1 - y0 <= 0) return rect;
    const cw = x1 - x0, ch = y1 - y0;
    const col = new Float32Array(cw), row = new Float32Array(ch);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        if (mask[yy * w + xx]) { col[xx - x0]++; row[yy - y0]++; }
      }
    }
    const cmax = quantile(Array.from(col), 0.98) || 1;
    const rmax = quantile(Array.from(row), 0.98) || 1;
    const th = 0.35;
    let lx = 0; for (let i = 0; i < cw; i++) if (col[i] >= cmax * th) { lx = i; break; }
    let rx = cw - 1; for (let i = cw - 1; i >= 0; i--) if (col[i] >= cmax * th) { rx = i; break; }
    let ty = 0; for (let i = 0; i < ch; i++) if (row[i] >= rmax * th) { ty = i; break; }
    let by = ch - 1; for (let i = ch - 1; i >= 0; i--) if (row[i] >= rmax * th) { by = i; break; }
    return { x: x0 + lx, y: y0 + ty, w: Math.max(rx - lx, 10), h: Math.max(by - ty, 10) };
  }

  // ---------------- 矩形检测 (连通域 + 封闭面积, 等价 Python find_rectangles) ----------------
  function detectRect(gray, mask, w, h) {
    // Python 用 MORPH_CLOSE(5) 再 findContours(RETR_EXTERNAL)
    const closed = morphClose(mask, w, h, 2);
    const { comps } = connectedComponents(closed, w, h);
    // 按面积降序
    comps.sort((a, b) => b.area - a.area);
    // Python: area < 20000 skip (固定阈值, 已按 1500 图校准, 随分辨率缩放)
    const minArea = Math.max(15000 * (w / 1500) * (h / 1125), 1500);
    const rects = [];
    for (const c of comps) {
      if (c.area < minArea) break;
      if (c.x + c.w > 0.70 * w) continue;               // 前端视图应在左半部
      const en = enclosedArea(closed, w, h, c);
      const rectArea = c.w * c.h;
      if (rectArea <= 0 || en / rectArea < 0.6) continue;
      if (c.w < 0.10 * w || c.h < 0.05 * h) continue;
      rects.push({ x: c.x, y: c.y, w: c.w, h: c.h });
      if (rects.length >= 3) break;
    }
    if (!rects.length) return null;
    const best = rects[0];
    return refineRectEdges(mask, w, h, best);
  }

  // ---------------- 三角形检测 (孔口): 每列墨迹跨度, 拟合 V 形 ----------------
  // 尖点在左(X1), 底边垂直基线在右(X2), 半高 A (相对矩形中心)
  function detectTriangle(mask, w, h, rect) {
    const fx = rect.x, fy = rect.y, fw = rect.w, fh = rect.h;
    if (fw <= 20 || fh <= 20) return null;
    const cy = fy + fh / 2;
    const border = Math.max(8, Math.round(fw * 0.03));
    const x0 = fx + border, x1 = fx + fw - border;
    const yTop = fy + border, yBot = fy + fh - border;
    if (x1 - x0 <= 10 || yBot - yTop <= 10) return null;

    // 每列: 最长连续垂直 run (基线检测) 与 墨迹跨度 (斜线拟合)
    const cols = [];
    for (let x = x0; x < x1; x++) {
      let bestRun = 0, runStart = -1, r0 = 0, r1 = 0;
      let top = -1, bot = -1;
      for (let y = yTop; y < yBot; y++) {
        if (mask[y * w + x]) {
          if (top < 0) top = y;
          bot = y;
          if (runStart < 0) runStart = y;
        } else if (runStart >= 0) {
          const len = y - runStart;
          if (len > bestRun) { bestRun = len; r0 = runStart; r1 = y; }
          runStart = -1;
        }
      }
      if (runStart >= 0) { const len = yBot - runStart; if (len > bestRun) { bestRun = len; r0 = runStart; r1 = yBot; } }
      if (top >= 0) {
        cols.push({
          x: x - fx, run: bestRun, r0: r0 - cy, r1: r1 - cy,
          top: top - cy, bot: bot - cy, spread: (bot - top) / 2,
        });
      }
    }
    if (!cols.length) return null;

    // X2 = 对称于 cy 的最长垂直基线
    let base = null;
    for (const c of cols) {
      if (c.run < 0.5 * fh) continue;
      if (Math.abs(c.r0 + c.r1) > 0.25 * fh) continue;
      if (!base || c.run > base.run) base = c;
    }
    if (!base) return null;
    const X2 = base.x, A = base.run / 2;

    // 拟合斜线: spread(x) = A*(X2-x)/(X2-X1) -> X1 = X2 - A/slope
    const fitPts = cols.filter(c => c.x < X2 - 5 && c.spread > 0.2 * A && c.spread < 0.9 * A && Math.abs(c.top + c.bot) < 15);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (const p of fitPts) { sx += p.x; sy += p.spread; sxx += p.x * p.x; sxy += p.x * p.spread; n++; }
    const slope = n > 3 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
    let X1 = slope > 0.01 ? X2 - A / slope : X2 - 0.7 * fw;
    X1 = Math.max(0, Math.min(X1, X2 - 5));
    return { X1: Math.round(X1), X2: Math.round(X2), A: Math.round(A * 2) / 2 };
  }

  // ---------------- 弦检测 (左视图虚线) ----------------
  function detectChords(mask, w, h, circle) {
    const { x: cx, y: cy, r } = circle;
    const x0 = Math.max(0, Math.round(cx - r * 1.02));
    const x1 = Math.min(w, Math.round(cx + r * 1.02));
    const y0 = Math.max(0, Math.round(cy - r * 1.02));
    const y1 = Math.min(h, Math.round(cy + r * 1.02));
    const winW = x1 - x0, winH = y1 - y0;
    if (winW <= 0 || winH <= 0) return [];
    const rows = [];
    for (let y = y0; y < y1; y++) {
      let mn = -1, mx = -1, cnt = 0;
      for (let x = x0; x < x1; x++) {
        if (mask[y * w + x]) { if (mn < 0) mn = x; mx = x; cnt++; }
      }
      // Python: len(xs) < 0.12*w -> skip; span < 0.25*(2r) -> skip
      if (cnt < 0.12 * winW || mn < 0) continue;
      const span = mx - mn;
      if (span < 0.25 * (2 * r)) continue;
      // Python: abs(xs.mean() - w/2) > 0.2*w -> skip
      const meanX = (mn + mx) / 2;
      if (Math.abs(meanX - (x0 + winW / 2)) > 0.2 * winW) continue;
      rows.push({ y, offset: Math.abs(y - cy), half: span / 2 });
    }
    // 聚类相邻行
    rows.sort((a, b) => a.y - b.y);
    const groups = [];
    let cur = [];
    for (const rw of rows) {
      if (!cur.length || rw.y - cur[cur.length - 1].y <= 4) cur.push(rw);
      else { groups.push(cur); cur = [rw]; }
    }
    if (cur.length) groups.push(cur);
    const out = [];
    for (const g of groups) {
      const y = Math.round(g.reduce((s, r) => s + r.y, 0) / g.length);
      const off = Math.abs(y - cy);
      const half = Math.max(...g.map(r => r.half));
      // Python: 0.15r < off < 0.92r (排除中心线 & 圆边界)
      if (off > 0.15 * r && off < 0.92 * r) out.push({ y, offset: off, half_len: half });
    }
    return out;
  }

  // ---------------- 参数提取 (主入口, 镜像后端) ----------------
  function extractParams(gray, mask, w, h) {
    const params = {
      image: { w, h },
      views: { front: null, left: null, top: null },
      features: {},
      problem_type: null,
      confidence: 0,
      notes: [],
    };
    const circles = detectCircle(gray, mask, w, h);
    // 左视图: Python 按半径降序, 取第一个右半部且圆周墨迹覆盖率合格的圆
    circles.sort((a, b) => b.r - a.r);
    let leftCircle = null;
    for (const c of circles) {
      if (c.x < 0.45 * w) continue;
      if (c.cov < 0.5) continue;
      leftCircle = c;
      break;
    }
    const rect = detectRect(gray, mask, w, h);
    if (!leftCircle && !rect) {
      params.notes.push('未能可靠识别视图, 请尝试更清晰的图片。');
      return params;
    }

    if (rect) {
      const front = { rect: [rect.x, rect.y, rect.w, rect.h], L: rect.w, H: rect.h };
      const tri = detectTriangle(mask, w, h, rect);
      if (tri) { front.triangle = [tri.X1, tri.X2, tri.A]; front.X1 = tri.X1; front.X2 = tri.X2; front.A = tri.A; }
      front.center_y = rect.y + rect.h / 2;
      params.views.front = front;
    }
    if (leftCircle) {
      const left = { circle: [leftCircle.x, leftCircle.y, leftCircle.r], R: leftCircle.r, center: [leftCircle.x, leftCircle.y] };
      const chords = detectChords(mask, w, h, leftCircle);
      if (chords.length) {
        left.chords = chords;
        const cy = leftCircle.y;
        const above = chords.filter(c => c.y < cy);
        const below = chords.filter(c => c.y > cy);
        let bestPair = null;
        for (const a of above) for (const b of below) {
          // 优先选 offset 与主视图三角 A 一致的对称对 (跨视图自洽)
          const diff = Math.abs(a.offset - b.offset);
          if (!bestPair || diff < bestPair.diff) bestPair = { a, b, diff };
        }
        // 若主视图三角 A 可用, 用它筛选最优对称对 (跨视图一致性)
        const frontA = params.views.front && params.views.front.A;
        if (frontA && bestPair) {
          let best = null;
          for (const a of above) for (const b of below) {
            const off = (a.offset + b.offset) / 2;
            const dev = Math.abs(off - frontA) / frontA;
            const sym = Math.abs(a.offset - b.offset) / frontA;
            if (!best || dev + sym < best.score) best = { a, b, score: dev + sym };
          }
          if (best) bestPair = { a: best.a, b: best.b, diff: Math.abs(best.a.offset - best.b.offset) };
        }
        if (bestPair) {
          left.A = (bestPair.a.offset + bestPair.b.offset) / 2;
          left.W = (bestPair.a.half_len + bestPair.b.half_len) / 2;
        } else {
          chords.sort((a, b) => a.offset - b.offset);
          const top2 = chords.slice(0, 2);
          left.A = top2.reduce((s, c) => s + c.offset, 0) / top2.length;
          left.W = top2.reduce((s, c) => s + c.half_len, 0) / top2.length;
        }
      }
      params.views.left = left;
    }
    classify(params);
    return params;
  }

  function classify(params) {
    const front = params.views.front, left = params.views.left;
    if (front && left) {
      params.problem_type = 'cylinder_wedge_hole';
      params.confidence = 0.8;
      params.notes.push('识别到主视图(矩形+三角孔口)与左视图(圆+两条虚线弦)。');
      const R = left.R, A = left.A, W = left.W;
      if (R && A && W) {
        const Wt = Math.sqrt(R * R - A * A);
        const err = Math.abs(W - Wt) / (Wt || 1);
        if (err < 0.15) { params.confidence = Math.min(0.98, params.confidence + 0.15); params.notes.push('几何自洽: W≈√(R²−A²) (3-4-5 关系成立)。'); }
        else { params.confidence = Math.max(0.5, params.confidence - 0.1); params.notes.push('弦长与圆半径关系偏差较大, 按测量值求解。'); }
      }
    } else {
      params.problem_type = 'unrecognized';
      params.confidence = 0.2;
      params.notes.push('仅识别到部分视图, 给出通用重建。');
    }
  }

  // ---------------- 渲染辅助: 把检测结果画回 canvas ----------------
  function drawAnnotated(canvas, params) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.strokeStyle = '#dc2c2c'; ctx.lineWidth = Math.max(2, w * 0.002);
    const f = params.views.front;
    if (f && f.rect) {
      ctx.strokeRect(f.rect[0], f.rect[1], f.rect[2], f.rect[3]);
      if (f.triangle) {
        const [X1, X2, A] = f.triangle;
        const yc = f.center_y;
        ctx.beginPath();
        ctx.moveTo(f.rect[0] + X1, yc);
        ctx.lineTo(f.rect[0] + X2, yc - A);
        ctx.lineTo(f.rect[0] + X2, yc + A);
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.strokeStyle = '#1c64d9';
    const l = params.views.left;
    if (l && l.circle) {
      const [cx, cy, r] = l.circle;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 2 * Math.PI); ctx.fillStyle = '#1c64d9'; ctx.fill();
      for (const c of (l.chords || [])) {
        ctx.beginPath(); ctx.moveTo(cx - c.half_len, c.y); ctx.lineTo(cx + c.half_len, c.y); ctx.stroke();
      }
    }
    return canvas;
  }

  // ---------------- 顶层: 载入文件 -> 处理 -> 返回结果 ----------------
  async function loadImageFile(file, maxW) {
    maxW = maxW || 1500;
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('无法解码图片')); img.src = url; });
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, maxW / w);
    w = Math.round(w * scale); h = Math.round(h * scale);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return cx.getImageData(0, 0, w, h);
  }

  // 把 Float32Array 灰度写成灰度 canvas
  function grayToCanvas(gray, w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    const id = cx.createImageData(w, h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const v = Math.max(0, Math.min(255, gray[i]));
      id.data[p] = id.data[p + 1] = id.data[p + 2] = v; id.data[p + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }

  function maskToCanvas(mask, w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    const id = cx.createImageData(w, h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const v = mask[i] ? 0 : 255;
      id.data[p] = id.data[p + 1] = id.data[p + 2] = v; id.data[p + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }

  // 完整管线
  async function runPipeline(imageData) {
    const w = imageData.width, h = imageData.height;
    const gray0 = toGray(imageData);
    // Python: sharpen(1.6, sigma3) -> gray
    const gray = sharpen(gray0, w, h, 1.6, 5);
    // Python ink_mask: GaussianBlur(gray, sigma1.2) -> adaptiveThreshold(51, 18) -> MORPH_OPEN
    const pre = blur(gray, w, h, 2);
    const mask0 = adaptiveThreshold(pre, w, h, 25, 18);
    const mask = morphOpen(mask0, w, h, 1);
    const params = extractParams(gray, mask, w, h);

    const processed = grayToCanvas(gray, w, h);
    const annotated = drawAnnotated(grayToCanvas(gray, w, h), params);
    const maskCanvas = maskToCanvas(mask, w, h);
    return { processed, annotated, maskCanvas, params, gray };
  }

  return { loadImageFile, runPipeline, extractParams, sharpen, adaptiveThreshold,
           detectCircle, detectRect, detectTriangle, detectChords, drawAnnotated,
           grayToCanvas, maskToCanvas, toGray, sobel, blur, boxMean, ringCoverage,
           quantile, canny, dilate, erode, morphOpen, morphClose,
           connectedComponents, enclosedArea, refineRectEdges };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Vision;
