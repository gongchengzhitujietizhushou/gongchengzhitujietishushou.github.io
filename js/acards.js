// ============================================================
// js/acards.js
// 工程制图解题助手 —— 答案卡注册表
// ------------------------------------------------------------
// 每道题属于一个题型 (category)，每个题型对应一个答案卡模块
// (acard_xxx.js)。答案卡由一段 JSON 数据驱动，LLM 只要给出
// category + data 就能渲染出对应的答案卡。
//
// 答案卡模块约定:
//   AnswerCards.register('category_id', {
//     title:       '显示名称',
//     description: '题型描述 (供 LLM 判断)',
//     dataSchema:  'JSON 字段说明 (供 LLM 生成 data)',
//     normalize(data) -> 规范化后的 data | null,
//     mount(el, data, meta) -> { destroy() }
//   });
//
// meta: { title, analysis, notes, confidence }
// ============================================================
'use strict';

const AnswerCards = (() => {

  const cards = Object.create(null);

  function register(id, def) {
    if (!id || !def) throw new Error('答案卡注册参数无效');
    if (typeof def.mount !== 'function') throw new Error('答案卡缺少 mount()');
    cards[id] = Object.assign({ id: id }, def);
    return cards[id];
  }

  function get(id) {
    return cards[id] || null;
  }

  function has(id) {
    return !!cards[id];
  }

  function list() {
    return Object.keys(cards).map(function (id) { return cards[id]; });
  }

  // 供 LLM 提示词使用的题型目录
  function catalogForPrompt() {
    return list().map(function (c) {
      const lines = ['- ' + c.id + ': ' + (c.description || c.title || '')];
      if (c.dataSchema) lines.push('  数据字段: ' + c.dataSchema);
      return lines.join('\n');
    }).join('\n');
  }

  // 校验/规范化卡片数据
  function normalize(id, data) {
    const def = get(id);
    if (!def) return null;
    if (typeof def.normalize === 'function') return def.normalize(data);
    return data || null;
  }

  return { register, get, has, list, catalogForPrompt, normalize };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AnswerCards;
