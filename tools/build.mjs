#!/usr/bin/env node
/*******************************************************************************
 * Ethereals N ADS — build orchestrator
 *
 * Subcommands:
 *   node tools/build.mjs assets [--refresh]   download upstream filter lists
 *                                             into build/lists/ (only network step)
 *   node tools/build.mjs stage                assemble build/stage/ (vendored
 *                                             uBOL compiler environment)
 *   node tools/build.mjs compile <platform>   full build: stage + dist/<platform>
 *                                             + ruleset compilation + patch
 *   node tools/build.mjs icons                generate src/img/ PNG icons
 *
 * The ruleset compiler is uBlock Origin's platform/mv3/make-rulesets.js
 * (GPL-3.0, © Raymond Hill, modified for Ethereals N ADS) — see
 * tools/vendored-README.md for the exact provenance and modifications.
 *
 * This file is part of Ethereals N ADS, licensed GPL-3.0. Copyright (C) 2026 nhatnam232.
 ******************************************************************************/

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UBO = path.join(ROOT, 'build', 'ubo-src');
const STAGE = path.join(ROOT, 'build', 'stage');
const LISTS = path.join(ROOT, 'build', 'lists');
const NODE = process.execPath;
const DEV = process.env.DEV === '1';

function log(...args) { console.log(`[build]`, ...args); }
function die(msg) { console.error(`[build] ERROR:`, msg); process.exit(1); }

function rmrf(p) {
    // Windows: a transient lock (AV scan, stale CWD) can deny the first
    // removal — retry before giving up instead of failing the whole build.
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function cp(src, dest) {
    mkdirp(path.dirname(dest));
    fs.copyFileSync(src, dest);
}
function cpR(src, dest) {
    // mkdirp(dest) would turn a file destination into a directory and the
    // subsequent cpSync would fail (ERR_FS_CP_NON_DIR_TO_DIR) — only
    // directory destinations get pre-created.
    if (fs.statSync(src).isDirectory()) {
        mkdirp(dest);
        fs.cpSync(src, dest, { recursive: true, force: true });
    } else {
        mkdirp(path.dirname(dest));
        fs.copyFileSync(src, dest);
    }
}

function sha1(s) { return createHash('sha1').update(s).digest('hex'); }

function ensureUboSrc() {
    if (fs.existsSync(path.join(UBO, 'platform/mv3/make-rulesets.js'))) { return; }
    log('cloning gorhill/uBlock (shallow)…');
    mkdirp(path.join(ROOT, 'build'));
    const r = spawnSync('git', [
        'clone', '--depth', '1',
        'https://github.com/gorhill/uBlock.git', UBO,
    ], { stdio: 'inherit' });
    if (r.status !== 0) { die('git clone of gorhill/uBlock failed'); }
}

function readRulesets() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'rulesets.json'), 'utf8'));
}

/******************************************************************************/
// Patch the STAGED copy of uBO's make-rulesets.js (the vendored source in
// build/ubo-src is never touched — see tools/vendored-README.md):
//   1. retry transient list-fetch failures (undici socket races surface as
//      "Filter list should not be empty" and were build-breaking flakes)
//   2. never cache an empty/undefined fetch (a poisoned cache file made
//      later builds silently compile degraded rulesets)
function hardenStagedCompiler(file) {
    let src = fs.readFileSync(file, 'utf8');
    const fragile =
        '    const text = await fetchList(context, assetDetails);\n' +
        '    writeFile(`${cacheDir}/${platform}/${fname}`, text);';
    const hardened =
        '    let text;\n' +
        '    for ( let i = 0; i < 3 && Boolean(text) === false; i++ ) {\n' +
        '        text = await fetchList(context, assetDetails);\n' +
        '    }\n' +
        '    if ( Boolean(text) ) { writeFile(`${cacheDir}/${platform}/${fname}`, text); }';
    if (src.includes(hardened)) { return; }
    if (!src.includes(fragile)) {
        die('make-rulesets.js fetch shape changed upstream — update hardenStagedCompiler()');
    }
    fs.writeFileSync(file, src.replace(fragile, hardened));
    log('staged compiler hardened (fetch retry + empty-cache guard)');
}

/******************************************************************************/

// assets: download upstream lists into build/lists/upstream/<sha1>.txt

async function cmdAssets(refresh) {
    ensureUboSrc();
    mkdirp(path.join(LISTS, 'upstream'));
    const rulesets = readRulesets();
    let fetched = 0, cached = 0;
    for (const rs of rulesets) {
        for (const url of rs.urls || []) {
            if (url.startsWith('local://')) { continue; }
            const sha = sha1(url);
            const dest = path.join(LISTS, 'upstream', `${sha}.txt`);
            if (!refresh && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
                cached++; continue;
            }
            log(`fetch ${rs.id}: ${url.slice(0, 72)}…`);
            const res = await fetch(url).catch(() => null);
            if (!res || !res.ok) { die(`fetch failed (${res?.status}): ${url}`); }
            const text = await res.text();
            fs.writeFileSync(dest, text);
            fetched++;
        }
    }
    log(`assets: ${fetched} fetched, ${cached} cached`);
}

