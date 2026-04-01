// ==UserScript==
// @name         ä¹å·å¤šè´¦å·çŠ¶æ€ç®¡ç†
// @namespace    https://jz.faith.wang/
// @version      0.6.1
// @description  Multi-account dashboard with stamina countdown, idle, auto-idle, auto-dungeon, currency, rare items, technique and recruit cooldowns.
// @author       OpenAI Codex
// @match        https://jz.faith.wang/*
// @match        http://localhost:*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const BOOT = window.__JZ_MULTI_ACCOUNT_TOOL_CONFIG__ || {};
  const LAYOUT_MODE = BOOT.layout === 'page' ? 'page' : 'drawer';
  const IS_PAGE = LAYOUT_MODE === 'page';
  const PANEL_SIDE = !IS_PAGE && BOOT.side === 'left' ? 'left' : 'right';
  const PANEL_WIDTH = Math.max(420, Math.min(1600, Number(BOOT.panelWidth) || (IS_PAGE ? 1360 : 460)));
  const KEY = 'jzMultiAccountTool:v3';
  const JOB = {
    pending: 'è¿›è¡Œä¸­',
    generated_draft: 'å¾…ç¡®è®¤',
    published: 'å·²å‘å¸ƒ',
    failed: 'å¤±è´¥',
    refunded: 'å·²è¿”è¿˜',
    discarded: 'å·²ä¸¢å¼ƒ',
    accepted: 'å·²ç¡®è®¤',
    generated_preview: 'å¾…é¢„è§ˆ',
  };
  const IDLE = {
    active: 'æŒ‚æœºä¸­',
    stopping: 'åœæ­¢ä¸­',
    completed: 'å·²å®Œæˆ',
    interrupted: 'å·²ä¸­æ–­',
  };
  const STAMINA_RECOVER_PER_TICK = 1;
  const STAMINA_RECOVER_INTERVAL_SEC = 300;
  const INVENTORY_ITEMS_PAGE_SIZE = 200;
  const DUNGEON_POLL_INTERVAL_MS = 2500;
  const DUNGEON_SERVER_ADVANCE_GRACE_MS = 7000;
  const DUNGEON_STALL_TIMEOUT_MS = 10 * 60 * 1000;
  const BATTLE_KEEPALIVE_AUTH_TIMEOUT_MS = 5000;
  const AUTO_BATTLE_INITIAL_DELAY_MS = 450;
  const AUTO_BATTLE_RETRY_DELAY_MS = 800;
  const AUTO_BATTLE_MAX_RETRY = 3;
  const AUTO_BATTLE_SKILL_CACHE_MS = 5 * 60 * 1000;
  const AUTO_BATTLE_SKILL_ERROR_RETRY_MS = 10000;
  const SECT_FRAGMENT_BATCH_QTY = 500;
  const SECT_FRAGMENT_UNIT_COST = 50;
  const SECT_FRAGMENT_DONATION_SPIRIT_STONES = 2500;
  const SECT_FRAGMENT_ITEM_DEF_ID = 'mat-gongfa-canye';
  const SECT_FRAGMENT_SHOP_ITEM_ID = 'sect-shop-005';
  const DUNGEON_TYPE_LABELS = { material: 'ææ–™', equipment: 'è£…å¤‡', trial: 'è¯•ç‚¼', challenge: 'æŒ‘æˆ˜', event: 'æ´»åŠ¨' };
  const RARE_ITEMS = [
    { key: 'monthCard', label: 'ä¿®è¡Œæœˆå¡', itemDefId: 'cons-monthcard-001' },
    { key: 'insightToken', label: 'é¡¿æ‚Ÿç¬¦', itemDefId: 'token-005' },
    { key: 'recruitToken', label: 'é«˜çº§æ‹›å‹Ÿä»¤', itemDefId: 'token-004' },
    { key: 'renameCard', label: 'æ˜“åç¬¦', itemDefId: 'cons-rename-001' },
  ];
  const RARE_ITEM_KEYS = new Set(RARE_ITEMS.map((item) => item.key));
  const RARE_ITEM_BY_DEF_ID = new Map(RARE_ITEMS.map((item) => [item.itemDefId, item]));
  const SORT_SET = new Set(['manual', 'name', 'technique', 'partner', 'stamina_desc', 'stamina_asc']);
  const S = load();
  const T = new Map();
  const L = new Map();
  const R = new Map();
  const K = new Map();
  const UI = {
    open: IS_PAGE || BOOT.open === true,
    host: null,
    shadow: null,
    tick: 0,
    timer: 0,
    importOpen: false,
    importText: '',
    selectedId: '',
    pendingRender: false,
    pendingAutoRefresh: false,
    sectExchangeAllBusy: false,
    noticeMessage: '',
    noticeError: '',
  };
  const C = { loaded: false, loading: true, provider: 'local', tencentAppId: 0, error: '', sdkLoading: false };
  const D = { loaded: false, loading: false, error: '', list: [], fetchedAt: 0 };
  let sdkPromise = null;
  let socketIoPromise = null;
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        apiBase: normBase(raw.apiBase),
        autoRefreshMinutes: Number.isFinite(Number(raw.autoRefreshMinutes)) ? Math.max(0, Math.floor(Number(raw.autoRefreshMinutes))) : 5,
        lastAutoRefreshAt: str(raw.lastAutoRefreshAt),
        notifyEnabled: raw.notifyEnabled === true,
        sortBy: safeSort(str(raw.sortBy)),
        accounts: Array.isArray(raw.accounts) ? raw.accounts.map((a) => ({
          id: str(a.id) || uid(),
          order: Number.isFinite(Number(a.order)) ? Number(a.order) : 0,
          alias: str(a.alias),
          username: str(a.username),
          token: str(a.token),
          user: a && a.user && str(a.user.username) ? { id: Number(a.user.id) || null, username: str(a.user.username) } : null,
          hasCharacter: typeof a.hasCharacter === 'boolean' ? a.hasCharacter : null,
          character: a.character || null,
          idle: normalizeIdleSession(a.idle),
          idleError: str(a.idleError),
          idleConfig: normalizeIdleConfig(a.idleConfig),
          idleAutoEnabled: true,
          idleAutoArmed: true,
          technique: a.technique || null,
          partner: a.partner || null,
          dungeonId: str(a.dungeonId),
          dungeonRank: Math.max(1, Math.floor(Number(a.dungeonRank) || 1)),
          dungeonLastStopReason: str(a.dungeonLastStopReason),
          rareItems: normalizeRareItems(a.rareItems),
          inventoryError: str(a.inventoryError),
          techniqueNoticeKey: str(a.techniqueNoticeKey),
          partnerNoticeKey: str(a.partnerNoticeKey),
          lastLoginAt: str(a.lastLoginAt),
          lastRefreshAt: str(a.lastRefreshAt),
          lastError: str(a.lastError),
          lastMessage: str(a.lastMessage),
        })) : [],
      };
    } catch {
      return { apiBase: normBase(''), autoRefreshMinutes: 5, lastAutoRefreshAt: '', notifyEnabled: false, sortBy: 'manual', accounts: [] };
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({
      apiBase: S.apiBase,
      autoRefreshMinutes: S.autoRefreshMinutes,
      lastAutoRefreshAt: S.lastAutoRefreshAt,
      notifyEnabled: S.notifyEnabled,
      sortBy: S.sortBy,
      accounts: S.accounts,
    }));
  }

  function createAccount(order = nextOrder()) {
    return {
      id: uid(), order, alias: '', username: '', token: '', user: null, hasCharacter: null,
      character: null, idle: null, idleError: '', idleConfig: null, idleAutoEnabled: true, idleAutoArmed: true,
      technique: null, partner: null, dungeonId: '', dungeonRank: 1, dungeonLastStopReason: '', rareItems: emptyRareItems(), inventoryError: '',
      techniqueNoticeKey: '', partnerNoticeKey: '',
      lastLoginAt: '', lastRefreshAt: '', lastError: '', lastMessage: '',
    };
  }

  function clearCharacterState(a) {
    a.character = null;
    a.idle = null;
    a.idleError = '';
    a.idleAutoArmed = false;
    a.technique = null;
    a.partner = null;
    a.dungeonLastStopReason = '';
    a.rareItems = emptyRareItems();
    a.inventoryError = '';
    closeBattleKeepAlive(a.id);
    clearAutomationRuntime(a.id);
  }

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function uid() { return 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function safeSort(v) { return SORT_SET.has(v) ? v : 'manual'; }
  function nextOrder() { return S.accounts.reduce((m, a) => Math.max(m, Number(a.order) || 0), 0) + 1; }
  function normBase(v) {
    const preset = str(BOOT.defaultApiBase);
    const origin = String(location.origin || '').trim();
    const fallback = preset || (origin && origin !== 'null' ? origin.replace(/\/+$/, '') + '/api' : 'https://jz.faith.wang/api');
    return (str(v) || fallback).replace(/\/+$/, '');
  }
  function socketBase() {
    try {
      const u = new URL(normBase(S.apiBase), location.origin);
      u.pathname = u.pathname.replace(/\/api\/?$/, '');
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/+$/, '');
    } catch {
      return String(location.origin || '').replace(/\/+$/, '');
    }
  }
  function pageToken() { return str(localStorage.getItem('token')); }
  function isPageSocketAccount(token) { return !!str(token) && str(token) === pageToken(); }
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function now() { return new Date().toISOString(); }
  function num(v) { return Math.max(0, Math.floor(Number(v) || 0)).toLocaleString('zh-CN'); }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0)))); }
  function fmtTime(v) {
    if (!str(v)) return 'â€”';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
  }
  function dur(sec, zeroText = 'å¯ç”¨') {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    if (sec <= 0) return zeroText;
    const d = Math.floor(sec / 86400);
    const h = Math.floor(sec % 86400 / 3600);
    const m = Math.floor(sec % 3600 / 60);
    const s = sec % 60;
    return [d && d + 'å¤©', h && h + 'æ—¶', m && m + 'åˆ†', !d && !h && !m && s + 'ç§’'].filter(Boolean).join(' ');
  }
  function isInteractiveElement(el) {
    if (!el || typeof el !== 'object') return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable === true) return true;
    const role = str(el.getAttribute?.('role'));
    if (role === 'combobox' || role === 'listbox' || role === 'textbox' || role === 'spinbutton') return true;
    return !!el.closest?.('[data-field],.ant-select,.ant-picker,.ant-cascader');
  }
  function activeInteractiveElement() {
    const shadowActive = UI.shadow?.activeElement;
    if (isInteractiveElement(shadowActive)) return shadowActive;
    const active = document.activeElement;
    if (active && active !== document.body && active !== UI.host && isInteractiveElement(active)) return active;
    return null;
  }
  function shouldPauseLiveUiUpdates() { return !!activeInteractiveElement(); }
  function setGlobalNotice(message = '', error = '') {
    UI.noticeMessage = str(message);
    UI.noticeError = str(error);
  }
  function renderWhenSafe() {
    if (shouldPauseLiveUiUpdates()) {
      UI.pendingRender = true;
      return false;
    }
    UI.pendingRender = false;
    render();
    return true;
  }
  function sectFragmentTotalContributionCost(qty = SECT_FRAGMENT_BATCH_QTY, unitCost = SECT_FRAGMENT_UNIT_COST) {
    return Math.max(1, Math.floor(Number(qty) || 0)) * Math.max(1, Math.floor(Number(unitCost) || 0));
  }
  function parseSectShopRemaining(message) {
    const text = str(message);
    const matched = /å‰©ä½™\s*(\d+)\s*ä¸ª/.exec(text);
    if (matched) return Math.max(0, Math.floor(Number(matched[1]) || 0));
    if (/å·²å…‘æ¢|å‰©ä½™0ä¸ª/.test(text)) return 0;
    return null;
  }
  function remain(st) {
    if (!st) return 0;
    const ms = st.cooldownUntil ? new Date(st.cooldownUntil).getTime() : NaN;
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil((ms - Date.now()) / 1000));
    const base = Math.max(0, Math.floor(Number(st.cooldownRemainingSeconds) || 0));
    const fetched = Number(st.fetchedAtMs) || Date.now();
    return Math.max(0, base - Math.floor((Date.now() - fetched) / 1000));
  }
  function cdText(st) {
    if (!st) return 'æœªè¯»å–';
    if (st.unlocked === false) return st.unlockRealm ? `æœªè§£é”ï¼ˆ${st.unlockRealm}ï¼‰` : 'æœªè§£é”';
    return dur(remain(st));
  }
  function staminaRecoverPerTick(c) {
    return Math.max(1, Math.floor(Number(c?.staminaRecoverPerTick ?? c?.stamina_recover_per_tick) || STAMINA_RECOVER_PER_TICK));
  }
  function staminaRecoverIntervalSec(c) {
    return Math.max(1, Math.floor(Number(c?.staminaRecoverIntervalSec ?? c?.stamina_recover_interval_sec) || STAMINA_RECOVER_INTERVAL_SEC));
  }
  function staminaExactAnchorMs(c) {
    const ms = new Date(c?.staminaRecoverAt ?? c?.stamina_recover_at ?? '').getTime();
    return Number.isFinite(ms) ? ms : NaN;
  }
  function staminaAnchorMs(a) {
    const c = a?.character;
    if (!c) return NaN;
    const exact = staminaExactAnchorMs(c);
    if (Number.isFinite(exact)) return exact;
    const fetched = Number(c.staminaFetchedAtMs);
    if (Number.isFinite(fetched) && fetched > 0) return fetched;
    const refreshed = new Date(a?.lastRefreshAt || '').getTime();
    return Number.isFinite(refreshed) ? refreshed : NaN;
  }
  function hasExactStaminaAnchor(a) {
    return Number.isFinite(staminaExactAnchorMs(a?.character));
  }
  function staminaSnapshot(a) {
    const c = a?.character;
    if (!c) return null;
    const max = Math.max(0, Math.floor(Number(c.staminaMax) || 0));
    const base = Math.max(0, Math.floor(Number(c.stamina) || 0));
    if (!max) return { current: base, max: 0, toFullSec: null, approx: !hasExactStaminaAnchor(a) };
    if (base >= max) return { current: max, max, toFullSec: 0, approx: !hasExactStaminaAnchor(a) };
    const perTick = staminaRecoverPerTick(c);
    const intervalSec = staminaRecoverIntervalSec(c);
    const anchorMs = staminaAnchorMs(a);
    const elapsedSec = Number.isFinite(anchorMs) ? Math.max(0, Math.floor((Date.now() - anchorMs) / 1000)) : 0;
    const gained = Math.floor(elapsedSec / intervalSec) * perTick;
    const current = Math.min(max, base + gained);
    if (current >= max) return { current: max, max, toFullSec: 0, approx: !hasExactStaminaAnchor(a) };
    const mod = elapsedSec % intervalSec;
    const nextTickSec = mod === 0 ? intervalSec : intervalSec - mod;
    const ticksNeeded = Math.max(1, Math.ceil((max - current) / perTick));
    return {
      current,
      max,
      toFullSec: nextTickSec + Math.max(0, ticksNeeded - 1) * intervalSec,
      approx: !hasExactStaminaAnchor(a),
    };
  }
  function staminaCountdownText(a) {
    const snap = staminaSnapshot(a);
    if (!snap) return 'â€”';
    if (!(snap.max > 0)) return 'â€”';
    if (!(snap.toFullSec > 0)) return 'å·²æ»¡';
    return `${snap.approx ? 'çº¦ ' : ''}${dur(snap.toFullSec, 'å·²æ»¡')}`;
  }
  function staminaText(a) {
    const snap = staminaSnapshot(a);
    if (!snap) return 'â€”';
    const base = `${snap.current}/${snap.max || 'â€”'}`;
    const full = staminaCountdownText(a);
    return full === 'å·²æ»¡' || full === 'â€”' ? base : `${base} Â· æ»¡ä½“ ${full}`;
  }
  function staminaExtra(a) {
    const c = a?.character;
    if (!c) return 'æœªè¯»å–';
    const lines = [`è§’è‰² IDï¼š${esc(c.id)}`];
    lines.push(`æ¢å¤è§„åˆ™ï¼šæ¯ ${esc(dur(staminaRecoverIntervalSec(c), '0ç§’'))} æ¢å¤ ${esc(staminaRecoverPerTick(c))} ç‚¹`);
    if (!hasExactStaminaAnchor(a)) lines.push('è¯´æ˜ï¼šå½“å‰æ¥å£æœªè¿”å›æ¢å¤è¿›åº¦ï¼ŒæŒ‰æœ¬æ¬¡åˆ·æ–°æ—¶åˆ»ä¼°ç®—');
    return lines.join('<br>');
  }
  function emptyRareItems() {
    return { monthCard: 0, insightToken: 0, recruitToken: 0, renameCard: 0 };
  }
  function normalizeRareItems(v) {
    const out = emptyRareItems();
    if (!v || typeof v !== 'object') return out;
    for (const item of RARE_ITEMS) out[item.key] = Math.max(0, Math.floor(Number(v[item.key]) || 0));
    return out;
  }
  function normalizeAutoSkillPolicy(v) {
    const slots = Array.isArray(v?.slots) ? v.slots : [];
    return { slots: slots.map((slot) => ({ skilß}8öÚ$z{-®éÜj×à¢ÆÆ&VÃîˆz®XªzyZ(>ûÈ„”NûÈ“Æ–çWBFFÖf–VÆCÒ&GVævVöä–B"FFÖ–CÒ"G¶W62†æ–B—Ò"fÇVSÒ"G¶W62†æGVævVöä–B—Ò"Æ—7CÒ&GVævVöä6FÆör"Æ6V†öÆFW#Ò"G¶W62†GVævVöä–çWEÆ6V†öÆFW"‚’—Ò#ãÂöÆ&VÃà¢ÆÆ&VÃîˆz®XªzyZ(>™«î[ªcÆ–çWBFFÖf–VÆCÒ&GVævVöå&æ²"FFÖ–CÒ"G¶W62†æ–B—Ò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVSÒ"G¶W62„ÖF‚æÖ‚ƒÂÖF‚æfÆö÷"„çVÖ&W"†æGVævVöä–B—Ò"Æ—7CÒ&GVævVöä6FÆör"Æ6V†öÆFW#Ò"G¶W62†GVævVöä–çWEÆ6V†öÆFW"‚’—Ò#ãÂöÆ&VÃà¢ÆÆ&VÃîˆz®XªzyZ(>™«î[ªcÆ–çWBFFÖf–VÆCÒ&GVævVöå&æ²"FFÖ–CÒ"G¶W62†æ–B—Ò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVSÒ"G¶W62„ÖF‚æÖ‚ƒÂÖF‚æfÆö÷"„çVÖ&W"†æGVævVöä–B—Ò"Æ—7CÒ&GVævVöä6FÆör"Æ6V†öÆFW#Ò"G¶W62†GVævVöä–çWEÆ6V†öÆFW"‚’—Ò#ãÂöÆ&VÃà¢ÆÆ&VÃîˆz®XªzyZ(>™«î[ªcÆ–çWBFFÖf–VÆCÒ&GVævVöå&æ²"FFÖ–CÒ"G¶W62†æ–B—Ò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVSÒ"G¶W62„ÖF‚æÖ‚ƒÂÖF‚æfÆö÷"„çVÖ&W"†æGVævVöä–B—Ò"Æ—7CÒ&GVævVöä6FÆör"Æ6V†öÆFW#Ò"G¶W62†GVævVöä–çWEÆ6V†öÆFW"‚’—Ò#ãÂöÆ&VÃà¢ÆÆ&VÃîˆz®XªzyZ(>™«î[ªcÆ–çWBFFÖf–VÆCÒ&GVævVöå&æ²"FFÖ–CÒ"G¶W62†æ–B—Ò"G—SÒ&çVÖ&W""Ö–ãÒ#"7FWÒ#"fÇVSÒ"G¶W62„ÖF‚æÖ‚ƒÂÖF‚æfÆö÷"„çVÖ&W"†æGVævVöÈ–’—Ò"Æ—7CÒ&GVævVöä6FÆör"Æ6V†öÆFW#Ò"G¶W62†GVævVöä–çWEÆ6V†öÆFW"‚’—Ò#ãÂöÆ&VÃà