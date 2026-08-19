// options-page logic — part of Ethereals N ADS (GPL-3.0).

import { MSG, RULESET_GROUPS } from '../js/constants.js';
import { api } from '../js/ext-compat.js';
import * as scriptletManager from '../js/scriptlet-manager.js';

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
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
        const msg = api.i18n.getMessage(el.dataset.i18nPlaceholder);
        if (msg) { el.placeholder = msg; }
    }
    document.documentElement.lang = api.i18n.getUILanguage?.() || 'en';
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

let saveTimer = 0;

function noteSaved() {
    const el = $('#saveNote');
    el.textContent = api.i18n.getMessage('opt_saved') || 'Saved';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}

function patchSettings(patch) {
    return send(MSG.setSettings, { settings: patch })
        .then(noteSaved)
        .catch(e => { $('#saveNote').textContent = `⚠ ${e.message}`; });
}

/******************************************************************************/
// tabs
/******************************************************************************/

function showTab(name) {
    for (const btn of document.querySelectorAll('#tabs button')) {
        btn.classList.toggle('active', btn.dataset.tab === name);
    }
    for (const panel of document.querySelectorAll('.panel')) {
        panel.hidden = panel.id !== `tab-${name}`;
    }
    location.hash = name;
}

/******************************************************************************/
// settings tab
/******************************************************************************/

function fillSettings(s) {
    $('#defaultMode').value = s.defaultMode;
    $('#autoReload').checked = s.autoReload;
    $('#badgeEnabled').checked = s.badgeEnabled;
    $('#debugLogging').checked = s.debugLogging;
    $('#aabProfile').value = s.aabProfile;
    $('#moduleYoutube').checked = s.modules.youtube !== false;
    $('#moduleSpotify').checked = s.modules.spotify === true;
    $('#spotifyAccept').disabled = s.modules.spotifyNoticeAccepted === true;
    $('#qfEnabled').checked = s.quickFix.enabled;
    $('#qfUrl').value = s.quickFix.url;
    $('#qfInterval').value = s.quickFix.intervalHours;
}

async function initSettingsTab() {
    const { settings } = await send(MSG.getSettings);
    fillSettings(settings);
    syncQuickfixEnabled();

    $('#defaultMode').addEventListener('change', e => patchSettings({ defaultMode: e.target.value }));
    $('#autoReload').addEventListener('change', e => patchSettings({ autoReload: e.target.checked }));
    $('#badgeEnabled').addEventListener('change', e => patchSettings({ badgeEnabled: e.target.checked }));
    $('#debugLogging').addEventListener('change', e => patchSettings({ debugLogging: e.target.checked }));
    $('#aabProfile').addEventListener('change', e => patchSettings({ aabProfile: e.target.value }));
    $('#moduleYoutube').addEventListener('change', e =>
        patchSettings({ modules: { youtube: e.target.checked } }));
    $('#moduleSpotify').addEventListener('change', e =>
        patchSettings({ modules: { spotify: e.target.checked } }));
    $('#spotifyAccept').addEventListener('click', () =>
        patchSettings({ modules: { spotifyNoticeAccepted: true } }).then(refreshSpotifyGate));
    $('#qfEnabled').addEventListener('change', e => {
        syncQuickfixEnabled();
        patchSettings({ quickFix: { enabled: e.target.checked } });
    });
    $('#qfUrl').addEventListener('change', e =>
        patchSettings({ quickFix: { url: e.target.value.trim() } }));
    $('#qfInterval').addEventListener('change', e =>
        patchSettings({ quickFix: { intervalHours: Math.max(1, Number(e.target.value) || 168) } }));

    $('#qfUpdate').addEventListener('click', async () => {
        try {
            const r = await send(MSG.requestQuickFixUpdate);
            $('#saveNote').textContent = `quick-fix: ${r.updated ?? 0} rule(s)`;
        } catch (e) { $('#saveNote').textContent = `⚠ ${e.message}`; }
    });
    $('#qfClear').addEventListener('click', () =>
        send(MSG.clearQuickFixRules).then(noteSaved).catch(console.error));
}

async function refreshSpotifyGate() {
    const { settings } = await send(MSG.getSettings);
    $('#spotifyAccept').disabled = settings.modules.spotifyNoticeAccepted === true;
}

// quick-fix sub-controls are meaningless while the channel is off
function syncQuickfixEnabled() {
    const on = $('#qfEnabled').checked;
    for (const id of ['qfUrl', 'qfInterval', 'qfUpdate', 'qfClear']) {
        $('#' + id).disabled = !on;
    }
}

/******************************************************************************/
// filter lists tab
/******************************************************************************/

async function fetchRulesetDetails() {
    try {
        const res = await fetch(api.runtime.getURL('/rulesets/ruleset-details.json'));
        return await res.json();
    } catch { return []; }
}

