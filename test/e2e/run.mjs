#!/usr/bin/env node
/*******************************************************************************
 * Ethereals N ADS — e2e build smoke test
 *
 * Runs the real build for both platforms (needs the network the first time
 * to fetch upstream filter lists — cached under build/lists afterwards) and
 * asserts the dist layout the manifests promise: background, popup, options,
 * locales, icons, and a patched manifest with compiled rule resources.
 *
 * Skips with exit 0 (and a loud warning) when offline so `npm test` stays
 * usable on machines without connectivity — unit tests remain the gate.
 *
 * Part of Ethereals N ADS, licensed GPL-3.0. Copyright (C) 2026 nhatnam232.
 ******************************************************************************/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE = process.execPath;

function fail(msg) {
    console.error(`[e2e] FAIL: ${msg}`);
    process.exit(1);
}

async function online() {
    try {
        const res = await fetch('https://ublockorigin.github.io/uAssets/filters/filters.min.txt', {
            method: 'HEAD', signal: AbortSignal.timeout(8000),
        });
        return res.ok;
    } catch { return false; }
}

function assertLayout(platform) {
    const dist = path.join(ROOT, 'dist', platform);
    const mustExist = [
        'manifest.json',
        'js/background.js',
        'js/constants.js',
        'js/ext-compat.js',
        'popup/popup.html',
        'popup/popup.js',
        'options/options.html',
        'options/options.js',
        '_locales/en/messages.json',
        '_locales/vi/messages.json',
        'img/icon_128.png',
        'web_accessible_resources/noop.js',
    ];
    for (const rel of mustExist) {
        if (!fs.existsSync(path.join(dist, rel))) { fail(`dist/${platform}/${rel} missing`); }
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
    const rules = manifest.declarative_net_request?.rule_resources;
    if (!Array.isArray(rules) || rules.length === 0) {
        fail(`dist/${platform}: manifest has no declarative_net_request.rule_resources`);
    }
    const enabled = rules.filter(r => r.enabled === true);
    if (enabled.length === 0 || enabled.length > 10) {
        fail(`dist/${platform}: ${enabled.length} enabled rulesets (expected 1..10)`);
    }
    for (const res of enabled) {
        const p = path.join(dist, res.path);
        if (!fs.existsSync(p)) { fail(`dist/${platform}/${res.path} missing`); }
    }
    if (platform === 'firefox') {
        const id = manifest.browser_specific_settings?.gecko?.id;
        if (!id?.startsWith('ethereals-n-ads')) { fail(`firefox gecko id wrong: ${id}`); }
    }
    console.log(`[e2e] dist/${platform}: layout OK, ` +
        `${rules.length} rulesets (${enabled.length} enabled)`);
}

function build(platform) {
    console.log(`[e2e] building ${platform} (DEV=1)…`);
    const r = spawnSync(NODE, ['tools/build.mjs', 'compile', platform], {
        cwd: ROOT, stdio: 'inherit', env: { ...process.env, DEV: '1' },
    });
    if (r.status !== 0) { fail(`build of ${platform} exited ${r.status}`); }
}

/******************************************************************************/

function upstreamCacheCount() {
    const dir = path.join(ROOT, 'build', 'lists', 'upstream');
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.txt')).length; }
    catch { return 0; }
}

function upstreamUrlCount() {
    const rulesets = JSON.parse(fs.readFileSync(path.join(ROOT, 'rulesets.json'), 'utf8'));
    return rulesets.flatMap(rs => rs.urls || []).filter(u => !u.startsWith('local://')).length;
}

if (!fs.existsSync(path.join(ROOT, 'build', 'ubo-src', 'platform', 'mv3', 'make-rulesets.js'))) {
    console.warn('[e2e] build/ubo-src missing (needs `git clone` of gorhill/uBlock) — skipping');
    process.exit(0);
}

const cached = upstreamCacheCount();
if (cached < upstreamUrlCount() && !await online()) {
    console.warn('[e2e] offline (or uAssets unreachable) and no cached lists — skipping. ' +
        'Run `make assets` once while online to enable this test.');
    process.exit(0);
}

build('chromium');
assertLayout('chromium');
build('firefox');
assertLayout('firefox');

console.log('[e2e] OK');
