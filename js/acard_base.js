// ============================================================
// js/acard_base.js
// 答案卡基础构建器 (ACardBase) —— 通用 / 数据驱动
// ------------------------------------------------------------
// 答案卡由一段**通用 JSON** 驱动:
//
//   data = {
//     "params": { ...任意尺寸命名... },        // 立体尺寸参数 (由 solid.normalizeParams 校验)
//     "scene":  { "solid": "solid名" },        // 选择三维场景构建器 (见 solids 注册表)
//     "answer": {
//       "view":  "top" | "left" | "front",      // 所求视图
//       "views": { front:[prims], left:[prims], top:[prims] },  // 结果图坐标 (可省略, 由 solid.answer 计算)
//       "labels": { front, left, top },          // 可选视图名
//       "dims": [ "D=100  L=130 ..." ]           // 可选尺寸标注
//     }
//   }
//
// 渲染流程 (mountCard):
//   1. 从 solids 注册表取 scene.solid 对应的构建器。
//   2. 三维场景: solid.build(THREE, stage, params)。
//   3. 结果图:   answer.views 或 solid.answer(params).views, 交给 Render.render。
//
// 通用工具 + 注册表 + 通用卡片挂载都在此文件; 具体立体的几何
// 构建放在独立的 solid_xxx.js 里, 用 registerSolid 注册即可扩展。
//
// prim = { type:'line'|'poly'|'circle', kind:'visible'|'hidden'|'center', ... }
// ============================================================
'use strict';

