// host-permission tracking - part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

import { permissionsApi } from './ext-compat.js';

export async function getGrantedOrigins() {
    const all = await permissionsApi.getAll();
    const origins = all?.origins || [];
    return {
        allUrls: origins.includes('<all_urls>'),
        origins,
    };
}

function originToPattern(origin) {
    // *://*.example.com/* → .example.com (suffix matcher)
    const m = origin.match(/^\*:\/\/(?:\*\.)?([^/*]+)/);
    return m ? m[1].toLowerCase() : '';
}

export async function canInjectHost(hostname) {
    if (!hostname) { return false; }
    const { allUrls, origins } = await getGrantedOrigins();
    if (allUrls) { return true; }
    for (const o of origins) {
        const pat = originToPattern(o);
        if (!pat) { continue; }
        if (hostname === pat || hostname.endsWith('.' + pat)) { return true; }
    }
    return false;
}

// must be called from a user gesture context (popup), not from the SW
export async function requestOriginInPopup(hostname) {
    return permissionsApi.request({ origins: [`*://*.${hostname}/*`] })
        .then(() => true).catch(() => false);
}

export async function requestOrigin(hostname) {
    try { return await permissionsApi.request({ origins: [`*://*.${hostname}/*`] }); }
    catch { return false; }
}