async function initListsTab() {
    const [{ filterLists }, details] = await Promise.all([
        send(MSG.getFilterLists), fetchRulesetDetails(),
    ]);
    const tbody = $('#listsTable tbody');
    tbody.textContent = '';

    const groupLabel = id => {
        const group = details.find(d => d.id === id)?.group ?? RULESET_GROUPS[id] ?? 'default';
        return api.i18n.getMessage(`group_${group}`) || group;
    };

    const ordered = [...new Set([
        ...details.map(d => d.id),
        ...Object.keys(RULESET_GROUPS),
    ])].filter(id => RULESET_GROUPS[id] !== 'test' || details.some(d => d.id === id));

    for (const id of ordered) {
        const d = details.find(x => x.id === id);
        const manifestEnabled = d?.enabled ?? false;
        const override = filterLists.builtin[id];
        const enabled = override !== undefined ? override : manifestEnabled;
        const rules = d?.rules?.total ?? '—';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" ${enabled ? 'checked' : ''}></td>
            <td><span class="mono">${esc(id)}</span><br>
                <span class="muted">${esc(d?.name || groupLabel(id))}</span></td>
            <td class="num">${rules}</td>`;
        tr.querySelector('input').addEventListener('change', e => {
            send(MSG.setFilterListEnabled, { id, enabled: e.target.checked })
                .then(noteSaved).catch(console.error);
        });
        tbody.append(tr);
    }
}

/******************************************************************************/
// my rules tab
/******************************************************************************/

async function initMyRulesTab() {
    const r = await send(MSG.getMyRules);
    $('#myPermanent').value = (r.permanent || []).join('\n');
    $('#myTemporary').value = (r.temporary || []).join('\n');

    $('#myApply').addEventListener('click', async () => {
        const permanent = $('#myPermanent').value.split('\n');
        const temporary = $('#myTemporary').value.split('\n');
        try {
            const res = await send(MSG.setMyRules, { permanent, temporary });
            const box = $('#myErrors');
            const ul = box.querySelector('ul');
            ul.textContent = '';
            const errors = res.errors || [];
            box.hidden = errors.length === 0;
            for (const e of errors) {
                const li = document.createElement('li');
                li.textContent = `${e.text} — ${e.error}`;
                ul.append(li);
            }
            $('#saveNote').textContent =
                `my rules: ${res.applied?.permanent ?? 0} permanent, ${res.applied?.temporary ?? 0} temporary`;
        } catch (e) { $('#saveNote').textContent = `⚠ ${e.message}`; }
    });
}

/******************************************************************************/
// custom rules tab
/******************************************************************************/

async function refreshCustomRules() {
    const { rules } = await send(MSG.getCustomRules);
    const tbody = $('#customTable tbody');
    tbody.textContent = '';
    $('#customEmpty').hidden = rules.length !== 0;
    for (const r of rules) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" ${r.enabled !== false ? 'checked' : ''}></td>
            <td><span class="mono">${esc(r.text)}</span><br>
                <span class="muted">${esc(r.source)}</span></td>
            <td class="num"><button class="ghost" data-i18n="opt_customRemove">✕</button></td>`;
        tr.querySelector('input').addEventListener('change', e => {
            send(MSG.setCustomRuleEnabled, { id: r.id, enabled: e.target.checked })
                .then(() => refreshCustomRules()).catch(console.error);
        });
        tr.querySelector('button').addEventListener('click', () => {
            send(MSG.removeCustomRule, { id: r.id })
                .then(() => refreshCustomRules()).catch(console.error);
        });
        tbody.append(tr);
    }
}

function initCustomTab() {
    $('#customForm').addEventListener('submit', async e => {
        e.preventDefault();
        const input = $('#customInput');
        const text = input.value.trim();
        if (!text) { return; }
        try {
            await send(MSG.addCustomRule, { text });
            input.value = '';
            $('#customError').textContent = '';
            await refreshCustomRules();
        } catch (err) {
            $('#customError').textContent = `⚠ ${err.message}`;
        }
    });
    return refreshCustomRules();
}

/******************************************************************************/
// sites tab
/******************************************************************************/

