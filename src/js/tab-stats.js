// per-tab block tallies + durable stats — part of Ethereals N ADS (GPL-3.0).

import { RULESET_GROUPS, STORAGE_KEYS } from './constants.js';
import { api, isFirefox } from './ext-compat.js';
import { session, getStats, setStats } from './storage.js';

const RING_MAX = 50;
const FLUSH_EVERY = 25; // durable-stat writes per this many recorded matches

// ruleset id → stats category (byCategory keys are fixed in storage.js)
const CATEGORY_BY_RULESET = {
    'easyprivacy': 'trackers',
    'pgl': 'trackers',
    'aab-1': 'aab',
};

function categoryFor(rulesetId) {
    if (CATEGORY_BY_RULESET[rulesetId]) { return CATEGORY_BY_RULESET[rulesetId]; }
    const group = RULESET_GROUPS[rulesetId];
    return group === 'aab' ? 'aab' : 'ads';
}

function hostOf(url) {
    try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

let pending = 0;

async function flushDurable(delta) {
    const stats = await getStats();
    stats.total += delta.total;
    for (const [cat, n] of Object.entries(delta.byCategory)) {
        stats.byCategory[cat] = (stats.byCategory[cat] || 0) + n;
    }
    for (const [host, n] of Object.entries(delta.byHost)) {
        const site = stats.bySite[host] || { count: 0, lastSeen: 0 };
        site.count += n;
        site.lastSeen = Date.now();
        stats.bySite[host] = site;
    }
    await setStats(stats);
}

export async function recordMatch(info) {
    const req = info?.request;
    if (!req || req.tabId === undefined || req.tabId < 0) { return; }
    const category = categoryFor(req.rulesetId);
    const item = {
        host: hostOf(req.url),
        type: req.type || 'other',
        category,
        rulesetId: req.rulesetId || '',
        ts: Date.now(),
    };

    const all = await session.get(STORAGE_KEYS.tabStats, {}) || {};
    const tab = all[req.tabId] || { url: req.documentUrl || '', ads: 0, trackers: 0, cosmetic: 0, aab: 0, total: 0, ring: [] };
    if (req.documentUrl && tab.url !== req.documentUrl) {
        // navigation happened since the last tally — start a fresh page scope
        tab.url = req.documentUrl;
        tab.ring = [];
        Object.assign(tab, { ads: 0, trackers: 0, cosmetic: 0, aab: 0, total: 0 });
    }
    if (category in tab) { tab[category]++; }
    tab.total++;
    tab.ring.push(item);
    if (tab.ring.length > RING_MAX) { tab.ring = tab.ring.slice(-RING_MAX); }
    all[req.tabId] = tab;
    await session.set(STORAGE_KEYS.tabStats, all);

    // durable aggregate, throttled
    pending++;
    if (pending >= FLUSH_EVERY) {
        pending = 0;
        await flushDurable({
            total: FLUSH_EVERY,
            byCategory: { [category]: FLUSH_EVERY }, // approximate split —
            byHost: { [item.host]: FLUSH_EVERY },    // exact split kept in
        });                                          // session ring above
    }
}

export async function getTabStats(tabId) {
    const all = await session.get(STORAGE_KEYS.tabStats, {}) || {};
    return all[tabId] || null;
}

export async function getRecentBlocks(tabId) {
    const tab = await getTabStats(tabId);
    return tab?.ring ? [...tab.ring].reverse() : [];
}

export function pruneTab(tabId) {
    return session.get(STORAGE_KEYS.tabStats, {}).then(all => {
        if (!all || !(tabId in all)) { return; }
        delete all[tabId];
        return session.set(STORAGE_KEYS.tabStats, all);
    });
}

// register the Chrome debug signal (no-op elsewhere). Must be called from
// the background top level so events aren't missed after a SW wake.
export function registerMatchTracker() {
    if (isFirefox) { return; }
    const dnrApi = api.declarativeNetRequest;
    if (typeof dnrApi?.onRuleMatchedDebug?.addListener !== 'function') { return; }
    try {
        dnrApi.onRuleMatchedDebug.addListener(recordMatch);
    } catch {
        // permission not granted (release builds) — tallies simply stay off
    }
}
