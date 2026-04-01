// ==UserScript==
// @name         九州多账号状态管理
// @namespace    https://jz.faith.wang/
// @version      0.6.2
// @description  Bootstrap loader for the full multi-account dashboard script.
// @author       OpenAI Codex
// @match        https://jz.faith.wang/*
// @match        http://localhost:*/*
// @grant        none
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

  async function fetchText(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
        return await response.text();
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
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`加载失败: ${url}`));
          document.head.appendChild(script);
        });
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