async function refreshSites() {
    const { modes } = await send(MSG.getSites);
    const tbody = $('#sitesTable tbody');
    tbody.textContent = '';
    const rows = [];
    for (const mode of ['none', 'basic', 'optimal', 'complete']) {
        for (const host of (modes[mode] || [])) {
            rows.push({ host, mode: host === 'all-urls' ? `${mode} (all)` : mode });
        }
    }
    $('#sitesEmpty').hidden = rows.length !== 0;
    for (const { host, mode } of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="mono">${esc(host)}</td>
            <td>${esc(mode)}</td>
            <td class="num"><button class="ghost" data-i18n="opt_sitesForget">✕</button></td>`;
        tr.querySelector('button').addEventListener('click', () => {
            send(MSG.forgetSite, { hostname: host })
                .then(() => refreshSites()).catch(console.error);
        });
        tbody.append(tr);
    }
}

/******************************************************************************/
// stats tab
/******************************************************************************/

async function refreshStats() {
    const { stats } = await send(MSG.getStats);
    $('#statTotal').textContent = stats.total.toLocaleString();
    $('#statAds').textContent = (stats.byCategory.ads || 0).toLocaleString();
    $('#statTrackers').textContent = (stats.byCategory.trackers || 0).toLocaleString();
    $('#statAab').textContent = (stats.byCategory.aab || 0).toLocaleString();

    const top = Object.entries(stats.bySite || {})
        .sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    const ol = $('#statsTop');
    ol.textContent = '';
    $('#statsEmpty').hidden = top.length !== 0;
    for (const [host, { count }] of top) {
        const li = document.createElement('li');
        li.innerHTML = `${esc(host)} <span class="n">— ${count.toLocaleString()}</span>`;
        ol.append(li);
    }
}

/******************************************************************************/
// diagnostics tab
/******************************************************************************/

async function refreshDiag() {
    const [budgets, rules] = await Promise.all([
        send(MSG.getBudgets), send(MSG.getDynamicRules),
    ]);
    $('#diagBudgets').textContent = JSON.stringify(budgets.budgets, null, 2);
    $('#diagRules').textContent = JSON.stringify(rules.rules, null, 2);

    // registered site scriptlets + the three gates that must all be open:
    // module enabled → ToS accepted → host permission granted — plus the
    // last sync() outcome (mode / error) so a rejected registration is
    // visible instead of silently looking like "no ads blocked".
    let scriptlets = 'unavailable';
    try {
        const [{ settings }, perms, regs, syncStatus] = await Promise.all([
            send(MSG.getSettings),
            new Promise(res => api.permissions.getAll(r => res(r))),
            new Promise(resolve => {
                api.scripting.getRegisteredContentScripts(res => {
                    const err = api.runtime.lastError;
                    resolve(err ? null : res);
                });
            }),
            new Promise(res => api.storage.session.get('scriptletSyncStatus', r => res(r))),
        ]);
        scriptlets = JSON.stringify({
            gates: {
                moduleSpotify: settings.modules?.spotify === true,
                tosAccepted: settings.modules?.spotifyNoticeAccepted === true,
                grantedOrigins: perms?.origins || [],
            },
            lastSync: syncStatus?.scriptletSyncStatus || null,
            registered: regs === null ? 'unavailable'
                : regs.map(r => ({ id: r.id, matches: r.matches, world: r.world })),
        }, null, 2);
    } catch (e) { scriptlets = 'error: ' + e.message; }
    $('#diagScriptlets').textContent = scriptlets;
}

/******************************************************************************/
// about tab
/******************************************************************************/

async function initAboutTab() {
    const details = await fetchRulesetDetails();
    const ul = $('#attribList');
    ul.textContent = '';
    const seen = new Set();
    for (const d of details) {
        if (!d.homeURL || seen.has(d.homeURL)) { continue; }
        seen.add(d.homeURL);
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = d.homeURL;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.textContent = d.name || d.id;
        li.append(a);
        ul.append(li);
    }
    if (ul.children.length === 0) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'uBlock filters · EasyList · EasyPrivacy · Peter Lowe · URLhaus · ABPVN';
        ul.append(li);
    }

    $('#backupBtn').addEventListener('click', async () => {
        const data = await send(MSG.backup);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ethereals-n-ads-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
    $('#restoreFile').addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) { return; }
        try {
            const data = JSON.parse(await file.text());
            await send(MSG.restore, { data });
            $('#restoreNote').textContent = api.i18n.getMessage('opt_saved') || 'Restored';
            await Promise.all([initSettingsTab(), initListsTab(), refreshCustomRules(), refreshSites()]);
        } catch (err) {
            $('#restoreNote').textContent = `⚠ ${err.message}`;
        }
        e.target.value = '';
    });
}

/******************************************************************************/
// boot
/******************************************************************************/

function initTabs() {
    for (const btn of document.querySelectorAll('#tabs button')) {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    }
    const fromHash = () => {
        const initial = location.hash.slice(1);
        showTab(/^(\w+)$/.test(initial) ? initial : 'settings');
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
}

function init() {
    i18n();
    initTabs();
    initSettingsTab().catch(console.error);
    initListsTab().catch(console.error);
    initMyRulesTab().catch(console.error);
    initCustomTab().catch(console.error);
    refreshSites().catch(console.error);
    refreshStats().catch(console.error);
    refreshDiag().catch(console.error);
    $('#diagRefresh').addEventListener('click', () => refreshDiag().catch(console.error));
    $('#scriptletResync').addEventListener('click', async () => {
        const btn = $('#scriptletResync');
        btn.disabled = true;
        try {
            const r = await scriptletManager.sync();
            $('#diagScriptlets').textContent =
                `re-sync → ${JSON.stringify(r)}\n\n` + $('#diagScriptlets').textContent;
            await refreshDiag();
        } catch (e) { console.error(e); }
        btn.disabled = false;
    });
    initAboutTab().catch(console.error);
}

init();
