// site scriptlet manager (v2 slice) — part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

import { api, scripting } from './ext-compat.js';
import { getSettings } from './storage.js';
import { getGrantedOrigins } from './permissions.js';

// like ext-compat's call() but rejects — a failed registration must be
// visible (Diagnostics reads the recorded status)
export const SYNC_STATUS_KEY = 'scriptletSyncStatus';

function rawCall(fnPath, ...args) {
    const parts = fnPath.split('.');
    let obj = api;
    for (const p of parts.slice(0, -1)) { obj = obj?.[p]; }
    const fn = obj?.[parts.at(-1)];
    if (typeof fn !== 'function') { throw new Error(`API unavailable: ${fnPath}`); }
    return new Promise((resolve, reject) => {
        fn.call(obj, ...args, res => {
            const err = api.runtime.lastError;
            if (err) { reject(new Error(err.message)); } else { resolve(res); }
        });
    });
}

// the site bundles we ship — file paths are packaged in the extension.
// `hosts` are suffix-matched against navigation hostnames; `enabled` is
// the module gate (settings-only, permissions are checked separately).
const SITE_BUNDLES = [
    {
        id: 'eth-spotify',
        hosts: ['open.spotify.com'],
        file: '/scriptlets/site/spotify-patcher.js',
        enabled: s => s.modules?.spotify === true &&
                      s.modules?.spotifyNoticeAccepted === true,
    },
    {
        id: 'eth-youtube',
        hosts: ['youtube.com'],
        file: '/scriptlets/site/youtube-patcher.js',
        enabled: s => s.modules?.youtube !== false,
    },
];

function hostMatches(hostname, hosts) {
    return (hosts || []).some(h =>
        hostname === h || hostname.endsWith('.' + h));
}

function coversHost(origin, host) {
    // origin "*://*.example.com/*" → suffix-match example.com
    const m = origin.match(/^\*:\/\/(?:\*\.)?([^/*]+)/);
    if (!m) { return false; }
    const pat = m[1].toLowerCase();
    return host === pat || host.endsWith('.' + pat);
}

function bundleGranted(bundle, origins, allUrls) {
    return allUrls === true ||
        (origins || []).some(o => bundle.hosts.some(h => coversHost(o, h)));
}

// pure: (hostname, settings) → bundle files to inject on this navigation.
// Used by the Chromium path: webNavigation.onCommitted → executeScript
// (world MAIN) — the same architecture uBO/AdGuard use for web-player
// userscripts. Permission is not pre-checked here: executeScript fails
// loudly in the SW console when access is missing.
export function bundlesForHost(hostname, settings) {
    const out = [];
    for (const bundle of SITE_BUNDLES) {
        if (bundle.enabled(settings) && hostMatches(hostname, bundle.hosts)) {
            out.push(bundle.file);
        }
    }
    return out;
}

// pure: (settings, grantedOrigins, allUrls) → registration descriptors
export function computeRegistrations(settings, origins, allUrls) {
    const out = [];
    for (const bundle of SITE_BUNDLES) {
        if (!bundle.enabled(settings)) { continue; }
        if (!bundleGranted(bundle, origins, allUrls)) { continue; }
        out.push({
            id: bundle.id,
            matches: bundle.hosts.map(h => `*://${h}/*`),
            js: [bundle.file],
            world: 'MAIN',
            runAt: 'document_start',
            persistAcrossSessions: true,
        });
    }
    return out;
}

export async function sync() {
    const status = { at: new Date().toISOString(), ok: false, mode: null, ids: [], error: null };
    try {
        const settings = await getSettings();
        const { allUrls, origins } = await getGrantedOrigins();
        const desired = computeRegistrations(settings, origins, allUrls);

        const current = (await rawCall('scripting.getRegisteredContentScripts')) || [];
        const currentIds = new Set(current.map(s => s.id));
        const desiredIds = new Set(desired.map(r => r.id));

        const toRemove = current.filter(s => s.id.startsWith('eth-') && !desiredIds.has(s.id));
        const toAdd = desired.filter(r => !currentIds.has(r.id));
        const toUpdate = desired.filter(r => currentIds.has(r.id));

        if (toRemove.length !== 0) {
            await rawCall('scripting.unregisterContentScripts', { ids: toRemove.map(s => s.id) });
        }
        if (toAdd.length !== 0 || toUpdate.length !== 0) {
            try {
                // registerContentScripts upserts on id — covers both cases
                await rawCall('scripting.registerContentScripts', [...toAdd, ...toUpdate]);
                status.mode = 'persistent';
            } catch (e) {
                // Chromium can reject a PERSISTENT registration when the
                // match host is only an optional (runtime-granted)
                // permission — fall back to a session-scoped one; onStartup
                // re-registers it after every browser restart.
                await rawCall('scripting.registerContentScripts',
                    [...toAdd, ...toUpdate].map(r => ({ ...r, persistAcrossSessions: false })));
                status.mode = 'session';
            }
        }
        status.ok = true;
        status.ids = desired.map(r => r.id);
    } catch (e) {
        status.error = String(e?.message || e);
    }
    await new Promise(res => api.storage.session.set({ [SYNC_STATUS_KEY]: status }, res))
        .catch(() => { });
    return status;
}
