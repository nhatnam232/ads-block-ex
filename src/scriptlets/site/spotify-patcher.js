// Spotify web-player ad patcher v2 (MAIN world) — part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

(() => {
    if (location.hostname !== 'open.spotify.com') { return; }

    const stats = { injected: true, machinesSeen: 0, machinesFromFetch: 0, machinesFromXhr: 0,
        machinesFromWs: 0, adsRewired: 0, adsJumped: 0,
        wsFrames: 0, wsAdTracksNulled: 0, prunedResponses: 0,
        nowPlayingHref: '', nowPlayingLabel: '' };
    // debug capture — the last few raw machines + now-playing widget state,
    // so the exact shape of an ad state can be read right off the console
    const machineDump = [];
    stats.machinesDump = machineDump;
    function captureMachine(sm, source) {
        try {
            machineDump.unshift(`[${source}] ` + JSON.stringify(sm).slice(0, 3500));
            if (machineDump.length > 4) { machineDump.length = 4; }
        } catch { }
    }
    setInterval(() => {
        try {
            const link = document.querySelector('[data-testid="context-item-link"]');
            if (link) {
                stats.nowPlayingHref = link.href || '';
                stats.nowPlayingLabel = (link.textContent || '').slice(0, 80);
            }
        } catch { }
    }, 3000);
    try { Object.defineProperty(window, '__ethSpotify', { value: stats }); } catch { }
    document.documentElement.dataset.ethSpotify = '1';

    /**************************************************************************/
    // state-machine helpers
    /**************************************************************************/

    const adUri = uri => typeof uri === 'string' && uri.includes(':ad:');

    function trackOf(sm, state) {
        if (!state || typeof state.track !== 'number') { return null; }
        return (sm.tracks || [])[state.track] || null;
    }

    // observed 2026-09: uri lives at metadata.uri; content_type is "AD"
    function isAdTrackEntry(t) {
        if (!t) { return false; }
        if (t.content_type === 'AD') { return true; }
        return adUri(t.metadata?.uri || t.uri);
    }

    function isAdState(sm, state) {
        if (!state) { return false; }
        if (String(state.state_id || '').includes('filler')) { return false; }
        return isAdTrackEntry(trackOf(sm, state));
    }

    function advanceIndex(state) {
        return state?.transitions?.advance?.state_index;
    }

    // follow advance transitions from an ad state until a non-ad state
    function nextAdFreeIndex(sm, from) {
        let idx = from;
        for (let guard = 0; idx != null && guard < 64; guard++) {
            const st = sm.states?.[idx];
            if (!st || !isAdState(sm, st)) { return idx; }
            idx = advanceIndex(st);
        }
        return null;
    }

    function trackDurationMs(t) {
        return t?.metadata?.duration || t?.length_milliseconds ||
            t?.duration_ms || t?.duration || 30000;
    }

    // core: rewire + jump-to-end. Returns how many ad states were handled.
    function manipulateStateMachine(sm) {
        if (!sm || !Array.isArray(sm.states) || sm.states.length === 0) { return 0; }
        let handled = 0;

        // 1. redirect every transition that ENTERS an ad state
        for (const state of sm.states) {
            const tr = state?.transitions;
            if (!tr) { continue; }
            for (const key of Object.keys(tr)) {
                const target = tr[key]?.state_index;
                if (typeof target !== 'number') { continue; }
                const targetState = sm.states[target];
                if (!isAdState(sm, targetState)) { continue; }
                const free = nextAdFreeIndex(sm, target);
                if (typeof free === 'number') {
                    tr[key].state_index = free;
                    stats.adsRewired++;
                    handled++;
                }
            }
        }

        // 2. any ad state still reachable (starting state, all-ads chains):
        //    play it from its own end — instant, no server round-trip
        for (const state of sm.states) {
            if (!isAdState(sm, state)) { continue; }
            const dur = trackDurationMs(trackOf(sm, state)) || 30000;
            state.initial_playback_position = dur;
            state.position_offset = { as_of_timestamp: 0, offset: dur };
            if (state.restrictions) {
                state.restrictions = { restrict_up: true, restrict_down: true,
                    restrict_next: true, restrict_prev: true };
            }
            stats.adsJumped++;
            handled++;
        }
        return handled;
    }

    // parse + tamper any parsed body containing a state machine
    function tamperStateJson(text, source) {
        try {
            const data = JSON.parse(text);
            let out = text;
            if (data?.state_machine) {
                stats.machinesSeen++;
                stats['machinesFrom' + source]++;
                captureMachine(data.state_machine, source);
                if (manipulateStateMachine(data.state_machine) > 0) {
                    out = JSON.stringify(data);
                }
            }
            // state-conflict bodies carry replace_state commands
            if (Array.isArray(data?.commands)) {
                let touched = false;
                for (const cmd of data.commands) {
                    const sm = cmd?.command?.endpoint === 'replace_state'
                        ? cmd.command.state_machine
                        : cmd?.state_machine;
                    if (sm) {
                        stats.machinesSeen++;
                        stats['machinesFrom' + source]++;
                        captureMachine(sm, source);
                        if (manipulateStateMachine(sm) > 0) { touched = true; }
                    }
                }
                if (touched) { out = JSON.stringify(data); }
            }
            return out;
        } catch { return text; }
    }

    /**************************************************************************/
    // WebSocket hook — replace_state frames + ads/inject_tracks nulling
    /**************************************************************************/

    const RealWebSocket = window.WebSocket;
    const hookListeners = (ws) => {
        const wrap = (listener) => (ev) => {
            try {
                const tampered = tamperWsFrame(ev.data);
                if (tampered !== undefined && tampered !== ev.data) {
                    listener(new MessageEvent(ev.type, { data: tampered }));
                    return;
                }
            } catch { /* never break the player */ }
            listener(ev);
        };
        const origAdd = ws.addEventListener.bind(ws);
        ws.addEventListener = (type, listener, ...rest) => {
            if (type === 'message' && typeof listener === 'function') {
                return origAdd(type, wrap(listener), ...rest);
            }
            return origAdd(type, listener, ...rest);
        };
        // route the onmessage property through the same wrapper via the
        // native prototype setter
        const realSetter =
            Object.getOwnPropertyDescriptor(RealWebSocket.prototype, 'onmessage')?.set;
        let wrapped = null;
        Object.defineProperty(ws, 'onmessage', {
            get: () => wrapped,
            set: (fn) => {
                wrapped = typeof fn === 'function' ? wrap(fn) : fn;
                realSetter?.call(ws, wrapped);
            },
            configurable: true,
        });
    };

    function tamperWsFrame(data) {
        if (typeof data !== 'string' || !data.startsWith('{')) { return undefined; }
        let json;
        try { json = JSON.parse(data); } catch { return undefined; }
        if (!json || !Array.isArray(json.payloads)) { return undefined; }
        stats.wsFrames++;
        let touched = false;
        for (const payload of json.payloads) {
            // Spotify declares its own ad injection in the cluster state
            const ps = payload?.cluster?.player_state;
            if (ps && (ps.provider === 'ads/inject_tracks' ||
                       (ps.track && adUri(ps.track.uri)))) {
                ps.track = null;
                stats.wsAdTracksNulled++;
                touched = true;
            }
            const sm = payload?.type === 'replace_state'
                ? payload.state_machine
                : payload?.state_machine;
            if (sm) {
                stats.machinesSeen++;
                stats.machinesFromWs++;
                captureMachine(sm, 'Ws');
                if (manipulateStateMachine(sm) > 0) { touched = true; }
            }
        }
        return touched ? JSON.stringify(json) : data;
    }

    window.WebSocket = function (url, protocols) {
        const ws = protocols === undefined
            ? new RealWebSocket(url)
            : new RealWebSocket(url, protocols);
        hookListeners(ws);
        return ws;
    };
    window.WebSocket.prototype = RealWebSocket.prototype;
    window.WebSocket.OPEN = RealWebSocket.OPEN;
    window.WebSocket.CLOSED = RealWebSocket.CLOSED;

    /**************************************************************************/
    // fetch hook — /state responses carry the state machine
    /**************************************************************************/

    const realFetch = window.fetch;
    window.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const res = await realFetch(...args);
        if (!/spotify\.com/.test(url) || !/\/state/.test(url)) { return res; }

        try {
            const text = await res.clone().text();
            const out = tamperStateJson(text, 'Fetch');
            if (out !== text) {
                stats.prunedResponses++;
                return new Response(out, {
                    status: res.status, statusText: res.statusText,
                    headers: res.headers,
                });
            }
        } catch { /* fall through */ }
        return res;
    };

    /**************************************************************************/
    // XHR hook — parts of the player still use XMLHttpRequest for /state

    const XO = XMLHttpRequest.prototype;
    const realOpen = XO.open;
    XO.open = function (method, url, ...rest) {
        this.__eth_url = String(url || '');
        return realOpen.call(this, method, url, ...rest);
    };
    const realSend = XO.send;
    XO.send = function (body) {
        if (!/spotify\.com/.test(this.__eth_url || '') || !/\/state/.test(this.__eth_url)) {
            return realSend.call(this, body);
        }
        let rewritten = null;
        const define = () => {
            if (rewritten === null) { return; }
            try {
                Object.defineProperty(this, 'responseText', { get: () => rewritten, configurable: true });
                Object.defineProperty(this, 'response', {
                    get: () => this.responseType === '' || this.responseType === 'text'
                        ? rewritten : this.response,
                    configurable: true,
                });
            } catch { /* best effort */ }
        };
        this.addEventListener('readystatechange', () => {
            if (this.readyState !== 4 || rewritten !== null) { return; }
            try {
                const out = tamperStateJson(this.responseText, 'Xhr');
                if (out !== this.responseText) {
                    rewritten = out;
                    stats.prunedResponses++;
                    define();
                }
            } catch { /* leave untouched */ }
        }, { capture: true });
        return realSend.call(this, body);
    };
})();
