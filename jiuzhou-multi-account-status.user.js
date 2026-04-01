// ==UserScript==
// @name         九州多账号状态管理
// @namespace    https://jz.faith.wang/
// @version      0.6.3
// @description  Bootstrap loader for the full multi-account dashboard script.
// @author       OpenAI Codex
// @match        https://jz.faith.wang/*
// @match        http://localhost:*/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      unpkg.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const LABEL = '[九州多账号状态管理加载器]';
  const ARCHIVE_URLS = [
    'https://cdn.jsdelivr.net/gh/yuai404/jiuzhou-multi-account-status@main/archive/jiuzhou-multi-account-status-source.zip.base64.txt',
    'https://raw.githubusercontent.com/yuai404/jiuzhou-multi-account-status/main/archive/jiuzhou-multi-account-status-source.zip.base64.txt',
  ];
  const LIBRARY_URLS = [
    'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
    'https://unpkg.com/fflate@0.8.2/umd/index.js',
  ];
  const TARGET_FILE = 'jiuzhou-multi-account-status.user.js';

  function gmRequest(details) {
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest(details);
    if (typeof GM === 'object' && typeof GM?.xmlHttpRequest === 'function') return GM.xmlHttpRequest(details);
    return null;
  }

  function requestTextOnce(url) {
    return new Promise((resolve, reject) => {
      const handled = gmRequest({
        method: 'GET',
        url,
        onload: (response) => resolve(String(response?.responseText || '')),
        onerror: () => reject(new Error(`请求失败: ${url}`)),
        ontimeout: () => reject(new Error(`请求超时: ${url}`)),
      });
      if (handled) return;
      fetch(url, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
          return response.text();
        })
        .then(resolve, reject);
    });
  }

  async function fetchText(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        return await requestTextOnce(url);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('无法获取源码归档');
  }

  async function ensureLibrary(urls) {
    if (window.fflate?.unzipSync) return window.fflate;
    let lastError = null;
    for (const url of urls) {
      try {
        const source = await requestTextOnce(url);
        (0, eval)(`${source}\n//# sourceURL=${url}`);
        if (window.fflate?.unzipSync) return window.fflate;
        throw new Error(`库已加载但未暴露 fflate: ${url}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('无法加载解压库');
  }

  function base64ToBytes(text) {
    const clean = String(text || '').replace(/\s+/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function extractSource(bytes) {
    const archive = window.fflate?.unzipSync?.(bytes);
    if (!archive || !archive[TARGET_FILE]) throw new Error(`归档中缺少 ${TARGET_FILE}`);
    return new TextDecoder('utf-8').decode(archive[TARGET_FILE]);
  }

  (async () => {
    await ensureLibrary(LIBRARY_URLS);
    const archiveText = await fetchText(ARCHIVE_URLS);
    const code = extractSource(base64ToBytes(archiveText));
    (0, eval)(`${code}\n//# sourceURL=https://cdn.jsdelivr.net/gh/yuai404/jiuzhou-multi-account-status@main/${TARGET_FILE}`);
    console.log(LABEL, '源码加载完成');
  })().catch((error) => {
    console.error(LABEL, error);
  });
})();
