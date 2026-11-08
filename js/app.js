// ============================================================
// js/app.js
// 工程制图解题助手 —— Vue 3 应用入口 (纯前端)
//  - 上传图片 -> 视觉识别 -> 解题 -> 渲染答案
//  - 历史记录 (localStorage + IndexedDB)
//  - 设置面板 (LLM key)
// ============================================================
'use strict';

(function () {
  const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

  // ---------- 答案卡宿主组件 ----------
  // 挂载 / 销毁 AnswerCards 注册表中的卡片模块。
  const AnswerCardView = {
    props: { category: String, data: Object, meta: Object },
    template: '<div class="answer-card-host"></div>',
    mounted() { this.renderCard(); },
    beforeUnmount() { this.destroyCard(); },
    watch: {
      category() { this.renderCard(); },
      data: { deep: true, handler() { this.renderCard(); } },
    },
    methods: {
      // 旧题型 ID 兼容: cylinder_wedge_hole -> top_view
      mapCat(cat) {
        return (cat === 'cylinder_wedge_hole') ? 'top_view' : cat;
      },
      renderCard() {
        this.destroyCard();
        const category = this.mapCat(this.category);
        const def = (typeof AnswerCards !== 'undefined') && AnswerCards.get(category);
        if (!def) {
          this.$el.textContent = '暂不支持该题型答案卡。';
          return;
        }
        try {
          this.instance = def.mount(this.$el, this.data || {}, this.meta || {});
        } catch (e) {
          this.$el.textContent = '答案卡渲染失败: ' + (e && e.message ? e.message : String(e));
        }
      },
      destroyCard() {
        if (this.instance && this.instance.destroy) {
          try { this.instance.destroy(); } catch (e) { /* ignore */ }
        }
        this.instance = null;
        this.$el.innerHTML = '';
      },
    },
  };

  const app = createApp({
    setup() {
      // ---------- 状态 ----------
      const messages = ref([]);        // [{role:'user'|'bot', text, imageUrl?, answerUrl?, caption?, explanation?, params?, type?, time}]
      const inputText = ref('');
      const pendingFile = ref(null);   // { name, blob, url }
      const processing = ref(false);
      const history = ref([]);
      const activeId = ref(null);
      const showSettings = ref(false);
      const settings = reactive({
        llmKey: '', llmModel: LLM.DEFAULT_MODEL, llmModelCustom: '',
        llmBaseUrl: '', llmService: 'openai',
      });
      const llmModels = LLM.MODELS;
      const chatEl = ref(null);
      const fileInput = ref(null);
      const dragOver = ref(false);

      // ---------- 工具 ----------
      function fmtTime(ts) {
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      }

      function dataURLToBlob(dataURL) {
        const [head, body] = dataURL.split(',');
        const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/png';
        const bin = atob(body);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
      }

      // ---------- 历史 ----------
      async function refreshHistory() {
        history.value = Storage.getHistory();
      }

      // 把图片 Blob 读到 ImageData (缩放至最大 2400px 宽以保性能)
      function loadImageData(blob, maxW) {
        maxW = maxW || 2400;
        return new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(blob);
          img.onload = () => {
            const w = img.naturalWidth, h = img.naturalHeight;
            const scale = Math.min(1, maxW / w);
            const cw = Math.round(w * scale), ch = Math.round(h * scale);
            const cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            resolve(ctx.getImageData(0, 0, cw, ch));
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
          img.src = url;
        });
      }

      // 把图片转成 data URL 发给视觉模型 (限制宽度以控制 token/流量)
      function blobToDataUrl(blob, maxW) {
        maxW = maxW || 1400;
        return new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(blob);
          img.onload = () => {
            const w = img.naturalWidth, h = img.naturalHeight;
            const scale = Math.min(1, maxW / w);
            const cw = Math.round(w * scale), ch = Math.round(h * scale);
            const cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/jpeg', 0.9));
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
          img.src = url;
        });
      }

      // 当前生效的 LLM 配置 (处理"自定义模型")
      function llmSettings() {
        return {
          llmKey: (settings.llmKey || '').trim(),
          llmModel: settings.llmModel === '__custom__'
            ? (settings.llmModelCustom || '').trim()
            : ((settings.llmModel || '').trim() || LLM.DEFAULT_MODEL),
          llmBaseUrl: (settings.llmBaseUrl || '').trim(),
          llmService: settings.llmService || 'openai',
        };
      }

      function toLines(text) {
        return String(text || '')
          .split(/\r?\n+/)
          .map(s => s.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim())
          .filter(Boolean);
      }

      // 一个题型是否算作"已解"(有答案卡或明确识别)
      function isSolvedType(t) {
        return !!t && t !== 'other' && t !== 'unrecognized';
      }

      // 旧题型 ID -> 新题型 ID (历史记录兼容)
      function mapCategory(cat) {
        if (cat === 'cylinder_wedge_hole') return 'top_view';
        return cat;
      }

      // 从本地视觉管线 params 提取答案卡数据 (圆柱+楔形孔立体, 求作俯视图)
      function cardFromParams(params) {
        if (!params || params.problem_type !== 'cylinder_wedge_hole' || !params.views) return null;
        const f = params.views.front || {};
        const l = params.views.left || {};
        const R = Number(l.R || (f.H ? f.H / 2 : 0));
        const L = Number(f.L || 0);
        const X1 = Number(f.X1);
        const X2 = Number(f.X2);
        const A = Number(f.A != null ? f.A : l.A);
        if (!(R > 0 && L > 0)) return null;
        // 通用答案卡数据: params + scene(3D) + answer(结果图)
        return AnswerCards.normalize('top_view', {
          params: { R: R, L: L, X1: X1, X2: X2, A: A },
          scene: { solid: 'cylinder_wedge_hole' },
          answer: { view: 'top' },
        });
      }

      // 把答案卡数据写到 botMsg
      function applyCard(botMsg, category, data, meta) {
        const cat = mapCategory(category);
        const norm = AnswerCards.normalize(cat, data);
        if (!norm) return false;
        meta = meta || {};
        Object.assign(botMsg, {
          processing: false,
          mode: 'card',
          card: {
            category: cat,
            data: norm,
            title: meta.title || '',
            analysis: meta.analysis || '',
            notes: Array.isArray(meta.notes) ? meta.notes.slice() : [],
            confidence: meta.confidence != null ? Number(meta.confidence) : 0.8,
          },
          type: cat,
          status: 'solved',
          time: Date.now(),
        });
        return true;
      }

      // ---------- 核心: 上传并解题 ----------
      async function processImage(blob, fileName, question) {
        processing.value = true;
        try {
          // 用户消息: 显示原图
          const imgUrl = URL.createObjectURL(blob);
          messages.value.push({ role: 'user', imageUrl: imgUrl, fileName, time: Date.now() });

          // 处理中占位
          const botMsg = reactive({ role: 'bot', processing: true, time: Date.now() });
          messages.value.push(botMsg);

          const conf = llmSettings();
          const useLLM = LLM.isConfigured(conf);

          // 1) 优先交给视觉模型理解图纸
          let llmRes = null, llmError = null;
          if (useLLM) {
            try {
              const dataUrl = await blobToDataUrl(blob, 1400);
              llmRes = await LLM.analyzeDrawing(dataUrl, conf, question);
            } catch (e) {
              llmError = e;
            }
          }

          // 2) LLM 给出答案卡 -> 直接渲染
          if (llmRes && llmRes.mode === 'card') {
            applyCard(botMsg, llmRes.category, llmRes.data, llmRes);
          }
          // 3) LLM 给出文字 (识别为其它/不确定) -> 展示文字
          else if (llmRes && llmRes.mode === 'text') {
            const parts = [];
            if (llmRes.title) parts.push(llmRes.title);
            if (llmRes.text) parts.push(llmRes.text);
            if (llmRes.notes && llmRes.notes.length) parts.push('备注:\n- ' + llmRes.notes.join('\n- '));
            Object.assign(botMsg, {
              processing: false,
              text: parts.join('\n\n') || '未能确定题型，请补充说明或更换更清晰的图片。',
              type: 'other',
              status: 'partial',
              time: Date.now(),
            });
          }
          // 4) LLM 未配置 / 调用失败 -> 本地视觉管线
          else {
            let params = null;
            try {
              const imageData = await loadImageData(blob);
              const pipeline = await Vision.runPipeline(imageData);
              params = pipeline.params;
            } catch (e) {
              if (!llmError) llmError = e;
            }

            const cardData = cardFromParams(params);
            if (cardData) {
              applyCard(botMsg, 'top_view', cardData, {
                title: '求作俯视图',
                analysis: '',
                notes: (params && params.notes) || [],
                confidence: params ? params.confidence : 0.7,
              });
            } else {
              const parts = [];
              if (llmError) parts.push('LLM 调用失败: ' + llmError.message + '\n已回退到本地识别。');
              if (params && params.notes && params.notes.length) parts.push(params.notes.join('\n'));
              else parts.push('暂不支持该题型，或图片无法识别。');
              if (!useLLM) parts.push('提示: 在"设置"中配置 LLM 后，可分析更多题型。');
              Object.assign(botMsg, {
                processing: false,
                text: parts.join('\n\n') || '暂不支持该题型，或图片无法识别。',
                type: (params && params.problem_type) || 'unrecognized',
                status: 'partial',
                time: Date.now(),
              });
            }
          }

          // 5) 记录历史 (原图 + 结果一起存, 回看时无需重新请求 LLM)
          const problemType = botMsg.type || (botMsg.card ? botMsg.card.category : 'other');
          const cardData = botMsg.card && botMsg.card.data;
          const cp = (cardData && cardData.params) || null;
          const summary = cp
            ? (cp.R != null ? 'R=' + cp.R.toFixed(0) + ' ' : '') +
              (cp.L != null ? 'L=' + cp.L.toFixed(0) + ' ' : '') +
              (cp.A != null ? 'A=' + cp.A.toFixed(0) : '')
            : String(((llmRes && (llmRes.title || llmRes.text)) ||
                (botMsg.text || ''))).slice(0, 80);
          const entry = await Storage.addHistory({
            fileName: fileName || '上传图片',
            problemType: problemType,
            summary: summary,
            blob: blob,
            result: {
              answerUrl: botMsg.answerUrl || null,
              caption: botMsg.caption || '',
              explanation: botMsg.explanation || [],
              params: botMsg.params || null,
              text: botMsg.text || '',
              type: botMsg.type || '',
              status: botMsg.status || '',
              mode: botMsg.mode || '',
              card: botMsg.card || null,
              time: botMsg.time,
            },
          });
          activeId.value = entry.id;
          await refreshHistory();
          scrollBottom();
        } catch (err) {
          const botMsg = messages.value[messages.value.length - 1];
          if (botMsg && botMsg.processing) {
            botMsg.processing = false;
            botMsg.error = '处理失败: ' + err.message;
            botMsg.time = Date.now();
          }
        } finally {
          processing.value = false;
          pendingFile.value = null;
          scrollBottom();
        }
      }

      // ---------- 发送 ----------
      async function send() {
        if (processing.value) return;
        const text = inputText.value.trim();
        const file = pendingFile.value;
        if (!file && !text) return;

        if (file) {
          await processImage(file.blob, file.name, text);
          inputText.value = '';
          return;
        }

        // 纯文本问答
        const userMsg = { role: 'user', text, time: Date.now() };
        messages.value.push(userMsg);
        inputText.value = '';
        const botMsg = reactive({
          role: 'bot', processing: true, time: Date.now(),
        });
        messages.value.push(botMsg);
        scrollBottom();

        const conf = llmSettings();
        if (LLM.isConfigured(conf)) {
          try {
            const reply = await LLM.ask(text, null, conf);
            if (reply.mode === 'card') {
              applyCard(botMsg, reply.category, reply.data, reply);
            } else {
              Object.assign(botMsg, {
                processing: false,
                text: reply.text,
                type: 'other',
                status: 'partial',
                time: Date.now(),
              });
            }
          } catch (e) {
            Object.assign(botMsg, { processing: false, error: 'LLM 调用失败: ' + e.message, time: Date.now() });
          }
        } else {
          Object.assign(botMsg, {
            processing: false,
            text: '未配置 LLM：请在上方"设置"中填写 API Key 并选择模型，即可进行文字问答。\n\n也可以直接上传工程图图片，使用本地识别与求解。',
            time: Date.now(),
          });
        }
        scrollBottom();
      }

      // ---------- 文件选择 ----------
      function onFilePicked(e) {
        const f = e.target.files && e.target.files[0];
        if (f) setFile(f);
        e.target.value = '';
      }
      function setFile(f) {
        if (!/\.(png|jpe?g|webp|bmp)$/i.test(f.name)) {
          alert('仅支持 PNG / JPG 图片。若为 XCF (GIMP) 格式, 请先在 GIMP 中导出为 PNG。');
          return;
        }
        if (pendingFile.value && pendingFile.value.url) URL.revokeObjectURL(pendingFile.value.url);
        pendingFile.value = { name: f.name, blob: f, url: URL.createObjectURL(f) };
      }
      function clearFile() {
        if (pendingFile.value && pendingFile.value.url) URL.revokeObjectURL(pendingFile.value.url);
        pendingFile.value = null;
      }
      function onDrop(e) {
        dragOver.value = false;
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) setFile(f);
      }

      // ---------- 历史点击 ----------
      async function openHistory(item) {
        activeId.value = item.id;
        const rec = await Storage.getHistoryRecord(item.id);
        if (!rec || !rec.blob) {
          messages.value = [{
            role: 'bot', text: '历史记录中的原图已不可用, 请重新上传。', time: Date.now(),
          }];
          return;
        }
        // 有缓存结果 → 直接回放, 不再请求 LLM
        if (rec.result) {
          messages.value = [
            { role: 'user', imageUrl: URL.createObjectURL(rec.blob), fileName: item.fileName, time: item.time },
            Object.assign({ role: 'bot', time: item.time }, rec.result),
          ];
          scrollBottom();
          return;
        }
        // 旧记录 → 重新处理
        messages.value = [];
        await processImage(rec.blob, item.fileName);
      }

      async function deleteHistory(item, ev) {
        ev.stopPropagation();
        await Storage.removeHistory(item.id);
        await refreshHistory();
        if (activeId.value === item.id) activeId.value = null;
      }

      async function clearAllHistory() {
        if (!confirm('确定清空全部历史记录?')) return;
        await Storage.clearHistory();
        await refreshHistory();
      }

      // ---------- 设置 ----------
      // 把 localStorage 中的设置载入响应式状态 (页面加载时也要执行，
      // 否则不打开设置弹窗直接提问会用不到已保存的配置)
      function applySavedSettings() {
        const s = Storage.getSettings();
        settings.llmKey = s.llmKey || '';
        settings.llmBaseUrl = s.llmBaseUrl || '';
        settings.llmService = s.llmService === 'anthropic' ? 'anthropic' : 'openai';
        const model = s.llmModel || '';
        if (model && !LLM.isKnownModel(model)) {
          settings.llmModel = '__custom__';
          settings.llmModelCustom = model;
        } else {
          settings.llmModel = model || LLM.DEFAULT_MODEL;
          settings.llmModelCustom = '';
        }
      }

      function openSettings() {
        applySavedSettings();
        showSettings.value = true;
      }
      function saveSettings() {
        const conf = llmSettings();
        Storage.saveSettings({
          llmKey: conf.llmKey,
          llmModel: conf.llmModel,
          llmBaseUrl: conf.llmBaseUrl,
          llmService: conf.llmService,
        });
        showSettings.value = false;
        // 如果还停留在初始欢迎语，保存配置后同步更新提示
        if (messages.value.length === 1 && messages.value[0].role === 'bot') {
          messages.value[0].text = greetingText(LLM.isConfigured(conf));
        }
      }

      function greetingText(configured) {
        return configured
          ? '你好! 我是"工程制图解题助手"。\n\n请上传一张工程图图片 (PNG/JPG)，系统会先用视觉模型理解图纸，再用几何算法求解并渲染答案卡；也可以直接输入文字提问。'
          : '你好! 我是"工程制图解题助手"。\n\n尚未配置 LLM。请先点击左下角「⚙ 设置」选择模型并填写 API Key。\n\n未配置时只能使用本地识别（仅支持部分内置题型）；配置后可分析更多题型，并支持文字问答。';
      }

      function newSession() {
        activeId.value = null;
        messages.value = [{
          role: 'bot',
          text: greetingText(LLM.isConfigured(llmSettings())),
          time: Date.now(),
        }];
      }

      function scrollBottom() {
        nextTick(() => {
          if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
        });
      }

      // ---------- 挂载 ----------
      onMounted(async () => {
        applySavedSettings();
        await refreshHistory();
        messages.value = [{
          role: 'bot',
          text: greetingText(LLM.isConfigured(llmSettings())),
          time: Date.now(),
        }];
        // 未配置 API Key 时, 默认弹出设置对话框引导配置
        if (!LLM.isConfigured(llmSettings())) {
          showSettings.value = true;
        }
      });

      return {
        messages, inputText, pendingFile, processing, history, activeId,
        showSettings, settings, llmModels, chatEl, fileInput, dragOver,
        send, onFilePicked, setFile, clearFile, onDrop, openHistory, deleteHistory,
        clearAllHistory, openSettings, saveSettings, fmtTime, newSession, isSolvedType,
      };
    },
  });

  app.component('answer-card', AnswerCardView);
  app.mount('#app');
})();