(function () {

  // ============================================================
  // 一、通用工具
  // ============================================================

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

  let threePromise = null;
  function loadThree() {
    if (typeof window !== 'undefined' && window.THREE && window.THREE.OrbitControls) {
      return Promise.resolve(window.THREE);
    }
    if (!threePromise) {
      threePromise = loadScripts(['js/vendor/three.min.js', 'js/vendor/OrbitControls.js'])
        .then(() => {
          if (!window.THREE) throw new Error('three.js 加载失败');
          if (!window.THREE.OrbitControls) throw new Error('OrbitControls 加载失败');
          return window.THREE;
        })
        .catch((e) => { threePromise = null; throw e; });
    }
    return threePromise;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);
  }

  function fillText(root, selector, text) {
    const el = root.querySelector(selector);
    if (el) el.textContent = text;
  }

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

  function injectAnalysis(root, text) {
    if (!text) return;
    const details = root.querySelector('.acard-analysis');
    const body = root.querySelector('.acard-analysis-body');
    if (!details || !body) return;
    details.hidden = false;
    body.textContent = text;
  }

  function buildCardShell(host, opts) {
    opts = opts || {};
    const root = document.createElement('div');
    root.className = 'acard ' + (opts.className || 'acard-solid');
    root.innerHTML = opts.template || TEMPLATE;
    host.appendChild(root);
    return root;
  }

  function renderAnswerImage(answerDesc, canvas, opts) {
    try {
      Render.render(answerDesc, canvas, opts || {});
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 二、立体 / 场景注册表 (solid registry)
  // ============================================================
  // 注册项 def = {
  //   name,                       // 唯一名
  //   title(params) -> string,    // 卡片标题
  //   normalizeParams(params),    // 校验/规范化 params -> {..} | null
  //   paramFields,                // [{key,label}] 用于显示 (可选)
  //   build(THREE, stage, params) -> { destroy() },   // 三维场景
  //   answer(params) -> { view?, views, labels?, dims? }  // 结果图坐标
  // }

  const solids = Object.create(null);
  function registerSolid(name, def) {
    if (!name || !def || typeof def.build !== 'function') {
      throw new Error('答案卡立体注册参数无效');
    }
    def.name = name;
    solids[name] = def;
    return def;
  }
  function getSolid(name) { return solids[name] || null; }

  // 所求视图 -> 面板文案 (通用, 与具体立体无关)
  const VIEW_META = {
    top:   { view: 'top',   panel: '俯视图 · 答案', known: '主视图、左视图', answer: '俯视图' },
    left:  { view: 'left',  panel: '左视图 · 答案', known: '主视图、俯视图', answer: '左视图' },
    front: { view: 'front', panel: '主视图 · 答案', known: '左视图、俯视图', answer: '主视图' },
  };

  // ============================================================
  // 三、通用答案卡
  // ============================================================

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

  // 规范化 data -> { params, solidName, view, views, labels, dims } | null
  // 支持三种输入:
  //   原始 data { params, scene:{solid}, answer:{view,views?,labels?,dims?} }
  //   已规范化对象 (含 solidName+views, 幂等, 可从历史回放)
  //   旧扁平 data { R,L,X1,X2,A } (配合 opts.defaultSolid 包装)
  function normalize(data, opts) {
    opts = opts || {};
    if (!data || typeof data !== 'object') return null;

    // 已规范化 (幂等)
    if (data.solidName && data.views && data.params) return data;

    // 旧扁平数据 -> 包装为通用格式 (仅当调用方提供 defaultSolid)
    if (!data.params && !data.scene && opts.defaultSolid) {
      data = {
        params: data,
        scene: { solid: opts.defaultSolid },
        answer: { view: opts.defaultView || 'top' },
      };
    }

    const params = (data.params && typeof data.params === 'object') ? data.params : null;
    const scene = data.scene || {};
    const solidName = scene.solid || '';
    const solid = getSolid(solidName);
    if (!params || !solid) return null;

    const normParams = (typeof solid.normalizeParams === 'function')
      ? solid.normalizeParams(params) : params;
    if (!normParams) return null;

    const answer = data.answer || {};
    const view = answer.view || opts.defaultView || 'top';
    if (view !== 'top' && view !== 'left' && view !== 'front') return null;

    let views = (answer.views && typeof answer.views === 'object') ? answer.views : null;
    let labels = (answer.labels && typeof answer.labels === 'object') ? answer.labels : null;
    let dims = Array.isArray(answer.dims) ? answer.dims : null;
    if (!views && typeof solid.answer === 'function') {
      const ans = solid.answer(normParams) || {};
      views = ans.views || null;
      labels = labels || ans.labels || null;
      dims = dims || ans.dims || null;
    }
    if (!views) return null;

    // 不内嵌 solid (函数), 仅返回可 JSON 序列化的字段, 挂载时按 solidName 重新取。
    return { params: normParams, solidName: solidName, view: view, views: views, labels: labels, dims: dims };
  }

  function subLine(params, fields) {
    const keys = (fields && fields.length)
      ? fields.map(function (f) { return f.key; })
      : Object.keys(params);
    return keys.filter(function (k) { return params[k] != null; })
      .map(function (k) { return k + '=' + fmt(params[k]); }).join(' · ');
  }

  // 通用答案卡挂载
  function mountCard(host, data, meta, opts) {
    opts = opts || {};
    const norm = normalize(data, opts);
    if (!norm) {
      host.textContent = '答案卡数据无效：需要 params / scene.solid / answer.view。';
      return { destroy: function () { host.innerHTML = ''; } };
    }
    const solid = getSolid(norm.solidName);
    if (!solid) {
      host.textContent = '答案卡数据无效：未注册立体 "' + norm.solidName + '"。';
      return { destroy: function () { host.innerHTML = ''; } };
    }
    meta = meta || {};
    const vm = VIEW_META[norm.view] || VIEW_META.top;

    const root = buildCardShell(host, { className: 'acard-solid', template: TEMPLATE });
    const title = meta.title || opts.title ||
      (solid.title ? solid.title(norm.params) : '') || vm.answer + '答案';
    fillText(root, '.acard-title', title);
    fillText(root, '.acard-sub', subLine(norm.params, solid.paramFields));
    fillText(root, '.acard-panel-title', vm.panel + ' 【所求】');
    fillText(root, '.acard-caption', vm.known + ' 为已知（灰蓝）；' + vm.answer + ' 为所求（黑、加粗）。');

    // 结果图 (通用 Render)
    const shotImg = root.querySelector('.acard-shot img');
    const answerDesc = { view: norm.view, views: norm.views, labels: norm.labels, dims: norm.dims };
    const dataUrl = renderAnswerImage(answerDesc, document.createElement('canvas'), { answerView: norm.view });
    if (dataUrl) {
      shotImg.src = dataUrl;
    } else {
      const shot = root.querySelector('.acard-shot');
      if (shot) shot.innerHTML = '<div class="acard-error">答案图渲染失败。</div>';
    }

    // 说明 + 解题过程
    injectNotes(root, meta.notes || []);
    injectAnalysis(root, meta.analysis);

    // 三维场景 (按 scene.solid 选择构建器)
    const stage = root.querySelector('.acard-stage');
    let sceneInst = null;
    let alive = true;
    loadThree().then(function (THREE) {
      if (!alive) return;
      sceneInst = solid.build(THREE, stage, norm.params);
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
    // 立体注册表
    registerSolid: registerSolid,
    getSolid: getSolid,
    solids: solids,
    // 通用答案卡
    normalize: normalize,
    mountCard: mountCard,
    viewMeta: VIEW_META,
  };

  if (typeof window !== 'undefined') window.ACardBase = API;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})();
