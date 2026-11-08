// ============================================================
// js/app.js
// 工程制图解题助手 —— Vue 3 应用入口 (纯前端)
//  - 上传图片 -> 视觉识别 -> 解题 -> 渲染答案
//  - 历史记录 (localStorage + IndexedDB)
//  - 设置面板 (LLM key / 广告代码, 预留)
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
      const settings = reactive({ llmKey: '', llmModel: '', adCode: '' });
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

      // ---------- 核心: 上传并解题 ----------
      async function processImage(blob, fileName) {
        processing.value = true;
        try {
          // 用户消息: 显示原图
          const imgUrl = URL.createObjectURL(blob);
          const userMsg = { role: 'user', imageUrl: imgUrl, fileName, time: Date.now() };
          messages.value.push(userMsg);

          // 处理中占位
          const botMsg = reactive({ role: 'bot', processing: true, time: Date.now() });
          messages.value.push(botMsg);

          // 视觉识别
          const imageData = await loadImageData(blob);
          const pipeline = await Vision.runPipeline(imageData);
          const params = pipeline.params;

          // 解题
          const result = Solver.solve(params);
          const geo = result.geometry;

          // 渲染答案 (自动缩放)
          const ansCanvas = document.createElement('canvas');
          Render.render(result, ansCanvas, {});
          const answerUrl = ansCanvas.toDataURL('image/png');

          // 更新机器人消息
          Object.assign(botMsg, {
            processing: false,
            answerUrl,
            caption: '俯视图 (黑色) — 圆柱上开通前后贯通的楔形孔, 出现"束腰"椭圆弧',
            explanation: result.explanation,
            params: [
              ['R', geo.R], ['L', geo.L], ['X1', geo.X1], ['X2', geo.X2],
              ['A', geo.A], ['W', geo.W], ['K', geo.K],
            ],
            type: result.problem_type,
            status: result.status,
            time: Date.now(),
          });

          // 记录历史
          const entry = await Storage.addHistory({
            fileName: fileName || '上传图片',
            problemType: result.problem_type,
            summary: `R=${geo.R.toFixed(0)} L=${geo.L.toFixed(0)} A=${geo.A.toFixed(0)} W=${geo.W.toFixed(0)}`,
            blob,
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
          await processImage(file.blob, file.name);
          inputText.value = '';
          return;
        }

        // 纯文本: 作为用户消息, 回复提示 (LLM 预留)
        const userMsg = { role: 'user', text, time: Date.now() };
        messages.value.push(userMsg);
        inputText.value = '';
        const botMsg = reactive({
          role: 'bot', processing: true, time: Date.now(),
        });
        messages.value.push(botMsg);
        // 模拟 (未来接 LLM)
        setTimeout(() => {
          Object.assign(botMsg, {
            processing: false,
            text: '当前为纯前端版本。请上传工程图图片 (PNG/JPG), 系统会识别主视图 (矩形+三角孔口) 与左视图 (圆+两条虚线弦), 并求解俯视图。\n\n提示: 未来版本可在"设置"中填入 LLM API Key, 实现文字问答。',
            time: Date.now(),
          });
          scrollBottom();
        }, 600);
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
        // 尝试恢复图片
        const blob = await Storage.getHistoryImage(item.id);
        if (blob) {
          messages.value = [];
          await processImage(blob, item.fileName);
        } else {
          messages.value = [{
            role: 'bot', text: '历史记录中的原图已不可用, 请重新上传。', time: Date.now(),
          }];
        }
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
        settings.llmModel = s.llmModel || '';
        settings.adCode = s.adCode || '';
        showSettings.value = true;
      }
      function saveSettings() {
        Storage.saveSettings({ llmKey: settings.llmKey, llmModel: settings.llmModel, adCode: settings.adCode });
        showSettings.value = false;
        const adSlot = document.getElementById('ad-slot');
        if (adSlot) adSlot.innerHTML = settings.adCode || '';
      }

      function scrollBottom() {
        nextTick(() => {
          if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
        });
      }

      // ---------- 挂载 ----------
      onMounted(async () => {
        await refreshHistory();
        const s = Storage.getSettings();
        settings.adCode = s.adCode || '';
        const adSlot = document.getElementById('ad-slot');
        if (adSlot && settings.adCode) adSlot.innerHTML = settings.adCode;
        messages.value = [{
          role: 'bot',
          text: '你好! 我是"工程制图解题助手"。\n\n请上传一张工程图图片 (PNG/JPG), 图片需包含: 主视图 (矩形+三角孔口) 与左视图 (圆+两条虚线弦) 的"圆柱上开通前后贯通楔形孔"题。系统将自动识别并求解俯视图。\n\n也可以点击下方示例, 快速体验。',
          time: Date.now(),
        }];
      });

      return {
        messages, inputText, pendingFile, processing, history, activeId,
        showSettings, settings, chatEl, fileInput, dragOver,
        send, onFilePicked, setFile, clearFile, onDrop, openHistory, deleteHistory,
        clearAllHistory, openSettings, saveSettings, fmtTime,
      };
    },
  }).mount('#app');
})();
