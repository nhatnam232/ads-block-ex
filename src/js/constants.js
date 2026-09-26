// constants & contracts — part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

// Conservative cross-browser floors (Chrome vs Firefox differ; always take
// Math.min with the values probed at runtime via declarativeNetRequest.* —
// Firefox hard-throws above 30K enabled static rules, MDN/source disagree on
// some constants, so we stay far below both and never hardcode at call sites).
export const RUNTIME_CAPS = {
    staticRulesTarget: 28000,   // enabled static rule budget (build gate)
    dynamicRules: 4000,         // user rules + quick-fix channel
    sessionRules: 4000,
    regexRules: 900,
    enabledRulesets: 10,        // MDN Firefox page says 10; Gecko source 20
};

// DNR priorities. Never rely on cross-browser tie-breaks (Firefox orders
// session > dynamic > static rulesets; Chrome orders by priority then action).
export const PRIORITY = {
    staticPlain: 1,             // matches compiler output
    quickFixBlock: 500,
    modeAllow: 10000,           // per-site "no filtering" (allowAllRequests)
    userAllow: 10001,
    userBlock: 10002,
};

// Dynamic-rule id ranges (single writer: js/dynamic-rules.js).
export const RULE_ID = {
    modeAllowDynamic: 1,        // allowAllRequests for 'none' sites
    modeAllowSession: 2,        // allow for tabless requests of 'none' sites
    customRules: [100, 999],
    myRulesPermanent: [1000, 1999],
    myRulesTemporary: [2000, 2999], // session store
    quickFix: [3000, 4499],
};

// Per-site filtering modes (uBOL semantics).
//   none    — no filtering at all (allowAllRequests)
//   basic   — network filtering only (DNR, no host permissions needed)
//   optimal — + specific cosmetics + scriptlets (host permission required)
//   complete— + generic cosmetic filtering everywhere (heaviest)
export const MODES = ['none', 'basic', 'optimal', 'complete'];

export const TOGGLE_KEYS = ['ads', 'cosmetic', 'aab', 'annoyances', 'https'];

// Ruleset id → group, mirroring rulesets.json at the repo root (kept in sync
// by convention). At runtime the compiler-stamped `group` field in
// ruleset-details.json wins; this map is the fallback for fresh installs
// where the details fetch failed.
export const RULESET_GROUPS = {
    'ublock-filters': 'default',
    'easylist': 'default',
    'easyprivacy': 'default',
    'pgl': 'default',
    'ublock-badware': 'malware',
    'urlhaus-full': 'malware',
    'vie-1': 'regions',
    'aab-1': 'aab',
    'youtube-1': 'media',
    'spotify-1': 'media',
    'ublock-annoyances-cookies': 'annoyances',
    'ublock-annoyances-others': 'annoyances',
    'test-1': 'test',
};

/*******************************************************************************
 * Storage schema (chrome.storage.local unless noted)
 ******************************************************************************/

export const STORAGE_KEYS = {
    settings: 'settings',           // see DEFAULT_SETTINGS
    modes: 'modes',                 // { none:[host], basic:[host], optimal:[host]|['all-urls'], complete:[host] }
    sites: 'sites',                 // { host: { paused, mode, toggles } }
    customRules: 'customRules',     // [{ id, text, enabled, source, createdAt }]
    myRules: 'myRules',             // { permanent:[line], temporary:[line] }
    filterLists: 'filterLists',     // { builtin: { id: enabled }, custom: [] }
    stats: 'stats',                 // { total, byCategory, bySite:{host:{count,lastSeen}}, history:[{d,total}] }
    // storage.session:
    tabStats: 'tabStats',           // { tabId: { url, host, ads, trackers, cosmetic, aab, total, ts, ring:[item] } }
};

export const DEFAULT_SETTINGS = {
    defaultMode: 'basic',           // effective mode before any site grant
    defaultToggles: {
        ads: 'standard',            // 'standard' | 'aggressive'
        cosmetic: true,
        aab: true,
        annoyances: false,
        https: false,
    },
    autoReload: true,
    badgeEnabled: true,
    aabProfile: 'standard',         // 'off' | 'standard' | 'aggressive'
    modules: {
        youtube: true,
        // on out of the box: no per-site Grant clicks, no ToS accept click.
        // (Install-time <all_urls> covers the injection; see manifest.)
        spotify: true,
        spotifyNoticeAccepted: true,
    },
    quickFix: {
        enabled: false,             // remote data channel (pinned URL)
        url: '',                    // empty → bundled seed only
        intervalHours: 168,         // weekly
        lastRun: 0,
        lastETag: '',
        lastCount: 0,
    },
    userscriptsOnboarded: false,
    ffMaximumMode: false,
    debugLogging: false,
};

/*******************************************************************************
 * Message protocol — popup/options ⇄ service worker.
 * Every message: { what: <MSG.*>, ...payload } → response object (or {ok:false,error}).
 ******************************************************************************/

export const MSG = {
    // popup
    getPopupData: 'getPopupData',
    setMode: 'setMode',
    setToggles: 'setToggles',
    pauseSite: 'pauseSite',
    pauseEverywhere: 'pauseEverywhere',
    forgetSite: 'forgetSite',
    getRecentBlocks: 'getRecentBlocks',
    addCustomRule: 'addCustomRule',
    validateRule: 'validateRule',
    openPicker: 'openPicker',
    getUserscriptsStatus: 'getUserscriptsStatus',
    // options
    getSettings: 'getSettings',
    setSettings: 'setSettings',
    getStats: 'getStats',
    getCustomRules: 'getCustomRules',
    removeCustomRule: 'removeCustomRule',
    setCustomRuleEnabled: 'setCustomRuleEnabled',
    getMyRules: 'getMyRules',
    setMyRules: 'setMyRules',
    getSites: 'getSites',
    getFilterLists: 'getFilterLists',
    setFilterListEnabled: 'setFilterListEnabled',
    getBudgets: 'getBudgets',
    getDynamicRules: 'getDynamicRules',
    requestQuickFixUpdate: 'requestQuickFixUpdate',
    clearQuickFixRules: 'clearQuickFixRules',
    backup: 'backup',               // → full settings JSON
    restore: 'restore',             // { data }
    // content scripts
    contentScriptReady: 'contentScriptReady',
    epickerCommit: 'epickerCommit', // { filter } → customRules
};

// Rule source badges for the custom-rules editor.
export const RULE_SOURCES = ['user', 'picker', 'imported', 'quickfix'];

/*******************************************************************************
 * Misc helpers shared everywhere
 ******************************************************************************/

export function hostnameFromURL(url) {
    try { return new URL(url).hostname; } catch { return ''; }
}

export function isIPAddress(host) {
    if (!host) { return false; }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { return true; }
    // bare IPv6 has ':', bracketed [::1] too - strip brackets first
    const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    return h.includes(':');
}

// base domain via the public suffix list is overkill here; label-based
// grouping is enough for per-site settings (subdomains inherit by suffix
// match in mode resolution, uBOL-style).
export function hostMatches(host, pattern) {
    if (pattern === 'all-urls' || pattern === '') { return true; }
    if (host === pattern) { return true; }
    return host.endsWith('.' + pattern);
}
