// background entry point — part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

import { api, isFirefox, initBadge, dnr, tabs, scripting, userScriptsAvailable } from './ext-compat.js';
import {
    MSG, RULE_ID, STORAGE_KEYS, TOGGLE_KEYS, MODES, hostnameFromURL,
} from './constants.js';
import {
    local, session, getSettings, setSettings, getModes, setModes,
    getSites, setSites, getStats, getCustomRules, setCustomRules,
    getMyRules, setMyRules, getFilterLists, setFilterLists,
} from './storage.js';
import * as scriptletManager from './scriptlet-manager.js';
import * as modeManager from './mode-manager.js';
import { canInjectHost } from './permissions.js';
import * as dynamicRules from './dynamic-rules.js';
import * as rulesetPolicy from './ruleset-policy.js';
import * as tabStats from './tab-stats.js';
import { parseUserRule, compileLines } from './user-rules.js';

/******************************************************************************/
// lifecycle
/******************************************************************************/

async function onInstalled() {
    await modeManager.seedDefaults();
    await initBadge();
    await rulesetPolicy.apply().catch(noop);
    scriptletManager.sync().catch(noop);
    const settings = await getSettings();
    // quick-fix refresh cadence (weekly default) — the alarm survives SW
    // restarts; the remote fetch itself ships in v2, v1 only re-reads the
    // bundled seed.
    await api.alarms.create('quickfix', {
        periodInMinutes: Math.max(30, (settings.quickFix.intervalHours || 168) * 60),
    });
}

function onStartup() {
    // idempotent resync after a browser restart (storage is the only truth)
    initBadge().catch(noop);
    rulesetPolicy.apply().catch(noop);
    modeManager.apply().catch(noop);
    scriptletManager.sync().catch(noop);
}

function noop() { /* best-effort calls above must never throw the SW */ }

api.runtime.onInstalled.addListener(() => { onInstalled().catch(noop); });
api.runtime.onStartup.addListener(onStartup);
api.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name !== 'quickfix') { return; }
    getSettings().then(s => {
        if (s.debugLogging) { console.log('[bg] quickfix alarm fired (v1: seed-only)'); }
    }).catch(noop);
});

// per-request tallies (Chrome + declarativeNetRequestFeedback only —
// registration itself throws without the permission, hence the guard inside)
tabStats.registerMatchTracker();
api.tabs.onRemoved.addListener(tabId => { tabStats.pruneTab(tabId).catch(noop); });

// site scriptlets depend on host permissions — re-sync when grants change
if (api.permissions?.onAdded) {
    api.permissions.onAdded.addListener(() => {
        scriptletManager.sync().catch(noop);
        api.action.setBadgeText({ text: '' }); // clear the "!" grant hint
    });
}
if (api.permissions?.onRemoved) {
    api.permissions.onRemoved.addListener(() => { scriptletManager.sync().catch(noop); });
}

// Chromium: MAIN-world site scriptlets inject per navigation — the same
// architecture uBO/AdGuard use for their web-player userscripts, avoiding
// the registerContentScripts permission quirks entirely. (Firefox keeps
// the registration path: <all_urls> is granted at install there.)
if (!isFirefox && api.webNavigation?.onCommitted) {
    api.webNavigation.onCommitted.addListener(details => {
        injectSiteScriptlets(details).catch(noop);
    });
}

async function injectSiteScriptlets(details) {
    if (details.frameId !== 0) { return; }
    const hostname = hostnameFromURL(details.url || '');
    if (!hostname) { return; }
    const files = scriptletManager.bundlesForHost(hostname, await getSettings());
    if (files.length === 0) { return; }
    if (!(await canInjectHost(hostname))) {
        await maybeAskForGrant(hostname);
        return;
    }
    await scripting.executeScript({
        target: { tabId: details.tabId },
        files,
        world: 'MAIN',
        injectImmediately: true,
    });
}

// a module wants this site but we hold no grant for it: pop the panel once
// per browser session — its Grant button runs permissions.request inside
// the user's click gesture (the only place the browser allows it). If the
// popup can't be opened, fall back to a badge hint.
async function maybeAskForGrant(hostname) {
    const asked = (await session.get('grantAsked', {})) || {};
    if (asked[hostname]) { return; }
    asked[hostname] = 1;
    await session.set('grantAsked', asked);
    try {
        await api.action.openPopup();
    } catch {
        api.action.setBadgeText({ text: '!' });
    }
}

