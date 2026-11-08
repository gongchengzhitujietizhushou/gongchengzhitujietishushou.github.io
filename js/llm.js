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
  const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
  const SENSENOVA_BASE = 'https://token.sensenova.cn/v1';
  const DEEPSEEK_BASE = 'https://api.deepseek.com';

  // 模型列表 (按服务商分组)。图像识别请选择支持视觉的模型。
  // baseUrl / provider 就是交给 litellm-js 的接入信息。
  const MODELS = [
    { group: '商汤 SenseTime', provider: 'openai', baseUrl: SENSENOVA_BASE,
      items: [
        { value: 'sensenova-6.8-flash-lite', label: 'SenseNova 6.8 Flash Lite' },
        { value: 'sensenova-6.8-flash', label: 'SenseNova 6.8 Flash' },
      ] },
    { group: 'DeepSeek', provider: 'openai', baseUrl: DEEPSEEK_BASE,
      items: [
        { value: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash-1017' },
        { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro-0813' },
      ] },
  ];

  const DEFAULT_MODEL = itemValue(MODELS[0].items[0]);

  // 模型项可以是字符串 (内置简单项) 或 { value, label } (带显示名)
  function itemValue(item) {
    return (item && typeof item === 'object') ? item.value : item;
  }
  function itemLabel(item) {
    return (item && typeof item === 'object' && item.label) ? item.label : item;
  }

  function findModel(model) {
    for (const g of MODELS) {
      if (g.items.some(function (it) { return itemValue(it) === model; })) return g;
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
    if (m.indexOf('sensenova') === 0) return { kind: 'openai', base: SENSENOVA_BASE };
    if (m.indexOf('deepseek') === 0) return { kind: 'openai', base: DEEPSEEK_BASE };
    return { kind: 'openai', base: SENSENOVA_BASE };
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
      (kind === 'anthropic' ? ANTHROPIC_BASE : SENSENOVA_BASE);
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
  // 从答案卡注册表生成题型目录, 供 LLM 判断/生成 data。
  function cardCatalog() {
    if (typeof AnswerCards === 'undefined' || !AnswerCards.catalogForPrompt) return '';
    return AnswerCards.catalogForPrompt();
  }

  function systemPromptForDrawing() {
    const catalog = cardCatalog();
    return [
      '你是工程制图（机械制图）识图与解题专家。分析用户上传的工程图图片。',
      '只输出一个 JSON 对象，不要输出 Markdown 代码块或任何多余文字。',
      '输出两种模式之一:',
      '1) 能确定题型且能给出完整参数时:',
      '{ "mode":"card", "category":"题型ID", "title":"题型简述", "confidence":0到1, "data":{...}, "analysis":"中文分步解答", "notes":["需要注意的点"] }',
      '2) 不能确定题型、没有对应答案卡或参数不足时:',
      '{ "mode":"text", "category":"other", "title":"题型简述", "confidence":0到1, "text":"中文分析", "notes":["需要注意的点"] }',
      catalog ? ('可用答案卡题型:\n' + catalog) : '',
      '规则:',
      '1. 只有题型与目录中的描述一致且参数完整时才用 card；category 必须取自目录，否则用 "other"。',
      '2. data 使用目录给出的字段名与同一比例；不要编造尺寸，看不清就降低 confidence 并用 text。',
      '3. text/analysis 使用简洁中文，按步骤分行。',
    ].filter(Boolean).join('\n');
  }

  function parseJson(text) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  }

  // 尝试把文本解析为对象 (不是有效 JSON 时返回 null)
  function tryParseObject(text) {
    try {
      const o = parseJson(text);
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch (e) {
      return null;
    }
  }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  // 规范化 LLM 输出: 要么是答案卡 (mode=card), 要么是纯文字 (mode=text)。
  function normalize(obj, raw) {
    const notes = Array.isArray(obj.notes) ? obj.notes.map(String) : [];
    const title = typeof obj.title === 'string' ? obj.title : '';
    const confidence = num(obj.confidence, 0.5);
    const category = String(obj.category || obj.problem_type || 'other');
    const analysis = typeof obj.analysis === 'string' ? obj.analysis : '';
    const text = typeof obj.text === 'string' ? obj.text : '';

    const hasCard = typeof AnswerCards !== 'undefined' &&
      AnswerCards.has && AnswerCards.has(category);

    // 旧格式 (problem_type + geometry) 或新格式 (mode=card) 都走答案卡
    if ((obj.mode === 'card' || obj.mode == null) && hasCard) {
      const data = obj.data || obj.geometry || null;
      const norm = AnswerCards.normalize(category, data);
      if (norm) {
        return {
          mode: 'card', category: category, title: title, confidence: confidence,
          data: norm, analysis: analysis, notes: notes, raw: raw,
        };
      }
      notes.push('LLM 给出的参数不完整，已改为文字说明。');
    }

    return {
      mode: 'text', category: category || 'other', title: title, confidence: confidence,
      text: text || analysis || raw, notes: notes, raw: raw,
    };
  }

  async function analyzeDrawing(dataUrl, settings, hint) {
    const userText = '请识别并解答这张工程图。' + (hint ? ('\n用户补充说明: ' + hint) : '');
    const raw = await chat(systemPromptForDrawing(), userText, dataUrl, settings, 2400);
    const obj = tryParseObject(raw);
    if (!obj) {
      throw new Error('LLM 返回的内容不是有效 JSON: ' + raw.slice(0, 160));
    }
    return normalize(obj, raw);
  }

  // 兼容旧调用: 把 LLM 结构化结果转成 Solver 需要的 params。
  // 新架构下答案卡直接使用 res.data, 此函数仅用于兼容 / 测试。
  function toParams(res) {
    if (!res || res.category !== 'cylinder_wedge_hole') return null;
    const g = res.data || res.geometry;
    if (!g) return null;
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
  // 返回 { mode:'text', text } 或 { mode:'card', category, data, analysis, notes, ... }
  async function ask(question, dataUrl, settings) {
    const sys = [
      '你是工程制图（机械制图）助手。用简洁中文回答；涉及尺寸、投影关系时说明依据和不确定性，不要编造。',
      '如果问题属于下面某个答案卡题型，且你能给出完整参数，只输出一个 JSON 对象:',
      '{ "mode":"card", "category":"题型ID", "title":"...", "confidence":0到1, "data":{...}, "analysis":"...", "notes":[] }',
      '其他问题直接用简洁中文回答，不要输出 JSON。',
      cardCatalog() ? ('可用答案卡题型:\n' + cardCatalog()) : '',
    ].filter(Boolean).join('\n');
    const raw = await chat(sys, question, dataUrl || null, settings, 1600);
    const obj = tryParseObject(raw);
    if (obj && (obj.mode === 'card' || obj.category || obj.problem_type || obj.data)) {
      return normalize(obj, raw);
    }
    return {
      mode: 'text', category: 'other', title: '', confidence: 0,
      text: raw, notes: [], raw: raw,
    };
  }

  return {
    MODELS, DEFAULT_MODEL, isKnownModel, providerFor, resolveConfig, isConfigured,
    analyzeDrawing, toParams, ask, chat, normalize, itemValue, itemLabel,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
