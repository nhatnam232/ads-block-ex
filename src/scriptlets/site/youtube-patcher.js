// YouTube ad patcher (MAIN world) — part of Ethereals N ADS (GPL-3.0).

(() => {
    const host = location.hostname;
    if (host !== 'www.youtube.com' && host !== 'm.youtube.com' &&
        host !== 'music.youtube.com' && host !== 'youtube.com') { return; }

    const stats = { injected: true, bodiesPruned: 0, jsonPruned: 0,
        requestsPruned: 0, ssapManifests: 0, ssaiSkips: 0,
        uaToken: null, uaAdvanced: 0,
        skipClicks: 0, overlaysHidden: 0 };
    try { Object.defineProperty(window, '__ethYouTube', { value: stats }); } catch { }
    document.documentElement.dataset.ethYouTube = '1';

    /**************************************************************************/
    // pruning
    /**************************************************************************/

    // ad-scheduling keys; pruning them wherever they appear is safe
    const AD_KEYS = new Set([
        'adPlacements', 'adSlots', 'playerAds',
        'adBreakHeartbeatParams', 'adSlotsHeartbeatParams',
    ]);

    function carriesAdKeys(obj) {
        return obj && typeof obj === 'object' &&
            ('adPlacements' in obj || 'adSlots' in obj || 'playerAds' in obj);
    }

    function pruneAdKeys(obj, depth = 0) {
        if (obj === null || typeof obj !== 'object' || depth > 10) { return obj; }
        if (Array.isArray(obj)) {
            for (const v of obj) { pruneAdKeys(v, depth + 1); }
            return obj;
        }
        for (const key of Object.keys(obj)) {
            if (AD_KEYS.has(key)) {
                // empty array keeps the schema; null where non-array expected
                obj[key] = Array.isArray(obj[key]) ? [] : null;
            } else {
                pruneAdKeys(obj[key], depth + 1);
            }
        }
        return obj;
    }

    function tamperJsonText(text) {
        // cut the adPlacements block before renaming — after the rename
        // there is no anchor left to match
        let out = text.replace(/"adPlacements[\s\S]*?("adSlots"|"adBreakHeartbeatParams")/g, '$1');
        // renamed keys make the player's parser skip the branch entirely
        out = out
            .replace(/"adPlacements"/g, '"no_ads"')
            .replace(/"adSlots"/g, '"no_ads"');
        if (out !== text) { return out; }
        // 3. structural fallback for JSON that survived the text pass
        try {
            const data = JSON.parse(text);
            if (!carriesAdKeys(data)) { return text; }
            return JSON.stringify(pruneAdKeys(data));
        } catch { return text; }
    }

    /**************************************************************************/
    // ytcfg client token — the "4-liner" family: appending a client-hint
    // token (; channel → ; lactmilli → ; instream → ; yahi) to the inner-tube
    // context userAgent makes the server return ad-free player responses.
    // uBO advances the ladder when ads leak through; we start at 'channel'.
    /**************************************************************************/

    const UA_LADDER = ['channel', 'lactmilli', 'instream', 'yahi'];
    let uaBase = null;
    let uaStep = 0;

    function applyUaToken() {
        const client = window.ytcfg?.data_?.INNERTUBE_CONTEXT?.client;
        if (!client) { return false; }
        if (uaBase === null) { uaBase = client.userAgent || ''; }
        const token = UA_LADDER.slice(0, uaStep + 1).map(t => `; ${t}`).join('');
        client.userAgent = uaBase + token;
        stats.uaToken = UA_LADDER[uaStep];
        return true;
    }

    const ytcfgTimer = setInterval(() => {
        if (applyUaToken()) {
            clearInterval(ytcfgTimer);
        }
    }, 50);
    setTimeout(() => clearInterval(ytcfgTimer), 15000);

    // advance the ladder when an SSAP ad actually shows up (uBO signal:
    // movie_player stats debug_info starting with "SSAP, AD") — then reload
    // the video through the player API so the new token takes effect
    setInterval(() => {
        try {
            const player = document.getElementById('movie_player');
            const statsForNerds = player?.getStatsForNerds?.();
            if (!statsForNerds?.debug_info?.startsWith('SSAP, AD')) { return; }
            if (uaStep >= UA_LADDER.length - 1) { return; }
            uaStep++;
            applyUaToken();
            stats.uaAdvanced = uaStep;
            const response = player.getPlayerResponse?.();
            const start = response?.playerConfig?.playbackStartConfig?.startSeconds ?? 0;
            const videoId = response?.videoDetails?.videoId;
            if (videoId) { player.loadVideoById?.(videoId, start); }
        } catch { /* player not ready */ }
    }, 2000);

    // outgoing player/next POST bodies carry the adSlots the CLIENT asks
    // for — drop them so the server never schedules client-side ads at all
    function tamperOutgoingJson(text) {
        try {
            const data = JSON.parse(text);
            if (!data || typeof data !== 'object' ||
                !('adSlots' in data || 'adConfig' in data)) { return text; }
            delete data.adSlots;
            delete data.adConfig;
            stats.requestsPruned++;
            return JSON.stringify(data);
        } catch { return text; }
    }

    /**************************************************************************/
    // SSAI skipper — server-stitched ads are marked as cue events inside the
    // DASH manifest (urn:google:youtube:ssap:cues). Parse them into time
    // ranges and seek the <video> past each one as it starts.
    /**************************************************************************/

    let adRanges = null; // [{start, end}] in seconds

    function captureSsap(text) {
        if (typeof text !== 'string' || !text.includes('ssap')) { return; }
        const stream = text.match(/schemeIdUri="urn:google:youtube:ssap:cues"([^>]*)>([\s\S]*?)<\/EventStream>/);
        if (!stream) { return; }
        const scaleMatch = stream[1].match(/timescale="(\d+)"/);
        const unitsPerSecond = Number(scaleMatch?.[1] || 1000);
        const ranges = [];
        for (const ev of stream[2].matchAll(/<Event[^>]*presentationTime="(\d+)"[^>]*duration="(\d+)"/g)) {
            const start = Number(ev[1]) / unitsPerSecond;
            const dur = Number(ev[2]) / unitsPerSecond;
            if (dur > 0) { ranges.push({ start, end: start + dur }); }
        }
        if (ranges.length !== 0) {
            stats.ssapManifests++;
            adRanges = ranges.sort((a, b) => a.start - b.start);
        }
    }

    function jumper() {
        if (adRanges === null) { return; }
        for (const video of document.querySelectorAll('video')) {
            const t = video.currentTime;
            for (const r of adRanges) {
                if (t >= r.start - 0.05 && t < r.end - 0.1 && r.end - t > 0.3) {
                    video.currentTime = r.end + 0.05;
                    stats.ssaiSkips++;
                    return;
                }
            }
        }
    }
    setInterval(jumper, 300);

    /**************************************************************************/
    // JSON.parse + Response.json wrappers (the classic json-prune surface)
    /**************************************************************************/

    const realParse = JSON.parse;
    JSON.parse = function (...args) {
        const out = realParse.apply(JSON, args);
        if (carriesAdKeys(out)) {
            stats.jsonPruned++;
            pruneAdKeys(out);
        }
        return out;
    };
    JSON.parse.toString = () => 'function parse() { [native code] }';

    const realJson = Response.prototype.json;
    Response.prototype.json = function (...args) {
        return realJson.apply(this, args).then(data => {
            if (carriesAdKeys(data)) {
                stats.jsonPruned++;
                pruneAdKeys(data);
            }
            return data;
        });
    };

    /**************************************************************************/
    // fetch + XHR hooks for /youtubei/ bodies
    /**************************************************************************/

    const realFetch = window.fetch;
    window.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

        // outgoing: strip adSlots from player/next POST bodies
        if (/youtubei\/v1\/(player|next)/.test(url)) {
            try {
                if (typeof args[0] === 'string' && args[1]?.body) {
                    const out = tamperOutgoingJson(args[1].body);
                    if (out !== args[1].body) { args[1].body = out; }
                } else if (args[0] instanceof Request) {
                    const req = args[0];
                    const body = await req.clone().text();
                    const out = tamperOutgoingJson(body);
                    if (out !== body) {
                        args[0] = new Request(req, { body: out });
                    }
                }
            } catch { /* send the original */ }
        }

        const res = await realFetch(...args);

        // incoming: any XML that smells like an SSAI manifest feeds the skipper
        try {
            const head = (await res.clone().text()).slice(0, 200000);
            captureSsap(head);
        } catch { /* not text */ }

        if (!/youtubei\/v1\/(player|next|browse|get_watch)|\/player\?|\/playlist\?/.test(url)) { return res; }
        try {
            const text = await res.clone().text();
            const out = tamperJsonText(text);
            if (out !== text) {
                stats.bodiesPruned++;
                return new Response(out, {
                    status: res.status, statusText: res.statusText,
                    headers: res.headers,
                });
            }
        } catch { /* fall through */ }
        return res;
    };

    const XO = XMLHttpRequest.prototype;
    const realOpen = XO.open;
    XO.open = function (method, url, ...rest) {
        this.__eth_url = String(url || '');
        this.__eth_method = String(method || 'GET').toUpperCase();
        return realOpen.call(this, method, url, ...rest);
    };
    const realSend = XO.send;
    XO.send = function (body) {
        const isApi = /youtubei\/v1\/(player|next|browse|get_watch)|\/playlist\?/.test(this.__eth_url || '');

        // outgoing: strip adSlots from POST bodies
        if (/youtubei\/v1\/(player|next)/.test(this.__eth_url || '') &&
            this.__eth_method === 'POST' && typeof body === 'string') {
            const out = tamperOutgoingJson(body);
            if (out !== body) { body = out; }
        }

        const watch = isApi || this.__eth_method === 'GET';
        if (!watch) { return realSend.call(this, body); }
        let rewritten = null;
        this.addEventListener('readystatechange', () => {
            if (this.readyState !== 4) { return; }
            try {
                // SSAI manifests arrive as XML over XHR too
                if (this.responseType === '' || this.responseType === 'text') {
                    captureSsap(this.responseText);
                }
                if (!isApi || rewritten !== null) { return; }
                const out = tamperJsonText(this.responseText);
                if (out !== this.responseText) {
                    rewritten = out;
                    stats.bodiesPruned++;
                    Object.defineProperty(this, 'responseText',
                        { get: () => rewritten, configurable: true });
                    Object.defineProperty(this, 'response', {
                        get: () => this.responseType === '' || this.responseType === 'text'
                            ? rewritten : this.response,
                        configurable: true,
                    });
                }
            } catch { /* leave untouched */ }
        }, { capture: true });
        return realSend.call(this, body);
    };

    /**************************************************************************/
    // DOM fallback — skip leaked ads, hide their chrome
    /**************************************************************************/

    const SKIP_BTN = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button';
    const AD_CHROME = [
        '.ytp-ad-image-overlay', '.ytp-ad-text-overlay', '.ytp-ad-progress',
        '.ytp-ad-player-overlay', '.ytp-ad-player-overlay-layout',
        '.ytp-ad-overlay-close-container',
    ].join(', ');

    function onAdDom() {
        const skip = document.querySelector(SKIP_BTN);
        if (skip && skip.offsetParent !== null) {
            skip.click();
            stats.skipClicks++;
        }
        for (const el of document.querySelectorAll(AD_CHROME)) {
            if (el.style?.display !== 'none') {
                el.style.display = 'none';
                stats.overlaysHidden++;
            }
        }
    }
    const observer = new MutationObserver(onAdDom);
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        }, { once: true });
    }
})();
