// popup logic (VPN-style hero + controls) — part of Ethereals N ADS (GPL-3.0).

import { MSG, MODES } from '../js/constants.js';
import { api, permissionsApi, tabs } from '../js/ext-compat.js';

const $ = sel => document.querySelector(sel);

function send(what, payload = {}) {
    return new Promise((resolve, reject) => {
        api.runtime.sendMessage({ what, ...payload }, res => {
            const err = api.runtime.lastError;
            if (err) { reject(new Error(err.message)); }
            else if (res && res.ok === false) { reject(new Error(res.error)); }
            else { resolve(res); }
        });
    });
}

function i18n() {
    for (const el of document.querySelectorAll('[data-i18n]')) {
        const msg = api.i18n.getMessage(el.dataset.i18n);
        if (msg) { el.textContent = msg; }
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
        const msg = api.i18n.getMessage(el.dataset.i18nTitle);
        if (msg) { el.title = msg; }
    }
    document.documentElement.lang = api.i18n.getUILanguage?.() || 'en';
}

// stat-tile auto-compact: 999 → 999, 1200 → 1.2K, 3400000 → 3.4M
function compactNum(n) {
    if (n < 1000) { return String(n); }
    if (n < 1_000_000) {
        const v = n / 1000;
        return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}K`;
    }
    return `${Math.round((n / 1_000_000) * 10) / 10}M`;
}

let state = null;

function render() {
    const d = state;
    $('#host').textContent = d.tab.hostname || '—';
    $('#host').title = d.tab.url;

    const locked = d.isBrowserUI || !d.tab.hostname;
    $('#browserWarning').hidden = !locked;
    $('#content').style.visibility = locked ? 'hidden' : 'visible';
    if (locked) { return; }

    // hero — power circle reflects "filtering active on this site"
    const on = d.mode !== 'none';
    const power = $('#powerBtn');
    power.setAttribute('aria-pressed', String(on));
    power.title = api.i18n.getMessage(on ? 'popup_powerOff' : 'popup_powerOn') || '';
    $('#powerState').textContent = api.i18n.getMessage(
        on ? 'popup_statusOn' : 'popup_statusOff') || '';
    $('#blockedCount').textContent = compactNum(d.blockedOnPage || 0);
    const total = compactNum(d.blockedTotal || 0);
    $('#blockedTotal').textContent =
        api.i18n.getMessage('popup_lifetime', [total]) || `${total} all time`;

    $('#grantSection').hidden = d.canInject || !on || d.mode === 'basic';

    for (const btn of document.querySelectorAll('.seg')) {
        btn.classList.toggle('active', btn.dataset.mode === d.mode);
        btn.title = api.i18n.getMessage(`mode_${btn.dataset.mode}_desc`) || '';
    }

    $('#adsLevel').value = d.toggles.ads === 'aggressive' ? 'aggressive' : 'standard';
    $('#tglAab').checked = d.toggles.aab !== false;
    $('#tglAnnoyances').checked = d.toggles.annoyances === true;

    $('#pauseSiteBtn').classList.toggle('on', d.paused);
    $('#pauseEverywhereBtn').classList.toggle('on', d.pausedEverywhere);

    const list = $('#recentList');
    list.textContent = '';
    const blocks = d.recentBlocks || [];
    $('#recentEmpty').hidden = blocks.length !== 0;
    for (const b of blocks.slice(0, 12)) {
        const li = document.createElement('li');
        const host = document.createElement('span');
        host.textContent = b.host;
        host.title = `${b.type} · ${b.rulesetId}`;
        const cat = document.createElement('span');
        cat.className = 'cat';
        cat.textContent = b.category;
        li.append(host, cat);
        list.append(li);
    }
}

async function refresh() {
    state = await send(MSG.getPopupData);
    render();
}

/******************************************************************************/
// wiring
/******************************************************************************/

// the big circle: toggle filtering for THIS site (VPN-app semantics).
// On → 'none'; Off → restore what the site ran on before (background
// remembers it as sites[host].lastMode), falling back to 'optimal'.
function onPowerToggle() {
    if (!state?.tab?.hostname) { return; }
    const on = state.mode !== 'none';
    const next = on ? 'none' : (MODES.includes(state.lastMode) ? state.lastMode : 'optimal');
    send(MSG.setMode, {
        hostname: state.tab.hostname,
        mode: next,
        tabId: state.tab.id,
    }).then(refresh).catch(console.error);
}

function onModeClick(mode) {
    if (!state?.tab?.hostname || state.tab.hostname === '') { return; }
    send(MSG.setMode, {
        hostname: state.tab.hostname,
        mode,
        tabId: state.tab.id,
    }).then(refresh).catch(console.error);
}

async function onGrant() {
    if (!state?.tab?.hostname) { return; }
    const btn = $('#grantBtn');
    const note = $('#grantResult');
    btn.disabled = true;
    note.textContent = '';
    // must stay in the click gesture — do not await anything first
    const granted = await permissionsApi.request({
        origins: [`*://*.${state.tab.hostname}/*`],
    }).then(() => true).catch(() => false);
    if (granted) {
        note.textContent = api.i18n.getMessage('popup_grantOk') || 'Granted — reloading…';
        // A host-permission change can tear down the SW message channel:
        // refresh() may never answer, so never wait on it — reload the tab
        // (the patcher registers via permissions.onAdded in the background)
        // and close the popup.
        tabs.reload(state.tab.id).catch?.(() => { });
        setTimeout(() => window.close(), 700);
        return;
    }
    note.textContent = api.i18n.getMessage('popup_grantFail') ||
        'No prompt appeared? Grant it manually: edge://extensions → Ethereals N ADS → Site access → On specific sites → add this site.';
    btn.disabled = false;
}

function init() {
    i18n();

    $('#powerBtn').addEventListener('click', onPowerToggle);
    for (const btn of document.querySelectorAll('.seg')) {
        btn.addEventListener('click', () => onModeClick(btn.dataset.mode));
    }

    $('#grantBtn').addEventListener('click', onGrant);

    $('#adsLevel').addEventListener('change', e => {
        send(MSG.setToggles, { toggles: { ads: e.target.value } })
            .then(refresh).catch(console.error);
    });
    $('#tglAab').addEventListener('change', e => {
        send(MSG.setToggles, { toggles: { aab: e.target.checked } })
            .then(refresh).catch(console.error);
    });
    $('#tglAnnoyances').addEventListener('change', e => {
        send(MSG.setToggles, { toggles: { annoyances: e.target.checked } })
            .then(refresh).catch(console.error);
    });

    $('#pauseSiteBtn').addEventListener('click', () => {
        send(MSG.pauseSite, {
            hostname: state.tab.hostname,
            tabId: state.tab.id,
        }).then(refresh).catch(console.error);
    });
    $('#pauseEverywhereBtn').addEventListener('click', () => {
        send(MSG.pauseEverywhere, { tabId: state.tab.id })
            .then(refresh).catch(console.error);
    });

    $('#optionsBtn').addEventListener('click', () => {
        api.runtime.openOptionsPage?.();
    });

    refresh().catch(e => {
        $('#host').textContent = 'error';
        console.error(e);
    });
}

init();
