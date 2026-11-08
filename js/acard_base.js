// ============================================================
// js/acard_base.js
// 答案卡基础构建器 (ACardBase)
// ------------------------------------------------------------
// 供各答案卡模块 (acard_xxx.js) 复用的公共函数与共享立体卡片:
//
//   通用工具:
//     loadScript(src)           按需加载一个 <script>
//     loadScripts([...])        按需依次加载多个 <script>
//     loadThree()               懒加载 three.js + OrbitControls
//     num(v) / fmt(v)           数值解析 / 格式化
//     fillText(root, sel, txt)  设置元素文本
//     injectNotes(root, list)   渲染说明列表 (.acard-notes)
//     injectAnalysis(root, txt) 展开解题过程 (.acard-analysis)
//     buildCardShell(host, opt) 创建答案卡骨架 (head/main/panel/analysis)
//     renderAnswerImage(result, canvas, opts) 用 Render 画答案图并返回 dataURL
//
//   共享立体答案卡 (圆柱 + 楔形孔, 三视图, target 决定"所求"):
//     normalize(data)           校验并规范化 { R,L,X1,X2,A }
//     mountSolidCard(host, data, meta, target) 挂载 3D + 三视图答案卡
//     buildSolidScene(THREE, stage, d) 构建立体 3D 场景实例
//     targets                   各"所求"视图文案 / Render 参数
//
// 目标: 让"答案卡"与"立体"解耦 —— 新题型若复用立体只调
// mountSolidCard; 若是全新题型, 用 buildCardShell + 通用工具自行组装。
// ============================================================
'use strict';

