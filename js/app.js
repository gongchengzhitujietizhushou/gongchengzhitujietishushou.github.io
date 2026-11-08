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

  createApp({
    setup() {
      // ---------- 状态 ----------
      const messages = ref([]);        // [{role:'user'|'bot', text, imageUrl?, answerUrl?, caption?, explanation?, params?, type?, time}]
      const inputText = ref('');
      const pendingFile = ref(null);   // { name, blob, url }
      const processing = ref(false);
      const history = ref([]);
      const activeId = ref(null);
      const showSettings = ref(false);
      const settings = reactive({ llmKey: '', llmModel: '', llmModelCustom: '', llmBaseUrl: '', llmService: 'openai' });
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
            : (settings.llmModel || '').trim(),
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

      // ---------- 核心: 上传并解题 ----------
      async function processImage(blob, fileName, question) {
        processing.value = true;
        try {
          // 用户消息: 显示原图
          const imgUrl = URL.createObjectURL(blob);
          const userMsg = { role: 'user', imageUrl: imgUrl, fileName, time: Date.now() };
          messages.value.push(userMsg);

          // 处理中占位
          const botMsg = reactive({ role: 'bot', processing: true, time: Date.now() });
          messages.value.push(botMsg);

          const llmConf = llmSettings();
          const useLLM = LLM.isConfigured(llmConf);

          // 1) 优先交给视觉模型理解图纸
          let llmRes = null, llmError = null;
          if (useLLM) {
            try {
              const dataUrl = await blobToDataUrl(blob, 1400);
              llmRes = await LLM.analyzeDrawing(dataUrl, llmConf, question);
            } catch (e) {
              llmError = e;
            }
          }

          // 2) 决定求解参数: LLM 结构化结果; 否则回退本地视觉管线
          let params = null;
          if (llmRes && llmRes.problem_type === 'cylinder_wedge_hole') {
            params = LLM.toParams(llmRes);
          }
          if (!params) {
            // LLM 未配置 / 调用失败 / 未给出可用参数 → 本地识别
            try {
              const imageData = await loadImageData(blob);
              const pipeline = await Vision.runPipeline(imageData);
              params = pipeline.params;
            } catch (e) {
              if (!llmError) llmError = e;
            }
          }

          // 3) 求解 + 渲染
          let answerUrl = null, explanation = [], paramsArr = null;
          let geo = null, problemType = 'unrecognized';
          let solved = false;

          if (params) {
            problemType = params.problem_type || problemType;
            const result = Solver.solve(params);
            geo = result.geometry;
            if (result.status === 'solved') {
              solved = true;
              const ansCanvas = document.createElement('canvas');
              Render.render(result, ansCanvas, {});
              answerUrl = ansCanvas.toDataURL('image/png');
              explanation = llmRes ? toLines(llmRes.analysis) : [];
              if (!explanation.length) explanation = result.explanation;
              paramsArr = [
                ['R', geo.R], ['L', geo.L], ['X1', geo.X1], ['X2', geo.X2],
                ['A', geo.A], ['W', geo.W], ['K', geo.K],
              ];
            } else {
              explanation = result.explanation;
            }
          }
          if (llmRes && llmRes.problem_type) problemType = llmRes.problem_type;

          // 4) 更新机器人消息
          if (solved) {
            const title = (llmRes && llmRes.title) ? (llmRes.title + ' · ') : '';
            Object.assign(botMsg, {
              processing: false,
              answerUrl,
              caption: title + '按识别比例重建，尺寸以原图标注为准',
              explanation,
              params: paramsArr,
              type: 'cylinder_wedge_hole',
              status: 'solved',
              time: Date.now(),
            });
          } else {
            const parts = [];
            if (llmRes) {
              if (llmRes.title) parts.push(llmRes.title);
              if (llmRes.analysis) parts.push(llmRes.analysis);
              if (llmRes.notes && llmRes.notes.length) parts.push('备注:\n- ' + llmRes.notes.join('\n- '));
            } else {
              if (llmError) parts.push('LLM 调用失败: ' + llmError.message + '\n已回退到本地识别。');
              if (explanation.length) parts.push(explanation.join('\n'));
              else parts.push('暂不支持该题型，或图片无法识别。');
              if (!useLLM) parts.push('提示: 在"设置"中配置 LLM 后，可分析更多题型。');
            }
            Object.assign(botMsg, {
              processing: false,
              text: parts.join('\n\n') || '暂不支持该题型，或图片无法识别。',
              type: problemType,
              status: 'partial',
              time: Date.now(),
            });
          }

          // 5) 记录历史 (原图 + 结果一起存, 回看时无需重新请求 LLM)
          const entry = await Storage.addHistory({
            fileName: fileName || '上传图片',
            problemType: problemType,
            summary: solved && geo
              ? `R=${geo.R.toFixed(0)} L=${geo.L.toFixed(0)} A=${geo.A.toFixed(0)} W=${geo.W.toFixed(0)}`
              : String(((llmRes && (llmRes.title || llmRes.analysis)) || (explanation[0] || ''))).slice(0, 80),
            blob,
            result: {
              answerUrl: botMsg.answerUrl || null,
              caption: botMsg.caption || '',
              explanation: botMsg.explanation || [],
              params: botMsg.params || null,
              text: botMsg.text || '',
              type: botMsg.type || '',
              status: botMsg.status || '',
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
            Object.assign(botMsg, { processing: false, text: reply, time: Date.now() });
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
      function openSettings() {
        const s = Storage.getSettings();
        settings.llmKey = s.llmKey || '';
        settings.llmBaseUrl = s.llmBaseUrl || '';
        settings.llmService = s.llmService === 'anthropic' ? 'anthropic' : 'openai';
        const model = s.llmModel || '';
        if (model && !LLM.isKnownModel(model)) {
          settings.llmModel = '__custom__';
          settings.llmModelCustom = model;
        } else {
          settings.llmModel = model;
          settings.llmModelCustom = '';
        }
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
      }

      function scrollBottom() {
        nextTick(() => {
          if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
        });
      }

      // ---------- 挂载 ----------
      onMounted(async () => {
        await refreshHistory();
        messages.value = [{
          role: 'bot',
          text: '你好! 我是"工程制图解题助手"。\n\n请上传一张工程图图片 (PNG/JPG), 系统会先用视觉模型理解图纸，再用几何算法求解并渲染。\n\n未配置 LLM 时使用本地识别，可解部分内置题型；在"设置"中选择模型并填写 API Key 后可分析更多题型。',
          time: Date.now(),
        }];
      });

      return {
        messages, inputText, pendingFile, processing, history, activeId,
        showSettings, settings, llmModels, chatEl, fileInput, dragOver,
        send, onFilePicked, setFile, clearFile, onDrop, openHistory, deleteHistory,
        clearAllHistory, openSettings, saveSettings, fmtTime,
      };
    },
  }).mount('#app');
})();