/******************************************************************************/

// stage: assemble the vendored compiler environment (mirrors uBO's
// tools/make-nodejs.sh + the staging portion of tools/make-mv3.sh)

function stageEnv() {
    ensureUboSrc();
    rmrf(STAGE);
    mkdirp(path.join(STAGE, 'js'));
    mkdirp(path.join(STAGE, 'js', 'wasm'));
    mkdirp(path.join(STAGE, 'web_accessible_resources'));

    // --- mirrors tools/make-nodejs.sh ---
    const jsFiles = [
        'arglist-parser.js', 'base64-custom.js', 'biditrie.js',
        'dynamic-net-filtering.js', 'filtering-context.js', 'hnswitches.js',
        'hntrie.js', 'jsonpath.js', 'redirect-resources.js',
        'regex-analyzer.js', 's14e-serializer.js', 'static-dnr-filtering.js',
        'static-filtering-parser.js', 'static-net-filtering.js',
        'static-filtering-io.js', 'tasks.js', 'text-utils.js', 'urlskip.js',
        'uri-utils.js', 'url-net-filtering.js',
    ];
    for (const f of jsFiles) {
        cp(path.join(UBO, 'src/js', f), path.join(STAGE, 'js', f));
    }
    mkdirp(path.join(STAGE, 'lib'));
    for (const lib of ['csstree', 'punycode.js', 'regexanalyzer', 'publicsuffixlist']) {
        cpR(path.join(UBO, 'src/lib', lib), path.join(STAGE, 'lib', lib));
    }
    // js/ubo-parser.js (copied below from the mv3 extension tree) imports
    // './punycode.js' — same dir, not ../lib — so it must exist twice
    cp(path.join(UBO, 'src/lib/punycode.js'), path.join(STAGE, 'js', 'punycode.js'));
    // wasm modules as JSON arrays (same conversions as make-nodejs.sh)
    cpR(path.join(UBO, 'src/js/wasm'), path.join(STAGE, 'js/wasm'));
    const wasmJson = (src, dest) => {
        const bytes = fs.readFileSync(src);
        fs.writeFileSync(dest, JSON.stringify(Array.from(bytes)));
    };
    wasmJson(path.join(UBO, 'src/js/wasm/hntrie.wasm'),
        path.join(STAGE, 'js/wasm/hntrie.wasm.json'));
    wasmJson(path.join(UBO, 'src/js/wasm/biditrie.wasm'),
        path.join(STAGE, 'js/wasm/biditrie.wasm.json'));
    wasmJson(path.join(UBO, 'src/lib/publicsuffixlist/wasm/publicsuffixlist.wasm'),
        path.join(STAGE, 'lib/publicsuffixlist/wasm/publicsuffixlist.wasm.json'));

    // --- mirrors the staging portion of tools/make-mv3.sh ---
    cp(path.join(UBO, 'platform/mv3/package.json'),
        path.join(STAGE, 'package.json'));
    cp(path.join(UBO, 'platform/mv3/make-rulesets.js'),
        path.join(STAGE, 'make-rulesets.js'));
    hardenStagedCompiler(path.join(STAGE, 'make-rulesets.js'));
    cp(path.join(UBO, 'platform/mv3/salvage-ruleids.mjs'),
        path.join(STAGE, 'salvage-ruleids.mjs'));
    cp(path.join(UBO, 'platform/mv3/extension/js/ubo-parser.js'),
        path.join(STAGE, 'js/ubo-parser.js'));
    cp(path.join(UBO, 'platform/mv3/extension/js/utils.js'),
        path.join(STAGE, 'js/utils.js'));
    cpR(path.join(UBO, 'src/js/resources'),
        path.join(STAGE, 'js/resources'));
    cp(path.join(UBO, 'src/js/trusted-tokens.js'),
        path.join(STAGE, 'js/trusted-tokens.js'));
    cpR(path.join(UBO, 'src/lib/regexanalyzer'),
        path.join(STAGE, 'js/regexanalyzer'));
    cpR(path.join(UBO, 'platform/mv3/scriptlets'),
        path.join(STAGE, 'scriptlets'));
    cpR(path.join(UBO, 'platform/mv3/extension/js/offscreen'),
        path.join(STAGE, 'js/offscreen'));
    cp(path.join(UBO, 'src/js/regex-analyzer.js'),
        path.join(STAGE, 'js/offscreen/regex-analyzer.js'));
    cpR(path.join(UBO, 'src/web_accessible_resources'),
        path.join(STAGE, 'web_accessible_resources'));
    // per-platform patch hooks (firefox/patch-ruleset.js is imported by the
    // compiler via `./${platform}/patch-ruleset.js`; chromium has none)
    mkdirp(path.join(STAGE, 'firefox'));
    cp(path.join(UBO, 'platform/mv3/firefox/patch-ruleset.js'),
        path.join(STAGE, 'firefox/patch-ruleset.js'));
    log('stage assembled at build/stage');
}