(function () {

  const THREE_URL = 'js/vendor/three.min.js';
  const ORBIT_URL = 'js/vendor/OrbitControls.js';

  // ============================================================
  // 一、通用工具
  // ============================================================

  // ---------- 按需加载 <script> ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const found = document.querySelector('script[data-acard-src="' + src + '"]');
      if (found) {
        if (found.dataset.loaded === '1') { resolve(); return; }
        found.addEventListener('load', () => resolve(), { once: true });
        found.addEventListener('error', () => reject(new Error('加载失败: ' + src)), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.acardSrc = src;
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error('加载失败: ' + src));
      document.head.appendChild(s);
    });
  }

  function loadScripts(srcs) {
    return srcs.reduce(function (p, s) { return p.then(() => loadScript(s)); }, Promise.resolve());
  }

  // ---------- 懒加载 three.js + OrbitControls ----------
  let threePromise = null;

  function loadThree() {
    if (typeof window !== 'undefined' && window.THREE && window.THREE.OrbitControls) {
      return Promise.resolve(window.THREE);
    }
    if (!threePromise) {
      threePromise = loadScripts([THREE_URL, ORBIT_URL])
        .then(() => {
          if (!window.THREE) throw new Error('three.js 加载失败');
          if (!window.THREE.OrbitControls) throw new Error('OrbitControls 加载失败');
          return window.THREE;
        })
        .catch((e) => { threePromise = null; throw e; });
    }
    return threePromise;
  }

  // ---------- 数值 ----------
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  }

  // ---------- DOM 工具 ----------
  function fillText(root, selector, text) {
    const el = root.querySelector(selector);
    if (el) el.textContent = text;
  }

  // 渲染说明列表 (去重)
  function injectNotes(root, list) {
    const notesEl = root.querySelector('.acard-notes');
    if (!notesEl) return;
    const seen = Object.create(null);
    (Array.isArray(list) ? list : []).forEach(function (t) {
      t = String(t || '').trim();
      if (!t || seen[t]) return;
      seen[t] = 1;
      const li = document.createElement('li');
      li.textContent = t;
      notesEl.appendChild(li);
    });
  }

  // 展开解题过程
  function injectAnalysis(root, text) {
    if (!text) return;
    const details = root.querySelector('.acard-analysis');
    const body = root.querySelector('.acard-analysis-body');
    if (!details || !body) return;
    details.hidden = false;
    body.textContent = text;
  }

  // 创建答案卡骨架 (默认 solid 模板; 新题型可传自定义 template)
  function buildCardShell(host, opts) {
    opts = opts || {};
    const root = document.createElement('div');
    root.className = 'acard ' + (opts.className || 'acard-solid');
    root.innerHTML = opts.template || TEMPLATE;
    host.appendChild(root);
    return root;
  }

  // 用 Render 画答案图, 返回 dataURL (失败返回 null)
  function renderAnswerImage(result, canvas, opts) {
    try {
      Render.render(result, canvas, opts || {});
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 二、共享立体答案卡 (圆柱 + 楔形孔)
  // ============================================================

  // 各"所求"视图的文案 / Render 参数
  const TARGETS = {
    top: {
      view: 'top',
      title: '求作俯视图',
      badge: '俯视图',
      panel: '俯视图 · 答案',
      known: '主视图、左视图',
      answer: '俯视图',
    },
    left: {
      view: 'left',
      title: '求作左视图',
      badge: '左视图',
      panel: '左视图 · 答案',
      known: '主视图、俯视图',
      answer: '左视图',
    },
    front: {
      view: 'front',
      title: '求作主视图',
      badge: '主视图',
      panel: '主视图 · 答案',
      known: '左视图、俯视图',
      answer: '主视图',
    },
  };

  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    const R = num(data.R);
    const L = num(data.L);
    const X1 = num(data.X1);
    const X2 = num(data.X2);
    const A = num(data.A);
    if (!(R > 0 && L > 0 && A > 0 && A < R)) return null;
    if (!(X1 >= 0 && X2 > X1 && X2 <= L * 1.0001)) return null;
    return { R: R, L: L, X1: X1, X2: X2, A: A };
  }

  function solverParams(d) {
    return {
      views: {
        front: {
          rect: [0, 0, d.L, 2 * d.R], L: d.L, H: 2 * d.R,
          X1: d.X1, X2: d.X2, A: d.A, center_y: d.R,
        },
        left: { circle: [0, 0, d.R], R: d.R, center: [0, 0], A: d.A },
      },
      problem_type: 'solid_wedge_hole',
      confidence: 0.9,
    };
  }

  // ---------- 卡片 DOM (solid 默认模板) ----------
  const TEMPLATE = [
    '<div class="acard-head">',
    '  <div class="acard-heading">',
    '    <span class="acard-badge">3D</span>',
    '    <div class="acard-heading-text">',
    '      <div class="acard-title"></div>',
    '      <div class="acard-sub"></div>',
    '    </div>',
    '  </div>',
    '  <div class="acard-views">',
    '    <button type="button" data-view="iso" class="active">轴测</button>',
    '    <button type="button" data-view="front">主视图</button>',
    '    <button type="button" data-view="left">左视图</button>',
    '    <button type="button" data-view="top">俯视图</button>',
    '  </div>',
    '</div>',
    '<div class="acard-main">',
    '  <section class="acard-stage">',
    '    <span class="acard-view-label">轴测 (自由旋转)</span>',
    '    <div class="acard-toggles">',
    '      <label><input type="checkbox" data-toggle="edges" checked> 交线 / 棱线</label>',
    '      <label><input type="checkbox" data-toggle="wire"> 线框</label>',
    '      <label><input type="checkbox" data-toggle="spin"> 自动旋转</label>',
    '    </div>',
    '    <div class="acard-hint">左键拖动旋转 · 滚轮缩放 · 右键平移</div>',
    '  </section>',
    '  <aside class="acard-panel">',
    '    <h4 class="acard-panel-title">俯视图 · 答案 <span>【所求】</span></h4>',
    '    <div class="acard-shot"><img alt="答案：三视图"></div>',
    '    <p class="acard-caption">主视图、左视图为已知（灰蓝）；俯视图为所求（黑、加粗）。</p>',
    '    <ul class="acard-notes"></ul>',
    '  </aside>',
    '</div>',
    '<details class="acard-analysis" hidden>',
    '  <summary>解题过程</summary>',
    '  <div class="acard-analysis-body"></div>',
    '</details>',
  ].join('');

  // ---------- 三维场景 ----------
  function buildSolidScene(THREE, stage, d) {
    const R = d.R, L = d.L, X1 = d.X1, X2 = d.X2, A = d.A;
    const K = A / (X2 - X1);
    const X0 = -L / 2;

    function yslot(m) { return Math.min(A, Math.max(0, K * (m - X1))); }
    function ymax(m) { return (m <= X1 || m >= X2) ? 0 : yslot(m); }
    function halfW(m) {
      const y = yslot(m);
      return Math.sqrt(Math.max(0, R * R - y * y));
    }

    const scene = new THREE.Scene();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    stage.appendChild(renderer.domElement);

    const cams = {};
    const ctl = {};
    let current = 'iso';

    cams.persp = new THREE.PerspectiveCamera(32, 1, 1, 40000);
    cams.persp.position.set(158, 112, 170);
    cams.persp.lookAt(0, 0, 0);

    cams.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40000);
    cams.ortho.lookAt(0, 0, 0);

    // 光照
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x0e1a26, 0.62));

    const key = new THREE.DirectionalLight(0xffffff, 0.72);
    key.position.set(190, 250, 170);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fb8ff, 0.34);
    fill.position.set(-210, 60, -160);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe0bd, 0.28);
    rim.position.set(-60, -180, 120);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    // ---------- 造面工具 ----------
    function Surface() {
      this.pos = [];
      this.nor = [];
    }

    Surface.prototype.add = function (fn, fnN, nu, nv) {
      const P = [], N = [];
      let i, j, u, v;

      for (i = 0; i <= nu; i++) {
        P[i] = []; N[i] = [];
        for (j = 0; j <= nv; j++) {
          u = i / nu; v = j / nv;
          P[i][j] = fn(u, v);
          N[i][j] = fnN(u, v).normalize();
        }
      }

      const i0 = Math.floor(nu / 2), j0 = Math.floor(nv / 2);
      const e1 = new THREE.Vector3().subVectors(P[i0 + 1][j0], P[i0][j0]);
      const e2 = new THREE.Vector3().subVectors(P[i0][j0 + 1], P[i0][j0]);
      const g = new THREE.Vector3().crossVectors(e1, e2);
      const flip = g.dot(N[i0][j0]) < 0;

      const self = this;

      function tri(a, na, b, nb, c, nc) {
        if (flip) {
          const t = b; b = c; c = t;
          const tn = nb; nb = nc; nc = tn;
        }
        self.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        self.nor.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
      }

      for (i = 0; i < nu; i++) {
        for (j = 0; j < nv; j++) {
          const p00 = P[i][j], p10 = P[i + 1][j];
          const p01 = P[i][j + 1], p11 = P[i + 1][j + 1];
          const n00 = N[i][j], n10 = N[i + 1][j];
          const n01 = N[i][j + 1], n11 = N[i + 1][j + 1];
          tri(p00, n00, p10, n10, p11, n11);
          tri(p00, n00, p11, n11, p01, n01);
        }
      }
    };

    Surface.prototype.geometry = function () {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      return g;
    };

    // ---------- 造立体 ----------
    const so = new Surface();    // 外表面
    const si = new Surface();    // 孔内表面
    const V = THREE.Vector3;

    function lateral(m0, m1, bottom, nu) {
      return {
        fn: function (u, v) {
          const m = m0 + (m1 - m0) * u;
          const p0 = Math.asin(Math.min(1, Math.max(-1, ymax(m) / R)));
          let phi = p0 + v * (Math.PI - 2 * p0);
          if (bottom) phi += Math.PI;
          return new V(m + X0, R * Math.sin(phi), R * Math.cos(phi));
        },
        nfn: function (u, v) {
          const m = m0 + (m1 - m0) * u;
          const p0 = Math.asin(Math.min(1, Math.max(-1, ymax(m) / R)));
          let phi = p0 + v * (Math.PI - 2 * p0);
          if (bottom) phi += Math.PI;
          return new V(0, Math.sin(phi), Math.cos(phi));
        },
      };
    }

    [[0, X1], [X1, X2], [X2, L]].forEach(function (seg) {
      [false, true].forEach(function (bottom) {
        const p = lateral(seg[0], seg[1], bottom);
        const nu = Math.max(12, Math.round((seg[1] - seg[0]) * 1.8 / Math.max(1, R / 50)));
        so.add(p.fn, p.nfn, nu, 64);
      });
    });

    // 孔上面 (斜平面)
    si.add(
      function (u, v) {
        const m = X1 + u * (X2 - X1), w = halfW(m);
        return new V(m + X0, ymax(m), -w + 2 * w * v);
      },
      function () { return new V(K, -1, 0); },
      24, 24
    );

    // 孔下面
    si.add(
      function (u, v) {
        const m = X1 + u * (X2 - X1), w = halfW(m);
        return new V(m + X0, -ymax(m), -w + 2 * w * v);
      },
      function () { return new V(K, 1, 0); },
      24, 24
    );

    // 孔底平面
    si.add(
      function (u, v) {
        const y = -A + 2 * A * u, w = Math.sqrt(Math.max(0, R * R - y * y));
        return new V(X2 + X0, y, -w + 2 * w * v);
      },
      function () { return new V(-1, 0, 0); },
      32, 32
    );

    // 左右端面
    so.add(
      function (u, v) {
        const r = u * R, t = v * Math.PI * 2;
        return new V(X0, r * Math.sin(t), r * Math.cos(t));
      },
      function () { return new V(-1, 0, 0); },
      10, 120
    );
    so.add(
      function (u, v) {
        const r = u * R, t = v * Math.PI * 2;
        return new V(L + X0, r * Math.sin(t), r * Math.cos(t));
      },
      function () { return new V(1, 0, 0); },
      10, 120
    );

    const solidMat = new THREE.MeshStandardMaterial({
      color: 0x8fbadd, metalness: 0.12, roughness: 0.44, side: THREE.FrontSide,
    });
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x3f6685, metalness: 0.08, roughness: 0.72, side: THREE.FrontSide,
    });

    root.add(new THREE.Mesh(so.geometry(), solidMat));
    root.add(new THREE.Mesh(si.geometry(), innerMat));

    // ---------- 交线 / 棱线 ----------
    const markGroup = new THREE.Group();
    root.add(markGroup);

    const markMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
    const tubeR = Math.max(0.3, Math.min(1.6, R * 0.011));

    function tube(points, closed) {
      const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0);
      const geo = new THREE.TubeGeometry(curve, Math.max(64, points.length), tubeR, 8, closed);
      markGroup.add(new THREE.Mesh(geo, markMat));
    }

    // 孔口四条椭圆弧
    const N = 90;
    [1, -1].forEach(function (sy) {
      [1, -1].forEach(function (sz) {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const m = X1 + (X2 - X1) * i / N;
          pts.push(new V(m + X0, sy * ymax(m), sz * halfW(m)));
        }
        tube(pts, false);
      });
    });

    // 楔形孔尖
    tube([new V(X1 + X0, 0, -R), new V(X1 + X0, 0, 0), new V(X1 + X0, 0, R)], false);

    // 孔底平面轮廓
    const wallPts = [];
    const NW = 40;
    const hw2 = halfW(X2);
    let i2;
    for (i2 = 0; i2 <= NW; i2++) {
      wallPts.push(new V(X2 + X0, A, -hw2 + 2 * hw2 * i2 / NW));
    }
    for (i2 = 0; i2 <= NW; i2++) {
      const yy = A - 2 * A * i2 / NW;
      wallPts.push(new V(X2 + X0, yy, Math.sqrt(Math.max(0, R * R - yy * yy))));
    }
    for (i2 = 0; i2 <= NW; i2++) {
      wallPts.push(new V(X2 + X0, -A, hw2 - 2 * hw2 * i2 / NW));
    }
    for (i2 = 0; i2 <= NW; i2++) {
      const yy2 = -A + 2 * A * i2 / NW;
      wallPts.push(new V(X2 + X0, yy2, -Math.sqrt(Math.max(0, R * R - yy2 * yy2))));
    }
    tube(wallPts, true);

    // ---------- 相机 / 视图 ----------
    const span = Math.max(L, 2 * R);
    const camDist = span * 4 + 1000;

    const VIEWS = {
      iso:   { cam: 'persp', label: '轴测 (自由旋转)' },
      front: { cam: 'ortho', pos: [0, 0, camDist], up: [0, 1, 0], label: '主视图方向 (沿 -Z 看)' },
      left:  { cam: 'ortho', pos: [-camDist, 0, 0], up: [0, 1, 0], label: '左视图方向 (沿 +X 看)' },
      top:   { cam: 'ortho', pos: [0, camDist, 0], up: [0, 0, -1], label: '俯视图方向 (沿 -Y 看)' },
    };

    function mkControls(cam) {
      const c = new THREE.OrbitControls(cam, renderer.domElement);
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      c.rotateSpeed = 0.85;
      c.zoomSpeed = 0.9;
      c.minDistance = span * 0.3;
      c.maxDistance = span * 6;
      c.target.set(0, 0, 0);
      c.enabled = false;
      return c;
    }

    ctl.persp = mkControls(cams.persp);
    ctl.ortho = mkControls(cams.ortho);

    function fitOrtho() {
      const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
      const aspect = w / h;
      const hFit = Math.max(2 * R * 1.22, (L * 1.18) / aspect);
      cams.ortho.left = -hFit * aspect / 2;
      cams.ortho.right = hFit * aspect / 2;
      cams.ortho.top = hFit / 2;
      cams.ortho.bottom = -hFit / 2;
      cams.ortho.updateProjectionMatrix();
    }

    const FIT_R = Math.sqrt((L / 2) * (L / 2) + R * R + R * R) * 1.03;

    function fitPersp(keepDir) {
      const aspect = cams.persp.aspect || 1;
      const vfov = cams.persp.fov * Math.PI / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      const dist = FIT_R / Math.sin(Math.min(vfov, hfov) / 2) * 1.12;
      const dir = keepDir && cams.persp.position.lengthSq() > 0
        ? cams.persp.position.clone().normalize()
        : new THREE.Vector3(0.6, 0.52, 0.61).normalize();
      cams.persp.position.copy(dir.multiplyScalar(dist));
      cams.persp.lookAt(0, 0, 0);
    }

    const cardRoot = stage.closest('.acard') || document;
    const labelEl = stage.querySelector('.acard-view-label');
    const viewButtons = Array.prototype.slice.call(cardRoot.querySelectorAll('.acard-views button'));

    function setView(name) {
      const v = VIEWS[name] || VIEWS.iso;
      current = VIEWS[name] ? name : 'iso';

      if (v.cam === 'ortho') {
        fitOrtho();
        cams.ortho.up.set(v.up[0], v.up[1], v.up[2]);
        cams.ortho.position.set(v.pos[0], v.pos[1], v.pos[2]);
        cams.ortho.zoom = 1;
        cams.ortho.lookAt(0, 0, 0);
        cams.ortho.updateProjectionMatrix();
        ctl.ortho.target.set(0, 0, 0);
        ctl.ortho.update();
      } else {
        cams.persp.up.set(0, 1, 0);
        fitPersp();
        ctl.persp.target.set(0, 0, 0);
        ctl.persp.update();
      }

      ctl.persp.enabled = (v.cam === 'persp');
      ctl.ortho.enabled = (v.cam === 'ortho');
      draw();

      if (labelEl) labelEl.textContent = v.label;
      viewButtons.forEach(function (b) {
        b.classList.toggle('active', b.dataset.view === current);
      });
    }

    function draw() {
      renderer.render(scene, (VIEWS[current] && VIEWS[current].cam === 'ortho') ? cams.ortho : cams.persp);
    }

    let autoSpin = false;
    let alive = true;
    let raf = 0;
    const clock = new THREE.Clock();

    function loop() {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();

      if (autoSpin) {
        const c = (VIEWS[current] && VIEWS[current].cam === 'ortho') ? cams.ortho : cams.persp;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.55);
        c.position.applyQuaternion(q);
        c.lookAt(0, 0, 0);
      }

      (ctl.persp.enabled ? ctl.persp : ctl.ortho).update();
      draw();
    }

    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cams.persp.aspect = w / h;
      cams.persp.updateProjectionMatrix();
      fitOrtho();
      if (!current || current === 'iso') fitPersp(true);
      draw();
    }

    // ---------- 交互 ----------
    const bindings = [];
    viewButtons.forEach(function (b) {
      const fn = function () { setView(b.dataset.view); };
      b.addEventListener('click', fn);
      bindings.push([b, 'click', fn]);
    });

    const edgeBox = stage.querySelector('[data-toggle="edges"]');
    const wireBox = stage.querySelector('[data-toggle="wire"]');
    const spinBox = stage.querySelector('[data-toggle="spin"]');

    function onEdges(e) { markGroup.visible = e.target.checked; draw(); }
    function onWire(e) {
      solidMat.wireframe = e.target.checked;
      innerMat.wireframe = e.target.checked;
      solidMat.needsUpdate = true;
      innerMat.needsUpdate = true;
      draw();
    }
    function onSpin(e) { autoSpin = e.target.checked; }

    if (edgeBox) { edgeBox.addEventListener('change', onEdges); bindings.push([edgeBox, 'change', onEdges]); }
    if (wireBox) { wireBox.addEventListener('change', onWire); bindings.push([wireBox, 'change', onWire]); }
    if (spinBox) { spinBox.addEventListener('change', onSpin); bindings.push([spinBox, 'change', onSpin]); }

    ctl.persp.addEventListener('change', draw);
    ctl.ortho.addEventListener('change', draw);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () { resize(); });
      ro.observe(stage);
    }
    window.addEventListener('resize', resize);

    resize();
    setView('iso');
    loop();
    requestAnimationFrame(resize);

    return {
      destroy: function () {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } }
        window.removeEventListener('resize', resize);
        bindings.forEach(function (b) { b[0].removeEventListener(b[1], b[2]); });
        Object.keys(ctl).forEach(function (k) {
          if (ctl[k] && typeof ctl[k].dispose === 'function') {
            try { ctl[k].dispose(); } catch (e) { /* ignore */ }
          }
        });
        try { renderer.dispose(); } catch (e) { /* ignore */ }
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      },
    };
  }

  // ---------- 挂载立体答案卡 (target: 'top' | 'left' | 'front') ----------
  function mountSolidCard(host, data, meta, target) {
    const tgt = TARGETS[target] || TARGETS.top;
    const d = normalize(data);
    if (!d) {
      host.textContent = '答案卡数据无效：需要 R / L / X1 / X2 / A。';
      return { destroy: function () { host.innerHTML = ''; } };
    }
    meta = meta || {};

    const result = Solver.solve(solverParams(d));

    const root = buildCardShell(host, { className: 'acard-solid', template: TEMPLATE });

    fillText(root, '.acard-title', meta.title || tgt.title);
    fillText(root, '.acard-sub',
      'R=' + fmt(d.R) + ' · L=' + fmt(d.L) + ' · X1=' + fmt(d.X1) +
      ' · X2=' + fmt(d.X2) + ' · A=' + fmt(d.A));
    fillText(root, '.acard-panel-title', tgt.panel + ' 【所求】');
    fillText(root, '.acard-caption', tgt.known + ' 为已知（灰蓝）；' + tgt.answer + ' 为所求（黑、加粗）。');

    // 答案图 (Canvas 2D 三视图, answerView 高亮所求视图)
    const shotImg = root.querySelector('.acard-shot img');
    const dataUrl = renderAnswerImage(result, document.createElement('canvas'), { answerView: tgt.view });
    if (dataUrl) {
      shotImg.src = dataUrl;
    } else {
      const shot = root.querySelector('.acard-shot');
      if (shot) shot.innerHTML = '<div class="acard-error">答案图渲染失败。</div>';
    }

    // 说明 (求解器说明 + LLM 备注)
    injectNotes(root, (result.explanation || []).concat(meta.notes || []));
    // LLM 的解题过程
    injectAnalysis(root, meta.analysis);

    // 三维场景 (异步加载 three.js)
    const stage = root.querySelector('.acard-stage');
    let sceneInst = null;
    let alive = true;

    loadThree().then(function (THREE) {
      if (!alive) return;
      sceneInst = buildSolidScene(THREE, stage, d);
    }).catch(function (e) {
      if (!alive) return;
      stage.innerHTML = '<div class="acard-error">3D 场景加载失败: ' + String(e.message || e) + '</div>';
    });

    return {
      destroy: function () {
        alive = false;
        if (sceneInst && sceneInst.destroy) sceneInst.destroy();
        sceneInst = null;
        host.innerHTML = '';
      },
    };
  }

  const API = {
    // 通用工具
    loadScript: loadScript,
    loadScripts: loadScripts,
    loadThree: loadThree,
    num: num,
    fmt: fmt,
    fillText: fillText,
    injectNotes: injectNotes,
    injectAnalysis: injectAnalysis,
    buildCardShell: buildCardShell,
    renderAnswerImage: renderAnswerImage,
    // 共享立体答案卡
    normalize: normalize,
    mountSolidCard: mountSolidCard,
    buildSolidScene: buildSolidScene,
    targets: TARGETS,
  };

  if (typeof window !== 'undefined') window.ACardBase = API;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})();
