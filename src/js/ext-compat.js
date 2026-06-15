// browser/API compatibility layer — part of Ethereals N ADS (GPL-3.0).

import { RUNTIME_CAPS } from './constants.js';

export const api = globalThis.browser ?? globalThis.chrome ?? chrome;

export const isFirefox = (() => {
    try { return typeof api.runtime.getBrowserInfo === 'function'; }
    catch { return false; }
})();

/*******************************************************************************
 * Promisified helpers (callback-style APIs on both browsers)
 ******************************************************************************/

export function call(fnPath, ...args) {
    const parts = fnPath.split('.');
    let obj = api;
    for (const p of parts.slice(0, -1)) { obj = obj?.[p]; }
    const fn = obj?.[parts.at(-1)];
    if (typeof fn !== 'function') {
        return Promise.reject(new Error(`API unavailable: ${fnPath}`));
    }
    return new Promise((resolve, reject) => {
        fn.call(obj, ...args, res => {
            const err = api.runtime.lastError;
            if (err) { reject(new Error(err.message)); } else { resolve(res); }
        });
    }).catch(e => { console.warn(`[ext] ${fnPath}:`, e.message); return undefined; });
}

export const tabs = {
    query: q => call('tabs.query', q),
    get: id => call('tabs.get', id),
    update: (id, props) => call('tabs.update', id, props),
    reload: id => call('tabs.reload', id),
    sendMessage: (id, msg) => call('tabs.sendMessage', id, msg),
};

export const dnr = {
    getDynamicRules: () => call('declarativeNetRequest.getDynamicRules'),
    updateDynamicRules: opts => call('declarativeNetRequest.updateDynamicRules', opts),
    getSessionRules: () => call('declarativeNetRequest.getSessionRules'),
    updateSessionRules: opts => call('declarativeNetRequest.updateSessionRules', opts),
    getEnabledRulesets: () => call('declarativeNetRequest.getEnabledRulesets'),
    updateEnabledRulesets: opts => call('declarativeNetRequest.updateEnabledRulesets', opts),
    getAvailableStaticRuleCount: () => call('declarativeNetRequest.getAvailableStaticRuleCount'),
    setExtensionActionOptions: opts => call('declarativeNetRequest.setExtensionActionOptions', opts),
};

export const scripting = {
    registerContentScripts: opts => call('scripting.registerContentScripts', opts),
    getRegisteredContentScripts: opts => call('scripting.getRegisteredContentScripts', opts),
    unregisterContentScripts: opts => call('scripting.unregisterContentScripts', opts),
    executeScript: opts => call('scripting.executeScript', opts),
};

export const permissionsApi = {
    contains: p => call('permissions.contains', p),
    request: p => call('permissions.request', p),
    remove: p => call('permissions.remove', p),
    getAll: () => call('permissions.getAll', {}),
};

export const action = {
    setBadgeText: o => call('action.setBadgeText', o),
    getBadgeText: o => call('action.getBadgeText', o),
    setBadgeBackgroundColor: o => call('action.setBadgeBackgroundColor', o),
};

/*******************************************************************************
 * Capability probing — never hardcode quotas; probe and Math.min with our
 * conservative floors (see constants.js rationale). Result is cached in
 * storage.session (cheap, survives SW restarts within a browser session).
 ******************************************************************************/

let capsCache = null;

export async function probeCaps() {
    if (capsCache) { return capsCache; }
    const d = api.declarativeNetRequest ?? {};
    const dynMax = typeof d.MAX_NUMBER_OF_DYNAMIC_RULES === 'number'
        ? d.MAX_NUMBER_OF_DYNAMIC_RULES : RUNTIME_CAPS.dynamicRules;
    const sessMax = typeof d.MAX_NUMBER_OF_SESSION_RULES === 'number'
        ? d.MAX_NUMBER_OF_SESSION_RULES : RUNTIME_CAPS.sessionRules;
    const regexMax = typeof d.MAX_NUMBER_OF_REGEX_RULES === 'number'
        ? d.MAX_NUMBER_OF_REGEX_RULES : RUNTIME_CAPS.regexRules;
    const enabledMax = typeof d.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS === 'number'
        ? d.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS : RUNTIME_CAPS.enabledRulesets;
    capsCache = {
        dynamicRules: Math.min(dynMax, RUNTIME_CAPS.dynamicRules),
        sessionRules: Math.min(sessMax, RUNTIME_CAPS.sessionRules),
        regexRules: Math.min(regexMax, RUNTIME_CAPS.regexRules),
        enabledRulesets: Math.min(enabledMax, RUNTIME_CAPS.enabledRulesets),
        isFirefox,
    };
    return capsCache;
}

/*******************************************************************************
 * userScripts availability (Chrome: gated by the "Allow User Scripts" toggle,
 * Chrome 138+; Firefox: optional permission, requested from the panel).
 ******************************************************************************/

export async function userScriptsAvailable() {
    const us = api.userScripts;
    if (!us || typeof us.getScripts !== 'function') { return false; }
    try { await new Promise((resolve, reject) => {
        us.getScripts(_ => {
            const err = api.runtime.lastError;
            if (err) { reject(err); } else { resolve();
            } });
    }); return true; }
    catch { return false; }
}

/*******************************************************************************
 * Badge: Chrome counts DNR matches natively (authoritative); Firefox has no
 * setExtensionActionOptions → we draw the badge ourselves from the tally.
 ******************************************************************************/

export async function initBadge() {
    if (!isFirefox) {
        await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true })
            .catch(() => { });
    } else {
        await action.setBadgeBackgroundColor({ color: '#0b3f9e' }).catch?.(() => { });
    }
}

export async function setFirefoxBadge(tabId, text) {
    if (!isFirefox) { return; }
    await action.setBadgeText({ tabId, text: text || '' }).catch?.(() => { });
}

/*******************************************************************************
 * JSON manifest details (ruleset metadata shipped by the build)
 ******************************************************************************/

let rulesetDetailsCache = null;

export async function getRulesetDetails() {
    if (rulesetDetailsCache) { return rulesetDetailsCache; }
    const url = api.runtime.getURL('/rulesets/ruleset-details.json');
    const res = await fetch(url);
    rulesetDetailsCache = await res.json();
    return rulesetDetailsCache;
}
