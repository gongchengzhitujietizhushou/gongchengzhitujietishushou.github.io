// ============================================================
// js/llm.js
// 工程制图解题助手 —— LLM / 视觉模型接入 (纯前端)
//  - 图纸图片 -> 视觉模型 -> 结构化 JSON (Drawing IR)
//  - 文本问答
//  - API Key 仅保存在本机 localStorage, 由浏览器直接请求服务商
//  - 服务商/协议适配交给 litellm-js (js/vendor/litellm.umd.js):
//      OpenAI 及所有 OpenAI 兼容接口 (DeepSeek / 通义 / GLM / Kimi /
//      Gemini OpenAI 兼容端点 / 自定义网关) 走 /chat/completions;
//      Anthropic Claude 走 /messages。
// ============================================================
'use strict';

const LLM = (() => {

  const LIB_URL = 'js/vendor/litellm.umd.js';
  const OPENAI_BASE = 'https://api.openai.com/v1';
  const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

  // 常见模型 (按服务商分组)。图像识别请选择支持视觉的模型。
  // baseUrl / provider 就是交给 litellm-js 的接入信息。
  const MODELS = [
    { group: 'OpenAI', provider: 'openai', baseUrl: OPENAI_BASE,
      items: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] },
    { group: '通义千问 (DashScope)', provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      items: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct'] },
    { group: '智谱 GLM', provider: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      items: ['glm-4v-plus', 'glm-4v', 'glm-4.5v'] },
    { group: 'Google Gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      items: ['gemini-2.0-flash', 'gemini-1.5-pro'] },
    { group: 'Anthropic Claude', provider: 'anthropic', baseUrl: ANTHROPIC_BASE,
      items: ['claude-3-5-sonnet-latest', 'claude-sonnet-4-20250514'] },
    { group: '月之暗面 Kimi', provider: 'openai', baseUrl: 'https://api.moonshot.cn/v1',
      items: ['moonshot-v1-8k-vision-preview'] },
    { group: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1',
      items: ['deepseek-chat', 'deepseek-reasoner'] },
  ];

  const DEFAULT_MODEL = MODELS[0].items[0];

  function findModel(model) {
    for (const g of MODELS) {
      if (g.items.indexOf(model) >= 0) return g;
    }
    return null;
  }

  function isKnownModel(model) {
    return !!findModel(model);
  }

  // 返回 { kind: 'openai' | 'anthropic', base }
  // 内置模型查表；未知模型按名称前缀推断 (自定义模型可用设置覆盖)。
  function providerFor(model) {
    const known = findModel(model);
    if (known) return { kind: known.provider, base: known.baseUrl };

    const m = String(model || '').toLowerCase();
    if (m.indexOf('claude') === 0) return { kind: 'anthropic', base: ANTHROPIC_BASE };
    if (m.indexOf('gemini') === 0)
      return { kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai' };
    if (m.indexOf('qwen') === 0)
      return { kind: 'openai', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };
    if (m.indexOf('glm') === 0) return { kind: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4' };
    if (m.indexOf('moonshot') === 0 || m.indexOf('kimi') === 0)
      return { kind: 'openai', base: 'https://api.moonshot.cn/v1' };
    if (m.indexOf('deepseek') === 0) return { kind: 'openai', base: 'https://api.deepseek.com/v1' };
    return { kind: 'openai', base: OPENAI_BASE };
  }

  function isConfigured(s) {
    return !!(s && s.llmKey && s.llmModel && s.llmModel !== '__custom__');
  }

  // 解析当前设置：内置模型用内置接入信息；自定义模型用用户填写的 Base URL / 接口类型。
  function resolveConfig(settings) {
    const model = settings && settings.llmModel;
    const known = findModel(model);
    if (known) return { kind: known.provider, base: known.baseUrl };

    const kind = (settings && settings.llmService === 'anthropic') ? 'anthropic' : 'openai';
    const base = String((settings && settings.llmBaseUrl) || '').trim() ||
      (kind === 'anthropic' ? ANTHROPIC_BASE : OPENAI_BASE);
    return { kind: kind, base: base };
  }

  // ---------- 加载 litellm-js (首次调用时按需加载) ----------
  let libPromise = null;
  function loadLib() {
    if (typeof window === 'undefined' || typeof document === 'undefined')
      return Promise.reject(new Error('LLM 库仅支持浏览器环境'));
    if (window.litellm && window.litellm.LiteLLM) return Promise.resolve(window.litellm);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB_URL;
        s.async = true;
        s.onload = () => (window.litellm && window.litellm.LiteLLM)
          ? resolve(window.litellm)
          : reject(new Error('LLM 库加载失败'));
        s.onerror = () => { libPromise = null; reject(new Error('LLM 库加载失败')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  // ---------- 请求辅助 ----------
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('LLM 请求超时')), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  function formatError(e) {
    if (!e) return 'LLM 请求失败';
    const status = e.status ? ('LLM API ' + e.status + ': ') : '';
    let msg = '';
    if (e.data && e.data.error) msg = e.data.error.message || e.data.error.code || '';
    if (!msg && e.data && e.data.message) msg = e.data.message;
    if (!msg) msg = e.message || String(e);
    return (status + String(msg)).slice(0, 400);
  }

  function imageParts(dataUrl) {
    const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || '');
    return m ? { mime: m[1] || 'image/jpeg', b64: m[2] } : null;
  }

  // 统一调用: system + 文本 + 可选图片
  async function chat(system, userText, dataUrl, settings, maxTokens) {
    const model = String((settings && settings.llmModel) || '').trim();
    const key = String((settings && settings.llmKey) || '').trim();
    if (!model) throw new Error('未选择 LLM 模型');

    const cfg = resolveConfig(settings);
    const lib = await loadLib();
    const messages = [];
    let extra = null;

    if (cfg.kind === 'anthropic') {
      // Anthropic: system 作为顶层参数，用户内容使用 base64 图片块。
      const content = [];
      if (dataUrl) {
        const ip = imageParts(dataUrl);
        if (!ip) throw new Error('图片编码无效');
        content.push({ type: 'image', source: { type: 'base64', media_type: ip.mime, data: ip.b64 } });
      }
      content.push({ type: 'text', text: userText });
      messages.push({ role: 'user', content: content });
      extra = { additional_params: { system: system } };
    } else {
      // OpenAI 兼容: system 消息 + image_url data URL。
      const content = [];
      if (dataUrl) content.push({ type: 'image_url', image_url: { url: dataUrl } });
      content.push({ type: 'text', text: userText });
      messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: content });
    }

    const inst = new lib.LiteLLM();
    const provider = inst.registerProvider(cfg.kind, { apiKey: key, baseUrl: cfg.base });

    if (cfg.kind === 'anthropic') {
      // litellm-js 0.2.0 的 Anthropic 适配器：
      //  1) 不发送浏览器直连所需的 anthropic-dangerous-direct-browser-access 头；
      //  2) 会附加无效的 stop 参数。
      // 这里在实例上补正，协议本身仍由该库处理。
      const origHeaders = provider._getAuthHeaders.bind(provider);
      provider._getAuthHeaders = function () {
        return Object.assign(origHeaders(), {
          'anthropic-dangerous-direct-browser-access': 'true',
        });
      };
      const origTransform = provider._transformOptions.bind(provider);
      provider._transformOptions = function (options) {
        const t = origTransform(options);
        delete t.stop;
        return t;
      };
    }

    let res;
    try {
      res = await withTimeout(provider.completion(Object.assign({
        model: model,
        messages: messages,
        max_tokens: maxTokens || 1600,
      }, extra || {})), 120000);
    } catch (e) {
      throw new Error(formatError(e));
    }

    const content = res && res.choices && res.choices[0] &&
      res.choices[0].message && res.choices[0].message.content;
    let out = '';
    if (typeof content === 'string') out = content;
    else if (Array.isArray(content)) out = content.map(x => (x && x.text) || '').join('\n');
    out = (out || '').trim();
    if (!out) throw new Error('LLM 返回为空');
    return out;
  }

  // ---------- 解析图纸 ----------
  const SYSTEM_PROMPT = [
    '你是工程制图（机械制图）识图与解题专家。分析用户上传的工程图图片。',
    '只输出一个 JSON 对象，不要输出 Markdown 代码块或任何多余文字。',
    'JSON 结构:',
    '{',
    '  "problem_type": "cylinder_wedge_hole" 或 "other",',
    '  "title": "题型简述",',
    '  "confidence": 0 到 1 的数字,',
    '  "geometry": { "R": 100, "L": 数字, "X1": 数字, "X2": 数字, "A": 数字 },',
    '  "analysis": "中文分步解答或说明",',
    '  "notes": ["需要注意的点"]',
    '}',
    '规则:',
    '1. 仅当题目是「轴线水平的圆柱，主视图为矩形+三角形孔口，左视图为圆+两条水平虚线弦，求俯视图（圆柱上开前后贯通楔形孔）」时，problem_type 才用 "cylinder_wedge_hole"。',
    '2. 该题型必须给出 geometry，且使用同一比例：令 R=100；L=圆柱长度；X1=三角形尖点 x；X2=孔底 x；A=孔口半高。需满足 0<X1<X2<L 且 0<A<R。',
    '3. 其他题型 problem_type 用 "other"，在 analysis 中说明已知视图、缺失视图、关键几何关系与求解思路；不要编造尺寸。',
    '4. 看不清或信息不足时降低 confidence，并在 notes 中说明。',
    '5. analysis 使用简洁中文，按步骤分行。',
  ].join('\n');

  function parseJson(text) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function normalize(obj, raw) {
    const out = {
      problem_type: obj.problem_type || 'other',
      title: typeof obj.title === 'string' ? obj.title : '',
      confidence: num(obj.confidence, 0.5),
      geometry: (obj.geometry && typeof obj.geometry === 'object') ? obj.geometry : null,
      analysis: typeof obj.analysis === 'string' ? obj.analysis : '',
      notes: Array.isArray(obj.notes) ? obj.notes.map(String) : [],
      raw: raw,
    };
    if (!out.analysis) out.analysis = raw;
    return out;
  }

  async function analyzeDrawing(dataUrl, settings, hint) {
    const userText = '请识别并解答这张工程图。' + (hint ? ('\n用户补充说明: ' + hint) : '');
    const raw = await chat(SYSTEM_PROMPT, userText, dataUrl, settings, 2000);
    let obj;
    try {
      obj = parseJson(raw);
    } catch (e) {
      throw new Error('LLM 返回的内容不是有效 JSON: ' + raw.slice(0, 160));
    }
    return normalize(obj, raw);
  }

  // 把 LLM 的结构化结果转成 Solver 需要的 params
  function toParams(res) {
    if (!res || res.problem_type !== 'cylinder_wedge_hole' || !res.geometry) return null;
    const g = res.geometry;
    const R = num(g.R, 0), L = num(g.L, 0), X1 = num(g.X1, NaN), X2 = num(g.X2, NaN), A = num(g.A, 0);
    if (!(R > 0 && L > 0 && A > 0 && X2 > X1 && X1 >= 0 && X2 <= L * 1.01 && A < R)) return null;
    return {
      image: {},
      views: {
        front: { rect: [0, 0, L, 2 * R], L: L, H: 2 * R, X1: X1, X2: X2, A: A, center_y: R },
        left: { circle: [0, 0, R], R: R, center: [0, 0], A: A },
      },
      problem_type: 'cylinder_wedge_hole',
      confidence: res.confidence,
      notes: (res.notes || []).slice(),
    };
  }

  // ---------- 文字问答 ----------
  async function ask(question, dataUrl, settings) {
    const sys = '你是工程制图（机械制图）助手。用简洁中文回答；涉及尺寸、投影关系时说明依据和不确定性，不要编造。';
    return chat(sys, question, dataUrl || null, settings, 1200);
  }

  return {
    MODELS, DEFAULT_MODEL, isKnownModel, providerFor, resolveConfig, isConfigured,
    analyzeDrawing, toParams, ask, chat,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
