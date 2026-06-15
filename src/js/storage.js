// typed storage helpers - part of Ethereals N ADS (GPL-3.0).

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants.js';
import { api } from './ext-compat.js';

export const local = {
    get(key, fallback) {
        return api.storage.local.get([key]).then(o => {
            const v = o?.[key];
            return v === undefined ? fallback : v;
        });
    },
    async getWithDefaults(key, defaults) {
        const o = await api.storage.local.get([key]);
        const v = o?.[key];
        if (v === undefined || v === null || typeof v !== 'object') {
            return structuredClone(defaults);
        }
        return { ...structuredClone(defaults), ...v };
    },
    set(key, value) {
        return api.storage.local.set({ [key]: value });
    },
    remove(key) { return api.storage.local.remove([key]); },
};

export const session = {
    get(key, fallback) {
        return api.storage.session.get([key]).then(o => {
            const v = o?.[key];
            return v === undefined ? fallback : v;
        });
    },
    set(key, value) {
        return api.storage.session.set({ [key]: value });
    },
};

/******************************************************************************/

export async function getSettings() {
    const s = await local.getWithDefaults(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
    // deep-merge nested defaults (modules/quickFix/defaultToggles)
    s.defaultToggles = { ...DEFAULT_SETTINGS.defaultToggles, ...s.defaultToggles };
    s.modules = { ...DEFAULT_SETTINGS.modules, ...s.modules };
    s.quickFix = { ...DEFAULT_SETTINGS.quickFix, ...s.quickFix };
    return s;
}

export function setSettings(settings) {
    return local.set(STORAGE_KEYS.settings, settings);
}

export async function getModes() {
    const m = await local.get(STORAGE_KEYS.modes, null);
    if (m && Array.isArray(m.none) && Array.isArray(m.basic) &&
        Array.isArray(m.optimal) && Array.isArray(m.complete)) {
        return m;
    }
    return { none: [], basic: [], optimal: [], complete: [] };
}

export function setModes(modes) {
    return local.set(STORAGE_KEYS.modes, modes);
}

export async function getSites() {
    return await local.get(STORAGE_KEYS.sites, {}) || {};
}

export function setSites(sites) {
    return local.set(STORAGE_KEYS.sites, sites);
}

export async function getStats() {
    return await local.getWithDefaults(STORAGE_KEYS.stats, {
        total: 0,
        byCategory: { ads: 0, trackers: 0, cosmetic: 0, aab: 0 },
        bySite: {},
        history: [],
    });
}

export function setStats(stats) {
    return local.set(STORAGE_KEYS.stats, stats);
}

export async function getCustomRules() {
    return await local.get(STORAGE_KEYS.customRules, []) || [];
}

export function setCustomRules(rules) {
    return local.set(STORAGE_KEYS.customRules, rules);
}

export async function getMyRules() {
    const r = await local.get(STORAGE_KEYS.myRules, null);
    if (r && Array.isArray(r.permanent) && Array.isArray(r.temporary)) {
        return r;
    }
    return { permanent: [], temporary: [] };
}

export function setMyRules(myRules) {
    return local.set(STORAGE_KEYS.myRules, myRules);
}

export async function getFilterLists() {
    const fl = await local.get(STORAGE_KEYS.filterLists, null);
    if (fl && typeof fl.builtin === 'object' && Array.isArray(fl.custom)) {
        return fl;
    }
    return { builtin: {}, custom: [] };
}

export function setFilterLists(fl) {
    return local.set(STORAGE_KEYS.filterLists, fl);
}
