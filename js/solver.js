// ============================================================
// js/solver.js
// 工程制图解题助手 —— 解题算法 (纯前端 JS 移植自 core/solver.py)
// 对 "圆柱 + 前后贯通楔形孔" 立体题型 (top_view/left_view/front_view) 求解:
//   计算该立体的主视图 / 左视图 / 俯视图 三视图, 由 Render 高亮所求视图。
// 几何模型 (轴线水平圆柱):
//   圆柱: 半径 R, 长度 L, 轴线沿 x, 圆柱面 y²+z²=R², 0<=x<=L
//   楔形孔: 沿 z 贯通, 三角截面 (x-y): 斜面 y=±K(x−X1), K=A/(X2−X1)
//           孔底 x=X2, 孔口半高 A, 孔底半弦长 W=√(R²−A²)
// ============================================================
'use strict';

const Solver = (() => {

  // 测量值整理为自洽几何参数 (像素单位, 同图比例一致)
  function reconcile(params) {
    const front = (params.views && params.views.front) || {};
    const left = (params.views && params.views.left) || {};
    const notes = Array.isArray(params.notes) ? params.notes.slice() : [];

    const R_circle = left.R;
    const H = front.H;
    const L = front.L;

    // 半径 R: 左视图圆最可靠; 主视图矩形高 H=2R 校核
    let R = R_circle ? Number(R_circle) : (H ? H / 2 : null);
    if (R_circle && H) {
      const R_front = H / 2;
      if (Math.abs(R_front - R_circle) / R_circle < 0.15) {
        R = (R_circle + R_front) / 2;
      } else {
        R = Number(R_circle);
        notes.push(`主视图高/2 与圆半径偏差较大, 取圆半径 R=${R.toFixed(0)}。`);
      }
    }

    // 长度 L
    if (!L || !R || L / R < 1.2) {
      notes.push('主视图长度 L 与半径 R 比例异常, 用默认 L=2.6R。');
      L = 2.6 * R;
    }

    // 孔参数
    let X1 = front.X1;
    let X2 = front.X2;
    let A = front.A != null ? front.A : left.A;
    if (A == null) {
      A = 0.8 * R;
      notes.push('未量到孔口半高 A, 取 A=0.8R。');
    }
    A = Math.min(Math.max(A, 0.1 * R), 0.95 * R);

    if (X1 == null || X2 == null) {
      X1 = 0.15 * L; X2 = 0.80 * L;
      notes.push('未量到三角孔口位置, 取 X1=0.15L, X2=0.8L。');
    }
    X1 = Math.min(Math.max(X1, 0.02 * L), X2 - 0.05 * L);
    X2 = Math.min(Math.max(X2, X1 + 0.05 * L), 0.98 * L);

    // 孔底半弦长 W: 3-4-5 关系 W=√(R²−A²) (设计意图), 测量值仅作校核
    const W_meas = left.W;
    const W_theory = Math.sqrt(Math.max(R * R - A * A, 0));
    const W = W_theory;
    if (W_meas) {
      const dev = Math.abs(W_meas - W_theory) / Math.max(W_theory, 1e-6);
      notes.push(`弦长: 测量 ${W_meas.toFixed(0)} vs 理论 √(R²−A²)=${W_theory.toFixed(0)} (偏差 ${(dev * 100).toFixed(0)}%)。`);
    }

    return {
      R: round2(R), L: round2(L), X1: round2(X1), X2: round2(X2),
      A: round2(A), W: round2(W),
      W_meas: W_meas != null ? round2(W_meas) : null,
      K: round4(A / (X2 - X1)),
      notes,
    };
  }

  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  // 束腰椭圆弧 (x∈[X1,X2])
  function waist(geo, n) {
    n = n || 120;
    const R = geo.R, X1 = geo.X1, X2 = geo.X2, K = geo.K;
    const xs = [], ztop = [], zbot = [];
    for (let i = 0; i < n; i++) {
      const x = X1 + (X2 - X1) * i / (n - 1);
      const y = K * (x - X1);
      const z = Math.sqrt(Math.max(R * R - y * y, 0));
      xs.push(x); ztop.push(z); zbot.push(-z);
    }
    return { xs, ztop, zbot };
  }

  // 俯视图基本图元 (坐标系: x 向右, z 向上)
  function topViewPrimitives(geo) {
    const R = geo.R, L = geo.L, X1 = geo.X1, X2 = geo.X2, W = geo.W;
    const prims = [];
    const { xs, ztop, zbot } = waist(geo);

    // 外轮廓上下直边 (被束腰分成两段)
    for (const zc of [R, -R]) {
      prims.push({ type: 'line', a: [0, zc], b: [X1, zc], kind: 'visible', width: 2.6 });
      prims.push({ type: 'line', a: [X2, zc], b: [L, zc], kind: 'visible', width: 2.6 });
    }
    // 左右端面
    prims.push({ type: 'line', a: [0, -R], b: [0, R], kind: 'visible', width: 2.6 });
    prims.push({ type: 'line', a: [L, -R], b: [L, R], kind: 'visible', width: 2.6 });
    // 束腰椭圆弧
    prims.push({ type: 'poly', pts: xs.map((x, i) => [x, ztop[i]]), kind: 'visible', width: 2.6 });
    prims.push({ type: 'poly', pts: xs.map((x, i) => [x, zbot[i]]), kind: 'visible', width: 2.6 });
    // 孔底平面处可见竖直线段 |z|∈[W,R]
    for (const s of [1, -1]) {
      prims.push({ type: 'line', a: [X2, s * W], b: [X2, s * R], kind: 'visible', width: 2.6 });
    }
    // 孔底平面 (不可见)
    prims.push({ type: 'line', a: [X2, -W], b: [X2, W], kind: 'hidden', width: 1.5 });
    // 孔尖 (不可见)
    prims.push({ type: 'line', a: [X1, -R], b: [X1, R], kind: 'hidden', width: 1.5 });
    // 中心线 (俯视图: 轴线 z=0)
    prims.push({ type: 'line', a: [-12, 0], b: [L + 12, 0], kind: 'center', width: 0.95 });
    return prims;
  }

  // 主视图图元
  function frontPrimitives(geo) {
    const R = geo.R, L = geo.L, X1 = geo.X1, X2 = geo.X2, A = geo.A;
    const prims = [];
    const rect = [[0, -R], [L, -R], [L, R], [0, R]];
    for (let i = 0; i < 4; i++) {
      prims.push({ type: 'line', a: rect[i], b: rect[(i + 1) % 4], kind: 'visible', width: 2.0 });
    }
    const tri = [[X1, 0], [X2, A], [X2, -A]];
    for (let i = 0; i < 3; i++) {
      prims.push({ type: 'line', a: tri[i], b: tri[(i + 1) % 3], kind: 'visible', width: 2.0 });
    }
    // 中心线 (主视图: 轴线 y=0)
    prims.push({ type: 'line', a: [-12, 0], b: [L + 12, 0], kind: 'center', width: 0.95 });
    return prims;
  }

  // 左视图图元
  function leftPrimitives(geo) {
    const R = geo.R, A = geo.A, W = geo.W;
    const prims = [{ type: 'circle', c: [0, 0], r: R, kind: 'visible', width: 2.0 }];
    for (const s of [1, -1]) {
      prims.push({ type: 'line', a: [-W, s * A], b: [W, s * A], kind: 'hidden', width: 1.4 });
    }
    // 中心线 (左视图: 十字)
    prims.push({ type: 'line', a: [-R - 12, 0], b: [R + 12, 0], kind: 'center', width: 0.95 });
    prims.push({ type: 'line', a: [0, -R - 12], b: [0, R + 12], kind: 'center', width: 0.95 });
    return prims;
  }

  // 文字说明
  function explain(geo) {
    const R = geo.R, L = geo.L, X1 = geo.X1, X2 = geo.X2, A = geo.A, W = geo.W;
    return [
      `立体为轴线水平的圆柱: 半径 R=${R.toFixed(0)}, 长度 L=${L.toFixed(0)} (L/R=${(L / R).toFixed(2)})。`,
      `主视图三角孔口: 尖点 x=X1=${X1.toFixed(0)}, 孔底 x=X2=${X2.toFixed(0)}, 孔口半高 A=${A.toFixed(0)} (= ${(A / R).toFixed(2)}R)。孔沿前后方向贯通, 截面为楔形。`,
      `左视图两条虚线弦位于 y=±A, 即孔底平面(垂直于轴线 x=X2)上下两条棱边的投影, 弦长之半 W=√(R²−A²)=${W.toFixed(0)} (= ${(W / R).toFixed(2)}R), 3-4-5 关系成立。`,
      `斜平面与圆柱面的交线为椭圆, 孔把圆柱前后两侧切断, 故俯视图轮廓向内收缩, 形成两条椭圆弧"束腰" (x 从 X1=${X1.toFixed(0)} 到 X2=${X2.toFixed(0)})。`,
      `俯视图: 孔底平面 x=X2 处为一条虚线 (长 2W=${(2 * W).toFixed(0)}); 孔尖 x=X1 处两侧面交线亦为虚线 (长 2R=${(2 * R).toFixed(0)})。`,
    ];
  }

  // 主求解入口
  function solve(params) {
    const geo = reconcile(params);
    const ptype = params.problem_type || 'unrecognized';
    const result = {
      problem_type: ptype, geometry: geo, views: {}, explanation: [],
      confidence: params.confidence || 0,
    };
    if (ptype === 'cylinder_wedge_hole') {
      result.views.top = topViewPrimitives(geo);
      result.views.front = frontPrimitives(geo);
      result.views.left = leftPrimitives(geo);
      result.explanation = explain(geo);
      result.confidence = params.confidence || 0.7;
      result.status = 'solved';
    } else {
      result.status = 'partial';
      result.explanation = [
        '未能完全识别题型, 给出参数与说明。',
        '请上传更清晰的工程图图片，系统会尝试识别视图与几何图元并求解。',
      ];
    }
    return result;
  }

  return { solve, reconcile, topViewPrimitives, frontPrimitives, leftPrimitives, waist, explain };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
