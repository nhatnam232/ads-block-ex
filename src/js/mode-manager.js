// per-site filtering modes (uBOL semantics) - part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

import { api } from './ext-compat.js';
import { PRIORITY, RULE_ID, MODES } from './constants.js';
import { getModes, setModes, getSettings } from './storage.js';
import * as dynamicRules from './dynamic-rules.js';

function labels(host) { return host === 'all-urls' ? 0 : host.split('.').length; }

function matches(host, pattern) {
    if (pattern === 'all-urls') { return true; }
    return host === pattern || host.endsWith('.' + pattern);
}

export async function effectiveMode(hostname) {
    if (!hostname) { return 'basic'; }
    const [modes, settings] = await Promise.all([getModes(), getSettings()]);
    let best = null; // { mode, labels }
    for (const mode of MODES) {
        for (const pattern of modes[mode]) {
            if (matches(hostname, pattern)) {
                const n = labels(pattern);
                if (best === null || n > best.labels) { best = { mode, labels: n }; }
            }
        }
    }
    return best ? best.mode : settings.defaultMode;
}

// remove host from all lists; returns mutated modes
function removeFromAll(modes, host) {
    for (const mode of MODES) {
        modes[mode] = modes[mode].filter(h => h !== host);
    }
}

function descendantsOf(modes, host) {
    const suffix = '.' + host;
    const out = new Set();
    for (const mode of MODES) {
        for (const h of modes[mode]) {
            if (h.endsWith(suffix)) { out.add(h); }
        }
    }
    return out;
}

export async function setSiteMode(hostname, mode) {
    if (!MODES.includes(mode)) { throw new Error(`bad mode: ${mode}`); }
    const modes = await getModes();
    removeFromAll(modes, hostname);
    if (mode === 'none') {
        // no-filtering dominates subdomains: prune descendants from all lists
        for (const d of descendantsOf(modes, hostname)) { removeFromAll(modes, d); }
    }
    if (!modes[mode].includes(hostname)) {
        modes[mode].push(hostname);
    }
    await setModes(modes);
    await apply();
    return true;
}

// drop every trace of a host so it falls back to settings.defaultMode
export async function forgetHost(hostname) {
    const modes = await getModes();
    removeFromAll(modes, hostname);
    await setModes(modes);
    await apply();
    return true;
}

/******************************************************************************/

const TRUSTED = PRIORITY.modeAllow;

export async function apply() {
    const modes = await getModes();
    const none = [...new Set(modes.none)].sort();

    const dynamic = [];
    const session = [];
    if (none.length !== 0) {
        dynamic.push({
            id: RULE_ID.modeAllowDynamic,
            priority: TRUSTED,
            action: { type: 'allowAllRequests' },
            condition: { resourceTypes: ['main_frame'], requestDomains: none },
        });
        session.push({
            id: RULE_ID.modeAllowSession,
            priority: TRUSTED,
            action: { type: 'allow' },
            condition: { tabIds: [api.tabs.TAB_ID_NONE], initiatorDomains: none },
        });
    }
    await dynamicRules.applyModeRules(dynamic, session);
}

/******************************************************************************/

// defaults for a fresh install (mirrors uBOL: optimal everywhere, gated by
// host permissions in practice — ungranted sites effectively run 'basic')
export async function seedDefaults() {
    const modes = await getModes();
    if (modes.optimal.length === 0 && modes.basic.length === 0 &&
        modes.none.length === 0 && modes.complete.length === 0) {
        modes.optimal = ['all-urls'];
        await setModes(modes);
    }
}