/******************************************************************************/
// helpers
/******************************************************************************/

function freeIdInRange(records, [lo, hi]) {
    const used = new Set(records.map(r => r.id));
    for (let id = lo; id <= hi; id++) {
        if (!used.has(id)) { return id; }
    }
    return -1;
}

// (re)compile the persisted custom-rule records into their DNR range
async function applyCustomRules() {
    const records = (await getCustomRules()).filter(r => r.enabled !== false);
    const { rules } = compileLines(records.map(r => r.text), RULE_ID.customRules[0]);
    return dynamicRules.applyRange(RULE_ID.customRules, rules, 'dynamic');
}

async function applyMyRules() {
    const myRules = await getMyRules();
    const perm = compileLines(myRules.permanent || [], RULE_ID.myRulesPermanent[0]);
    const temp = compileLines(myRules.temporary || [], RULE_ID.myRulesTemporary[0]);
    const rPerm = await dynamicRules.applyRange(
        RULE_ID.myRulesPermanent, perm.rules, 'dynamic');
    const rTemp = await dynamicRules.applyRange(
        RULE_ID.myRulesTemporary, temp.rules, 'session');
    return { errors: [...perm.errors, ...temp.errors], applied: { permanent: rPerm.applied, temporary: rTemp.applied } };
}

async function maybeReload(tabId) {
    if (!tabId || tabId < 0) { return; }
    const settings = await getSettings();
    if (settings.autoReload) { tabs.reload(tabId).catch?.(noop); }
}

/******************************************************************************/
// message handlers
/******************************************************************************/