/******************************************************************************/

// local static server so the compiler can consume cached lists + our
// filters/*.txt without network access

function startListServer() {
    return new Promise(resolve => {
        const srv = http.createServer((req, res) => {
            const u = new URL(req.url, 'http://127.0.0.1');
            let file = null;
            if (u.pathname.startsWith('/up/')) {
                const name = path.basename(u.pathname);
                if (/^[0-9a-f]{40}\.txt$/.test(name)) {
                    file = path.join(LISTS, 'upstream', name);
                }
            } else if (u.pathname.startsWith('/filters/')) {
                const name = path.basename(u.pathname);
                if (/^[\w.-]+\.txt$/.test(name)) {
                    file = path.join(ROOT, 'filters', name);
                }
            }
            if (file && fs.existsSync(file)) {
                res.writeHead(200, {
                    'content-type': 'text/plain; charset=utf-8',
                    'cache-control': 'no-store',
                    // Node's fetch (undici) pools connections; a request sent
                    // on a socket the server is closing hangs for undici's
                    // 5-minute headers timeout, which the compiler surfaces
                    // as "Filter list should not be empty". Connection: close
                    // keeps every request on its own socket — no race.
                    'connection': 'close',
                });
                res.end(fs.readFileSync(file));
            } else {
                res.writeHead(404); res.end('not found');
            }
        });
        srv.keepAliveTimeout = 1000;
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

/******************************************************************************/

// compile <platform>: assemble dist, run compiler, post-patch

async function cmdCompile(platform) {
    if (platform !== 'chromium' && platform !== 'firefox') {
        die(`unknown platform "${platform}" (chromium|firefox)`);
    }
    stageEnv();
    await cmdAssets(false);

    const dist = path.join(ROOT, 'dist', platform);
    rmrf(dist);
    mkdirp(dist);
    // our shared extension tree + per-platform manifest
    cpR(path.join(ROOT, 'src'), dist);
    cp(path.join(ROOT, 'platform', platform, 'manifest.json'),
        path.join(dist, 'manifest.json'));

    // rewrite rulesets.json: upstream URLs + local:// → local server URLs
    const srv = await startListServer();
    const port = srv.address().port;
    const rulesets = readRulesets().map(rs => ({
        ...rs,
        urls: (rs.urls || []).map(u =>
            u.startsWith('local://')
                ? `http://127.0.0.1:${port}/filters/${u.slice('local://'.length)}`
                : `http://127.0.0.1:${port}/up/${sha1(u)}.txt`),
    }));
    fs.writeFileSync(path.join(STAGE, 'rulesets.json'),
        JSON.stringify(rulesets, null, 2));

    log(`compiling rulesets for ${platform} (list server :${port})…`);
    const r = spawnSync(NODE, [
        '--no-warnings', 'make-rulesets.js',
        `output=${dist}`, `platform=${platform}`,
    ], { cwd: STAGE, stdio: 'inherit' });
    srv.close();
    if (r.status !== 0) { die(`make-rulesets.js exited ${r.status}`); }

    const patch = spawnSync(NODE, [
        'tools/patch-manifest.mjs', dist, platform, DEV ? 'dev' : 'release',
    ], { cwd: ROOT, stdio: 'inherit' });
    if (patch.status !== 0) { die(`patch-manifest.mjs exited ${patch.status}`); }

    log(`done → ${path.relative(ROOT, dist)}`);
}

/******************************************************************************/

// icons: generate src/img/icon_{16,32,64,128}.png (no external deps)

async function cmdIcons() {
    const { generateIcons } = await import('./make-icons.mjs');
    await generateIcons(path.join(ROOT, 'src', 'img'));
    log('icons generated');
}

/******************************************************************************/

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
case 'assets':
    await cmdAssets(rest.includes('--refresh'));
    break;
case 'stage':
    stageEnv();
    break;
case 'compile':
    await cmdCompile(rest[0]);
    break;
case 'icons':
    await cmdIcons();
    break;
default:
    die('usage: node tools/build.mjs assets[--refresh]|stage|compile <platform>|icons');
}
