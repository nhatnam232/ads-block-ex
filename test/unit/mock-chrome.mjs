/*******************************************************************************
 * Ethereals N ADS — in-memory chrome.* mock for unit tests
 *
 * Import this FIRST in every test file: src/js/ext-compat.js captures
 * globalThis.chrome at module-evaluation time, so the mock must exist before
 * any src module is imported.
 *
 * Part of Ethereals N ADS, licensed GPL-3.0. Copyright (C) 2026 nhatnam232.
 ******************************************************************************/

// chrome.storage areas are dual-mode: callback-style OR promise-returning
// when the callback is omitted (Chrome 88+ / Firefox behavior our src code
// relies on). The mock supports both.
function makeStorageArea() {
    const map = new Map();
    const doGet = keys => {
        const out = {};
        const list = keys === null || keys === undefined
            ? [...map.keys()] : (Array.isArray(keys) ? keys : [keys]);
        for (const k of list) {
            if (map.has(k)) { out[k] = structuredClone(map.get(k)); }
        }
        return out;
    };
    const doSet = obj => {
        for (const [k, v] of Object.entries(obj)) { map.set(k, structuredClone(v)); }
    };
    const doRemove = keys => {
        for (const k of (Array.isArray(keys) ? keys : [keys])) { map.delete(k); }
    };
    return {
        map,
        get(keys, cb) {
            if (typeof cb === 'function') { cb(doGet(keys)); return; }
            return Promise.resolve(doGet(keys));
        },
        set(obj, cb) {
            doSet(obj);
            if (typeof cb === 'function') { cb(); return; }
            return Promise.resolve();
        },
        remove(keys, cb) {
            doRemove(keys);
            if (typeof cb === 'function') { cb(); return; }
            return Promise.resolve();
        },
        clear(cb) {
            map.clear();
            if (typeof cb === 'function') { cb(); return; }
            return Promise.resolve();
        },
    };
}

function makeRuleStore() {
    const state = { rules: [], calls: 0 };
    return {
        state,
        get(cb) { cb(structuredClone(state.rules)); },
        update({ removeRuleIds = [], addRules = [] }, cb) {
            state.calls++;
            const remove = new Set(removeRuleIds);
            state.rules = state.rules.filter(r => !remove.has(r.id));
            for (const rule of addRules) {
                state.rules = state.rules.filter(r => r.id !== rule.id);
                state.rules.push(structuredClone(rule));
            }
            state.rules.sort((a, b) => a.id - b.id);
            cb();
        },
    };
}

export const state = {
    local: makeStorageArea(),
    session: makeStorageArea(),
    dynamic: makeRuleStore(),
    sessionRules: makeRuleStore(),
    enabledRulesets: [],
    permissions: { origins: [] },
    alarms: [],
};

function cbStyle(fn) {
    return (...args) => {
        const cb = args.at(-1);
        Promise.resolve(fn(...args.slice(0, -1))).then(r => cb?.(r));
    };
}

globalThis.chrome = {
    runtime: {
        lastError: null,
        getURL: p => `chrome-extension://fake${p}`,
        sendMessage: cbStyle(() => ({ ok: true })),
        openOptionsPage: cbStyle(() => {}),
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} },
    },
    i18n: {
        getMessage: key => key ?? '',
        getUILanguage: () => 'en',
    },
    storage: {
        local: state.local,
        session: state.session,
    },
    alarms: {
        create: (name, info) => { state.alarms.push({ name, info }); },
        onAlarm: { addListener() {} },
    },
    tabs: {
        TAB_ID_NONE: -1,
        query: cbStyle(() => [{ id: 1, url: 'https://a.example.com/page' }]),
        get: cbStyle(() => ({ id: 1 })),
        update: cbStyle(() => {}),
        reload: cbStyle(() => { state.reloaded = (state.reloaded || 0) + 1; }),
        sendMessage: cbStyle(() => {}),
        onRemoved: { addListener() {} },
    },
    declarativeNetRequest: {
        MAX_NUMBER_OF_DYNAMIC_RULES: 4000,
        MAX_NUMBER_OF_SESSION_RULES: 4000,
        MAX_NUMBER_OF_REGEX_RULES: 900,
        MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 10,
        getDynamicRules: state.dynamic.get,
        updateDynamicRules: state.dynamic.update,
        getSessionRules: state.sessionRules.get,
        updateSessionRules: state.sessionRules.update,
        getEnabledRulesets: cb => { cb([...state.enabledRulesets]); },
        updateEnabledRulesets: ({ enableRulesetIds = [], disableRulesetIds = [] }, cb) => {
            state.enabledRulesets = [...new Set([
                ...state.enabledRulesets.filter(id => !disableRulesetIds.includes(id)),
                ...enableRulesetIds,
            ])];
            cb();
        },
        setExtensionActionOptions: (_o, cb) => cb?.(),
    },
    permissions: {
        contains: cbStyle(() => true),
        request: cbStyle(() => true),
        remove: cbStyle(() => true),
        getAll: cbStyle(() => ({ origins: [...state.permissions.origins] })),
    },
    action: {
        setBadgeText: (_o, cb) => cb?.(),
        setBadgeBackgroundColor: (_o, cb) => cb?.(),
    },
};

export function reset() {
    state.local.clear(() => {});
    state.session.clear(() => {});
    state.dynamic.state.rules = [];
    state.dynamic.state.calls = 0;
    state.sessionRules.state.rules = [];
    state.sessionRules.state.calls = 0;
    state.enabledRulesets = [];
    state.permissions.origins = [];
    state.alarms = [];
    state.reloaded = 0;
}