const handlers = {

    // ---- popup -------------------------------------------------------------

    async [MSG.getPopupData]() {
        const [tab] = (await tabs.query({ active: true, currentWindow: true })) || [];
        const url = tab?.url || '';
        const hostname = hostnameFromURL(url);
        const [settings, mode, canInject, recent, budgets, sites, usOK, modes, tabStat, stats] = await Promise.all([
            getSettings(),
            modeManager.effectiveMode(hostname),
            canInjectHost(hostname),
            tabStats.getRecentBlocks(tab?.id),
            dynamicRules.getBudgets(),
            getSites(),
            userScriptsAvailable(),
            getModes(),
            tabStats.getTabStats(tab?.id),
            getStats(),
        ]);
        return {
            tab: { id: tab?.id ?? -1, url, hostname },
            isBrowserUI: /^(chrome|edge|about|moz-extension):/.test(url),
            mode,
            canInject,
            toggles: settings.defaultToggles,
            paused: sites[hostname]?.paused === true,
            pausedEverywhere: (modes.none || []).includes('all-urls'),
            lastMode: sites[hostname]?.lastMode,
            blockedOnPage: tabStat?.total ?? 0,
            blockedTotal: stats.total ?? 0,
            recentBlocks: recent,
            budgets,
            userscripts: { available: usOK, onboarded: settings.userscriptsOnboarded },
            autoReload: settings.autoReload,
        };
    },

    async [MSG.setMode]({ hostname, mode, tabId }) {
        if (!MODES.includes(mode)) { throw new Error(`bad mode: ${mode}`); }
        const previous = await modeManager.effectiveMode(hostname);
        await modeManager.setSiteMode(hostname, mode);
        const sites = await getSites();
        sites[hostname] = {
            ...(sites[hostname] || {}),
            paused: mode === 'none',
            // remember what the site ran on before it was switched off, so
            // the popup's power toggle can restore it (VPN-app semantics)
            ...(mode === 'none'
                ? { lastMode: previous !== 'none' ? previous : undefined }
                : { lastMode: undefined }),
        };
        await setSites(sites);
        await maybeReload(tabId);
        return { mode };
    },

    async [MSG.setToggles]({ toggles }) {
        const settings = await getSettings();
        for (const key of TOGGLE_KEYS) {
            if (key in (toggles || {})) { settings.defaultToggles[key] = toggles[key]; }
        }
        await setSettings(settings);
        const rs = await rulesetPolicy.apply();
        scriptletManager.sync().catch(noop);
        return { toggles: settings.defaultToggles, rulesets: rs };
    },

    async [MSG.pauseSite]({ hostname, tabId }) {
        const previous = await modeManager.effectiveMode(hostname);
        await modeManager.setSiteMode(hostname, 'none');
        const sites = await getSites();
        sites[hostname] = {
            ...(sites[hostname] || {}),
            paused: true,
            ts: Date.now(),
            lastMode: previous !== 'none' ? previous : undefined,
        };
        await setSites(sites);
        await maybeReload(tabId);
        return { paused: true };
    },

    async [MSG.pauseEverywhere]({ tabId }) {
        const modes = await getModes();
        if (modes.none.includes('all-urls')) {
            // toggle back off: restore the shipped default (optimal everywhere)
            Object.assign(modes, { none: [], basic: [], optimal: [], complete: [] });
            await setModes(modes);
            await modeManager.seedDefaults();
            await modeManager.apply();
            await maybeReload(tabId);
            return { paused: false };
        }
        // 'none' at all-urls would still lose to any per-site entry (most-
        // specific match wins), so clear every list — pause means pause.
        Object.assign(modes, { none: ['all-urls'], basic: [], optimal: [], complete: [] });
        await setModes(modes);
        await modeManager.apply();
        await maybeReload(tabId);
        return { paused: true };
    },

    async [MSG.forgetSite]({ hostname }) {
        await modeManager.forgetHost(hostname);
        const sites = await getSites();
        delete sites[hostname];
        await setSites(sites);
        return { forgotten: true };
    },

    async [MSG.getRecentBlocks]({ tabId }) {
        return { blocks: await tabStats.getRecentBlocks(tabId) };
    },

    async [MSG.addCustomRule]({ text, source = 'user' }) {
        const parsed = parseUserRule(text);
        if (!parsed.ok) { throw new Error(parsed.error || 'invalid rule'); }
        const records = await getCustomRules();
        const id = freeIdInRange(records, RULE_ID.customRules);
        if (id === -1) { throw new Error('Custom-rule slots full (max 900).'); }
        records.push({ id, text: text.trim(), enabled: true, source, createdAt: Date.now() });
        await setCustomRules(records);
        const applied = await applyCustomRules();
        return { id, applied: applied.applied };
    },

    async [MSG.validateRule]({ text }) {
        const parsed = parseUserRule(text);
        return { valid: parsed.ok === true, error: parsed.error || null };
    },

    async [MSG.openPicker]() {
        return { ok: false, error: 'Element picker ships in v2.' };
    },

    async [MSG.getUserscriptsStatus]() {
        const settings = await getSettings();
        return { available: await userScriptsAvailable(), onboarded: settings.userscriptsOnboarded };
    },

    // ---- options ------------------------------------------------------------

    async [MSG.getSettings]() {
        return { settings: await getSettings() };
    },

    async [MSG.setSettings]({ settings: patch }) {
        const current = await getSettings();
        const next = { ...current, ...patch };
        next.defaultToggles = { ...current.defaultToggles, ...(patch?.defaultToggles || {}) };
        next.modules = { ...current.modules, ...(patch?.modules || {}) };
        next.quickFix = { ...current.quickFix, ...(patch?.quickFix || {}) };
        await setSettings(next);
        const rs = await rulesetPolicy.apply();
        scriptletManager.sync().catch(noop);
        if (patch?.badgeEnabled !== undefined) { await initBadge(); }
        return { settings: next, rulesets: rs };
    },

    async [MSG.getStats]() {
        return { stats: await getStats() };
    },

    async [MSG.getCustomRules]() {
        return { rules: await getCustomRules() };
    },

    async [MSG.removeCustomRule]({ id }) {
        const records = (await getCustomRules()).filter(r => r.id !== id);
        await setCustomRules(records);
        const applied = await applyCustomRules();
        return { applied: applied.applied };
    },

    async [MSG.setCustomRuleEnabled]({ id, enabled }) {
        const records = await getCustomRules();
        const rec = records.find(r => r.id === id);
        if (!rec) { throw new Error(`no custom rule ${id}`); }
        rec.enabled = enabled === true;
        await setCustomRules(records);
        const applied = await applyCustomRules();
        return { applied: applied.applied };
    },

    async [MSG.getMyRules]() {
        const myRules = await getMyRules();
        return { permanent: myRules.permanent || [], temporary: myRules.temporary || [] };
    },

    async [MSG.setMyRules]({ permanent, temporary }) {
        const myRules = {
            permanent: (permanent || []).map(s => String(s).trim()).filter(Boolean),
            temporary: (temporary || []).map(s => String(s).trim()).filter(Boolean),
        };
        await setMyRules(myRules);
        const result = await applyMyRules();
        return { ...result, saved: true };
    },

    async [MSG.getSites]() {
        const [sites, modes] = await Promise.all([getSites(), getModes()]);
        return { sites, modes };
    },

    async [MSG.getFilterLists]() {
        return { filterLists: await getFilterLists() };
    },

    async [MSG.setFilterListEnabled]({ id, enabled }) {
        const fl = await getFilterLists();
        fl.builtin[id] = enabled === true;
        await setFilterLists(fl);
        const rs = await rulesetPolicy.apply();
        return { filterLists: fl, rulesets: rs };
    },

    async [MSG.getBudgets]() {
        return { budgets: await dynamicRules.getBudgets() };
    },

    async [MSG.getDynamicRules]() {
        return { rules: await dynamicRules.getOurRules() };
    },

    async [MSG.requestQuickFixUpdate]() {
        const settings = await getSettings();
        const qf = settings.quickFix;
        if (!qf.enabled || !qf.url) {
            return { updated: 0, note: 'Quick-fix channel is disabled or unconfigured (v1: bundled seed only).' };
        }
        const res = await fetch(qf.url).catch(() => null);
        if (!res || !res.ok) { throw new Error(`quick-fix fetch failed (${res?.status})`); }
        const lines = (await res.text()).split(/\r?\n/);
        const { rules, errors } = compileLines(lines, RULE_ID.quickFix[0]);
        const applied = await dynamicRules.applyRange(RULE_ID.quickFix, rules, 'dynamic');
        settings.quickFix = {
            ...qf, lastRun: Date.now(),
            lastETag: res.headers.get('etag') || '', lastCount: applied.applied,
        };
        await setSettings(settings);
        return { updated: applied.applied, errors: errors.slice(0, 10) };
    },

    async [MSG.clearQuickFixRules]() {
        const r = await dynamicRules.clearRange(RULE_ID.quickFix, 'dynamic');
        return { cleared: r.applied };
    },

    async [MSG.backup]() {
        const entries = await Promise.all(
            Object.entries(STORAGE_KEYS).filter(([, key]) => key !== STORAGE_KEYS.tabStats)
                .map(async ([, key]) => [key, await local.get(key, undefined)]));
        return {
            format: 1, extension: 'ethereals-n-ads',
            exportedAt: new Date().toISOString(),
            data: Object.fromEntries(entries.filter(([, v]) => v !== undefined)),
        };
    },

    async [MSG.restore]({ data }) {
        if (!data || typeof data !== 'object' || data.extension !== 'ethereals-n-ads') {
            throw new Error('Not an Ethereals N ADS backup file.');
        }
        const known = new Set(Object.values(STORAGE_KEYS));
        for (const [key, value] of Object.entries(data.data || {})) {
            if (!known.has(key)) { continue; }
            await local.set(key, value);
        }
        // re-derive every derived state from the restored storage
        await modeManager.apply();
        await rulesetPolicy.apply();
        await applyCustomRules();
        await applyMyRules();
        return { restored: true };
    },

    // ---- content scripts -----------------------------------------------------

    async [MSG.contentScriptReady]() {
        return { ok: true }; // no cosmetic engine in v1 — future injection ack
    },

    async [MSG.epickerCommit]({ filter }) {
        return handlers[MSG.addCustomRule]({ text: filter, source: 'picker' });
    },
};

/******************************************************************************/
// router
/******************************************************************************/

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handler = handlers[msg?.what];
    if (!handler) {
        sendResponse({ ok: false, error: `unknown message: ${msg?.what}` });
        return false;
    }
    handler(msg, sender)
        .then(data => sendResponse({ ok: true, ...data }))
        .catch(e => sendResponse({
            ok: false,
            error: String(e?.message || e),
        }));
    return true; // async response
});
