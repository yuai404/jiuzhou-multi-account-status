// ==UserScript==
// @name         九州多账号状态管理
// @namespace    https://jz.faith.wang/
// @version      0.8.5
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
  const SCRIPT_VERSION = str(BOOT.version) || '0.8.5';
  const KEY = 'jzMultiAccountTool:v3';
  const DEFAULT_MONTH_CARD_ID = 'monthcard-001';
  const JOB = {
    pending: '进行中',
    generated_draft: '待确认',
    published: '已发布',
    failed: '失败',
    refunded: '已返还',
    discarded: '已丢弃',
    accepted: '已确认',
    generated_preview: '待预览',
  };
  const IDLE = {
    active: '挂机中',
    stopping: '停止中',
    completed: '已完成',
    interrupted: '已中断',
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
  const WANDER_OPTION_COUNT = 3;
  const WANDER_PENDING_JOB_POLL_INTERVAL_MS = 2000;
  const WANDER_PENDING_JOB_MAX_POLLS = 45;
  const DUNGEON_TYPE_LABELS = { material: '材料', equipment: '装备', trial: '试炼', challenge: '挑战', event: '活动' };
  const RARE_ITEMS = [
    { key: 'monthCard', label: '修行月卡', itemDefId: 'cons-monthcard-001' },
    { key: 'insightToken', label: '顿悟符', itemDefId: 'token-005' },
    { key: 'recruitToken', label: '高级招募令', itemDefId: 'token-004' },
    { key: 'renameCard', label: '易名符', itemDefId: 'cons-rename-001' },
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
    settingsOpen: BOOT.settingsOpen === true,
    importOpen: false,
    importText: '',
    selectedId: '',
    pendingRender: false,
    pendingAutoRefresh: false,
    signInAllBusy: false,
    monthCardClaimAllBusy: false,
    sectExchangeAllBusy: false,
    noticeMessage: '',
    noticeError: '',
    wanderOpenById: Object.create(null),
    wanderChoiceDraftById: Object.create(null),
    scrollPositions: Object.create(null),
    lastScrollAt: 0,
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
          signIn: normalizeSignInState(a.signIn),
          signInError: str(a.signInError),
          monthCard: normalizeMonthCardState(a.monthCard),
          monthCardError: str(a.monthCardError),
          wanderOverview: normalizeWanderOverview(a.wanderOverview),
          wanderError: str(a.wanderError),
          wanderOptionIndex: normalizeWanderOptionIndex(a.wanderOptionIndex),
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
          technique: null, partner: null, signIn: null, signInError: '', monthCard: null, monthCardError: '', wanderOverview: null, wanderError: '', wanderOptionIndex: 0, dungeonId: '', dungeonRank: 1, dungeonLastStopReason: '', rareItems: emptyRareItems(), inventoryError: '',
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
    a.signIn = null;
    a.signInError = '';
    a.monthCard = null;
    a.monthCardError = '';
    a.wanderOverview = null;
    a.wanderError = '';
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
  function currentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function num(v) { return Math.max(0, Math.floor(Number(v) || 0)).toLocaleString('zh-CN'); }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(Number(ms) || 0)))); }
  function fmtTime(v) {
    if (!str(v)) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
  }
  function dur(sec, zeroText = '可用') {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    if (sec <= 0) return zeroText;
    const d = Math.floor(sec / 86400);
    const h = Math.floor(sec % 86400 / 3600);
    const m = Math.floor(sec % 3600 / 60);
    const s = sec % 60;
    return [d && d + '天', h && h + '时', m && m + '分', !d && !h && !m && s + '秒'].filter(Boolean).join(' ');
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
  function isUserScrollingRecently() {
    return Date.now() - Math.max(0, Number(UI.lastScrollAt) || 0) < 300;
  }
  function shouldPauseLiveUiUpdates() {
    return !!activeInteractiveElement();
  }
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
  function rememberScrollPositions() {
    if (!UI.shadow) return;
    UI.shadow.querySelectorAll('[data-scroll-key]').forEach((el) => {
      const key = str(el.getAttribute('data-scroll-key'));
      if (!key) return;
      UI.scrollPositions[key] = Math.max(0, Math.floor(Number(el.scrollTop) || 0));
    });
  }
  function restoreScrollPositions() {
    if (!UI.shadow) return;
    UI.shadow.querySelectorAll('[data-scroll-key]').forEach((el) => {
      const key = str(el.getAttribute('data-scroll-key'));
      if (!key) return;
      const top = Math.max(0, Math.floor(Number(UI.scrollPositions[key]) || 0));
      if (top > 0) el.scrollTop = top;
    });
  }
  function sectFragmentTotalContributionCost(qty = SECT_FRAGMENT_BATCH_QTY, unitCost = SECT_FRAGMENT_UNIT_COST) {
    return Math.max(1, Math.floor(Number(qty) || 0)) * Math.max(1, Math.floor(Number(unitCost) || 0));
  }
  function parseSectShopRemaining(message) {
    const text = str(message);
    const matched = /剩余\s*(\d+)\s*个/.exec(text);
    if (matched) return Math.max(0, Math.floor(Number(matched[1]) || 0));
    if (/已兑换|剩余0个/.test(text)) return 0;
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
    if (!st) return '未读取';
    if (st.unlocked === false) return st.unlockRealm ? `未解锁（${st.unlockRealm}）` : '未解锁';
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
    if (!snap) return '—';
    if (!(snap.max > 0)) return '—';
    if (!(snap.toFullSec > 0)) return '已满';
    return `${snap.approx ? '约 ' : ''}${dur(snap.toFullSec, '已满')}`;
  }
  function staminaText(a) {
    const snap = staminaSnapshot(a);
    if (!snap) return '—';
    const base = `${snap.current}/${snap.max || '—'}`;
    const full = staminaCountdownText(a);
    return full === '已满' || full === '—' ? base : `${base} · 满体 ${full}`;
  }
  function staminaExtra(a) {
    const c = a?.character;
    if (!c) return '未读取';
    const lines = [`角色 ID：${esc(c.id)}`];
    lines.push(`恢复规则：每 ${esc(dur(staminaRecoverIntervalSec(c), '0秒'))} 恢复 ${esc(staminaRecoverPerTick(c))} 点`);
    if (!hasExactStaminaAnchor(a)) lines.push('说明：当前接口未返回恢复进度，按本次刷新时刻估算');
    return lines.join('<br>');
  }
  function emptyRareItems() {
    return { monthCard: 0, insightToken: 0, recruitToken: 0, renameCard: 0, sectFragment: 0 };
  }
  function normalizeRareItems(v) {
    const out = emptyRareItems();
    if (!v || typeof v !== 'object') return out;
    for (const item of RARE_ITEMS) out[item.key] = Math.max(0, Math.floor(Number(v[item.key]) || 0));
    out.sectFragment = Math.max(0, Math.floor(Number(v.sectFragment) || 0));
    return out;
  }
  function normalizeSignInState(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      today: str(v.today),
      signedToday: v.signedToday === true,
      month: str(v.month),
      monthSignedCount: Math.max(0, Math.floor(Number(v.monthSignedCount) || 0)),
      streakDays: Math.max(0, Math.floor(Number(v.streakDays) || 0)),
      todayReward: Math.max(0, Math.floor(Number(v.todayReward) || 0)),
      fetchedAtMs: Math.max(0, Math.floor(Number(v.fetchedAtMs) || 0)),
    };
  }
  function normalizeMonthCardState(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      monthCardId: str(v.monthCardId),
      name: str(v.name),
      active: v.active === true,
      expireAt: str(v.expireAt) || null,
      daysLeft: Math.max(0, Math.floor(Number(v.daysLeft) || 0)),
      today: str(v.today),
      lastClaimDate: str(v.lastClaimDate) || null,
      canClaim: v.canClaim === true,
      dailySpiritStones: Math.max(0, Math.floor(Number(v.dailySpiritStones) || 0)),
      fetchedAtMs: Math.max(0, Math.floor(Number(v.fetchedAtMs) || 0)),
    };
  }
  function normalizeWanderOptionIndex(v) {
    return Math.max(0, Math.min(WANDER_OPTION_COUNT - 1, Math.floor(Number(v) || 0)));
  }
  function normalizeWanderJob(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      generationId: str(v.generationId),
      status: str(v.status),
      startedAt: str(v.startedAt),
      finishedAt: str(v.finishedAt) || null,
      errorMessage: str(v.errorMessage) || null,
    };
  }
  function normalizeWanderEpisodeOption(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      index: Math.max(0, Math.floor(Number(v.index) || 0)),
      text: str(v.text),
    };
  }
  function normalizeWanderEpisode(v) {
    if (!v || typeof v !== 'object') return null;
    const rawChosenOptionIndex = v.chosenOptionIndex;
    return {
      id: str(v.id),
      dayKey: str(v.dayKey),
      dayIndex: Math.max(0, Math.floor(Number(v.dayIndex) || 0)),
      title: str(v.title),
      opening: str(v.opening),
      options: (Array.isArray(v.options) ? v.options : []).map((option, index) => normalizeWanderEpisodeOption({
        ...(option && typeof option === 'object' ? option : {}),
        index: Number.isFinite(Number(option?.index)) ? Number(option.index) : index,
      })).filter(Boolean),
      chosenOptionIndex: rawChosenOptionIndex === null || rawChosenOptionIndex === '' || typeof rawChosenOptionIndex === 'undefined'
        ? null
        : (Number.isFinite(Number(rawChosenOptionIndex)) ? Math.max(0, Math.floor(Number(rawChosenOptionIndex))) : null),
      chosenOptionText: str(v.chosenOptionText) || null,
      summary: str(v.summary),
      isEnding: v.isEnding === true,
      endingType: str(v.endingType),
      rewardTitleName: str(v.rewardTitleName) || null,
      rewardTitleDesc: str(v.rewardTitleDesc) || null,
      createdAt: str(v.createdAt),
      chosenAt: str(v.chosenAt) || null,
    };
  }
  function normalizeWanderStory(v) {
    if (!v || typeof v !== 'object') return null;
    const episodes = (Array.isArray(v.episodes) ? v.episodes : [])
      .map(normalizeWanderEpisode)
      .filter(Boolean)
      .sort((a, b) => a.dayIndex - b.dayIndex || a.createdAt.localeCompare(b.createdAt));
    return {
      id: str(v.id),
      status: str(v.status),
      theme: str(v.theme),
      premise: str(v.premise),
      summary: str(v.summary),
      episodeCount: Math.max(0, Math.floor(Number(v.episodeCount) || episodes.length)),
      rewardTitleId: str(v.rewardTitleId) || null,
      finishedAt: str(v.finishedAt) || null,
      createdAt: str(v.createdAt),
      updatedAt: str(v.updatedAt),
      episodes,
    };
  }
  function normalizeWanderGeneratedTitle(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      id: str(v.id),
      name: str(v.name),
      description: str(v.description),
      color: str(v.color) || null,
      effects: v.effects && typeof v.effects === 'object' ? v.effects : {},
      isEquipped: v.isEquipped === true,
      obtainedAt: str(v.obtainedAt),
    };
  }
  function normalizeWanderOverview(v) {
    if (!v || typeof v !== 'object') return null;
    const hasPendingEpisode = v.hasPendingEpisode === true;
    const currentEpisode = normalizeWanderEpisode(v.currentEpisode);
    if (hasPendingEpisode && currentEpisode) {
      currentEpisode.pendingChoice = true;
      currentEpisode.chosenOptionIndex = null;
      currentEpisode.chosenOptionText = null;
      currentEpisode.chosenAt = null;
    }
    return {
      today: str(v.today),
      aiAvailable: v.aiAvailable === true,
      hasPendingEpisode,
      canGenerate: v.canGenerate === true,
      isCoolingDown: v.isCoolingDown === true,
      cooldownUntil: str(v.cooldownUntil) || null,
      cooldownRemainingSeconds: Math.max(0, Math.floor(Number(v.cooldownRemainingSeconds) || 0)),
      currentGenerationJob: normalizeWanderJob(v.currentGenerationJob),
      activeStory: normalizeWanderStory(v.activeStory),
      currentEpisode,
      latestFinishedStory: normalizeWanderStory(v.latestFinishedStory),
      generatedTitles: (Array.isArray(v.generatedTitles) ? v.generatedTitles : []).map(normalizeWanderGeneratedTitle).filter(Boolean),
      fetchedAtMs: Math.max(0, Math.floor(Number(v.fetchedAtMs) || 0)) || Date.now(),
    };
  }
  function normalizeAutoSkillPolicy(v) {
    const slots = Array.isArray(v?.slots) ? v.slots : [];
    return { slots: slots.map((slot) => ({ skillId: str(slot?.skillId ?? slot?.skill_id), priority: Math.max(0, Math.floor(Number(slot?.priority) || 0)) })).filter((slot) => slot.skillId) };
  }
  function normalizeIdleConfig(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      mapId: str(v.mapId), roomId: str(v.roomId), maxDurationMs: Math.max(0, Math.floor(Number(v.maxDurationMs) || 0)),
      autoSkillPolicy: normalizeAutoSkillPolicy(v.autoSkillPolicy),
      targetMonsterDefId: str(v.targetMonsterDefId) || null,
      includePartnerInBattle: v.includePartnerInBattle === true,
    };
  }
  function currentSpiritStones(a) { return Math.max(0, Math.floor(Number(a?.character?.spiritStones ?? a?.character?.spirit_stones) || 0)); }
  function currentSilver(a) { return Math.max(0, Math.floor(Number(a?.character?.silver) || 0)); }
  function currentSectFragments(a) { return Math.max(0, Math.floor(Number(a?.rareItems?.sectFragment) || 0)); }
  function currencyText(a) { return a?.character ? `灵石 ${num(currentSpiritStones(a))} · 银两 ${num(currentSilver(a))}` : '未读取'; }
  function currencyExtra(a) { return a?.character ? `灵石：${esc(num(currentSpiritStones(a)))}<br>银两：${esc(num(currentSilver(a)))}` : '未读取'; }
  function totalSpiritStones() { return S.accounts.reduce((sum, a) => sum + currentSpiritStones(a), 0); }
  function totalSilver() { return S.accounts.reduce((sum, a) => sum + currentSilver(a), 0); }
  function totalSectFragments() { return S.accounts.reduce((sum, a) => sum + currentSectFragments(a), 0); }
  function totalSectFragmentsText() { return `功法残页 ${num(totalSectFragments())}`; }
  function totalSectFragmentsExtra() {
    const total = totalSectFragments();
    const holders = S.accounts.filter((a) => currentSectFragments(a) > 0).length;
    return `总数量：${esc(num(total))}<br>有残页账号：${esc(num(holders))}`;
  }
  function totalRareItems() {
    const out = emptyRareItems();
    for (const a of S.accounts) {
      const items = normalizeRareItems(a?.rareItems);
      for (const item of RARE_ITEMS) out[item.key] += Math.max(0, Math.floor(Number(items[item.key]) || 0));
    }
    return out;
  }
  function totalRareItemsText() {
    const items = totalRareItems();
    return RARE_ITEMS.map((item) => `${item.label} ${num(items[item.key])}`).join(' · ');
  }
  function totalRareItemsExtra() {
    const items = totalRareItems();
    return RARE_ITEMS.map((item) => `${esc(item.label)}：${esc(num(items[item.key]))}`).join('<br>');
  }
  function lastAutoRefreshText() {
    if (S.autoRefreshMinutes <= 0) return '已关闭';
    return str(S.lastAutoRefreshAt) ? fmtTime(S.lastAutoRefreshAt) : '尚未自动刷新';
  }
  function settingsSummaryText() {
    const autoRefreshText = S.autoRefreshMinutes > 0 ? `每 ${S.autoRefreshMinutes} 分钟` : '已关闭';
    return `版本 v${SCRIPT_VERSION} · 自动刷新 ${autoRefreshText} · 验证码 ${providerName()} · API ${S.apiBase}`;
  }
  function summarizeWanderAccounts() {
    const summary = { ready: 0, pending: 0, generating: 0, cooling: 0, failed: 0, unavailable: 0 };
    for (const a of S.accounts) {
      if (!a?.token || !a?.character) continue;
      if (a.wanderError) {
        summary.failed += 1;
        continue;
      }
      const overview = normalizeWanderOverview(a.wanderOverview);
      if (!overview) continue;
      if (!overview.aiAvailable) {
        summary.unavailable += 1;
        continue;
      }
      if (overview.currentGenerationJob?.status === 'pending') {
        summary.generating += 1;
        continue;
      }
      if (overview.currentGenerationJob?.status === 'failed') {
        summary.failed += 1;
        continue;
      }
      if (overview.hasPendingEpisode) {
        summary.pending += 1;
        continue;
      }
      if (overview.isCoolingDown) {
        summary.cooling += 1;
        continue;
      }
      if (overview.canGenerate) summary.ready += 1;
    }
    return summary;
  }
  function globalWanderSummaryText() {
    const s = summarizeWanderAccounts();
    return `可开始 ${s.ready} · 待选择 ${s.pending} · 生成中 ${s.generating}`;
  }
  function globalWanderSummaryExtra() {
    const s = summarizeWanderAccounts();
    return `冷却中 ${s.cooling}<br>失败/读取异常 ${s.failed}<br>AI 未配置 ${s.unavailable}`;
  }
  function globalSummaryCards() {
    return `
      <div class="summary-grid">
        ${summaryCard('全局灵石 / 银两', `灵石 ${esc(num(totalSpiritStones()))} · 银两 ${esc(num(totalSilver()))}`, '')}
        ${summaryCard('全局稀有物品', esc(totalRareItemsText()), totalRareItemsExtra())}
        ${summaryCard('全局功法残页', esc(totalSectFragmentsText()), totalSectFragmentsExtra())}
        ${summaryCard('全局云游', esc(globalWanderSummaryText()), globalWanderSummaryExtra())}
        ${summaryCard('上次自动刷新', esc(lastAutoRefreshText()), S.autoRefreshMinutes > 0 ? `当前频率：每 ${esc(S.autoRefreshMinutes)} 分钟` : '自动刷新已关闭')}
      </div>`;
  }
  function rareItemsText(a) {
    if (!a?.character) return '未读取';
    if (a.inventoryError) return '读取失败';
    const items = normalizeRareItems(a.rareItems);
    return RARE_ITEMS.map((item) => `${item.label} ${num(items[item.key])}`).join(' · ');
  }
  function rareItemsExtra(a) {
    if (!a?.character) return '未读取';
    if (a.inventoryError) return `稀有物品读取失败：${esc(a.inventoryError)}`;
    const items = normalizeRareItems(a.rareItems);
    return RARE_ITEMS.map((item) => `${esc(item.label)}：${esc(num(items[item.key]))}`).join('<br>');
  }
  function sectFragmentText(a) {
    if (!a?.character) return a?.hasCharacter === false ? '\u672a\u521b\u5efa\u89d2\u8272' : '\u672a\u8bfb\u53d6';
    if (a.inventoryError) return '\u8bfb\u53d6\u5931\u8d25';
    return `\u529f\u6cd5\u6b8b\u9875 ${num(currentSectFragments(a))}`;
  }
  function sectFragmentExtra(a) {
    if (!a?.character) return a?.hasCharacter === false ? '\u8d26\u53f7\u5df2\u767b\u5f55\uff0c\u4f46\u5c1a\u672a\u521b\u5efa\u89d2\u8272' : '\u672a\u8bfb\u53d6';
    if (a.inventoryError) return `\u529f\u6cd5\u6b8b\u9875\u8bfb\u53d6\u5931\u8d25\uff1a${esc(a.inventoryError)}`;
    return `\u5f53\u524d\u6570\u91cf\uff1a${esc(num(currentSectFragments(a)))}`;
  }
  function signInText(a) {
    if (!a?.character) return a?.hasCharacter === false ? '未创建角色' : '未读取';
    if (a.signInError) return a.signInError === '接口未部署' ? '暂不可用' : '读取失败';
    const st = normalizeSignInState(a.signIn);
    if (!st) return '未读取';
    return st.signedToday ? '今日已签到' : '今日未签到';
  }
  function signInExtra(a) {
    if (!a?.character) return a?.hasCharacter === false ? '账号已登录，但尚未创建角色' : '未读取';
    if (a.signInError) return `签到状态读取失败：${esc(a.signInError)}`;
    const st = normalizeSignInState(a.signIn);
    if (!st) return '未读取';
    const lines = [
      `月份：${esc(st.month || currentMonthKey())}`,
      `本月已签：${esc(num(st.monthSignedCount))} 天`,
      `连续签到：${esc(num(st.streakDays))} 天`,
    ];
    lines.push(st.signedToday
      ? `今日状态：已签到${st.todayReward > 0 ? ` · 获得 ${esc(num(st.todayReward))} 灵石` : ''}`
      : '今日状态：尚未签到');
    return lines.join('<br>');
  }
  function monthCardText(a) {
    if (!a?.character) return a?.hasCharacter === false ? '未创建角色' : '未读取';
    if (a.monthCardError) return a.monthCardError === '接口未部署' ? '暂不可用' : '读取失败';
    const st = normalizeMonthCardState(a.monthCard);
    if (!st) return '未读取';
    if (!st.active) return st.expireAt ? '已到期' : '未激活';
    if (st.canClaim) return '可领奖励';
    return st.today && st.lastClaimDate === st.today ? '今日已领取' : '生效中';
  }
  function monthCardExtra(a) {
    if (!a?.character) return a?.hasCharacter === false ? '账号已登录，但尚未创建角色' : '未读取';
    if (a.monthCardError) return `月卡状态读取失败：${esc(a.monthCardError)}`;
    const st = normalizeMonthCardState(a.monthCard);
    if (!st) return '未读取';
    const lines = [`每日奖励：${esc(num(st.dailySpiritStones))} 灵石`];
    if (!st.active) {
      lines.push(st.expireAt ? `状态：已到期（${esc(fmtTime(st.expireAt))}）` : '状态：未激活');
      return lines.join('<br>');
    }
    lines.push(`状态：生效中 · 剩余 ${esc(num(st.daysLeft))} 天`);
    lines.push(`到期：${esc(fmtTime(st.expireAt))}`);
    lines.push(st.canClaim ? '今日奖励：可领取' : `今日奖励：${st.today && st.lastClaimDate === st.today ? '已领取' : '暂不可领'}`);
    return lines.join('<br>');
  }
  function getWanderDraft(id, episodeId = '') {
    const row = UI.wanderChoiceDraftById[id];
    if (!row || typeof row !== 'object') return null;
    if (episodeId && str(row.episodeId) !== str(episodeId)) return null;
    const optionIndex = Number.isFinite(Number(row.optionIndex)) ? Math.max(0, Math.floor(Number(row.optionIndex))) : null;
    return optionIndex === null ? null : { episodeId: str(row.episodeId), optionIndex };
  }
  function setWanderDraft(id, episodeId, optionIndex) {
    UI.wanderChoiceDraftById[id] = {
      episodeId: str(episodeId),
      optionIndex: Math.max(0, Math.floor(Number(optionIndex) || 0)),
    };
  }
  function clearWanderDraft(id, episodeId = '') {
    if (!episodeId) {
      delete UI.wanderChoiceDraftById[id];
      return;
    }
    const row = getWanderDraft(id, episodeId);
    if (row) delete UI.wanderChoiceDraftById[id];
  }
  function wanderDraftIndex(id, episode) {
    const options = Array.isArray(episode?.options) ? episode.options : [];
    const draft = getWanderDraft(id, episode?.id);
    if (draft && options.some((option) => option.index === draft.optionIndex)) return draft.optionIndex;
    if (episode?.pendingChoice === true) return null;
    if (Number.isFinite(Number(episode?.chosenOptionIndex))) return Math.max(0, Math.floor(Number(episode.chosenOptionIndex)));
    return null;
  }
  function wanderDraftLabel(id, episode) {
    const idx = wanderDraftIndex(id, episode);
    return idx === null ? '未选择' : `抉择 ${idx + 1}`;
  }
  function syncWanderChoiceUi(id, episodeId) {
    const root = UI.shadow;
    if (!root) return;
    const draft = getWanderDraft(id, episodeId);
    const draftIndex = draft ? draft.optionIndex : null;
    root.querySelectorAll('[data-action="wanderPick"]').forEach((el) => {
      if (str(el.getAttribute('data-id')) !== str(id) || str(el.getAttribute('data-episode-id')) !== str(episodeId)) return;
      const optionIndex = Math.max(0, Math.floor(Number(el.getAttribute('data-option-index')) || 0));
      const picked = draftIndex !== null && optionIndex === draftIndex;
      el.classList.toggle('is-preferred', picked);
      el.setAttribute('aria-pressed', picked ? 'true' : 'false');
    });
    root.querySelectorAll('[data-wander-confirm-text]').forEach((el) => {
      if (str(el.getAttribute('data-id')) !== str(id) || str(el.getAttribute('data-episode-id')) !== str(episodeId)) return;
      el.textContent = `当前待确认：${draftIndex === null ? '未选择' : `抉择 ${draftIndex + 1}`}`;
    });
    root.querySelectorAll('[data-action="wanderConfirm"]').forEach((el) => {
      if (str(el.getAttribute('data-id')) !== str(id) || str(el.getAttribute('data-episode-id')) !== str(episodeId)) return;
      if (!loadState(id).wanderAction) el.disabled = draftIndex === null;
    });
  }
  function readCheckedWanderOptionFromDom(id, episodeId) {
    const root = UI.shadow;
    if (!root) return null;
    const name = `wander-choice-${id}-${episodeId}`;
    const checked = root.querySelector(`input[name="${name}"]:checked`);
    if (!checked) return null;
    const value = checked.getAttribute('value');
    return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : null;
  }
  function wanderRemain(overview) {
    if (!overview) return 0;
    const untilMs = overview.cooldownUntil ? new Date(overview.cooldownUntil).getTime() : NaN;
    if (Number.isFinite(untilMs)) return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
    const fetched = Math.max(0, Math.floor(Number(overview.fetchedAtMs) || 0)) || Date.now();
    return Math.max(0, Math.floor(Number(overview.cooldownRemainingSeconds) || 0) - Math.floor((Date.now() - fetched) / 1000));
  }
  function wanderHistoryStory(overview) {
    if (!overview) return null;
    return overview.activeStory || overview.latestFinishedStory || null;
  }
  function wanderCurrentEpisode(overview) {
    return overview?.currentEpisode || null;
  }
  function wanderText(a) {
    if (!a?.character) return a?.hasCharacter === false ? '未创建角色' : '未读取';
    if (a.wanderError) return a.wanderError === '接口未部署' ? '暂不可用' : '读取失败';
    const overview = normalizeWanderOverview(a.wanderOverview);
    if (!overview) return '未读取';
    if (!overview.aiAvailable) return 'AI 未配置';
    if (overview.currentGenerationJob?.status === 'pending') return '生成中';
    if (overview.currentGenerationJob?.status === 'failed') return '生成失败';
    const currentEpisode = wanderCurrentEpisode(overview);
    if (overview.hasPendingEpisode && currentEpisode) return `第 ${Math.max(1, currentEpisode.dayIndex || 1)} 幕待选择`;
    if (overview.isCoolingDown) return `冷却 ${dur(wanderRemain(overview))}`;
    if (overview.canGenerate) return '可开始';
    if (currentEpisode?.rewardTitleName) return `已结幕 · ${currentEpisode.rewardTitleName}`;
    if (wanderHistoryStory(overview)?.theme) return `进行中 · ${wanderHistoryStory(overview).theme}`;
    return '待刷新';
  }
  function wanderExtra(a) {
    if (!a?.character) return a?.hasCharacter === false ? '账号已登录，但尚未创建角色' : '未读取';
    if (a.wanderError) return `云游状态读取失败：${esc(a.wanderError)}`;
    const overview = normalizeWanderOverview(a.wanderOverview);
    if (!overview) return '未读取';
    const currentEpisode = wanderCurrentEpisode(overview);
    const lines = [
      `今日日期：${esc(overview.today || '未返回')}`,
      `AI：${esc(overview.aiAvailable ? '可用' : '未配置')}`,
    ];
    if (overview.currentGenerationJob?.status) lines.push(`生成任务：${esc(overview.currentGenerationJob.status)}`);
    if (overview.currentGenerationJob?.status === 'failed' && overview.currentGenerationJob.errorMessage) {
      lines.push(`失败原因：${esc(overview.currentGenerationJob.errorMessage)}`);
    }
    if (currentEpisode) {
      lines.push(`当前幕：第 ${esc(Math.max(1, currentEpisode.dayIndex || 1))} 幕 · ${esc(currentEpisode.title || '未命名')}`);
      if (overview.hasPendingEpisode === true) lines.push(`待确认：${esc(wanderDraftLabel(a.id, currentEpisode))}`);
      if (currentEpisode.chosenOptionText) lines.push(`已选：${esc(currentEpisode.chosenOptionText)}`);
    }
    if (overview.isCoolingDown) lines.push(`冷却剩余：${esc(dur(wanderRemain(overview)))}`);
    const story = wanderHistoryStory(overview);
    if (story?.theme) lines.push(`故事：${esc(story.theme)}`);
    return lines.join('<br>');
  }
  function wanderActionLabel(a) {
    const overview = normalizeWanderOverview(a?.wanderOverview);
    if (!a?.token) return '一键云游';
    if (loadState(a.id).wanderAction) return '云游中...';
    if (!overview) return '一键云游';
    if (overview.currentGenerationJob?.status === 'pending') return '生成中...';
    if (overview.currentGenerationJob?.status === 'failed') return '重新云游';
    const currentEpisode = wanderCurrentEpisode(overview);
    if (overview.hasPendingEpisode && currentEpisode) return '前往确认';
    if (overview.canGenerate && !overview.isCoolingDown) return '开始云游';
    if (overview.isCoolingDown) return `冷却 ${dur(wanderRemain(overview))}`;
    return '一键云游';
  }
  function wanderTagHtml(text, tone = '') {
    return `<span class="wander-tag${tone ? ` ${tone}` : ''}">${esc(text)}</span>`;
  }
  function wanderTagsHtml(overview) {
    if (!overview) return '';
    const tags = [];
    if (!overview.aiAvailable) tags.push(wanderTagHtml('AI 未配置', 'is-error'));
    if (overview.hasPendingEpisode) tags.push(wanderTagHtml('待选择', 'is-warn'));
    if (overview.isCoolingDown) tags.push(wanderTagHtml('冷却中', 'is-ok'));
    if (overview.currentGenerationJob?.status === 'pending') tags.push(wanderTagHtml('生成中', 'is-info'));
    if (overview.currentGenerationJob?.status === 'failed') tags.push(wanderTagHtml('生成失败', 'is-error'));
    if (overview.canGenerate && !overview.isCoolingDown && overview.currentGenerationJob === null) tags.push(wanderTagHtml('可开始', 'is-ready'));
    return tags.join('');
  }
  function wanderCurrentEpisodeActionsHtml(a, overview) {
    const episode = wanderCurrentEpisode(overview);
    if (!episode) return '';
    const needsChoice = overview?.hasPendingEpisode === true;
    if (needsChoice) episode.pendingChoice = true;
    const draftIndex = needsChoice
      ? (() => {
        const draft = getWanderDraft(a.id, episode.id);
        if (draft) return draft.optionIndex;
        return null;
      })()
      : (Number.isFinite(Number(episode.chosenOptionIndex)) ? Math.max(0, Math.floor(Number(episode.chosenOptionIndex))) : null);
    const options = (Array.isArray(episode.options) ? episode.options : []).map((option, listIndex) => {
      const optionIndex = Number.isFinite(Number(option?.index)) ? Math.max(0, Math.floor(Number(option.index))) : listIndex;
      const classes = ['wander-option-line'];
      if (draftIndex !== null && optionIndex === draftIndex) classes.push('is-preferred');
      if (!needsChoice && episode.chosenOptionIndex === optionIndex) classes.push('is-chosen');
      return needsChoice
        ? `<button class="${classes.join(' ')}" type="button" data-action="wanderPick" data-id="${esc(a.id)}" data-episode-id="${esc(episode.id)}" data-option-index="${esc(optionIndex)}" aria-pressed="${draftIndex !== null && optionIndex === draftIndex ? 'true' : 'false'}"><span>抉择 ${esc(optionIndex + 1)}</span><span>${esc(option?.text || '未返回')}</span></button>`
        : `<div class="${classes.join(' ')}"><span>抉择 ${esc(optionIndex + 1)}</span><span>${esc(option?.text || '未返回')}</span></div>`;
    }).join('');
    const confirmBar = needsChoice
      ? `<div class="wander-confirm-bar"><div class="wander-confirm-text" data-wander-confirm-text data-id="${esc(a.id)}" data-episode-id="${esc(episode.id)}">当前待确认：${esc(wanderDraftLabel(a.id, episode))}</div><button class="btn" data-action="wanderConfirm" data-id="${esc(a.id)}" data-episode-id="${esc(episode.id)}" ${draftIndex === null || loadState(a.id).wanderAction ? 'disabled' : ''}>${loadState(a.id).wanderAction ? '确认中...' : '确认选择'}</button></div>`
      : `<div class="wander-confirm-bar"><div class="wander-confirm-text">已选：${esc(episode.chosenOptionText || `抉择 ${episode.chosenOptionIndex + 1}`)}</div>${overview.isCoolingDown ? `<div class="wander-confirm-hint">冷却剩余：${esc(dur(wanderRemain(overview)))}</div>` : ''}</div>`;
    const rewardLine = episode.rewardTitleName
      ? `<div class="wander-episode-reward">结幕称号：${esc(episode.rewardTitleName)}${episode.rewardTitleDesc ? ` · ${esc(episode.rewardTitleDesc)}` : ''}</div>`
      : '';
    return `
      <div class="wander-current-box">
        <div class="wander-current-head">
          <div class="wander-current-title">当前幕：第 ${esc(Math.max(1, episode.dayIndex || 1))} 幕 · ${esc(episode.title || '未命名')}</div>
          ${episode.isEnding ? wanderTagHtml('终幕', 'is-warn') : ''}
        </div>
        ${episode.opening ? `<div class="wander-episode-opening">${esc(episode.opening)}</div>` : ''}
        ${options ? `<div class="wander-option-list">${options}</div>` : ''}
        ${confirmBar}
        ${episode.summary ? `<div class="wander-episode-summary">${esc(episode.summary)}</div>` : ''}
        ${rewardLine}
      </div>`;
  }
  function wanderStoryEntriesHtml(a, overview) {
    const story = wanderHistoryStory(overview);
    if (!story) return '<div class="wander-empty">尚未开启任何云游故事。</div>';
    const currentEpisodeId = str(wanderCurrentEpisode(overview)?.id);
    const entries = (Array.isArray(story.episodes) ? story.episodes : []).filter((episode) => str(episode?.id) !== currentEpisodeId).map((episode) => {
      const options = (Array.isArray(episode.options) ? episode.options : []).map((option, listIndex) => {
        const optionIndex = Number.isFinite(Number(option?.index)) ? Math.max(0, Math.floor(Number(option.index))) : listIndex;
        const classes = ['wander-option-line'];
        if (episode.chosenOptionIndex === optionIndex) classes.push('is-chosen');
        return `<div class="${classes.join(' ')}"><span>抉择 ${esc(optionIndex + 1)}</span><span>${esc(option?.text || '未返回')}</span></div>`;
      }).join('');
      const resultLine = episode.chosenOptionText
        ? `<div class="wander-episode-result">已选：${esc(episode.chosenOptionText)}</div>`
        : '<div class="wander-episode-result is-pending">尚未选择。</div>';
      const rewardLine = episode.rewardTitleName
        ? `<div class="wander-episode-reward">结幕称号：${esc(episode.rewardTitleName)}${episode.rewardTitleDesc ? ` · ${esc(episode.rewardTitleDesc)}` : ''}</div>`
        : '';
      return `
        <article class="wander-entry">
          <div class="wander-entry-head">
            <div class="wander-entry-title">第 ${esc(Math.max(1, episode.dayIndex || 1))} 幕 · ${esc(episode.title || '未命名')}</div>
            ${episode.isEnding ? wanderTagHtml('终幕', 'is-warn') : ''}
          </div>
          ${episode.opening ? `<div class="wander-episode-opening">${esc(episode.opening)}</div>` : ''}
          ${options ? `<div class="wander-option-list">${options}</div>` : ''}
          ${resultLine}
          ${episode.summary ? `<div class="wander-episode-summary">${esc(episode.summary)}</div>` : ''}
          ${rewardLine}
        </article>`;
    }).join('');
    return `
      <div class="wander-story-head">
        <div class="wander-story-theme">${esc(story.theme || '云游故事')}</div>
        <div class="wander-story-meta">共 ${esc(story.episodeCount || story.episodes.length)} 幕 · 状态 ${esc(story.status || '未知')}</div>
      </div>
      ${story.premise ? `<div class="wander-story-premise">${esc(story.premise)}</div>` : ''}
      <div class="wander-story-list" data-scroll-key="wander-story-${esc(a.id)}">${entries || '<div class="wander-empty">暂无幕次内容。</div>'}</div>`;
  }
  function wanderPanelHtml(a) {
    const open = UI.wanderOpenById[a.id] === true;
    const overview = normalizeWanderOverview(a.wanderOverview);
    const currentEpisode = wanderCurrentEpisode(overview);
    if (overview?.hasPendingEpisode !== true && currentEpisode?.chosenOptionIndex !== null) clearWanderDraft(a.id, currentEpisode?.id);
    const currentSummary = overview
      ? (currentEpisode
        ? `当前第 ${Math.max(1, currentEpisode.dayIndex || 1)} 幕 · ${currentEpisode.title || '未命名'}`
        : (overview.currentGenerationJob?.status === 'pending'
          ? '云游生成中，完成后会自动出现在这里'
          : (overview.isCoolingDown ? `冷却剩余 ${dur(wanderRemain(overview))}` : '当前暂无可展示的幕次')))
      : (a.wanderError ? `读取失败：${a.wanderError}` : '请先刷新状态');
    return `
      <div class="wander-panel-box">
        <button type="button" class="wander-fold" data-toggle-wander="${esc(a.id)}" aria-expanded="${open ? 'true' : 'false'}">
          <div class="wander-fold-main">
            <div class="wander-fold-title">云游详情</div>
            <div class="wander-fold-sub">${esc(currentSummary)}</div>
          </div>
          <div class="wander-fold-side">${open ? '收起' : '展开'}</div>
        </button>
        <div class="wander-fold-body ${open ? 'show' : ''}">
          ${overview ? `
            <div class="wander-overview-top">
              <div class="wander-tag-row">${wanderTagsHtml(overview)}</div>
              <div class="wander-overview-note">今日日期：${esc(overview.today || '未返回')}</div>
            </div>
            ${wanderCurrentEpisodeActionsHtml(a, overview)}
            ${wanderStoryEntriesHtml(a, overview)}
          ` : `<div class="wander-empty">${esc(a.wanderError ? `云游状态读取失败：${a.wanderError}` : '当前暂无云游内容，请先刷新或执行一键云游。')}</div>`}
        </div>
      </div>`;
  }
  function idleConfigReady(cfg) { return !!(cfg && cfg.mapId && cfg.roomId && cfg.targetMonsterDefId && cfg.maxDurationMs > 0); }
  function idleConfigSummary(cfg) { return cfg ? `${cfg.mapId || '?'} / ${cfg.roomId || '?'} / ${cfg.targetMonsterDefId || '?'} / ${dur(Math.floor(cfg.maxDurationMs / 1000), '0秒')}` : '未读取'; }
  function idleAutoText(a) { return idleConfigReady(a?.idleConfig) ? '全局刷新检测' : '等待配置'; }
  function createRuntimeState() {
    return {
      idleAutoRestartKey: '',
      idleNextCheckAt: 0,
      idleNextStartAt: 0,
      dungeonRunToken: '',
      dungeonRunning: false,
      dungeonCurrentInstanceId: '',
      dungeonCurrentSessionId: '',
      dungeonLastProgressKey: '',
      dungeonLastProgressAt: 0,
      dungeonLastAdvanceKey: '',
      dungeonLastAdvanceAt: 0,
      dungeonLogs: [],
      dungeonBattleState: null,
      dungeonBattleLastActionKey: '',
      dungeonBattleLastAttemptKey: '',
      dungeonBattleRetryCount: 0,
      dungeonBattleRetryTimer: 0,
      dungeonBattleActionInFlight: false,
      dungeonBattleSkillConfig: null,
      dungeonBattleSkillConfigLoadedAt: 0,
      dungeonBattleSkillConfigError: '',
    };
  }
  function runtime(id) {
    if (!R.has(id)) R.set(id, createRuntimeState());
    return R.get(id);
  }
  function clearDungeonBattleRetryTimer(id) {
    const r = runtime(id);
    if (r.dungeonBattleRetryTimer) {
      try { clearTimeout(r.dungeonBattleRetryTimer); } catch {}
      r.dungeonBattleRetryTimer = 0;
    }
  }
  function resetDungeonBattleRuntime(id, preserveSkillConfig = false) {
    const r = runtime(id);
    clearDungeonBattleRetryTimer(id);
    r.dungeonBattleState = null;
    r.dungeonBattleLastActionKey = '';
    r.dungeonBattleLastAttemptKey = '';
    r.dungeonBattleRetryCount = 0;
    r.dungeonBattleActionInFlight = false;
    if (!preserveSkillConfig) {
      r.dungeonBattleSkillConfig = null;
      r.dungeonBattleSkillConfigLoadedAt = 0;
      r.dungeonBattleSkillConfigError = '';
    }
  }
  function clearAutomationRuntime(id) {
    const r = runtime(id);
    r.idleAutoRestartKey = '';
    r.idleNextCheckAt = 0;
    r.idleNextStartAt = 0;
    r.dungeonRunToken = '';
    r.dungeonRunning = false;
    r.dungeonCurrentInstanceId = '';
    r.dungeonCurrentSessionId = '';
    r.dungeonLastProgressKey = '';
    r.dungeonLastProgressAt = 0;
    r.dungeonLastAdvanceKey = '';
    r.dungeonLastAdvanceAt = 0;
    r.dungeonLogs = [];
    resetDungeonBattleRuntime(id);
  }
  function dungeonLogTime() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
  function setDungeonStopReason(a, reason = '') { if (a) a.dungeonLastStopReason = str(reason); }
  function clearDungeonLog(id) { runtime(id).dungeonLogs = []; }
  function pushDungeonLog(id, message, shouldRerender = false) {
    const a = acct(id);
    const msg = str(message);
    if (!a || !msg) return;
    const r = runtime(id);
    if (!Array.isArray(r.dungeonLogs)) r.dungeonLogs = [];
    r.dungeonLogs.push(`[${dungeonLogTime()}] ${msg}`);
    while (r.dungeonLogs.length > 12) r.dungeonLogs.shift();
    if (shouldRerender) renderWhenSafe();
  }
  function dungeonSessionSummary(session) {
    if (!session || typeof session !== 'object') return '会话为空';
    const parts = [`状态 ${str(session.status) || '未知'}`];
    if (str(session.currentBattleId)) parts.push(`战斗 ${str(session.currentBattleId)}`);
    if (str(session.nextAction) && str(session.nextAction) !== 'none') parts.push(`下一步 ${str(session.nextAction)}`);
    if (session.canAdvance === true) parts.push('可推进');
    return parts.join(' · ');
  }
  function normalizeDungeonId(v) {
    const raw = str(v);
    if (!raw) return '';
    const hit = D.list.find((row) => row.id === raw || row.name === raw);
    return hit ? hit.id : raw;
  }
  function dungeonDefById(id) { id = str(id); return D.list.find((row) => row.id === id) || null; }
  function dungeonLabel(a) {
    const dungeonId = normalizeDungeonId(a?.dungeonId);
    const def = dungeonDefById(dungeonId);
    return def ? def.name : (dungeonId || '未设置');
  }
  function dungeonShortText(a) {
    const r = runtime(a.id);
    if (r.dungeonRunning) return '执行中';
    const dungeonId = normalizeDungeonId(a?.dungeonId);
    return !dungeonId ? '未设置' : `${dungeonLabel(a)} · 难度${Math.max(1, Math.floor(Number(a?.dungeonRank) || 1))}`;
  }
  function dungeonText(a) {
    const r = runtime(a.id);
    if (r.dungeonRunning) return `执行中 · ${dungeonLabel(a)}`;
    const dungeonId = normalizeDungeonId(a?.dungeonId);
    return !dungeonId ? '未设置' : `${dungeonLabel(a)} · 难度 ${Math.max(1, Math.floor(Number(a?.dungeonRank) || 1))}`;
  }
  function dungeonExtra(a) {
    const dungeonId = normalizeDungeonId(a?.dungeonId);
    const def = dungeonDefById(dungeonId);
    const lines = [];
    if (def) {
      lines.push(`秘境：${esc(def.name)}`);
      lines.push(`类型：${esc(def.typeLabel || def.type || '未知')}`);
      lines.push(`消耗：${esc(num(def.staminaCost))} 体力 / 次`);
    } else if (dungeonId) {
      lines.push(`秘境 ID：${esc(dungeonId)}`);
    } else {
      lines.push('秘境：未设置');
    }
    lines.push(`难度：${esc(Math.max(1, Math.floor(Number(a?.dungeonRank) || 1)))}`);
    lines.push(`状态：${esc(runtime(a.id).dungeonRunning ? '执行中' : '待机')}`);
    lines.push(`最近停止：${esc(a?.dungeonLastStopReason || '—')}`);
    return lines.join('<br>');
  }
  function dungeonLogText(a) {
    const logs = runtime(a.id).dungeonLogs;
    if (!Array.isArray(logs) || !logs.length) return a.dungeonLastStopReason ? '最近已停止' : '暂无日志';
    return logs[logs.length - 1];
  }
  function dungeonLogExtra(a) {
    const logs = Array.isArray(runtime(a.id).dungeonLogs) ? runtime(a.id).dungeonLogs : [];
    const lines = [`最近停止：${esc(a?.dungeonLastStopReason || (runtime(a.id).dungeonRunning ? '运行中' : '—'))}`];
    if (!logs.length) {
      lines.push('运行日志：暂无');
      return lines.join('<br>');
    }
    lines.push('运行日志：');
    lines.push(logs.map((line) => esc(line)).join('<br>'));
    return lines.join('<br>');
  }
  function dungeonInputPlaceholder() {
    if (D.loading) return '读取秘境列表中...';
    if (D.error) return '列表读取失败，可直接填写秘境 ID';
    return '可输入秘境 ID（支持下拉）';
  }
  function dungeonDatalistHtml() { return D.list.map((d) => `<option value="${esc(d.id)}" label="${esc(d.name)}"></option>`).join(''); }
  function battleSessionKey(session) { return !session || typeof session !== 'object' ? '' : [str(session.sessionId), str(session.currentBattleId), str(session.status), str(session.nextAction), str(session.lastResult)].join('|'); }
  function shouldAdvanceDungeonSession(session) {
    return !!session
      && str(session.type) === 'dungeon'
      && str(session.status) === 'waiting_transition'
      && str(session.nextAction) === 'advance'
      && session.canAdvance === true;
  }
  function shouldReturnToMapDungeonSession(session) {
    return !!session
      && str(session.type) === 'dungeon'
      && str(session.status) === 'waiting_transition'
      && str(session.nextAction) === 'return_to_map'
      && session.canAdvance === true;
  }
  function idleUntil(st) {
    if (!st?.startedAt) return '';
    const startMs = new Date(st.startedAt).getTime();
    const maxDurationMs = Math.max(0, Math.floor(Number(st.maxDurationMs) || 0));
    if (!Number.isFinite(startMs) || !maxDurationMs) return '';
    return new Date(startMs + maxDurationMs).toISOString();
  }
  function idleElapsed(st) {
    if (!st?.startedAt) return 0;
    const startMs = new Date(st.startedAt).getTime();
    if (!Number.isFinite(startMs)) return 0;
    const endMs = st.endedAt ? new Date(st.endedAt).getTime() : NaN;
    const stopMs = Number.isFinite(endMs) ? endMs : Date.now();
    return Math.max(0, Math.floor((stopMs - startMs) / 1000));
  }
  function idleStatus(v) {
    v = str(v);
    return v ? (IDLE[v] || v) : '未挂机';
  }
  function idleText(st, err = '') {
    const msg = str(err);
    if (msg) return msg === '接口未部署' ? '暂不可用' : '读取失败';
    if (!st) return '未挂机';
    if (st.status === 'active') return `${idleStatus(st.status)} · ${dur(idleElapsed(st), '0秒')}`;
    return idleStatus(st.status);
  }
  function idleExtra(st, err = '', a = null) {
    const msg = str(err);
    if (msg) return `挂机状态读取失败：${esc(msg)}`;
    const lines = [`自动挂机：${esc(idleAutoText(a))}`];
    const cfg = normalizeIdleConfig(a?.idleConfig);
    if (cfg) lines.push(`上次配置：${esc(idleConfigSummary(cfg))}`);
    if (!st) return lines.concat('当前未在挂机').join('<br>');
    if (st.targetMonsterName) lines.push(`目标：${esc(st.targetMonsterName)}`);
    if (st.mapId || st.roomId) lines.push(`地图：${esc(st.mapId || '?')} / ${esc(st.roomId || '?')}`);
    lines.push(`开始：${esc(fmtTime(st.startedAt))}`);
    const until = idleUntil(st);
    if (until && !st.endedAt) lines.push(`预计结束：${esc(fmtTime(until))}`);
    if (st.endedAt) lines.push(`结束：${esc(fmtTime(st.endedAt))}`);
    lines.push(`战斗：${esc(st.totalBattles)} 场 · 胜 ${esc(st.winCount)} / 负 ${esc(st.loseCount)}`);
    lines.push(`累计：经验 +${esc(num(st.totalExp))} · 银两 +${esc(num(st.totalSilver))}`);
    if (st.bagFullFlag) lines.push('背包已满，可能影响收益');
    return lines.join('<br>');
  }
  function job(v) { v = str(v); return v ? (JOB[v] || v) : '无'; }
  function acct(id) { return S.accounts.find((x) => x.id === id) || null; }
  function selectedAccount(list) {
    const xs = Array.isArray(list) ? list : sortedAccounts();
    const cur = acct(UI.selectedId);
    if (cur) return cur;
    UI.selectedId = xs[0]?.id || '';
    return UI.selectedId ? acct(UI.selectedId) : null;
  }
  function temp(id) {
    if (!T.has(id)) T.set(id, { password: '', captchaCode: '', captchaId: '', captchaImage: '', ticket: '', randstr: '' });
    return T.get(id);
  }
  function loadState(id) {
    if (!L.has(id)) L.set(id, {});
    const state = L.get(id);
    ['captcha', 'login', 'refresh', 'idleStart', 'idleStop', 'dungeonStart', 'sectExchange', 'signIn', 'monthCardClaim', 'wanderAction'].forEach((key) => {
      if (typeof state[key] !== 'boolean') state[key] = false;
    });
    return state;
  }
  function setBusy(id, k, v) { loadState(id)[k] = !!v; }
  function setMsg(a, msg = '', err = '') { a.lastMessage = msg; a.lastError = err; }
  function clearLocalCaptcha(id) {
    const t = temp(id);
    t.captchaCode = '';
    t.captchaId = '';
    t.captchaImage = '';
  }
  function clearTencentPayload(id) {
    const t = temp(id);
    t.ticket = '';
    t.randstr = '';
  }
  function clearRuntime(id) {
    clearLocalCaptcha(id);
    clearTencentPayload(id);
  }
  async function ensureSocketIoLoaded() {
    if (typeof window.io === 'function') return window.io;
    if (!socketIoPromise) {
      socketIoPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${socketBase()}/socket.io/socket.io.js`;
        script.onload = () => {
          if (typeof window.io === 'function') resolve(window.io);
          else reject(new Error('socket.io 客户端加载成功，但 io 未注入到页面'));
        };
        script.onerror = () => reject(new Error('socket.io 客户端加载失败'));
        document.head.appendChild(script);
      }).catch((e) => {
        socketIoPromise = null;
        throw e;
      });
    }
    return socketIoPromise;
  }
  function closeBattleKeepAlive(id) {
    const entry = K.get(id);
    if (!entry) return;
    entry.manualClose = true;
    clearDungeonBattleRetryTimer(id);
    try { entry.socket.removeAllListeners(); } catch {}
    try { entry.socket.disconnect(); } catch {}
    K.delete(id);
  }
  async function ensureBattleKeepAlive(id) {
    const a = acct(id);
    if (!a || !a.token) return false;
    if (isPageSocketAccount(a.token)) {
      pushDungeonLog(id, '当前页面账号本身已在线，无需额外战斗保活 Socket', true);
      return true;
    }
    const existing = K.get(id);
    if (existing && existing.token === a.token) {
      if (existing.authReady === true) return true;
      try { return await existing.readyPromise; } catch { return false; }
    }
    closeBattleKeepAlive(id);
    let ioFactory;
    try {
      ioFactory = await ensureSocketIoLoaded();
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      pushDungeonLog(id, `战斗保活 Socket 初始化失败：${message}`, true);
      return false;
    }
    let settled = false;
    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const socket = ioFactory(socketBase(), {
      path: '/game-socket',
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: false,
    });
    const entry = { socket, token: a.token, authReady: false, readyPromise, manualClose: false };
    K.set(id, entry);
    const finishReady = (ok, value) => {
      if (settled) return;
      settled = true;
      if (ok) resolveReady(value);
      else rejectReady(value);
    };
    socket.on('connect', () => {
      if (K.get(id) !== entry) return;
      pushDungeonLog(id, '战斗保活 Socket 已连接，正在认证账号在线状态', true);
      socket.emit('game:auth', a.token);
    });
    socket.on('game:auth-ready', () => {
      if (K.get(id) !== entry) return;
      entry.authReady = true;
      pushDungeonLog(id, '战斗保活 Socket 已认证成功，该账号现在会被服务端视为在线', true);
      finishReady(true, true);
    });
    socket.on('battle:update', (data) => {
      if (K.get(id) !== entry) return;
      try {
        handleBattleRealtimeUpdate(id, data);
      } catch (e) {
        const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
        pushDungeonLog(id, `自动出招状态同步失败：${message}`, true);
      }
    });
    socket.on('game:error', (data) => {
      if (K.get(id) !== entry) return;
      const message = str(data?.message) || '服务器错误';
      pushDungeonLog(id, `战斗保活 Socket 错误：${message}`, true);
      finishReady(false, new Error(message));
    });
    socket.on('game:kicked', (data) => {
      if (K.get(id) !== entry) return;
      const message = str(data?.message) || '账号已在其他窗口登录';
      pushDungeonLog(id, `战斗保活 Socket 被挤下线：${message}`, true);
      finishReady(false, new Error(message));
      closeBattleKeepAlive(id);
    });
    socket.on('disconnect', (reason) => {
      if (K.get(id) !== entry) return;
      K.delete(id);
      if (entry.manualClose) return;
      const message = str(reason) || '未知断开';
      pushDungeonLog(id, `战斗保活 Socket 已断开：${message}`, true);
      finishReady(false, new Error(message));
    });
    try {
      socket.connect();
      return await Promise.race([
        readyPromise,
        sleep(BATTLE_KEEPALIVE_AUTH_TIMEOUT_MS).then(() => { throw new Error('认证超时'); }),
      ]);
    } catch (e) {
      closeBattleKeepAlive(id);
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      pushDungeonLog(id, `战斗保活 Socket 未就绪：${message}`, true);
      return false;
    }
  }
  function staminaRatio(a) {
    const snap = staminaSnapshot(a);
    return snap && snap.max > 0 ? snap.current / snap.max : -1;
  }
  function sortedAccounts() {
    const xs = [...S.accounts];
    const byName = (a, b) => (a.alias || a.username || '').localeCompare(b.alias || b.username || '', 'zh-Hans-CN');
    const byRemain = (a, k) => {
      const st = k === 'technique' ? a.technique : a.partner;
      if (!a.token) return Number.MAX_SAFE_INTEGER - 5;
      if (!st) return Number.MAX_SAFE_INTEGER - 4;
      if (st.unlocked === false) return Number.MAX_SAFE_INTEGER - 3;
      return remain(st);
    };
    switch (S.sortBy) {
      case 'name':
        xs.sort(byName);
        break;
      case 'technique':
        xs.sort((a, b) => byRemain(a, 'technique') - byRemain(b, 'technique') || byName(a, b));
        break;
      case 'partner':
        xs.sort((a, b) => byRemain(a, 'partner') - byRemain(b, 'partner') || byName(a, b));
        break;
      case 'stamina_desc':
        xs.sort((a, b) => staminaRatio(b) - staminaRatio(a) || byName(a, b));
        break;
      case 'stamina_asc':
        xs.sort((a, b) => staminaRatio(a) - staminaRatio(b) || byName(a, b));
        break;
      default:
        xs.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || byName(a, b));
    }
    return xs;
  }
  function notifyText() {
    if (typeof Notification === 'undefined') return '浏览器不支持';
    return Notification.permission === 'granted' ? '已授权' : Notification.permission === 'denied' ? '已拒绝' : '未授权';
  }
  async function askNotify() {
    if (typeof Notification === 'undefined') return;
    try { await Notification.requestPermission(); } finally { render(); }
  }
  function maybeNotify(a, type) {
    if (!S.notifyEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const st = type === 'technique' ? a.technique : a.partner;
    const field = type === 'technique' ? 'techniqueNoticeKey' : 'partnerNoticeKey';
    const key = str(st?.cooldownUntil);
    if (!st || st.unlocked === false || !key || remain(st) > 0 || a[field] === key) return;
    a[field] = key;
    a.lastMessage = `${type === 'technique' ? '功法自研' : '伙伴招募'} 冷却已完成`;
    save();
    new Notification(`${type === 'technique' ? '功法自研' : '伙伴招募'} 已冷却完成`, {
      body: `${a.alias || a.username || '账号'} 已可继续操作`,
      tag: `jz-${type}-${a.id}-${key}`,
      renotify: false,
    });
  }
  function parseImportLine(line) {
    const text = str(line);
    if (!text || text.startsWith('#')) return null;
    const parts = text.split(/\t|,|\|/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) return { alias: parts[0], username: parts[1], password: parts.slice(2).join(',') };
    if (parts.length === 2) return { alias: '', username: parts[0], password: parts[1] };
    if (parts.length === 1) return { alias: '', username: parts[0], password: '' };
    return null;
  }

  function normalizeIdleSession(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      id: str(v.id),
      characterId: Number(v.characterId) || 0,
      status: str(v.status),
      mapId: str(v.mapId),
      roomId: str(v.roomId),
      maxDurationMs: Math.max(0, Math.floor(Number(v.maxDurationMs) || 0)),
      totalBattles: Math.max(0, Math.floor(Number(v.totalBattles) || 0)),
      winCount: Math.max(0, Math.floor(Number(v.winCount) || 0)),
      loseCount: Math.max(0, Math.floor(Number(v.loseCount) || 0)),
      totalExp: Math.max(0, Math.floor(Number(v.totalExp) || 0)),
      totalSilver: Math.max(0, Math.floor(Number(v.totalSilver) || 0)),
      bagFullFlag: v.bagFullFlag === true,
      startedAt: str(v.startedAt),
      endedAt: str(v.endedAt) || null,
      viewedAt: str(v.viewedAt) || null,
      targetMonsterDefId: str(v.targetMonsterDefId) || null,
      targetMonsterName: str(v.targetMonsterName) || null,
    };
  }

  function api(path, { method = 'GET', body, token = '' } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(S.apiBase + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    }).then(async (r) => {
      const txt = await r.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch {}
      if (!r.ok) {
        const e = new Error(data?.message || `HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      if (data && data.success === false) throw new Error(data.message || '请求失败');
      return data;
    });
  }

  function buildDefaultBattleSkillConfig() {
    return {
      loadedFromTechnique: false,
      skills: [{
        id: 'basic_attack',
        actualSkillId: 'skill-normal-attack',
        name: '普攻',
        targetType: 'single_enemy',
        damageType: 'physical',
        costLingqi: 0,
        costLingqiRate: 0,
        costQixue: 0,
        costQixueRate: 0,
        effects: [],
      }],
    };
  }
  function buildBattleSkillConfig(statusData) {
    const fallback = buildDefaultBattleSkillConfig();
    const equippedSkills = Array.isArray(statusData?.equippedSkills) ? statusData.equippedSkills : [];
    const availableSkills = Array.isArray(statusData?.availableSkills) ? statusData.availableSkills : [];
    const availableBySkillId = new Map(
      availableSkills
        .map((row) => [str(row?.skillId), row])
        .filter((row) => row[0]),
    );
    const skills = [...fallback.skills];
    const seen = new Set(skills.map((skill) => skill.id));
    for (const slot of [...equippedSkills].sort((a, b) => (Number(a?.slot_index) || 0) - (Number(b?.slot_index) || 0))) {
      const skillId = str(slot?.skill_id);
      if (!skillId || seen.has(skillId)) continue;
      const info = availableBySkillId.get(skillId);
      skills.push({
        id: skillId,
        actualSkillId: skillId,
        name: str(slot?.skill_name) || str(info?.skillName) || skillId,
        targetType: str(info?.targetType) || 'single_enemy',
        damageType: str(info?.damageType) || '',
        costLingqi: Math.max(0, Math.floor(Number(info?.costLingqi) || 0)),
        costLingqiRate: Math.max(0, Number(info?.costLingqiRate) || 0),
        costQixue: Math.max(0, Math.floor(Number(info?.costQixue) || 0)),
        costQixueRate: Math.max(0, Number(info?.costQixueRate) || 0),
        effects: Array.isArray(info?.effects) ? info.effects : [],
      });
      seen.add(skillId);
    }
    return { loadedFromTechnique: skills.length > 1, skills };
  }
  async function ensureBattleSkillConfig(id, force = false) {
    const a = acct(id);
    const r = runtime(id);
    const fallback = buildDefaultBattleSkillConfig();
    if (!a?.token || !(Number(a?.character?.id) > 0)) {
      r.dungeonBattleSkillConfig = fallback;
      r.dungeonBattleSkillConfigLoadedAt = Date.now();
      return fallback;
    }
    if (!force && r.dungeonBattleSkillConfig) {
      const age = Date.now() - Math.max(0, Number(r.dungeonBattleSkillConfigLoadedAt) || 0);
      if (r.dungeonBattleSkillConfigError) {
        if (age < AUTO_BATTLE_SKILL_ERROR_RETRY_MS) return r.dungeonBattleSkillConfig;
      } else if (age < AUTO_BATTLE_SKILL_CACHE_MS) {
        return r.dungeonBattleSkillConfig;
      }
    }
    const previousError = str(r.dungeonBattleSkillConfigError);
    try {
      const data = (await api(`/character/${a.character.id}/technique/status`, { token: a.token }))?.data || {};
      const config = buildBattleSkillConfig(data);
      const summary = config.skills.map((skill) => skill.name).join(' / ');
      if (!r.dungeonBattleSkillConfig || previousError || force) {
        pushDungeonLog(id, `自动出招技能已同步：${summary || '仅普攻'}`, true);
      }
      r.dungeonBattleSkillConfig = config;
      r.dungeonBattleSkillConfigLoadedAt = Date.now();
      r.dungeonBattleSkillConfigError = '';
      return config;
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (!r.dungeonBattleSkillConfig || previousError !== message || force) {
        pushDungeonLog(id, `自动出招技能读取失败，暂以普攻兜底：${message}`, true);
      }
      r.dungeonBattleSkillConfig = fallback;
      r.dungeonBattleSkillConfigLoadedAt = Date.now();
      r.dungeonBattleSkillConfigError = message;
      return fallback;
    }
  }
  function mergeBattleUnitSnapshot(previousUnit, incomingUnit) {
    return {
      ...previousUnit,
      ...incomingUnit,
      currentAttrs: { ...(previousUnit?.currentAttrs || {}), ...(incomingUnit?.currentAttrs || {}) },
      buffs: Array.isArray(incomingUnit?.buffs) ? incomingUnit.buffs : (Array.isArray(previousUnit?.buffs) ? previousUnit.buffs : []),
      shields: Array.isArray(incomingUnit?.shields) ? incomingUnit.shields : (Array.isArray(previousUnit?.shields) ? previousUnit.shields : []),
      skillCooldowns: { ...(previousUnit?.skillCooldowns || {}), ...(incomingUnit?.skillCooldowns || {}) },
      stats: { ...(previousUnit?.stats || {}), ...(incomingUnit?.stats || {}) },
    };
  }
  function mergeBattleUnits(previousUnits, incomingUnits) {
    const prev = Array.isArray(previousUnits) ? previousUnits : [];
    const next = Array.isArray(incomingUnits) ? incomingUnits : [];
    const previousById = new Map(prev.map((unit) => [str(unit?.id), unit]).filter((row) => row[0]));
    const incomingById = new Map(next.map((unit) => [str(unit?.id), unit]).filter((row) => row[0]));
    const merged = [];
    for (const previousUnit of prev) {
      const key = str(previousUnit?.id);
      if (!key || !incomingById.has(key)) continue;
      merged.push(mergeBattleUnitSnapshot(previousUnit, incomingById.get(key)));
    }
    for (const incomingUnit of next) {
      const key = str(incomingUnit?.id);
      if (!key || previousById.has(key)) continue;
      merged.push(incomingUnit);
    }
    return merged;
  }
  function mergeBattleStateDelta(previousState, incomingState, unitsDelta) {
    if (!unitsDelta || !previousState || !incomingState) return incomingState || previousState || null;
    if (str(previousState?.battleId) !== str(incomingState?.battleId)) return incomingState;
    return {
      ...previousState,
      ...incomingState,
      teams: {
        attacker: {
          ...(previousState?.teams?.attacker || {}),
          ...(incomingState?.teams?.attacker || {}),
          units: mergeBattleUnits(previousState?.teams?.attacker?.units, incomingState?.teams?.attacker?.units),
        },
        defender: {
          ...(previousState?.teams?.defender || {}),
          ...(incomingState?.teams?.defender || {}),
          units: mergeBattleUnits(previousState?.teams?.defender?.units, incomingState?.teams?.defender?.units),
        },
      },
    };
  }
  function normalizeBattleRealtimePayload(raw, previous) {
    const kind = str(raw?.kind);
    const battleId = str(raw?.battleId);
    if (!battleId) return null;
    const envelope = raw?.data && typeof raw.data === 'object' ? raw.data : null;
    const session = raw?.session ?? envelope?.session ?? null;
    if (kind === 'battle_abandoned') return { kind, battleId, session, state: null };
    const state = raw?.state ?? envelope?.state ?? null;
    if (!state || typeof state !== 'object') return null;
    return {
      kind: kind === 'battle_started' || kind === 'battle_finished' ? kind : 'battle_state',
      battleId,
      session,
      state: mergeBattleStateDelta(previous?.state || null, state, raw?.unitsDelta === true),
    };
  }
  async function readCurrentBattleView(token) {
    const data = (await api('/battle-session/current', { token }))?.data || {};
    return {
      session: data.session || null,
      state: data.state || null,
      finished: data.finished === true,
    };
  }
  async function advanceBattleSession(token, sessionId) {
    return (await api(`/battle-session/${encodeURIComponent(str(sessionId))}/advance`, {
      method: 'POST',
      token,
      body: {},
    }))?.data || null;
  }
  async function clearStaleBattleSessionByBattleId(token, battleId) {
    if (!str(battleId)) return null;
    return (await abandonBattle(token, battleId)) || null;
  }
  function battleActionStateKey(state) {
    if (!state || typeof state !== 'object') return '';
    return [str(state.battleId), str(state.phase), Math.floor(Number(state.roundCount) || 0), str(state.currentTeam), str(state.currentUnitId)].join('|');
  }
  function getBattleUnitById(state, unitId) {
    const id = str(unitId);
    if (!id) return null;
    const attackerUnits = Array.isArray(state?.teams?.attacker?.units) ? state.teams.attacker.units : [];
    const defenderUnits = Array.isArray(state?.teams?.defender?.units) ? state.teams.defender.units : [];
    return [...attackerUnits, ...defenderUnits].find((unit) => str(unit?.id) === id) || null;
  }
  function getAliveUnits(units) {
    return (Array.isArray(units) ? units : []).filter((unit) => unit && unit.isAlive !== false);
  }
  function resolveTauntLockedEnemyId(casterUnit, aliveEnemies) {
    const buffs = Array.isArray(casterUnit?.buffs) ? casterUnit.buffs : [];
    for (const buff of buffs) {
      const control = str(buff?.control);
      if (control !== 'taunt') continue;
      const sourceUnitId = str(buff?.sourceUnitId);
      const sourceAlive = aliveEnemies.find((enemy) => str(enemy?.id) === sourceUnitId);
      if (sourceAlive) return sourceUnitId;
    }
    return '';
  }
  function resolveSingleEnemyTargetId(casterUnit, aliveEnemies) {
    if (!aliveEnemies.length) return '';
    const tauntLockedId = resolveTauntLockedEnemyId(casterUnit, aliveEnemies);
    if (tauntLockedId) return tauntLockedId;
    const lowHpTarget = aliveEnemies
      .map((enemy) => ({
        unit: enemy,
        ratio: Math.max(0, Number(enemy?.qixue) || 0) / Math.max(1, Number(enemy?.currentAttrs?.max_qixue) || 1),
      }))
      .sort((a, b) => a.ratio - b.ratio)[0];
    if (lowHpTarget && lowHpTarget.ratio < 0.3) return str(lowHpTarget.unit?.id);
    const highThreatTarget = [...aliveEnemies].sort((a, b) => (Number(b?.stats?.damageDealt) || 0) - (Number(a?.stats?.damageDealt) || 0))[0];
    return str(highThreatTarget?.id) || str(aliveEnemies[0]?.id);
  }
  function resolveSingleAllyTargetId(casterUnit, skill, aliveAllies) {
    if (!aliveAllies.length) return '';
    const effects = Array.isArray(skill?.effects) ? skill.effects : [];
    const needsHp = effects.some((effect) => ['heal', 'shield'].includes(str(effect?.type)) || (str(effect?.type) === 'resource' && str(effect?.resourceType) === 'qixue'));
    const needsLingqi = effects.some((effect) => str(effect?.type) === 'restore_lingqi' || (str(effect?.type) === 'resource' && str(effect?.resourceType) === 'lingqi'));
    const needsCleanse = effects.some((effect) => ['cleanse', 'cleanse_control', 'dispel'].includes(str(effect?.type)));
    if (needsCleanse) {
      const best = [...aliveAllies].sort((a, b) => {
        const aControl = (Array.isArray(a?.buffs) ? a.buffs : []).filter((buff) => str(buff?.type) === 'debuff' && str(buff?.control)).length;
        const bControl = (Array.isArray(b?.buffs) ? b.buffs : []).filter((buff) => str(buff?.type) === 'debuff' && str(buff?.control)).length;
        const aDebuffs = (Array.isArray(a?.buffs) ? a.buffs : []).filter((buff) => str(buff?.type) === 'debuff').length;
        const bDebuffs = (Array.isArray(b?.buffs) ? b.buffs : []).filter((buff) => str(buff?.type) === 'debuff').length;
        return (bControl - aControl) || (bDebuffs - aDebuffs);
      })[0];
      if (best) return str(best.id);
    }
    if (needsHp) {
      const best = [...aliveAllies].sort((a, b) => {
        const aRatio = Math.max(0, Number(a?.qixue) || 0) / Math.max(1, Number(a?.currentAttrs?.max_qixue) || 1);
        const bRatio = Math.max(0, Number(b?.qixue) || 0) / Math.max(1, Number(b?.currentAttrs?.max_qixue) || 1);
        return aRatio - bRatio;
      })[0];
      if (best) return str(best.id);
    }
    if (needsLingqi) {
      const best = [...aliveAllies].sort((a, b) => {
        const aRatio = Math.max(0, Number(a?.lingqi) || 0) / Math.max(1, Number(a?.currentAttrs?.max_lingqi) || 1);
        const bRatio = Math.max(0, Number(b?.lingqi) || 0) / Math.max(1, Number(b?.currentAttrs?.max_lingqi) || 1);
        return aRatio - bRatio;
      })[0];
      if (best) return str(best.id);
    }
    return str(casterUnit?.id) || str(aliveAllies[0]?.id);
  }
  function resolveBattleSkillTargetIds(state, casterUnit, skill) {
    const isAttacker = getAliveUnits(state?.teams?.attacker?.units).some((unit) => str(unit?.id) === str(casterUnit?.id));
    const aliveAllies = getAliveUnits(isAttacker ? state?.teams?.attacker?.units : state?.teams?.defender?.units);
    const aliveEnemies = getAliveUnits(isAttacker ? state?.teams?.defender?.units : state?.teams?.attacker?.units);
    const targetType = str(skill?.targetType);
    if (targetType === 'self') return str(casterUnit?.id) ? [str(casterUnit.id)] : [];
    if (targetType === 'single_enemy') {
      const targetId = resolveSingleEnemyTargetId(casterUnit, aliveEnemies);
      return targetId ? [targetId] : [];
    }
    if (targetType === 'single_ally') {
      const targetId = resolveSingleAllyTargetId(casterUnit, skill, aliveAllies);
      return targetId ? [targetId] : [];
    }
    return [];
  }
  function readSkillControlState(buffs, aliveEnemyNameById) {
    const list = Array.isArray(buffs) ? buffs : [];
    let silenced = false;
    let disarmed = false;
    let taunted = false;
    let tauntSourceName = '';
    for (const buff of list) {
      const control = str(buff?.control);
      if (control === 'silence') silenced = true;
      if (control === 'disarm') disarmed = true;
      if (control === 'taunt') {
        const sourceUnitId = str(buff?.sourceUnitId);
        const sourceName = aliveEnemyNameById.get(sourceUnitId) || '';
        if (sourceName) {
          taunted = true;
          if (!tauntSourceName) tauntSourceName = sourceName;
        }
      }
    }
    return { silenced, disarmed, taunted, tauntSourceName };
  }
  function resolveRateCostAmount(maxValue, rate) {
    const normalizedMax = Math.max(0, Math.floor(Number(maxValue) || 0));
    const normalizedRate = Math.max(0, Number(rate) || 0);
    if (normalizedMax <= 0 || normalizedRate <= 0) return 0;
    return Math.max(1, Math.ceil(normalizedMax * normalizedRate));
  }
  function resolveSkillCostRequirement(skill, unit) {
    return {
      totalLingqi: Math.max(0, Math.floor(Number(skill?.costLingqi) || 0)) + resolveRateCostAmount(unit?.currentAttrs?.max_lingqi, skill?.costLingqiRate),
      totalQixue: Math.max(0, Math.floor(Number(skill?.costQixue) || 0)) + resolveRateCostAmount(unit?.currentAttrs?.max_qixue, skill?.costQixueRate),
    };
  }
  function getSkillCooldownLeft(unit, skill) {
    const skillCooldowns = unit?.skillCooldowns && typeof unit.skillCooldowns === 'object' ? unit.skillCooldowns : {};
    return Math.max(0, Math.floor(Number(skillCooldowns[str(skill?.actualSkillId)]) || 0));
  }
  function resolveSkillAvailability(skill, unit, controlState, targetIds) {
    const cooldownLeft = getSkillCooldownLeft(unit, skill);
    if (cooldownLeft > 0) return { available: false, message: `${skill.name} 冷却中` };
    const damageType = str(skill?.damageType);
    if (damageType === 'magic' && controlState.silenced) return { available: false, message: '被沉默中，无法释放法术技能' };
    if (damageType === 'physical' && controlState.disarmed) return { available: false, message: '被缴械中，无法释放物理技能' };
    const cost = resolveSkillCostRequirement(skill, unit);
    if (cost.totalLingqi > 0 && Math.max(0, Math.floor(Number(unit?.lingqi) || 0)) < cost.totalLingqi) return { available: false, message: '灵气不足' };
    if (cost.totalQixue > 0 && Math.max(0, Math.floor(Number(unit?.qixue) || 0)) <= cost.totalQixue) return { available: false, message: '气血不足' };
    const targetType = str(skill?.targetType);
    if (['self', 'single_enemy', 'single_ally'].includes(targetType) && (!Array.isArray(targetIds) || !targetIds.length)) return { available: false, message: '缺少目标' };
    return { available: true, message: '' };
  }
  function isDungeonBattlePlayerTurn(a, state) {
    const characterId = Math.floor(Number(a?.character?.id) || 0);
    return !!characterId
      && str(state?.phase) !== 'finished'
      && str(state?.currentTeam) === 'attacker'
      && str(state?.currentUnitId) === `player-${characterId}`;
  }
  async function tryAutoBattleAction(id, expectedKey) {
    const a = acct(id);
    const r = runtime(id);
    if (!a?.token || !a?.character || !r.dungeonRunning) return false;
    if (r.dungeonBattleActionInFlight) return false;
    const state = r.dungeonBattleState;
    const stateKey = battleActionStateKey(state);
    if (!state || !stateKey || stateKey !== expectedKey || !isDungeonBattlePlayerTurn(a, state)) return false;
    const myUnit = getBattleUnitById(state, state.currentUnitId);
    if (!myUnit) return false;
    const aliveEnemyNameById = new Map(
      getAliveUnits(state?.teams?.defender?.units)
        .map((unit) => [str(unit?.id), str(unit?.name)])
        .filter((row) => row[0]),
    );
    const controlState = readSkillControlState(myUnit?.buffs, aliveEnemyNameById);
    const pickSkill = (skillList) => {
      const list = Array.isArray(skillList) ? skillList : buildDefaultBattleSkillConfig().skills;
      for (const skill of list) {
        if (skill.id === 'basic_attack') continue;
        const targetIds = resolveBattleSkillTargetIds(state, myUnit, skill);
        const availability = resolveSkillAvailability(skill, myUnit, controlState, targetIds);
        if (!availability.available) continue;
        return { skill, targetIds };
      }
      const basicAttack = list.find((skill) => skill.id === 'basic_attack') || buildDefaultBattleSkillConfig().skills[0];
      const targetIds = resolveBattleSkillTargetIds(state, myUnit, basicAttack);
      const availability = resolveSkillAvailability(basicAttack, myUnit, controlState, targetIds);
      return availability.available ? { skill: basicAttack, targetIds } : null;
    };
    let config = await ensureBattleSkillConfig(id, false);
    let equippedSkills = Array.isArray(config?.skills) ? config.skills : buildDefaultBattleSkillConfig().skills;
    r.dungeonBattleActionInFlight = true;
    try {
      let selected = pickSkill(equippedSkills);
      if (!selected && (!config?.loadedFromTechnique || r.dungeonBattleSkillConfigError)) {
        config = await ensureBattleSkillConfig(id, true);
        equippedSkills = Array.isArray(config?.skills) ? config.skills : buildDefaultBattleSkillConfig().skills;
        selected = pickSkill(equippedSkills);
      }
      if (!selected) return false;
      const response = await api('/battle/action', {
        method: 'POST',
        token: a.token,
        body: { battleId: str(state.battleId), skillId: str(selected.skill.actualSkillId), targetIds: selected.targetIds },
      });
      if (response?.success === false) throw new Error(response.message || '行动失败');
      r.dungeonBattleLastActionKey = expectedKey;
      r.dungeonBattleLastAttemptKey = expectedKey;
      r.dungeonBattleRetryCount = 0;
      clearDungeonBattleRetryTimer(id);
      const targetText = selected.targetIds
        .map((targetId) => str(getBattleUnitById(state, targetId)?.name) || targetId)
        .filter(Boolean)
        .join('、');
      pushDungeonLog(id, `自动出招：${selected.skill.name}${targetText ? ` -> ${targetText}` : ''}`, true);
      return true;
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (/技能不存在|当前不是玩家行动回合|没有当前行动单位|战斗不存在/.test(message)) {
        if (/技能不存在/.test(message)) await ensureBattleSkillConfig(id, true);
      } else {
        pushDungeonLog(id, `自动出招失败：${message}`, true);
      }
      return false;
    } finally {
      r.dungeonBattleActionInFlight = false;
    }
  }
  function scheduleAutoBattleAction(id, source = 'socket') {
    const a = acct(id);
    const r = runtime(id);
    const state = r.dungeonBattleState;
    const key = battleActionStateKey(state);
    if (!a || !r.dungeonRunning || !key || !isDungeonBattlePlayerTurn(a, state)) {
      clearDungeonBattleRetryTimer(id);
      r.dungeonBattleLastAttemptKey = '';
      r.dungeonBattleRetryCount = 0;
      return;
    }
    if (r.dungeonBattleLastActionKey === key) return;
    if (r.dungeonBattleLastAttemptKey !== key) {
      clearDungeonBattleRetryTimer(id);
      r.dungeonBattleLastAttemptKey = key;
      r.dungeonBattleRetryCount = 0;
    }
    if (r.dungeonBattleRetryTimer) return;
    const delay = r.dungeonBattleRetryCount > 0 ? AUTO_BATTLE_RETRY_DELAY_MS : AUTO_BATTLE_INITIAL_DELAY_MS;
    r.dungeonBattleRetryTimer = setTimeout(async () => {
      r.dungeonBattleRetryTimer = 0;
      const ok = await tryAutoBattleAction(id, key);
      if (ok) return;
      if (battleActionStateKey(runtime(id).dungeonBattleState) !== key) return;
      if (++r.dungeonBattleRetryCount >= AUTO_BATTLE_MAX_RETRY) return;
      scheduleAutoBattleAction(id, `${source}-retry`);
    }, Math.max(0, delay));
  }
  function handleBattleRealtimeUpdate(id, raw) {
    const r = runtime(id);
    const normalized = normalizeBattleRealtimePayload(raw, r.dungeonBattleState ? { state: r.dungeonBattleState } : null);
    if (!normalized) return;
    r.dungeonBattleState = normalized.state || null;
    if (normalized.state && r.dungeonRunning) scheduleAutoBattleAction(id, 'socket');
  }

  function providerName() {
    if (!C.loaded && C.loading) return '读取中';
    return C.provider === 'tencent' ? '腾讯点击验证码' : '本地图片验证码';
  }

  function providerHint() {
    if (C.provider === 'tencent') {
      return `当前为腾讯云天御模式${C.tencentAppId ? `（AppId: ${C.tencentAppId}）` : ''}，点击“登录”后会弹出点击验证码。`;
    }
    return '当前为本地图片验证码模式，需要先刷新并输入 4 位验证码。';
  }

  async function refreshCaptchaConfig(silent) {
    C.loading = true;
    if (!silent) render();
    try {
      const d = (await api('/captcha/config'))?.data || {};
      C.provider = d.provider === 'tencent' ? 'tencent' : 'local';
      C.tencentAppId = Math.max(0, Math.floor(Number(d.tencentAppId) || 0));
      C.error = '';
    } catch (e) {
      C.provider = 'local';
      C.tencentAppId = 0;
      C.error = `验证码配置读取失败，已按图片验证码模式处理：${e.message || e}`;
    }
    C.loaded = true;
    C.loading = false;
    if (C.provider === 'tencent') {
      S.accounts.forEach((a) => clearLocalCaptcha(a.id));
      save();
    }
    render();
  }

  function ensureTencentSdkLoaded() {
    if (typeof window.TencentCaptcha !== 'undefined') return Promise.resolve();
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://turing.captcha.qcloud.com/TJCaptcha.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('腾讯验证码 SDK 加载失败'));
        document.head.appendChild(script);
      });
    }
    return sdkPromise;
  }

  async function runTencentCaptcha() {
    if (!C.tencentAppId) throw new Error('腾讯验证码 AppId 未配置');
    C.sdkLoading = true;
    render();
    try {
      await ensureTencentSdkLoaded();
      return await new Promise((resolve, reject) => {
        try {
          const captcha = new window.TencentCaptcha(
            String(C.tencentAppId),
            (result) => {
              if (result && result.ret === 0 && result.ticket) {
                resolve({ ticket: String(result.ticket), randstr: str(result.randstr) });
              } else if (result && result.ret === 2) {
                reject(new Error('已取消腾讯验证码'));
              } else {
                reject(new Error(result?.errorMessage || '腾讯验证码校验失败'));
              }
            },
            { userLanguage: 'zh-cn' },
          );
          captcha.show();
        } catch (e) {
          reject(e);
        }
      });
    } finally {
      C.sdkLoading = false;
      render();
    }
  }

  async function importAccounts() {
    const rows = UI.importText.split(/\r?\n/).map(parseImportLine).filter(Boolean);
    if (!rows.length) return;
    for (const row of rows) {
      let a = S.accounts.find((x) => x.username === row.username);
      if (!a) {
        a = createAccount(nextOrder());
        S.accounts.push(a);
      }
      if (row.alias) a.alias = row.alias;
      a.username = row.username;
      if (row.password) temp(a.id).password = row.password;
      setMsg(a, '已导入到列表', '');
    }
    save();
    render();
    if (C.provider === 'local') {
      for (const row of rows) {
        const a = S.accounts.find((x) => x.username === row.username);
        if (a) await refreshCaptcha(a.id);
      }
    }
  }
  async function refreshCaptcha(id) {
    const a = acct(id);
    if (!a) return;
    if (C.provider === 'tencent') {
      clearLocalCaptcha(id);
      setMsg(a, '当前为腾讯点击验证码，登录时会自动弹出验证', '');
      save();
      render();
      return;
    }
    setBusy(id, 'captcha', true);
    setMsg(a, '加载验证码中...', '');
    render();
    try {
      const d = (await api('/auth/captcha'))?.data;
      if (!d?.captchaId || !d?.imageData) throw new Error('验证码数据不完整');
      Object.assign(temp(id), { captchaId: String(d.captchaId), captchaImage: String(d.imageData), captchaCode: '' });
      setMsg(a, '验证码已刷新', '');
    } catch (e) {
      setMsg(a, '', `验证码加载失败：${e.message || e}`);
    }
    setBusy(id, 'captcha', false);
    save();
    render();
  }

  async function login(id) {
    const a = acct(id);
    if (!a) return;
    const t = temp(id);
    if (!str(a.username)) return setMsg(a, '', '请填写用户名'), render();
    if (!str(t.password)) return setMsg(a, '', '请填写密码'), render();

    setBusy(id, 'login', true);
    setMsg(a, C.provider === 'tencent' ? '等待腾讯验证码...' : '登录中...', '');
    render();

    try {
      let payload = { username: a.username, password: t.password };

      if (C.provider === 'tencent') {
        if (!C.loaded) await refreshCaptchaConfig(true);
        if (C.provider !== 'tencent') {
          throw new Error('验证码模式已切换，请重新点击登录');
        }
        const captchaResult = await runTencentCaptcha();
        t.ticket = captchaResult.ticket;
        t.randstr = captchaResult.randstr;
        payload = { ...payload, ticket: t.ticket, randstr: t.randstr };
      } else {
        if (!str(t.captchaId) || !str(t.captchaCode)) {
          throw new Error('请先获取并填写图片验证码');
        }
        payload = { ...payload, captchaId: t.captchaId, captchaCode: t.captchaCode };
      }

      const d = (await api('/auth/login', { method: 'POST', body: payload }))?.data;
      if (!d?.token) throw new Error('登录响应缺少 token');
      a.token = String(d.token);
      a.user = d.user && str(d.user.username) ? { id: Number(d.user.id) || null, username: str(d.user.username) } : null;
      a.lastLoginAt = now();
      clearRuntime(id);
      clearAutomationRuntime(id);
      save();
      await refresh(id, true);
      setMsg(a, '登录成功，状态已更新', '');
    } catch (e) {
      setMsg(a, '', `登录失败：${e.message || e}`);
      if (C.provider === 'local') await refreshCaptcha(id);
      setBusy(id, 'login', false);
      save();
      render();
      return;
    }

    setBusy(id, 'login', false);
    save();
    render();
  }

  async function loadDungeonCatalog(silent) {
    D.loading = true;
    if (!silent) render();
    try {
      const d = (await api('/dungeon/list'))?.data || {};
      D.list = Array.isArray(d.dungeons)
        ? d.dungeons.map((row) => ({
          id: str(row.id),
          name: str(row.name) || str(row.id),
          type: str(row.type),
          typeLabel: DUNGEON_TYPE_LABELS[str(row.type)] || str(row.type) || '未知',
          staminaCost: Math.max(0, Math.floor(Number(row.stamina_cost ?? row.staminaCost) || 0)),
        })).filter((row) => row.id)
        : [];
      D.error = '';
      D.fetchedAt = Date.now();
    } catch (e) {
      D.list = [];
      D.error = `秘境列表读取失败：${e.message || e}`;
    }
    D.loaded = true;
    D.loading = false;
    render();
  }
  function buildInventoryItemsPath(location, page) {
    const q = new URLSearchParams({ location, page: String(Math.max(1, Math.floor(Number(page) || 1))), pageSize: String(INVENTORY_ITEMS_PAGE_SIZE) });
    return `/inventory/items?${q.toString()}`;
  }

  async function fetchInventoryItemsByLocation(token, location) {
    const items = [];
    let page = 1;
    let total = Infinity;
    while (items.length < total && page <= 50) {
      const res = (await api(buildInventoryItemsPath(location, page), { token }))?.data || {};
      const rows = Array.isArray(res.items) ? res.items : [];
      total = Math.max(rows.length, Math.floor(Number(res.total) || 0));
      items.push(...rows);
      if (rows.length < INVENTORY_ITEMS_PAGE_SIZE) break;
      page += 1;
    }
    return items;
  }

  async function fetchRareItems(token) {
    const [bagItems, warehouseItems] = await Promise.all([fetchInventoryItemsByLocation(token, 'bag'), fetchInventoryItemsByLocation(token, 'warehouse')]);
    const counts = emptyRareItems();
    for (const row of [...bagItems, ...warehouseItems]) {
      const defId = str(row?.item_def_id ?? row?.itemDefId);
      const qty = Math.max(0, Math.floor(Number(row?.qty) || 0));
      if (defId === SECT_FRAGMENT_ITEM_DEF_ID) {
        counts.sectFragment += qty;
        continue;
      }
      const rare = RARE_ITEM_BY_DEF_ID.get(defId);
      if (!rare) continue;
      counts[rare.key] += qty;
    }
    return counts;
  }

  async function readSignInOverview(token, month = currentMonthKey()) {
    const q = new URLSearchParams({ month: str(month) || currentMonthKey() });
    return (await api(`/signin/overview?${q.toString()}`, { token }))?.data || null;
  }
  async function readMonthCardStatus(token, monthCardId = DEFAULT_MONTH_CARD_ID) {
    const q = new URLSearchParams({ monthCardId: str(monthCardId) || DEFAULT_MONTH_CARD_ID });
    return (await api(`/monthcard/status?${q.toString()}`, { token }))?.data || null;
  }
  async function readWanderOverview(token) {
    return (await api('/wander/overview', { token }))?.data || null;
  }
  async function generateWander(token) {
    return (await api('/wander/generate', { method: 'POST', token }))?.data || null;
  }
  async function chooseWanderOption(token, episodeId, optionIndex) {
    return (await api('/wander/choose', {
      method: 'POST',
      token,
      body: { episodeId: str(episodeId), optionIndex: Math.max(0, Math.floor(Number(optionIndex) || 0)) },
    }))?.data || null;
  }
  async function readIdleConfig(token) {
    return normalizeIdleConfig((await api('/idle/config', { token }))?.data?.config);
  }
  async function readMySectInfo(token) {
    return (await api('/sect/me', { token }))?.data || null;
  }
  async function readSectShop(token) {
    const data = (await api('/sect/shop', { token }))?.data;
    return Array.isArray(data) ? data : [];
  }
  async function donateSect(token, spiritStones) {
    return (await api('/sect/donate', {
      method: 'POST',
      token,
      body: { spiritStones: Math.max(0, Math.floor(Number(spiritStones) || 0)) },
    })) || null;
  }
  async function buySectShopItem(token, itemId, quantity) {
    return (await api('/sect/shop/buy', {
      method: 'POST',
      token,
      body: { itemId: str(itemId), quantity: Math.max(1, Math.floor(Number(quantity) || 1)) },
    })) || null;
  }
  function resolveSectFragmentShopItem(shopItems) {
    const rows = Array.isArray(shopItems) ? shopItems : [];
    return rows.find((row) => str(row?.itemDefId) === SECT_FRAGMENT_ITEM_DEF_ID || str(row?.id) === SECT_FRAGMENT_SHOP_ITEM_ID) || null;
  }
  function findSectMemberInfo(sectInfo, characterId) {
    const members = Array.isArray(sectInfo?.members) ? sectInfo.members : [];
    return members.find((row) => Number(row?.characterId) === Number(characterId || 0)) || null;
  }
  async function readCurrentBattleSession(token) {
    return (await readCurrentBattleView(token))?.session || null;
  }
  async function abandonBattle(token, battleId) {
    return (await api('/battle/abandon', {
      method: 'POST',
      token,
      body: { battleId },
    }))?.data || null;
  }
  async function resolveIdleStartConfig(a) {
    let lastError = null;
    try {
      const fresh = await readIdleConfig(a.token);
      a.idleConfig = normalizeIdleConfig(fresh);
      save();
      if (idleConfigReady(a.idleConfig)) return a.idleConfig;
    } catch (e) {
      lastError = e;
    }
    if (idleConfigReady(a.idleConfig)) return normalizeIdleConfig(a.idleConfig);
    if (lastError) throw lastError;
    throw new Error('未读取到可用的挂机配置，请先在游戏内手动设置一次挂机');
  }
  async function startIdle(id, autoTriggered = false) {
    const a = acct(id);
    if (!a) return;
    if (!a.token) return setMsg(a, '', '请先登录账号'), render();
    if (loadState(id).idleStart || loadState(id).idleStop) return;
    setBusy(id, 'idleStart', true);
    setMsg(a, autoTriggered ? '自动续挂启动中...' : '启动挂机中...', '');
    render();
    try {
      const cfg = await resolveIdleStartConfig(a);
      if (!idleConfigReady(cfg)) throw new Error('未读取到可用的挂机配置，请先在游戏内手动设置一次挂机');
      await api('/idle/start', {
        method: 'POST',
        token: a.token,
        body: {
          mapId: cfg.mapId,
          roomId: cfg.roomId,
          maxDurationMs: cfg.maxDurationMs,
          autoSkillPolicy: cfg.autoSkillPolicy,
          targetMonsterDefId: cfg.targetMonsterDefId,
          includePartnerInBattle: cfg.includePartnerInBattle,
        },
      });
      a.idleAutoEnabled = true;
      a.idleAutoArmed = true;
      runtime(id).idleAutoRestartKey = '';
      setMsg(a, autoTriggered ? '自动续挂已重新开始' : '挂机已开始', '');
      await refresh(id, true);
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      setMsg(a, '', `${autoTriggered ? '自动续挂失败' : '挂机启动失败'}：${message}`);
      runtime(id).idleNextStartAt = Date.now() + 60000;
    }
    setBusy(id, 'idleStart', false);
    save();
    render();
  }
  async function stopIdle(id) {
    const a = acct(id);
    if (!a) return;
    if (!a.token) return setMsg(a, '', '请先登录账号'), render();
    if (loadState(id).idleStop || loadState(id).idleStart) return;
    setBusy(id, 'idleStop', true);
    setMsg(a, '停止挂机中...', '');
    render();
    try {
      await api('/idle/stop', { method: 'POST', token: a.token });
      runtime(id).idleAutoRestartKey = '';
      setMsg(a, '已发送停止挂机请求', '');
      await refresh(id, true);
    } catch (e) {
      setMsg(a, '', `停止挂机失败：${e.message || e}`);
    }
    setBusy(id, 'idleStop', false);
    save();
    render();
  }
  async function signInOnce(id, { fromGlobal = false } = {}) {
    const a = acct(id);
    if (!a) return { success: false, skipped: true, message: '账号不存在' };
    if (!a.token) {
      setMsg(a, '', '请先登录账号');
      render();
      return { success: false, skipped: true, message: '未登录' };
    }
    const state = loadState(id);
    if (state.signIn || state.monthCardClaim || state.refresh || state.login) {
      return { success: false, skipped: true, message: '账号正忙' };
    }
    setBusy(id, 'signIn', true);
    setMsg(a, fromGlobal ? '全局签到中...' : '签到中...', '');
    render();
    try {
      const overview = await readSignInOverview(a.token);
      a.signIn = normalizeSignInState({
        ...(overview || {}),
        todayReward: Math.max(0, Math.floor(Number(overview?.records?.[overview?.today]?.reward) || 0)),
        fetchedAtMs: Date.now(),
      });
      a.signInError = '';
      if (overview?.signedToday) {
        setMsg(a, '今日已签到', '');
        save();
        render();
        return { success: true, skipped: true, already: true, reward: 0, message: '今日已签到' };
      }
      const res = await api('/signin/do', { method: 'POST', token: a.token });
      const reward = Math.max(0, Math.floor(Number(res?.data?.reward) || 0));
      await refresh(id, true);
      setMsg(a, `签到成功，获得 ${num(reward)} 灵石`, '');
      save();
      render();
      return { success: true, reward };
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (Number(e?.status) === 401) {
        a.token = '';
        a.user = null;
        a.hasCharacter = null;
        clearCharacterState(a);
        setMsg(a, '', '登录状态已失效，请重新登录');
        save();
        render();
        return { success: false, message: '登录状态已失效，请重新登录' };
      }
      if (/今日已签到/.test(message)) {
        try {
          const overview = await readSignInOverview(a.token);
          a.signIn = normalizeSignInState({
            ...(overview || {}),
            todayReward: Math.max(0, Math.floor(Number(overview?.records?.[overview?.today]?.reward) || 0)),
            fetchedAtMs: Date.now(),
          });
          a.signInError = '';
        } catch {}
        setMsg(a, '今日已签到', '');
        save();
        render();
        return { success: true, skipped: true, already: true, reward: 0, message: '今日已签到' };
      }
      setMsg(a, '', `签到失败：${message}`);
      save();
      render();
      return { success: false, message };
    } finally {
      setBusy(id, 'signIn', false);
      save();
      render();
    }
  }
  async function signInAll() {
    const ids = S.accounts.filter((a) => a.token).map((a) => a.id);
    if (!ids.length) {
      setGlobalNotice('', '没有可执行签到的已登录账号');
      render();
      return;
    }
    if (UI.signInAllBusy) return;
    UI.signInAllBusy = true;
    setGlobalNotice(`全局签到中：${ids.length} 个账号`, '');
    render();
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let already = 0;
    let totalReward = 0;
    try {
      for (const id of ids) {
        const result = await signInOnce(id, { fromGlobal: true });
        if (result?.success) {
          if (result.already) already += 1;
          else if (result.skipped) skipped += 1;
          else success += 1;
          totalReward += Math.max(0, Math.floor(Number(result.reward) || 0));
        } else if (result?.skipped) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
      setGlobalNotice(`全局签到完成：成功 ${success}，已签到 ${already}，跳过 ${skipped}，失败 ${failed}，共获得 ${num(totalReward)} 灵石`, '');
    } catch (e) {
      setGlobalNotice('', `全局签到失败：${e.message || e}`);
    } finally {
      UI.signInAllBusy = false;
      render();
    }
  }
  async function claimMonthCardRewardOnce(id, { fromGlobal = false } = {}) {
    const a = acct(id);
    if (!a) return { success: false, skipped: true, message: '账号不存在' };
    if (!a.token) {
      setMsg(a, '', '请先登录账号');
      render();
      return { success: false, skipped: true, message: '未登录' };
    }
    const state = loadState(id);
    if (state.monthCardClaim || state.signIn || state.refresh || state.login) {
      return { success: false, skipped: true, message: '账号正忙' };
    }
    setBusy(id, 'monthCardClaim', true);
    setMsg(a, fromGlobal ? '全局领取月卡中...' : '领取月卡中...', '');
    render();
    try {
      const status = await readMonthCardStatus(a.token, DEFAULT_MONTH_CARD_ID);
      a.monthCard = normalizeMonthCardState({ ...(status || {}), fetchedAtMs: Date.now() });
      a.monthCardError = '';
      if (!status?.active) {
        const message = status?.expireAt ? '月卡已到期' : '未激活月卡';
        setMsg(a, message, '');
        save();
        render();
        return { success: true, skipped: true, inactive: true, reward: 0, message };
      }
      if (!status?.canClaim) {
        const message = status?.today && status?.lastClaimDate === status?.today ? '今日月卡奖励已领取' : '当前无可领取月卡奖励';
        setMsg(a, message, '');
        save();
        render();
        return { success: true, skipped: true, already: true, reward: 0, message };
      }
      const res = await api('/monthcard/claim', {
        method: 'POST',
        token: a.token,
        body: { monthCardId: DEFAULT_MONTH_CARD_ID },
      });
      const reward = Math.max(0, Math.floor(Number(res?.data?.rewardSpiritStones) || 0));
      await refresh(id, true);
      setMsg(a, `月卡奖励领取成功，获得 ${num(reward)} 灵石`, '');
      save();
      render();
      return { success: true, reward };
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (Number(e?.status) === 401) {
        a.token = '';
        a.user = null;
        a.hasCharacter = null;
        clearCharacterState(a);
        setMsg(a, '', '登录状态已失效，请重新登录');
        save();
        render();
        return { success: false, message: '登录状态已失效，请重新登录' };
      }
      if (/今日已领取/.test(message)) {
        try {
          const status = await readMonthCardStatus(a.token, DEFAULT_MONTH_CARD_ID);
          a.monthCard = normalizeMonthCardState({ ...(status || {}), fetchedAtMs: Date.now() });
          a.monthCardError = '';
        } catch {}
        setMsg(a, '今日月卡奖励已领取', '');
        save();
        render();
        return { success: true, skipped: true, already: true, reward: 0, message: '今日月卡奖励已领取' };
      }
      if (/未激活月卡|月卡已到期/.test(message)) {
        try {
          const status = await readMonthCardStatus(a.token, DEFAULT_MONTH_CARD_ID);
          a.monthCard = normalizeMonthCardState({ ...(status || {}), fetchedAtMs: Date.now() });
          a.monthCardError = '';
        } catch {}
        setMsg(a, message, '');
        save();
        render();
        return { success: true, skipped: true, inactive: true, reward: 0, message };
      }
      setMsg(a, '', `领取月卡失败：${message}`);
      save();
      render();
      return { success: false, message };
    } finally {
      setBusy(id, 'monthCardClaim', false);
      save();
      render();
    }
  }
  async function claimMonthCardRewardAll() {
    const ids = S.accounts.filter((a) => a.token).map((a) => a.id);
    if (!ids.length) {
      setGlobalNotice('', '没有可执行月卡领取的已登录账号');
      render();
      return;
    }
    if (UI.monthCardClaimAllBusy) return;
    UI.monthCardClaimAllBusy = true;
    setGlobalNotice(`全局领取月卡中：${ids.length} 个账号`, '');
    render();
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let already = 0;
    let totalReward = 0;
    try {
      for (const id of ids) {
        const result = await claimMonthCardRewardOnce(id, { fromGlobal: true });
        if (result?.success) {
          if (result.already) already += 1;
          else if (result.skipped) skipped += 1;
          else success += 1;
          totalReward += Math.max(0, Math.floor(Number(result.reward) || 0));
        } else if (result?.skipped) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
      setGlobalNotice(`全局月卡领取完成：成功 ${success}，已领取/不可领 ${already + skipped}，失败 ${failed}，共获得 ${num(totalReward)} 灵石`, '');
    } catch (e) {
      setGlobalNotice('', `全局月卡领取失败：${e.message || e}`);
    } finally {
      UI.monthCardClaimAllBusy = false;
      render();
    }
  }
  async function refreshWanderState(id, { silent = false } = {}) {
    const a = acct(id);
    if (!a?.token) throw new Error('请先登录账号');
    const overview = normalizeWanderOverview({ ...(await readWanderOverview(a.token) || {}), fetchedAtMs: Date.now() });
    a.wanderOverview = overview;
    a.wanderError = '';
    if (!silent) {
      save();
      renderWhenSafe();
    }
    return overview;
  }
  async function pollWanderUntilSettled(id, { fromGlobal = false } = {}) {
    const a = acct(id);
    if (!a?.token) throw new Error('请先登录账号');
    let latest = null;
    for (let i = 0; i < WANDER_PENDING_JOB_MAX_POLLS; i += 1) {
      latest = await refreshWanderState(id, { silent: true });
      if (latest?.currentGenerationJob?.status !== 'pending') return latest;
      setMsg(a, `${fromGlobal ? '全局云游' : '云游'}生成中...（${i + 1}/${WANDER_PENDING_JOB_MAX_POLLS}）`, '');
      save();
      renderWhenSafe();
      await sleep(WANDER_PENDING_JOB_POLL_INTERVAL_MS);
    }
    return latest;
  }
  async function executeWander(id, { fromGlobal = false } = {}) {
    const a = acct(id);
    if (!a) return { success: false, skipped: true, message: '账号不存在' };
    if (!a.token) {
      setMsg(a, '', '请先登录账号');
      render();
      return { success: false, skipped: true, message: '未登录' };
    }
    const state = loadState(id);
    if (state.wanderAction || state.refresh || state.login) {
      return { success: false, skipped: true, message: '账号正忙' };
    }
    setBusy(id, 'wanderAction', true);
    setMsg(a, fromGlobal ? '全局云游中...' : '云游执行中...', '');
    render();
    try {
      let overview = a.character ? normalizeWanderOverview(a.wanderOverview) : null;
      if (!a.character?.id) await refresh(id, true);
      if (!overview) overview = await refreshWanderState(id, { silent: true });
      if (!overview?.aiAvailable) {
        const message = overview ? '当前服务器未配置云游 AI' : '云游状态未读取';
        setMsg(a, message, '');
        save();
        render();
        return { success: true, skipped: true, unavailable: true, message };
      }
      if (overview.currentGenerationJob?.status === 'pending') {
        overview = await pollWanderUntilSettled(id, { fromGlobal });
      }
      if (overview?.currentGenerationJob?.status === 'failed' && !overview.currentEpisode) {
        setMsg(a, fromGlobal ? '全局云游重新推演中...' : '云游重新推演中...', '');
        save();
        renderWhenSafe();
        await generateWander(a.token);
        overview = await pollWanderUntilSettled(id, { fromGlobal });
      } else if (overview?.canGenerate && !overview?.isCoolingDown && !overview?.hasPendingEpisode && !overview?.currentEpisode) {
        setMsg(a, fromGlobal ? '全局云游开启中...' : '云游开启中...', '');
        save();
        renderWhenSafe();
        await generateWander(a.token);
        overview = await pollWanderUntilSettled(id, { fromGlobal });
      }
      if (!overview) {
        setMsg(a, '', '云游状态读取失败');
        save();
        render();
        return { success: false, message: '云游状态读取失败' };
      }
      if (overview.currentGenerationJob?.status === 'pending') {
        a.wanderOverview = overview;
        a.wanderError = '';
        setMsg(a, '云游仍在生成中，请稍后再试', '');
        save();
        render();
        return { success: true, skipped: true, pending: true, message: '生成中' };
      }
      if (overview.currentGenerationJob?.status === 'failed') {
        const message = overview.currentGenerationJob.errorMessage || '云游生成失败';
        a.wanderOverview = overview;
        a.wanderError = '';
        setMsg(a, '', `云游失败：${message}`);
        save();
        render();
        return { success: false, message };
      }
      const currentEpisode = wanderCurrentEpisode(overview);
      if (overview.hasPendingEpisode && currentEpisode) {
        UI.wanderOpenById[id] = true;
        setMsg(a, fromGlobal ? '已生成新云游，请到下方详情里手动选择并确认' : '请到下方云游详情里选择并确认', '');
        save();
        render();
        return { success: true, pendingChoice: true, message: '待手动确认' };
      }
      if (overview.isCoolingDown) {
        setMsg(a, `云游冷却中：${dur(wanderRemain(overview))}`, '');
        a.wanderOverview = overview;
        a.wanderError = '';
        save();
        render();
        return { success: true, skipped: true, cooling: true, message: '冷却中' };
      }
      if (overview.canGenerate) {
        setMsg(a, '云游已就绪，可再次执行', '');
        a.wanderOverview = overview;
        a.wanderError = '';
        save();
        render();
        return { success: true, skipped: true, ready: true, message: '可开始' };
      }
      a.wanderOverview = overview;
      a.wanderError = '';
      setMsg(a, '当前无需云游操作', '');
      save();
      render();
      return { success: true, skipped: true, message: '无需操作' };
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (Number(e?.status) === 401) {
        a.token = '';
        a.user = null;
        a.hasCharacter = null;
        clearCharacterState(a);
        setMsg(a, '', '登录状态已失效，请重新登录');
        save();
        render();
        return { success: false, message: '登录状态已失效，请重新登录' };
      }
      setMsg(a, '', `云游失败：${message}`);
      save();
      render();
      return { success: false, message };
    } finally {
      setBusy(id, 'wanderAction', false);
      save();
      render();
    }
  }
  async function confirmWanderChoice(id, episodeId) {
    const a = acct(id);
    if (!a) return { success: false, message: '账号不存在' };
    if (!a.token) {
      setMsg(a, '', '请先登录账号');
      render();
      return { success: false, message: '未登录' };
    }
    const state = loadState(id);
    if (state.wanderAction || state.refresh || state.login) return { success: false, skipped: true, message: '账号正忙' };
    const overview = normalizeWanderOverview(a.wanderOverview);
    const currentEpisode = wanderCurrentEpisode(overview);
    const draft = getWanderDraft(id, episodeId);
    if (!currentEpisode || str(currentEpisode.id) !== str(episodeId) || overview?.hasPendingEpisode !== true) {
      setMsg(a, '', '\u5f53\u524d\u6ca1\u6709\u5f85\u786e\u8ba4\u7684\u4e91\u6e38\u9009\u9879');
      render();
      return { success: false, message: '\u5f53\u524d\u6ca1\u6709\u5f85\u786e\u8ba4\u7684\u4e91\u6e38\u9009\u9879' };
    }
    const effectiveDraft = draft || (overview?.hasPendingEpisode === true ? null : (Number.isFinite(Number(currentEpisode.chosenOptionIndex))
      ? { episodeId: currentEpisode.id, optionIndex: Math.max(0, Math.floor(Number(currentEpisode.chosenOptionIndex))) }
      : null));
    if (!effectiveDraft || !Array.isArray(currentEpisode.options) || !currentEpisode.options.some((option, index) => {
      const optionIndex = Number.isFinite(Number(option?.index)) ? Math.max(0, Math.floor(Number(option.index))) : index;
      return optionIndex === effectiveDraft.optionIndex;
    })) {
      setMsg(a, '', '请先在下方详情里点选一个抉择');
      render();
      return { success: false, message: '请先选择抉择' };
    }
    setBusy(id, 'wanderAction', true);
    setMsg(a, `确认云游抉择 ${effectiveDraft.optionIndex + 1} 中...`, '');
    render();
    try {
      const chooseResult = await chooseWanderOption(a.token, currentEpisode.id, effectiveDraft.optionIndex);
      const latest = await refreshWanderState(id, { silent: true });
      clearWanderDraft(id, episodeId);
      const awardedTitle = chooseResult?.awardedTitle?.name || latest?.currentEpisode?.rewardTitleName || '';
      const baseMessage = `云游已确认抉择 ${effectiveDraft.optionIndex + 1}`;
      setMsg(a, awardedTitle ? `${baseMessage}，获得称号「${awardedTitle}」` : baseMessage, '');
      save();
      render();
      return { success: true, awardedTitle };
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (Number(e?.status) === 401) {
        a.token = '';
        a.user = null;
        a.hasCharacter = null;
        clearCharacterState(a);
        clearWanderDraft(id);
        setMsg(a, '', '登录状态已失效，请重新登录');
        save();
        render();
        return { success: false, message: '登录状态已失效，请重新登录' };
      }
      setMsg(a, '', `确认云游失败：${message}`);
      save();
      render();
      return { success: false, message };
    } finally {
      setBusy(id, 'wanderAction', false);
      save();
      render();
    }
  }
  async function exchangeSectTechniqueFragments(id, { fromGlobal = false } = {}) {
    const a = acct(id);
    if (!a) return { success: false, skipped: true, message: '账号不存在' };
    if (!a.token) {
      setMsg(a, '', '请先登录账号');
      render();
      return { success: false, skipped: true, message: '未登录' };
    }
    const state = loadState(id);
    if (state.sectExchange || state.refresh || state.login) {
      return { success: false, skipped: true, message: '账号正忙' };
    }
    if (!a.character?.id) await refresh(id, true);
    setBusy(id, 'sectExchange', true);
    setMsg(a, fromGlobal ? '全局宗门兑换中...' : '宗门兑换中...', '');
    render();
    let shouldRefresh = false;
    try {
      const current = acct(id);
      if (!current?.character?.id) throw new Error('角色信息未读取，请先刷新状态');
      const sectInfo = await readMySectInfo(current.token);
      if (!sectInfo?.sect) throw new Error('当前未加入宗门');
      const me = findSectMemberInfo(sectInfo, current.character.id);
      if (!me) throw new Error('未在宗门成员列表中找到当前角色');
      const shopItems = await readSectShop(current.token);
      const fragmentItem = resolveSectFragmentShopItem(shopItems);
      if (!fragmentItem?.id) throw new Error('宗门商店未找到功法残页商品');
      const costPerUnit = Math.max(1, Math.floor(Number(fragmentItem.costContribution) || SECT_FRAGMENT_UNIT_COST));

      let boughtQty = 0;
      let buyCount = SECT_FRAGMENT_BATCH_QTY;
      let donated = false;
      let contribution = Math.max(0, Math.floor(Number(me.contribution) || 0));

      while (buyCount > 0) {
        try {
          const buyRes = await buySectShopItem(current.token, fragmentItem.id, buyCount);
          const qty = Math.max(0, Math.floor(Number(buyRes?.qty) || 0));
          boughtQty = qty || Math.max(1, Math.floor(Number(fragmentItem.qty) || 1)) * buyCount;
          shouldRefresh = true;
          break;
        } catch (e) {
          const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
          const remaining = parseSectShopRemaining(message);
          if (remaining !== null && remaining < buyCount) {
            if (remaining <= 0) throw new Error('今日功法残页兑换额度已用完');
            buyCount = remaining;
            setMsg(current, `检测到今日剩余可兑换 ${remaining} 个，自动按剩余额度兑换...`, '');
            render();
            continue;
          }
          if (/贡献不足/.test(message) && !donated) {
            if (contribution >= sectFragmentTotalContributionCost(buyCount, costPerUnit)) throw e;
            setMsg(current, `贡献不足，自动捐献 ${SECT_FRAGMENT_DONATION_SPIRIT_STONES} 灵石后重试...`, '');
            render();
            const donateRes = await donateSect(current.token, SECT_FRAGMENT_DONATION_SPIRIT_STONES);
            donated = true;
            shouldRefresh = true;
            contribution += Math.max(0, Math.floor(Number(donateRes?.addedContribution) || 0));
            continue;
          }
          throw e;
        }
      }

      const partial = boughtQty > 0 && boughtQty < SECT_FRAGMENT_BATCH_QTY;
      const resultText = partial
        ? `已兑换功法残页 ${num(boughtQty)} 个（今日额度不足 500，已按剩余额度兑换）`
        : `已兑换功法残页 ${num(boughtQty)} 个`;
      if (shouldRefresh) await refresh(id, true);
      setMsg(current, donated ? `${resultText}（已自动捐献 ${SECT_FRAGMENT_DONATION_SPIRIT_STONES} 灵石）` : resultText, '');
      save();
      render();
      return { success: true, donated, boughtQty, partial };
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (shouldRefresh) await refresh(id, true);
      setMsg(a, '', `宗门兑换失败：${message}`);
      save();
      render();
      return { success: false, message };
    } finally {
      setBusy(id, 'sectExchange', false);
      save();
      render();
    }
  }
  async function exchangeSectTechniqueFragmentsAll() {
    const ids = S.accounts.filter((a) => a.token).map((a) => a.id);
    if (!ids.length) {
      setGlobalNotice('', '没有可执行宗门兑换的已登录账号');
      render();
      return;
    }
    if (UI.sectExchangeAllBusy) return;
    UI.sectExchangeAllBusy = true;
    setGlobalNotice(`全局兑换功法残页中：${ids.length} 个账号`, '');
    render();
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let donated = 0;
    let totalBought = 0;
    try {
      for (const id of ids) {
        const result = await exchangeSectTechniqueFragments(id, { fromGlobal: true });
        if (result?.success) {
          success += 1;
          totalBought += Math.max(0, Math.floor(Number(result.boughtQty) || 0));
          if (result.donated) donated += 1;
        } else if (result?.skipped) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
      const summary = `全局宗门兑换完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}；累计兑换 ${num(totalBought)} 个功法残页${donated ? `；自动捐献 ${donated} 个账号` : ''}`;
      if (success > 0) setGlobalNotice(summary, '');
      else setGlobalNotice('', summary);
    } catch (e) {
      setGlobalNotice('', `全局宗门兑换失败：${e.message || e}`);
    } finally {
      UI.sectExchangeAllBusy = false;
      render();
    }
  }
  async function waitForDungeonSession(id, runToken, initialSession) {
    const a = acct(id);
    if (!a || !a.token) return;
    const r = runtime(id);
    r.dungeonCurrentSessionId = str(initialSession?.sessionId);
    r.dungeonLastProgressKey = battleSessionKey(initialSession);
    r.dungeonLastProgressAt = Date.now();
    pushDungeonLog(id, `开始跟踪秘境会话 ${r.dungeonCurrentSessionId || '未知'}：${dungeonSessionSummary(initialSession)}`, true);
    while (r.dungeonRunning && r.dungeonRunToken === runToken) {
      await sleep(DUNGEON_POLL_INTERVAL_MS);
      if (!r.dungeonRunning || r.dungeonRunToken !== runToken) return;
      const view = await readCurrentBattleView(a.token);
      const session = view.session;
      if (!session) {
        pushDungeonLog(id, '当前秘境会话已结束，准备继续下一次秘境', true);
        return;
      }
      if (str(session.type) !== 'dungeon') throw new Error('检测到其他战斗会话，已停止自动秘境');
      if (view.state && typeof view.state === 'object') {
        r.dungeonBattleState = mergeBattleStateDelta(r.dungeonBattleState, view.state, false);
        scheduleAutoBattleAction(id, 'poll');
      }
      const key = battleSessionKey(session);
      if (key && key !== r.dungeonLastProgressKey) {
        r.dungeonLastProgressKey = key;
        r.dungeonLastProgressAt = Date.now();
        pushDungeonLog(id, `会话更新：${dungeonSessionSummary(session)}`, true);
      }
      r.dungeonCurrentSessionId = str(session.sessionId);

      if (shouldReturnToMapDungeonSession(session)) {
        const advanceKey = [str(session.sessionId), str(session.status), str(session.nextAction), session.canAdvance === true ? '1' : '0', str(session.currentBattleId)].join('|');
        if (advanceKey !== r.dungeonLastAdvanceKey) {
          r.dungeonLastAdvanceKey = advanceKey;
          r.dungeonLastAdvanceAt = Date.now();
          pushDungeonLog(id, `检测到秘境结算待返回地图，尝试自动完成会话：${dungeonSessionSummary(session)}`, true);
        }
        try {
          await advanceBattleSession(a.token, session.sessionId);
          r.dungeonLastProgressAt = Date.now();
          await sleep(300);
          continue;
        } catch (e) {
          const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
          if (/战斗不存在|当前战斗不存在/.test(message) && str(session.currentBattleId)) {
            pushDungeonLog(id, `秘境结算返回地图失败：${message}；改为放弃残留会话清理`, true);
            try {
              await clearStaleBattleSessionByBattleId(a.token, session.currentBattleId);
              r.dungeonLastProgressAt = Date.now();
              await sleep(300);
              continue;
            } catch (clearError) {
              const clearMessage = (typeof clearError?.message === 'string' ? clearError.message : String(clearError || '')).trim() || '未知错误';
              pushDungeonLog(id, `残留秘境结算会话清理失败：${clearMessage}`, true);
            }
          } else {
            pushDungeonLog(id, `秘境结算返回地图失败：${message}`, true);
          }
        }
      } else if (shouldAdvanceDungeonSession(session)) {
        const advanceKey = [str(session.sessionId), str(session.status), str(session.nextAction), session.canAdvance === true ? '1' : '0', str(session.currentBattleId)].join('|');
        if (advanceKey !== r.dungeonLastAdvanceKey) {
          r.dungeonLastAdvanceKey = advanceKey;
          r.dungeonLastAdvanceAt = Date.now();
          pushDungeonLog(id, `检测到服务端待推进状态，等待服务端自动推进：${dungeonSessionSummary(session)}`, true);
        }
      } else if (r.dungeonLastAdvanceKey) {
        r.dungeonLastAdvanceKey = '';
        r.dungeonLastAdvanceAt = 0;
      }

      if (['completed', 'failed', 'abandoned'].includes(str(session.status))) continue;
      if (Date.now() - r.dungeonLastProgressAt > DUNGEON_STALL_TIMEOUT_MS) {
        pushDungeonLog(id, '秘境会话长时间未推进，自动秘境即将停止', true);
        throw new Error('秘境战斗长时间没有推进，请检查游戏内战斗状态或接口响应');
      }
    }
  }
  async function clearStaleDungeonTransitionBeforeLaunch(id, runToken, initialSession) {
    const a = acct(id);
    if (!a || !a.token) return false;
    if (shouldReturnToMapDungeonSession(initialSession)) {
      const sessionId = str(initialSession.sessionId);
      const battleId = str(initialSession.currentBattleId);
      pushDungeonLog(id, `检测到启动前残留秘境结算会话，尝试自动返回地图后重新开始：${dungeonSessionSummary(initialSession)}`, true);
      try {
        await advanceBattleSession(a.token, sessionId);
        await sleep(400);
        const after = await readCurrentBattleSession(a.token);
        if (!after) {
          pushDungeonLog(id, '残留秘境结算会话已清理，准备重新开始秘境', true);
          return true;
        }
        if (str(after.type) !== 'dungeon') {
          pushDungeonLog(id, '原有秘境会话已切换为其他战斗，不会直接新开秘境', true);
          return false;
        }
        if (str(after.sessionId) === sessionId && shouldReturnToMapDungeonSession(after)) {
          pushDungeonLog(id, '残留秘境结算会话仍未清理成功，请稍后重试或手动刷新页面', true);
          return false;
        }
        pushDungeonLog(id, `残留秘境会话状态已变化，继续按最新状态处理：${dungeonSessionSummary(after)}`, true);
        return false;
      } catch (e) {
        const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
        if (/战斗不存在|当前战斗不存在/.test(message) && battleId) {
          pushDungeonLog(id, `残留秘境结算会话返回地图失败：${message}；改为放弃残留会话清理`, true);
          try {
            await clearStaleBattleSessionByBattleId(a.token, battleId);
            await sleep(400);
            const after = await readCurrentBattleSession(a.token);
            if (!after) {
              pushDungeonLog(id, '残留秘境结算会话已清理，准备重新开始秘境', true);
              return true;
            }
            if (str(after.type) !== 'dungeon') {
              pushDungeonLog(id, '原有秘境会话已切换为其他战斗，不会直接新开秘境', true);
              return false;
            }
            pushDungeonLog(id, `残留秘境会话状态已变化，继续按最新状态处理：${dungeonSessionSummary(after)}`, true);
            return false;
          } catch (clearError) {
            const clearMessage = (typeof clearError?.message === 'string' ? clearError.message : String(clearError || '')).trim() || '未知错误';
            pushDungeonLog(id, `残留秘境结算会话清理失败：${clearMessage}`, true);
            return false;
          }
        }
        pushDungeonLog(id, `残留秘境结算会话清理失败：${message}`, true);
        return false;
      }
    }
    if (!shouldAdvanceDungeonSession(initialSession)) return false;
    const r = runtime(id);
    const sessionKey = battleSessionKey(initialSession);
    const sessionId = str(initialSession.sessionId);
    const battleId = str(initialSession.currentBattleId);
    const deadline = Date.now() + DUNGEON_SERVER_ADVANCE_GRACE_MS;
    pushDungeonLog(id, `检测到启动前残留秘境转场会话，先等待服务端自动推进 ${Math.ceil(DUNGEON_SERVER_ADVANCE_GRACE_MS / 1000)} 秒：${dungeonSessionSummary(initialSession)}`, true);
    while (r.dungeonRunning && r.dungeonRunToken === runToken && Date.now() < deadline) {
      await sleep(2000);
      if (!r.dungeonRunning || r.dungeonRunToken !== runToken) return false;
      const latest = await readCurrentBattleSession(a.token);
      if (!latest) {
        pushDungeonLog(id, '残留秘境会话已自动清理，准备重新开始秘境', true);
        return true;
      }
      if (str(latest.type) !== 'dungeon') return false;
      if (str(latest.sessionId) !== sessionId) return false;
      if (!shouldAdvanceDungeonSession(latest)) return false;
      if (battleSessionKey(latest) !== sessionKey) return false;
    }
    if (!battleId) return false;
    pushDungeonLog(id, '残留秘境转场会话长时间未清理，尝试放弃残留战斗后重新开始', true);
    try {
      await abandonBattle(a.token, battleId);
      await sleep(800);
      const after = await readCurrentBattleSession(a.token);
      if (!after) {
        pushDungeonLog(id, '残留秘境会话已清理，准备重新开始秘境', true);
        return true;
      }
      if (str(after.type) !== 'dungeon') {
        pushDungeonLog(id, '原有秘境会话已切换为其他战斗，不会直接新开秘境', true);
        return false;
      }
      if (str(after.sessionId) === sessionId && battleSessionKey(after) === sessionKey) {
        pushDungeonLog(id, '残留秘境会话仍未清理成功，请先在网页战斗页手动退出', true);
        return false;
      }
      pushDungeonLog(id, `残留秘境会话状态已变化，继续按最新状态处理：${dungeonSessionSummary(after)}`, true);
      return false;
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      pushDungeonLog(id, `残留秘境会话清理失败：${message}`, true);
      return false;
    }
  }
  async function startDungeon(id) {
    const a = acct(id);
    if (!a) return;
    if (!a.token) return setMsg(a, '', '请先登录账号'), render();
    const dungeonId = normalizeDungeonId(a.dungeonId);
    const difficultyRank = Math.max(1, Math.floor(Number(a.dungeonRank) || 1));
    if (!dungeonId) return setMsg(a, '', '请先填写秘境 ID（可从下拉候选中选择）'), render();
    a.dungeonId = dungeonId;
    const r = runtime(id);
    if (r.dungeonRunning || loadState(id).dungeonStart) return;
    const runToken = uid();
    r.dungeonRunning = true;
    r.dungeonRunToken = runToken;
    r.dungeonCurrentInstanceId = '';
    r.dungeonCurrentSessionId = '';
    r.dungeonLastProgressKey = '';
    r.dungeonLastProgressAt = Date.now();
    r.dungeonLastAdvanceKey = '';
    r.dungeonLastAdvanceAt = 0;
    clearDungeonLog(id);
    resetDungeonBattleRuntime(id);
    setDungeonStopReason(a, '');
    setBusy(id, 'dungeonStart', true);
    setMsg(a, `自动秘境启动：${dungeonLabel(a) || dungeonId} · 难度 ${difficultyRank}`, '');
    pushDungeonLog(id, `自动秘境启动：${dungeonLabel(a) || dungeonId} · 难度 ${difficultyRank}`);
    save();
    render();
    try {
      await ensureBattleSkillConfig(id, true);
      const keepAliveReady = await ensureBattleKeepAlive(id);
      if (!keepAliveReady) pushDungeonLog(id, '战斗保活 Socket 未就绪；组队战斗在离线玩家回合时可能停住', true);
      let launched = 0;
      while (r.dungeonRunning && r.dungeonRunToken === runToken) {
        const currentView = await readCurrentBattleView(a.token);
        const currentSession = currentView.session;
        if (currentSession) {
          if (str(currentSession.type) !== 'dungeon') throw new Error('当前已有其他战斗会话在进行');
          if (currentView.state && typeof currentView.state === 'object') {
            r.dungeonBattleState = mergeBattleStateDelta(r.dungeonBattleState, currentView.state, false);
            scheduleAutoBattleAction(id, 'pre-track');
          }
          if (launched <= 0 && await clearStaleDungeonTransitionBeforeLaunch(id, runToken, currentSession)) continue;
          pushDungeonLog(id, `检测到已有秘境会话，继续接管：${dungeonSessionSummary(currentSession)}`, true);
          await waitForDungeonSession(id, runToken, currentSession);
          continue;
        }
        const created = (await api('/dungeon/instance/create', {
          method: 'POST',
          token: a.token,
          body: { dungeonId, difficultyRank },
        }))?.data || {};
        const instanceId = str(created.instanceId);
        if (!instanceId) throw new Error('秘境实例创建失败');
        r.dungeonCurrentInstanceId = instanceId;
        pushDungeonLog(id, `已创建秘境实例 ${instanceId}，准备开始战斗`, true);
        const started = (await api('/battle-session/start', {
          method: 'POST',
          token: a.token,
          body: { type: 'dungeon', instanceId },
        }))?.data || {};
        const session = started.session || null;
        if (!session) throw new Error('秘境战斗启动失败');
        launched += 1;
        setMsg(a, `自动秘境进行中：已开启 ${launched} 次`, '');
        pushDungeonLog(id, `第 ${launched} 次秘境已开战：${dungeonSessionSummary(session)}`, true);
        const launchedView = await readCurrentBattleView(a.token);
        if (launchedView?.state && typeof launchedView.state === 'object') {
          r.dungeonBattleState = mergeBattleStateDelta(r.dungeonBattleState, launchedView.state, false);
          scheduleAutoBattleAction(id, 'launch');
        }
        render();
        await waitForDungeonSession(id, runToken, session);
        if (r.dungeonRunning && r.dungeonRunToken === runToken) pushDungeonLog(id, `第 ${launched} 次秘境已完成，继续检查是否可开启下一次`, true);
      }
      if (r.dungeonRunToken === runToken) {
        setDungeonStopReason(a, '已停止');
        pushDungeonLog(id, '自动秘境已停止', true);
        setMsg(a, '自动秘境已停止', '');
      }
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      if (/体力不足/.test(message)) {
        setDungeonStopReason(a, message);
        pushDungeonLog(id, `体力不足，自动秘境结束：${message}`, true);
        setMsg(a, `自动秘境停止：${message}`, '');
      } else {
        setDungeonStopReason(a, `失败：${message}`);
        pushDungeonLog(id, `自动秘境失败：${message}`, true);
        setMsg(a, '', `自动秘境失败：${message}`);
      }
    }
    if (r.dungeonRunToken === runToken) {
      r.dungeonRunning = false;
      r.dungeonRunToken = '';
      r.dungeonCurrentInstanceId = '';
      r.dungeonCurrentSessionId = '';
      r.dungeonLastProgressKey = '';
      r.dungeonLastProgressAt = 0;
      r.dungeonLastAdvanceKey = '';
      r.dungeonLastAdvanceAt = 0;
      resetDungeonBattleRuntime(id);
      closeBattleKeepAlive(id);
      setBusy(id, 'dungeonStart', false);
      await refresh(id, true);
      save();
      render();
    }
  }
  function stopDungeon(id) {
    const a = acct(id);
    if (!a) return;
    const r = runtime(id);
    if (!r.dungeonRunning) return;
    r.dungeonRunning = false;
    r.dungeonRunToken = '';
    r.dungeonCurrentInstanceId = '';
    r.dungeonCurrentSessionId = '';
    r.dungeonLastProgressKey = '';
    r.dungeonLastProgressAt = 0;
    r.dungeonLastAdvanceKey = '';
    r.dungeonLastAdvanceAt = 0;
    resetDungeonBattleRuntime(id);
    closeBattleKeepAlive(id);
    setBusy(id, 'dungeonStart', false);
    setDungeonStopReason(a, '已手动停止');
    pushDungeonLog(id, '已手动停止自动秘境；当前已开启的战斗会自然结束', true);
    setMsg(a, '已停止自动秘境；当前已开启的战斗会自然结束', '');
    save();
    render();
  }
  async function maybeAutoStartIdleAfterGlobalRefresh(a) {
    if (!a?.token || !a?.character) return false;
    const id = a.id;
    const r = runtime(id);
    if (!idleConfigReady(a.idleConfig) || a.idleError) return false;
    if (loadState(id).idleStart || loadState(id).idleStop || loadState(id).refresh || loadState(id).dungeonStart) return false;
    if (r.dungeonRunning || r.idleNextStartAt > Date.now()) return false;
    const st = a.idle;
    if (st?.status === 'active' || st?.status === 'stopping') return false;
    let currentSession = null;
    try {
      currentSession = await readCurrentBattleSession(a.token);
    } catch (e) {
      const message = (typeof e?.message === 'string' ? e.message : String(e || '')).trim() || '未知错误';
      setMsg(a, '', `自动挂机检查失败：${message}`);
      save();
      render();
      return false;
    }
    if (currentSession) return false;
    await startIdle(id, true);
    return true;
  }

  async function refresh(id, silent) {
    const a = acct(id);
    if (!a) return;
    if (!a.token) return setMsg(a, '', '该账号尚未登录'), render();
    setBusy(id, 'refresh', true);
    if (!silent) setMsg(a, '刷新中...', '');
    if (!silent) render();
    try {
      const chk = (await api('/character/check', { token: a.token }))?.data;
      a.hasCharacter = chk?.hasCharacter === true;
      if (!a.hasCharacter) {
        clearCharacterState(a);
        a.hasCharacter = false;
        a.lastRefreshAt = now();
        setMsg(a, '账号已登录，但尚未创建角色', '');
      } else {
        const c = chk.character || {};
        const cid = Number(c.id) || 0;
        if (!cid) throw new Error('角色 ID 读取失败');
        const fetchedAtMs = Date.now();
        a.character = {
          id: cid,
          nickname: str(c.nickname),
          title: str(c.title),
          realm: str(c.realm),
          subRealm: str(c.sub_realm || c.subRealm),
          stamina: Math.max(0, Math.floor(Number(c.stamina) || 0)),
          staminaMax: Math.max(0, Math.floor(Number(c.stamina_max ?? c.staminaMax) || 0)),
          staminaRecoverAt: str(c.stamina_recover_at ?? c.staminaRecoverAt) || null,
          staminaRecoverPerTick: Math.max(1, Math.floor(Number(c.stamina_recover_per_tick ?? c.staminaRecoverPerTick) || STAMINA_RECOVER_PER_TICK)),
          staminaRecoverIntervalSec: Math.max(1, Math.floor(Number(c.stamina_recover_interval_sec ?? c.staminaRecoverIntervalSec) || STAMINA_RECOVER_INTERVAL_SEC)),
          staminaFetchedAtMs: fetchedAtMs,
          spiritStones: Math.max(0, Math.floor(Number(c.spirit_stones ?? c.spiritStones) || 0)),
          silver: Math.max(0, Math.floor(Number(c.silver) || 0)),
        };
        const [tr, pr, ir, icr, rr, sr, mr, wr] = await Promise.allSettled([
          api(`/character/${cid}/technique/research/status`, { token: a.token }),
          api('/partner/recruit/status', { token: a.token }),
          api('/idle/status', { token: a.token }),
          readIdleConfig(a.token),
          fetchRareItems(a.token),
          readSignInOverview(a.token),
          readMonthCardStatus(a.token, DEFAULT_MONTH_CARD_ID),
          readWanderOverview(a.token),
        ]);
        if (tr.status === 'rejected') throw tr.reason;
        if (pr.status === 'rejected') throw pr.reason;
        const td = tr.value?.data || {};
        const pd = pr.value?.data || {};
        a.technique = {
          unlockRealm: str(td.unlockRealm),
          unlocked: td.unlocked === true,
          cooldownRemainingSeconds: Math.max(0, Math.floor(Number(td.cooldownRemainingSeconds) || 0)),
          cooldownUntil: str(td.cooldownUntil) || null,
          currentJobStatus: str(td.currentJob?.status),
          resultStatus: str(td.resultStatus),
          fetchedAtMs: Date.now(),
        };
        a.partner = {
          unlockRealm: str(pd.unlockRealm),
          unlocked: pd.unlocked === true,
          cooldownRemainingSeconds: Math.max(0, Math.floor(Number(pd.cooldownRemainingSeconds) || 0)),
          cooldownUntil: str(pd.cooldownUntil) || null,
          currentJobStatus: str(pd.currentJob?.status),
          resultStatus: str(pd.resultStatus),
          fetchedAtMs: Date.now(),
        };
        if (ir.status === 'fulfilled') {
          a.idle = normalizeIdleSession(ir.value?.data?.session);
          a.idleError = '';
        } else {
          a.idle = null;
          a.idleError = Number(ir.reason?.status) === 404 ? '接口未部署' : (str(ir.reason?.message) || '读取失败');
        }
        if (icr.status === 'fulfilled') a.idleConfig = normalizeIdleConfig(icr.value);
        if (rr.status === 'fulfilled') {
          a.rareItems = normalizeRareItems(rr.value);
          a.inventoryError = '';
        } else {
          a.rareItems = emptyRareItems();
          a.inventoryError = str(rr.reason?.message || rr.reason) || '读取失败';
        }
        if (sr.status === 'fulfilled') {
          const sd = sr.value || {};
          a.signIn = normalizeSignInState({
            ...sd,
            todayReward: Math.max(0, Math.floor(Number(sd?.records?.[sd?.today]?.reward) || 0)),
            fetchedAtMs: Date.now(),
          });
          a.signInError = '';
        } else {
          a.signIn = null;
          a.signInError = Number(sr.reason?.status) === 404 ? '接口未部署' : (str(sr.reason?.message || sr.reason) || '读取失败');
        }
        if (mr.status === 'fulfilled') {
          a.monthCard = normalizeMonthCardState({ ...(mr.value || {}), fetchedAtMs: Date.now() });
          a.monthCardError = '';
        } else {
          a.monthCard = null;
          a.monthCardError = Number(mr.reason?.status) === 404 ? '接口未部署' : (str(mr.reason?.message || mr.reason) || '读取失败');
        }
        if (wr.status === 'fulfilled') {
          a.wanderOverview = normalizeWanderOverview({ ...(wr.value || {}), fetchedAtMs: Date.now() });
          a.wanderError = '';
        } else {
          a.wanderOverview = null;
          a.wanderError = Number(wr.reason?.status) === 404 ? '接口未部署' : (str(wr.reason?.message || wr.reason) || '读取失败');
        }
        a.idleAutoEnabled = true;
        a.idleAutoArmed = true;
        a.lastRefreshAt = now();
        const notes = [];
        if (a.idleError) notes.push(`挂机状态：${a.idleError}`);
        if (a.inventoryError) notes.push(`背包：${a.inventoryError}`);
        if (a.signInError) notes.push(`签到：${a.signInError}`);
        if (a.monthCardError) notes.push(`月卡：${a.monthCardError}`);
        if (a.wanderError) notes.push(`云游：${a.wanderError}`);
        setMsg(a, notes.length ? `状态刷新成功（${notes.join('；')}）` : '状态刷新成功', '');
      }
    } catch (e) {
      if (Number(e?.status) === 401) {
        a.token = '';
        a.user = null;
        a.hasCharacter = null;
        clearCharacterState(a);
        setMsg(a, '', '登录状态已失效，请重新登录');
      } else {
        setMsg(a, '', `刷新失败：${e.message || e}`);
      }
    }
    setBusy(id, 'refresh', false);
    save();
    if (silent) renderWhenSafe();
    else render();
  }
  async function refreshAll(isAutomatic = false) {
    const ids = S.accounts.filter((a) => a.token).map((a) => a.id);
    if (isAutomatic) {
      S.lastAutoRefreshAt = now();
      save();
    }
    await Promise.all(ids.map((id) => refresh(id, true)));
    for (const id of ids) {
      const a = acct(id);
      if (!a) continue;
      await maybeAutoStartIdleAfterGlobalRefresh(a);
    }
  }
  function flushDeferredUiWork() {
    if (shouldPauseLiveUiUpdates() || isUserScrollingRecently()) return;
    if (UI.pendingAutoRefresh) {
      UI.pendingAutoRefresh = false;
      void refreshAll(true);
      return;
    }
    if (UI.pendingRender) render(true);
  }

  function add() {
    const item = createAccount(nextOrder());
    S.accounts.push(item);
    UI.selectedId = item.id;
    save();
    render();
    if (C.provider === 'local') void refreshCaptcha(item.id);
  }
  function remove(id) {
    closeBattleKeepAlive(id);
    S.accounts = S.accounts.filter((a) => a.id !== id);
    T.delete(id);
    L.delete(id);
    R.delete(id);
    delete UI.wanderOpenById[id];
    if (UI.selectedId === id) UI.selectedId = S.accounts[0]?.id || '';
    save();
    render();
  }
  function logout(id) {
    const a = acct(id);
    if (!a) return;
    closeBattleKeepAlive(id);
    a.token = '';
    a.user = null;
    a.hasCharacter = null;
    clearCharacterState(a);
    setMsg(a, '已清空本地 token', '');
    clearRuntime(id);
    save();
    render();
  }
  function setField(id, field, val, checked) {
    if (field === 'apiBase') {
      S.apiBase = normBase(val);
      D.loaded = false;
      D.loading = false;
      D.error = '';
      D.list = [];
      save();
      sched();
      return;
    }
    if (field === 'autoRefreshMinutes') {
      S.autoRefreshMinutes = Math.max(0, Math.floor(Number(val) || 0));
      save();
      sched();
      return;
    }
    if (field === 'sortBy') {
      S.sortBy = safeSort(str(val));
      save();
      render();
      return;
    }
    if (field === 'notifyEnabled') {
      S.notifyEnabled = checked === true;
      save();
      render();
      return;
    }
    const a = acct(id);
    if (!a) return;
    if (field === 'password') temp(id).password = String(val || '');
    else if (field === 'captchaCode') temp(id).captchaCode = String(val || '').slice(0, 4);
    else if (field === 'alias' || field === 'username') {
      a[field] = String(val || '');
      save();
    } else if (field === 'dungeonId') {
      a.dungeonId = normalizeDungeonId(val);
      save();
    } else if (field === 'dungeonRank') {
      a.dungeonRank = Math.max(1, Math.floor(Number(val) || 1));
      save();
    } else if (field === 'wanderOptionIndex') {
      a.wanderOptionIndex = normalizeWanderOptionIndex(val);
      save();
    }
  }
  function styles() {
    return `
      :host,*{box-sizing:border-box}
      .wrap{${IS_PAGE ? 'position:relative;height:100%;min-height:0;padding:16px;pointer-events:auto;z-index:1;' : 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'}font-family:"Microsoft YaHei",sans-serif;color:#e5edf5}
      .fab{display:${IS_PAGE ? 'none' : 'block'};pointer-events:auto;position:fixed;${PANEL_SIDE === 'left' ? 'left:18px;' : 'right:18px;'}bottom:18px;border:0;border-radius:999px;padding:12px 16px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(37,99,235,.35)}
      .panel{pointer-events:auto;${IS_PAGE ? 'position:relative;top:auto;left:auto;right:auto;bottom:auto;width:100%;min-height:100%;' : `position:fixed;top:12px;${PANEL_SIDE === 'left' ? 'left:12px;' : 'right:12px;'}bottom:12px;width:min(${PANEL_WIDTH}px,calc(100vw - 24px));transform:${PANEL_SIDE === 'left' ? 'translateX(calc(-100% - 18px))' : 'translateX(calc(100% + 18px))'};`}background:rgba(9,14,24,.97);border:1px solid rgba(148,163,184,.2);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:transform .2s ease}
      .panel.open{transform:translateX(0)} .hd{padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.15)} .hd1{display:flex;justify-content:space-between;align-items:center;gap:10px}
      .head-left,.head-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .title{margin:0;font-size:${IS_PAGE ? '24px' : '18px'};font-weight:800} .sub{margin:8px 0 0;font-size:12px;line-height:1.5;color:#94a3b8}
      .version-badge{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border-radius:999px;background:rgba(37,99,235,.18);color:#93c5fd;font-size:11px;font-weight:800}
      .settings-summary{margin-top:8px;font-size:12px;line-height:1.6;color:#94a3b8}
      .x,.toggle{display:inline-flex;align-items:center;justify-content:center;border:0;background:rgba(148,163,184,.14);color:#e2e8f0;border-radius:10px;padding:8px 10px;cursor:pointer;font-weight:700}
      .x{display:${IS_PAGE ? 'none' : 'inline-flex'}}
      .settings-box{display:none}
      .settings-box.show{display:block}
      .cfg,.grid,.stats,.summary-grid,.feature-grid{display:grid;gap:10px} .cfg{grid-template-columns:${IS_PAGE ? 'repeat(4,minmax(0,1fr))' : '1fr 1fr'};margin-top:12px} .cfg .wide{grid-column:1 / -1} .grid,.stats{grid-template-columns:1fr 1fr} .feature-grid{grid-template-columns:${IS_PAGE ? 'repeat(3,minmax(0,1fr))' : '1fr'};margin-top:12px} .summary-grid{grid-template-columns:${IS_PAGE ? 'repeat(auto-fit,minmax(220px,1fr))' : '1fr'};margin:12px 0 0}
      .body{flex:1;overflow:auto;padding:${IS_PAGE ? '16px' : '12px'};background:rgba(2,6,23,.65)} .list{display:${IS_PAGE ? 'grid' : 'flex'};${IS_PAGE ? 'grid-template-columns:repeat(auto-fit,minmax(420px,1fr));align-items:start;' : 'flex-direction:column;'}gap:${IS_PAGE ? '16px' : '12px'}}
      .page-layout{display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);gap:16px;align-items:start}
      .side{position:sticky;top:0;display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(15,23,42,.82)}
      .side-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;font-weight:800}
      .side-count{font-size:12px;color:#94a3b8}
      .side-list{display:flex;flex-direction:column;gap:10px}
      .side-item{width:100%;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(2,6,23,.45);color:#e5edf5;padding:12px;cursor:pointer;text-align:left}
      .side-item.active{border-color:rgba(59,130,246,.7);background:rgba(37,99,235,.16);box-shadow:0 0 0 1px rgba(59,130,246,.18) inset}
      .side-item-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .side-item-name{font-size:14px;font-weight:800;line-height:1.4}
      .side-item-meta{margin-top:6px;font-size:12px;color:#94a3b8;line-height:1.6}
      .detail{min-width:0}
      .card{border:1px solid rgba(148,163,184,.16);border-radius:14px;padding:12px;background:rgba(15,23,42,.82)} .ch{display:flex;justify-content:space-between;gap:10px}
      .name{margin:0;font-size:16px;font-weight:800} .meta{margin-top:4px;font-size:12px;color:#94a3b8;line-height:1.5}
      .badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;background:rgba(148,163,184,.18);color:#cbd5e1}
      .badge.on{background:rgba(22,163,74,.18);color:#86efac}
      label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#cbd5e1} input:not([type="checkbox"]):not([type="radio"]),select,textarea{width:100%;border:1px solid rgba(148,163,184,.22);border-radius:10px;background:rgba(15,23,42,.88);color:#f8fafc;padding:10px 12px;outline:none} textarea{min-height:100px;resize:vertical}
      input[disabled]{opacity:.72;cursor:not-allowed}
      .inline{display:flex;align-items:center;gap:8px;border:1px solid rgba(148,163,184,.22);border-radius:10px;padding:10px 12px;background:rgba(15,23,42,.88)} .inline input{width:auto;margin:0;padding:0} .perm,.import-note{font-size:12px;color:#94a3b8}
      .cap{display:grid;grid-template-columns:120px 1fr;gap:12px;margin-top:12px} .img{height:56px;border-radius:12px;border:1px solid rgba(148,163,184,.18);display:flex;align-items:center;justify-content:center;overflow:hidden;background:rgba(2,6,23,.75)} .img img{width:100%;height:100%;object-fit:contain;background:#fff}
      .acts{display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start} .btn{border:0;border-radius:10px;padding:9px 12px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;cursor:pointer} .btn.alt{background:rgba(30,41,59,.95)} .btn.warn{background:#dc2626} .btn:disabled{opacity:.55;cursor:not-allowed}
      .msg{margin-top:12px;padding:10px 12px;border-radius:12px;font-size:12px;line-height:1.5;background:rgba(30,64,175,.22);color:#bfdbfe} .msg.err{background:rgba(127,29,29,.26);color:#fecaca}
      .st{border:1px solid rgba(148,163,184,.14);border-radius:12px;padding:10px 12px;background:rgba(2,6,23,.5)} .sl{font-size:11px;color:#94a3b8} .sv{margin-top:6px;font-size:14px;font-weight:800;line-height:1.45} .sx{margin-top:6px;font-size:11px;color:#94a3b8;line-height:1.5}
      .summary-card{border:1px solid rgba(148,163,184,.14);border-radius:12px;padding:10px 12px;background:rgba(2,6,23,.45)} .summary-card .label{font-size:11px;color:#94a3b8} .summary-card .value{margin-top:6px;font-size:14px;font-weight:800;line-height:1.45} .summary-card .extra{margin-top:6px;font-size:11px;color:#94a3b8;line-height:1.5}
      .toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px} .toolbar.daily{margin-top:10px} .empty,.foot{font-size:12px;color:#94a3b8} .empty{padding:26px 18px;text-align:center;border:1px dashed rgba(148,163,184,.25);border-radius:14px} .foot{margin-top:10px;line-height:1.6}
      .wander-panel-box{margin-top:12px;border:1px solid rgba(148,163,184,.14);border-radius:14px;background:rgba(2,6,23,.42);overflow:hidden}
      .wander-fold{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:0;background:transparent;color:#e5edf5;cursor:pointer;text-align:left}
      .wander-fold:hover{background:rgba(15,23,42,.5)}
      .wander-fold-main{min-width:0}
      .wander-fold-title{font-size:13px;font-weight:800}
      .wander-fold-sub{margin-top:4px;font-size:12px;line-height:1.5;color:#94a3b8}
      .wander-fold-side{flex:0 0 auto;font-size:12px;font-weight:700;color:#93c5fd}
      .wander-fold-body{display:none;padding:0 14px 14px}
      .wander-fold-body.show{display:block}
      .wander-overview-top{display:flex;flex-direction:column;gap:8px;padding-top:2px}
      .wander-tag-row{display:flex;flex-wrap:wrap;gap:8px}
      .wander-tag{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border-radius:999px;background:rgba(148,163,184,.14);font-size:11px;font-weight:700;color:#cbd5e1}
      .wander-tag.is-info{background:rgba(37,99,235,.18);color:#bfdbfe}
      .wander-tag.is-ok{background:rgba(22,163,74,.18);color:#86efac}
      .wander-tag.is-warn{background:rgba(217,119,6,.18);color:#fcd34d}
      .wander-tag.is-error{background:rgba(127,29,29,.28);color:#fecaca}
      .wander-tag.is-ready{background:rgba(30,64,175,.22);color:#93c5fd}
      .wander-overview-note,.wander-story-meta{font-size:12px;color:#94a3b8;line-height:1.5}
      .wander-story-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:10px}
      .wander-current-box{margin-top:10px;padding:12px;border:1px solid rgba(59,130,246,.24);border-radius:12px;background:rgba(15,23,42,.74)}
      .wander-current-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .wander-current-title{font-size:13px;font-weight:800;line-height:1.5;color:#e2e8f0}
      .wander-story-theme{font-size:14px;font-weight:800;color:#e2e8f0}
      .wander-story-premise{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(15,23,42,.82);font-size:12px;line-height:1.7;color:#cbd5e1}
      .wander-story-list{display:flex;flex-direction:column;gap:10px;max-height:420px;overflow:auto;margin-top:10px;padding-right:2px}
      .wander-entry{border:1px solid rgba(148,163,184,.14);border-radius:12px;padding:12px;background:rgba(15,23,42,.6)}
      .wander-entry-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
      .wander-entry-title{font-size:13px;font-weight:800;line-height:1.5}
      .wander-episode-opening,.wander-episode-summary,.wander-episode-result,.wander-episode-reward{margin-top:8px;font-size:12px;line-height:1.7;color:#cbd5e1}
      .wander-episode-result.is-pending{color:#fcd34d}
      .wander-episode-reward{color:#93c5fd}
      .wander-option-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .wander-option-line{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;padding:8px 10px;border-radius:10px;background:rgba(2,6,23,.55);font-size:12px;line-height:1.6;color:#cbd5e1;border:1px solid rgba(148,163,184,.12);text-align:left}
      button.wander-option-line{width:100%;cursor:pointer;appearance:none;background:rgba(2,6,23,.55)}
      .wander-option-line.is-preferred{box-shadow:0 0 0 1px rgba(59,130,246,.32) inset}
      .wander-option-line.is-chosen{background:rgba(22,163,74,.14);color:#bbf7d0}
      .wander-confirm-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(15,23,42,.82)}
      .wander-confirm-text{font-size:12px;line-height:1.6;color:#cbd5e1}
      .wander-confirm-hint{font-size:12px;line-height:1.6;color:#94a3b8}
      .import-box{display:none;margin-top:12px;padding:12px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(2,6,23,.42)} .import-box.show{display:block}
      @media (max-width:1100px){.cfg{grid-template-columns:1fr 1fr}.feature-grid{grid-template-columns:1fr 1fr}.list{grid-template-columns:repeat(auto-fit,minmax(360px,1fr))}.page-layout{grid-template-columns:260px minmax(0,1fr)}}
      @media (max-width:760px){.page-layout,.cfg,.grid,.stats,.cap,.list,.summary-grid,.feature-grid{grid-template-columns:1fr}.side{position:relative}.wander-story-head,.wander-entry-head,.wander-fold,.wander-confirm-bar{flex-direction:column;align-items:flex-start}.wander-fold-side{padding-left:0}}
      @media (max-width:640px){.cfg,.grid,.stats,.cap,.list,.summary-grid,.feature-grid{grid-template-columns:1fr}.wrap{${IS_PAGE ? 'padding:8px;' : ''}}.panel{${IS_PAGE ? 'min-height:100%;' : `top:8px;${PANEL_SIDE === 'left' ? 'left:8px;' : 'right:8px;'}bottom:8px;width:calc(100vw - 16px);`}}.img{width:100%}}
    `;
  }

  function stat(label, value, extra, type, id) {
    return `<div class="st"><div class="sl">${esc(label)}</div><div class="sv" ${type ? `data-type="${esc(type)}" data-id="${esc(id)}"` : ''}>${esc(value)}</div><div class="sx">${extra || '—'}</div></div>`;
  }
  function summaryCard(label, value, extra = '') {
    return `<div class="summary-card"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="extra">${extra || '—'}</div></div>`;
  }

  function captchaFieldHtml(a, t) {
    if (C.provider === 'tencent') {
      return `<label>验证码方式<input value="登录时自动弹出腾讯点击验证码" disabled></label>`;
    }
    return `<label>图片验证码<input maxlength="4" data-field="captchaCode" data-id="${esc(a.id)}" value="${esc(t.captchaCode)}" placeholder="4 位验证码"></label>`;
  }

  function captchaVisualHtml(a, t) {
    if (C.provider === 'tencent') {
      return `<div class="img"><div class="perm" style="padding:0 12px;text-align:center;line-height:1.6;">无需手输字符，点击“登录”后会弹出腾讯点击验证码。</div></div>`;
    }
    return `<div class="img">${t.captchaImage ? `<img src="${esc(t.captchaImage)}" alt="验证码">` : '<span class="empty">点右侧按钮获取</span>'}</div>`;
  }

  function captchaButtonText(b) {
    if (C.provider === 'tencent') return '验证码说明';
    return b.captcha ? '加载中...' : '刷新验证码';
  }

  function sideItem(a) {
    return `
      <button type="button" class="side-item ${UI.selectedId === a.id ? 'active' : ''}" data-select="${esc(a.id)}">
        <div class="side-item-top">
          <div class="side-item-name">${esc(a.alias || a.username || '未命名账号')}</div>
          <div class="badge ${a.token ? 'on' : ''}">${a.token ? '已登录' : '未登录'}</div>
        </div>
        <div class="side-item-meta">
          用户名：${esc(a.username || '—')}<br>
          体力：<span data-side-type="stamina" data-id="${esc(a.id)}">${esc(staminaText(a))}</span><br>
          资产：${esc(currencyText(a))}<br>
          签到：${esc(signInText(a))}<br>
          月卡：${esc(monthCardText(a))}<br>
          云游：<span data-side-type="wander" data-id="${esc(a.id)}">${esc(wanderText(a))}</span><br>
          挂机：<span data-side-type="idle" data-id="${esc(a.id)}">${esc(idleText(a.idle, a.idleError))}</span><br>
          秘境：<span data-side-type="dungeon" data-id="${esc(a.id)}">${esc(dungeonShortText(a))}</span><br>
          功法：${esc(cdText(a.technique))}<br>
          招募：${esc(cdText(a.partner))}
        </div>
      </button>`;
  }
  function card(a, i) {
    const t = temp(a.id);
    const b = loadState(a.id);
    const c = a.character;
    const dungeonRunning = runtime(a.id).dungeonRunning;
    const anyBatchBusy = UI.signInAllBusy || UI.monthCardClaimAllBusy || UI.sectExchangeAllBusy;
    const realm = c ? [c.realm, c.subRealm].filter(Boolean).join(' · ') || '未读取' : (a.hasCharacter === false ? '未创建角色' : '未读取');
    const msg = a.lastError || a.lastMessage || '';
    const err = !!a.lastError;
    return `
      <div class="card">
        <div class="ch">
          <div>
            <h3 class="name">${esc(a.alias || a.username || `账号 ${i + 1}`)}</h3>
            <div class="meta">${esc(a.user?.username ? `服务端用户：${a.user.username}` : '服务端用户：未登录')}<br>上次登录：${esc(fmtTime(a.lastLoginAt))}<br>上次刷新：${esc(fmtTime(a.lastRefreshAt))}</div>
          </div>
          <div class="badge ${a.token ? 'on' : ''}">${a.token ? '已登录' : '未登录'}</div>
        </div>
        <div class="grid" style="margin-top:12px">
          <label>备注<input data-field="alias" data-id="${esc(a.id)}" value="${esc(a.alias)}" placeholder="例如：大号 / 小号"></label>
          <label>用户名<input data-field="username" data-id="${esc(a.id)}" value="${esc(a.username)}" placeholder="登录用户名"></label>
          <label>密码（仅当前页面内存）<input type="password" data-field="password" data-id="${esc(a.id)}" value="${esc(t.password)}" placeholder="登录密码"></label>
          ${captchaFieldHtml(a, t)}
        </div>
        <div class="cap">
          ${captchaVisualHtml(a, t)}
          <div class="acts">
            <button class="btn alt" data-action="captcha" data-id="${esc(a.id)}" ${C.provider === 'local' && b.captcha ? 'disabled' : ''}>${esc(captchaButtonText(b))}</button>
            <button class="btn" data-action="login" data-id="${esc(a.id)}" ${(b.login || C.sdkLoading) ? 'disabled' : ''}>${b.login ? '登录中...' : '登录'}</button>
            <button class="btn alt" data-action="refresh" data-id="${esc(a.id)}" ${b.refresh || !a.token ? 'disabled' : ''}>${b.refresh ? '刷新中...' : '刷新状态'}</button>
            <button class="btn alt" data-action="logout" data-id="${esc(a.id)}" ${!a.token ? 'disabled' : ''}>清空 Token</button>
            <button class="btn warn" data-action="remove" data-id="${esc(a.id)}">删除</button>
          </div>
        </div>
        <div class="feature-grid">
          <label>自动秘境（ID）<input data-field="dungeonId" data-id="${esc(a.id)}" value="${esc(a.dungeonId)}" list="dungeonCatalog" placeholder="${esc(dungeonInputPlaceholder())}"></label>
          <label>自动秘境难度<input data-field="dungeonRank" data-id="${esc(a.id)}" type="number" min="1" step="1" value="${esc(Math.max(1, Math.floor(Number(a.dungeonRank) || 1)))}"></label>
        </div>
        <div class="toolbar daily">
          <button class="btn alt" data-action="signIn" data-id="${esc(a.id)}" ${(b.signIn || !a.token || anyBatchBusy) ? 'disabled' : ''}>${b.signIn ? '签到中...' : '一键签到'}</button>
          <button class="btn alt" data-action="monthCardClaim" data-id="${esc(a.id)}" ${(b.monthCardClaim || !a.token || anyBatchBusy) ? 'disabled' : ''}>${b.monthCardClaim ? '领取中...' : '领取月卡奖励'}</button>
          <button class="btn alt" data-action="wanderAction" data-id="${esc(a.id)}" ${(b.wanderAction || !a.token || anyBatchBusy) ? 'disabled' : ''}>${wanderActionLabel(a)}</button>
          <button class="btn alt" data-action="idleStart" data-id="${esc(a.id)}" ${(b.idleStart || b.idleStop || !a.token) ? 'disabled' : ''}>${b.idleStart ? '启动挂机中...' : '开始挂机'}</button>
          <button class="btn alt" data-action="idleStop" data-id="${esc(a.id)}" ${(b.idleStop || b.idleStart || !a.token) ? 'disabled' : ''}>${b.idleStop ? '停止中...' : '停止挂机'}</button>
          <button class="btn alt" data-action="sectExchange" data-id="${esc(a.id)}" ${(b.sectExchange || !a.token || anyBatchBusy) ? 'disabled' : ''}>${b.sectExchange ? '兑换中...' : '兑换500残页'}</button>
          <button class="btn" data-action="dungeonStart" data-id="${esc(a.id)}" ${(b.dungeonStart || !a.token) ? 'disabled' : ''}>${b.dungeonStart ? '自动秘境中...' : '开始自动秘境'}</button>
          <button class="btn warn" data-action="dungeonStop" data-id="${esc(a.id)}" ${!dungeonRunning ? 'disabled' : ''}>停止自动秘境</button>
        </div>
        ${msg ? `<div class="msg ${err ? 'err' : ''}">${esc(msg)}</div>` : ''}
        <div class="stats" style="margin-top:12px">
          ${stat('角色', c ? `${c.title ? `${c.title} · ` : ''}${c.nickname}` : (a.hasCharacter === false ? '未创建角色' : '未读取'), esc(realm), '', a.id)}
          ${stat('体力', staminaText(a), staminaExtra(a), 'stamina', a.id)}
          ${stat('灵石 / 银两', currencyText(a), currencyExtra(a), '', a.id)}
          ${stat('稀有物品', rareItemsText(a), rareItemsExtra(a), '', a.id)}
          ${stat('功法残页', sectFragmentText(a), sectFragmentExtra(a), '', a.id)}
          ${stat('签到', signInText(a), signInExtra(a), '', a.id)}
          ${stat('月卡', monthCardText(a), monthCardExtra(a), '', a.id)}
          ${stat('云游', wanderText(a), wanderExtra(a), 'wander', a.id)}
          ${stat('挂机状态', idleText(a.idle, a.idleError), idleExtra(a.idle, a.idleError, a), 'idle', a.id)}
          ${stat('自动秘境', dungeonText(a), dungeonExtra(a), 'dungeon', a.id)}
          ${stat('自动秘境日志', dungeonLogText(a), dungeonLogExtra(a), '', a.id)}
          ${stat('功法自研冷却', cdText(a.technique), `任务：${esc(job(a.technique?.currentJobStatus))}<br>结果：${esc(job(a.technique?.resultStatus))}<br>到期：${esc(fmtTime(a.technique?.cooldownUntil))}`, 'technique', a.id)}
          ${stat('伙伴招募冷却', cdText(a.partner), `任务：${esc(job(a.partner?.currentJobStatus))}<br>结果：${esc(job(a.partner?.resultStatus))}<br>到期：${esc(fmtTime(a.partner?.cooldownUntil))}`, 'partner', a.id)}
        </div>
        ${wanderPanelHtml(a)}
      </div>`;
  }
  function render(force = false) {
    if (!UI.shadow) return;
    if (!force && shouldPauseLiveUiUpdates()) {
      UI.pendingRender = true;
      return;
    }
    rememberScrollPositions();
    UI.pendingRender = false;
    const xs = sortedAccounts();
    const current = selectedAccount(xs);
    const currentIndex = current ? Math.max(0, xs.findIndex((a) => a.id === current.id)) : 0;
    const topErrors = [C.error, D.error, UI.noticeError].filter(Boolean).map((msg) => `<div class="msg err" style="margin-top:12px;">${esc(msg)}</div>`).join('');
    const topNotice = UI.noticeMessage ? `<div class="msg" style="margin-top:12px;">${esc(UI.noticeMessage)}</div>` : '';
    const settingsSummary = settingsSummaryText();
    const anyGlobalBatchBusy = UI.signInAllBusy || UI.monthCardClaimAllBusy || UI.sectExchangeAllBusy;
    UI.shadow.innerHTML = `
      <style>${styles()}</style>
      <div class="wrap">
        <button class="fab" id="fab">${UI.open ? '收起多账号' : '打开多账号'}</button>
        <section class="panel ${UI.open ? 'open' : ''}">
          <div class="hd">
            <div class="hd1">
              <div class="head-left">
                <h2 class="title">九州多账号状态管理</h2>
                <span class="version-badge">v${esc(SCRIPT_VERSION)}</span>
              </div>
              <div class="head-actions">
                <button class="toggle" id="toggleSettings">${UI.settingsOpen ? '收起设置' : '展开设置'}</button>
                <button class="x" id="close">关闭</button>
              </div>
            </div>
            ${UI.settingsOpen ? '' : `<div class="settings-summary">${esc(settingsSummary)}</div>`}
            <div class="settings-box ${UI.settingsOpen ? 'show' : ''}">
              <p class="sub">接口基于 /captcha/config、/auth/login、/character/check、/signin/overview、/signin/do、/monthcard/status、/monthcard/claim、/wander/overview、/wander/generate、/wander/choose、/idle/status、/idle/config、/dungeon/list、/dungeon/instance/create、/battle-session/start、/battle-session/current、/battle-session/:id/advance、/battle/action、/inventory/items、/character/:id/technique/status、/character/:id/technique/research/status、/partner/recruit/status、/sect/me、/sect/shop、/sect/shop/buy、/sect/donate。已兼容本地图片验证码与腾讯点击验证码；密码只保存在当前页面内存内，不写入 localStorage。</p>
              <div class="cfg">
                <label class="wide">API Base<input id="apiBase" value="${esc(S.apiBase)}" placeholder="https://jz.faith.wang/api"></label>
                <label>自动刷新（分钟，0 关闭）<input id="autoRefresh" type="number" min="0" step="1" value="${esc(S.autoRefreshMinutes)}"></label>
                <label>排序方式<select id="sortBy"><option value="manual" ${S.sortBy === 'manual' ? 'selected' : ''}>手动顺序</option><option value="name" ${S.sortBy === 'name' ? 'selected' : ''}>名称</option><option value="technique" ${S.sortBy === 'technique' ? 'selected' : ''}>功法自研剩余</option><option value="partner" ${S.sortBy === 'partner' ? 'selected' : ''}>伙伴招募剩余</option><option value="stamina_desc" ${S.sortBy === 'stamina_desc' ? 'selected' : ''}>体力高到低</option><option value="stamina_asc" ${S.sortBy === 'stamina_asc' ? 'selected' : ''}>体力低到高</option></select></label>
                <label>冷却完成提醒<span class="inline"><input id="notifyEnabled" type="checkbox" ${S.notifyEnabled ? 'checked' : ''}> 启用浏览器提醒</span></label>
                <label>通知权限<div class="inline" style="justify-content:space-between;"><span class="perm">${esc(notifyText())}</span><button class="btn alt" id="notifyBtn" type="button">请求授权</button></div></label>
                <label class="wide">验证码模式<div class="inline" style="justify-content:space-between;"><span class="perm">${esc(providerName())}：${esc(providerHint())}</span><button class="btn alt" id="reloadCaptchaConfig" type="button" ${C.loading ? 'disabled' : ''}>${C.loading ? '读取中...' : '刷新模式'}</button></div></label>
              </div>
            </div>
            ${topErrors}
            ${topNotice}
            <div class="toolbar">
              <button class="btn" id="add">新增账号</button>
              <button class="btn alt" id="all">刷新全部状态</button>
              <button class="btn alt" id="signInAll" ${(anyGlobalBatchBusy || !S.accounts.some((a) => a.token)) ? 'disabled' : ''}>${UI.signInAllBusy ? '全局签到中...' : '全局一键签到'}</button>
              <button class="btn alt" id="monthCardClaimAll" ${(anyGlobalBatchBusy || !S.accounts.some((a) => a.token)) ? 'disabled' : ''}>${UI.monthCardClaimAllBusy ? '全局领取中...' : '全局领取月卡'}</button>
              <button class="btn alt" id="sectExchangeAll" ${(anyGlobalBatchBusy || !S.accounts.some((a) => a.token)) ? 'disabled' : ''}>${UI.sectExchangeAllBusy ? '全局兑换中...' : '全局兑换500残页'}</button>
              <button class="btn alt" id="toggleImport">${UI.importOpen ? '收起批量导入' : '批量导入'}</button>
            </div>
            <div class="import-box ${UI.importOpen ? 'show' : ''}">
              <div class="import-note">格式支持：备注,用户名,密码 或 用户名,密码；也支持制表符或竖线分隔，一行一个账号。密码只导入当前页面内存。</div>
              <textarea id="importText" placeholder="大号,account001,password001&#10;小号,account002,password002">${esc(UI.importText)}</textarea>
              <div class="toolbar" style="margin-top:10px;">
                <button class="btn" id="doImport">导入到列表</button>
                <button class="btn alt" id="clearImport">清空文本</button>
              </div>
            </div>
          </div>
          <div class="body" data-scroll-key="main-body">
            ${globalSummaryCards()}
            ${xs.length ? (IS_PAGE
              ? `<div class="page-layout"><aside class="side"><div class="side-title"><span>账号列表</span><span class="side-count">${xs.length} 个账号</span></div><div class="side-list">${xs.map(sideItem).join('')}</div></aside><section class="detail">${current ? card(current, currentIndex) : '<div class="empty">请选择账号</div>'}</section></div>`
              : `<div class="list">${xs.map(card).join('')}</div>`)
              : '<div class="empty">还没有账号，点上方“新增账号”。</div>'}
            <datalist id="dungeonCatalog">${dungeonDatalistHtml()}</datalist>
            <div class="foot">仓库字段参考：E:/git/jiuzhou_src/client/src/pages/Game/modules/IdleBattle/api/idleBattleApi.ts、E:/git/jiuzhou_src/client/src/services/api/inventory.ts、E:/git/jiuzhou_src/client/src/services/api/world.ts、E:/git/jiuzhou_src/client/src/services/api/battleSession.ts</div>
          </div>
        </section>
      </div>`;
    bind();
    restoreScrollPositions();
    try { requestAnimationFrame(() => restoreScrollPositions()); } catch {}
    updateCountdowns();
  }
  function bind() {
    const s = UI.shadow;
    if (!s) return;
    s.getElementById('fab')?.addEventListener('click', () => { UI.open = !UI.open; render(); });
    s.getElementById('close')?.addEventListener('click', () => { UI.open = false; render(); });
    s.getElementById('toggleSettings')?.addEventListener('click', () => { UI.settingsOpen = !UI.settingsOpen; render(); });
    s.getElementById('add')?.addEventListener('click', () => add());
    s.getElementById('all')?.addEventListener('click', () => { void refreshAll(); });
    s.getElementById('signInAll')?.addEventListener('click', () => { void signInAll(); });
    s.getElementById('monthCardClaimAll')?.addEventListener('click', () => { void claimMonthCardRewardAll(); });
    s.getElementById('sectExchangeAll')?.addEventListener('click', () => { void exchangeSectTechniqueFragmentsAll(); });
    s.getElementById('toggleImport')?.addEventListener('click', () => { UI.importOpen = !UI.importOpen; render(); });
    s.getElementById('doImport')?.addEventListener('click', () => { void importAccounts(); });
    s.getElementById('clearImport')?.addEventListener('click', () => { UI.importText = ''; render(); });
    s.getElementById('notifyBtn')?.addEventListener('click', () => { void askNotify(); });
    s.getElementById('reloadCaptchaConfig')?.addEventListener('click', () => { void refreshCaptchaConfig(); });
    s.getElementById('apiBase')?.addEventListener('change', async (e) => {
      setField('', 'apiBase', e.target.value);
      await Promise.all([refreshCaptchaConfig(true), loadDungeonCatalog(true)]);
      render();
    });
    s.getElementById('autoRefresh')?.addEventListener('change', (e) => { setField('', 'autoRefreshMinutes', e.target.value); render(); });
    s.getElementById('sortBy')?.addEventListener('change', (e) => setField('', 'sortBy', e.target.value));
    s.getElementById('notifyEnabled')?.addEventListener('change', (e) => setField('', 'notifyEnabled', '', e.target.checked));
    s.getElementById('importText')?.addEventListener('input', (e) => { UI.importText = e.target.value; });
    s.querySelectorAll('[data-select]').forEach((el) => el.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-select');
      if (id && id !== UI.selectedId) {
        UI.selectedId = id;
        render();
      }
    }));
    s.querySelectorAll('[data-toggle-wander]').forEach((el) => el.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-toggle-wander');
      if (!id) return;
      UI.wanderOpenById[id] = UI.wanderOpenById[id] !== true;
      render();
    }));
    s.querySelectorAll('[data-scroll-key]').forEach((el) => el.addEventListener('scroll', (e) => {
      const key = str(e.currentTarget.getAttribute('data-scroll-key'));
      if (!key) return;
      UI.lastScrollAt = Date.now();
      UI.scrollPositions[key] = Math.max(0, Math.floor(Number(e.currentTarget.scrollTop) || 0));
    }, { passive: true }));
    s.querySelectorAll('[data-field]').forEach((el) => {
      if (el.getAttribute('data-field') === 'wanderChoiceDraft') return;
      const handler = (e) => setField(e.target.getAttribute('data-id'), e.target.getAttribute('data-field'), e.target.value);
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    s.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const action = e.currentTarget.getAttribute('data-action');
      if (action === 'captcha') await refreshCaptcha(id);
      else if (action === 'login') await login(id);
      else if (action === 'refresh') await refresh(id);
      else if (action === 'signIn') await signInOnce(id);
      else if (action === 'monthCardClaim') await claimMonthCardRewardOnce(id);
      else if (action === 'logout') logout(id);
      else if (action === 'remove') remove(id);
      else if (action === 'idleStart') await startIdle(id);
      else if (action === 'idleStop') await stopIdle(id);
      else if (action === 'sectExchange') await exchangeSectTechniqueFragments(id);
      else if (action === 'wanderAction') await executeWander(id);
      else if (action === 'wanderPick') {
        const episodeId = e.currentTarget.getAttribute('data-episode-id');
        const optionIndex = e.currentTarget.getAttribute('data-option-index');
        if (id && episodeId) {
          setWanderDraft(id, episodeId, optionIndex);
          UI.wanderOpenById[id] = true;
          render(true);
        }
      }
      else if (action === 'wanderConfirm') await confirmWanderChoice(id, e.currentTarget.getAttribute('data-episode-id'));
      else if (action === 'dungeonStart') await startDungeon(id);
      else if (action === 'dungeonStop') stopDungeon(id);
    }));
  }
  function updateCountdowns() {
    if (!UI.shadow) return;
    flushDeferredUiWork();
    if (shouldPauseLiveUiUpdates()) return;
    sortedAccounts().forEach((a) => {
      maybeNotify(a, 'technique');
      maybeNotify(a, 'partner');
    });
    UI.shadow.querySelectorAll('[data-type]').forEach((el) => {
      const a = acct(el.getAttribute('data-id'));
      if (!a) return;
      const type = el.getAttribute('data-type');
      el.textContent = type === 'technique'
        ? cdText(a.technique)
        : type === 'partner'
          ? cdText(a.partner)
          : type === 'stamina'
            ? staminaText(a)
            : type === 'idle'
              ? idleText(a.idle, a.idleError)
              : type === 'wander'
                ? wanderText(a)
                : dungeonText(a);
    });
    UI.shadow.querySelectorAll('[data-side-type]').forEach((el) => {
      const a = acct(el.getAttribute('data-id'));
      if (!a) return;
      const type = el.getAttribute('data-side-type');
      el.textContent = type === 'stamina'
        ? staminaText(a)
        : type === 'idle'
          ? idleText(a.idle, a.idleError)
          : type === 'wander'
            ? wanderText(a)
            : dungeonShortText(a);
    });
  }
  function sched() {
    if (UI.timer) clearInterval(UI.timer);
    if (S.autoRefreshMinutes > 0) {
      UI.timer = setInterval(() => {
        if (shouldPauseLiveUiUpdates()) {
          UI.pendingAutoRefresh = true;
          return;
        }
        UI.pendingAutoRefresh = false;
        void refreshAll(true);
      }, S.autoRefreshMinutes * 60000);
    }
  }

  async function initCaptchaMode() {
    await Promise.all([refreshCaptchaConfig(true), loadDungeonCatalog(true)]);
    if (C.provider === 'local') {
      const noToken = S.accounts.find((a) => !a.token);
      if (noToken) void refreshCaptcha(noToken.id);
    }
  }
  function mount() {
    if (UI.host) return;
    S.accounts.forEach((a, i) => {
      if (!(Number(a.order) > 0)) a.order = i + 1;
      if (!('idle' in a)) a.idle = null;
      if (typeof a.idleError !== 'string') a.idleError = '';
      a.idleConfig = normalizeIdleConfig(a.idleConfig);
      a.idleAutoEnabled = true;
      a.idleAutoArmed = true;
      a.dungeonId = normalizeDungeonId(a.dungeonId);
      a.dungeonRank = Math.max(1, Math.floor(Number(a.dungeonRank) || 1));
      if (typeof a.dungeonLastStopReason !== 'string') a.dungeonLastStopReason = '';
      a.rareItems = normalizeRareItems(a.rareItems);
      if (typeof a.inventoryError !== 'string') a.inventoryError = '';
      a.signIn = normalizeSignInState(a.signIn);
      if (typeof a.signInError !== 'string') a.signInError = '';
      a.monthCard = normalizeMonthCardState(a.monthCard);
      if (typeof a.monthCardError !== 'string') a.monthCardError = '';
      a.wanderOverview = normalizeWanderOverview(a.wanderOverview);
      if (typeof a.wanderError !== 'string') a.wanderError = '';
      a.wanderOptionIndex = normalizeWanderOptionIndex(a.wanderOptionIndex);
      if (typeof a.techniqueNoticeKey !== 'string') a.techniqueNoticeKey = '';
      if (typeof a.partnerNoticeKey !== 'string') a.partnerNoticeKey = '';
    });
    if (!S.accounts.length) {
      S.accounts.push(createAccount(1));
      save();
    }
    if (!acct(UI.selectedId)) UI.selectedId = S.accounts[0]?.id || '';
    UI.host = document.createElement('div');
    if (IS_PAGE) {
      UI.host.style.display = 'block';
      UI.host.style.flex = '1';
      UI.host.style.minHeight = '0';
    }
    UI.shadow = UI.host.attachShadow({ mode: 'open' });
    document.body.appendChild(UI.host);
    render();
    sched();
    UI.tick = setInterval(updateCountdowns, 1000);
    void initCaptchaMode();
    if (S.accounts.some((a) => a.token)) void refreshAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
