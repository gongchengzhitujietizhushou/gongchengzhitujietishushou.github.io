// ============================================================
// js/storage.js
// 工程制图解题助手 —— 前端存储 (浏览器)
//  - 历史索引 + 设置 (LLM key, 广告代码): localStorage
//  - 图片 Blob (较大): IndexedDB
// ============================================================
'use strict';

const Storage = (() => {

  const INDEX_KEY = 'gctz_history_index_v1';
  const SETTINGS_KEY = 'gctz_settings_v1';
  const DB_NAME = 'gctz_images';
  const DB_STORE = 'images';
  const DB_VERSION = 1;

  // ---------- 通用 localStorage 辅助 ----------
  function lsGet(key, fallback) {
    try {
      const s = localStorage.getItem(key);
      return s == null ? fallback : JSON.parse(s);
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
  }

  // ---------- IndexedDB 图片 ----------
  let _dbPromise = null;
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return _dbPromise;
  }

  async function dbPut(id, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function dbGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ---------- 历史索引 ----------
  function getHistory() {
    return lsGet(INDEX_KEY, []);
  }
  function saveHistory(hist) {
    lsSet(INDEX_KEY, hist.slice(0, 200));  // 最多 200 条
  }

  // 添加一条历史
  async function addHistory(item) {
    // item: { id, time, fileName, problemType, params, answerSummary, thumbBlob? }
    const hist = getHistory();
    const entry = {
      id: item.id || ('h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      time: item.time || Date.now(),
      fileName: item.fileName || '',
      problemType: item.problemType || '',
      summary: item.summary || '',
      hasImage: !!item.blob,
    };
    // 图片存入 IndexedDB
    if (item.blob) {
      try { await dbPut(entry.id, item.blob); }
      catch (e) { entry.hasImage = false; }
    }
    hist.unshift(entry);
    saveHistory(hist);
    return entry;
  }

  async function getHistoryImage(id) {
    try { return await dbGet(id); } catch (e) { return null; }
  }

  async function removeHistory(id) {
    const hist = getHistory();
    const idx = hist.findIndex(h => h.id === id);
    if (idx >= 0) { hist.splice(idx, 1); saveHistory(hist); }
    try { await dbDelete(id); } catch (e) { /* ignore */ }
  }

  async function clearHistory() {
    saveHistory([]);
    // 清空 IndexedDB
    try {
      const db = await openDB();
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      await new Promise(res => { tx.oncomplete = res; tx.onerror = res; });
    } catch (e) { /* ignore */ }
  }

  // ---------- 设置 ----------
  function getSettings() {
    return lsGet(SETTINGS_KEY, { llmKey: '', llmModel: '', adCode: '' });
  }
  function saveSettings(s) {
    lsSet(SETTINGS_KEY, Object.assign({ llmKey: '', llmModel: '', adCode: '' }, s));
  }

  return {
    getHistory, saveHistory, addHistory, getHistoryImage, removeHistory, clearHistory,
    getSettings, saveSettings,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
