#!/usr/bin/env node
/*******************************************************************************
 * Ethereals N ADS — post-compile manifest patch + hard budget gate
 *
 * Usage: node tools/patch-manifest.mjs <distDir> <platform> <dev|release>
 *
 * Runs AFTER uBOL's make-rulesets.js has generated rulesets/ and patched the
 * manifest. Responsibilities:
 *   1. HARD GATE — fail the build if enabled static rules exceed the
 *      cross-browser budget (Firefox throws above 30K enabled static rules):
 *      ≤ 28000 rules and ≤ 10 enabled rulesets, ≤ 900 regex rules.
 *   2. Strip strictblock redirect rules for v1 (we ship no interstitial page;
 *      removing is safer than a broken redirect target).
 *   3. dev mode — add declarativeNetRequestFeedback permission (chromium),
 *      enable the test-1 ruleset, switch the gecko id to the dev id.
 *
 * Part of Ethereals N ADS, licensed GPL-3.0.
 ******************************************************************************/

import fs from 'node:fs';
import path from 'node:path';

const [distDir, platform, mode] = process.argv.slice(2);
if (!distDir || !platform || !mode) {
    console.error('usage: patch-manifest.mjs <distDir> <platform> <dev|release>');
    process.exit(1);
}

const manifestPath = path.join(distDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/******************************************************************************/

// 2. strip strictblock redirect rules (v1 ships no strictblock.html)

const rulesetDir = path.join(distDir, 'rulesets', 'main');
let stripped = 0;
if (fs.existsSync(rulesetDir)) {
    for (const f of fs.readdirSync(rulesetDir)) {
        if (!f.endsWith('.json')) { continue; }
        const p = path.join(rulesetDir, f);
        const rules = JSON.parse(fs.readFileSync(p, 'utf8'));
        const kept = rules.filter(rule => {
            const redirect = JSON.stringify(rule.action?.redirect || {});
            if (redirect.includes('strictblock.html')) { stripped++; return false; }
            return true;
        });
        if (kept.length !== rules.length) {
            fs.writeFileSync(p, JSON.stringify(kept));
        }
    }
}

/******************************************************************************/

// 1. hard budget gate (compute totals from ruleset-details.json)

const detailsPath = path.join(distDir, 'rulesets', 'ruleset-details.json');
const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));

/******************************************************************************/

// 3. dev-mode extras — applied BEFORE the gate so the budget counts what
// actually ships (dev enabling test-1 used to slip past the gate)

if (mode === 'dev') {
    if (platform === 'chromium') {
        manifest.permissions = [...new Set([
            ...manifest.permissions, 'declarativeNetRequestFeedback',
        ])];
    }
    if (platform === 'firefox' && manifest.browser_specific_settings?.gecko) {
        manifest.browser_specific_settings.gecko.id =
            'ethereals-n-ads-dev@ethereals.invalid';
    }
    const testRes = manifest.declarative_net_request.rule_resources
        .find(r => r.id === 'test-1');
    if (testRes) { testRes.enabled = true; }
}

/******************************************************************************/

// 1. hard budget gate (compute totals from ruleset-details.json)

let enabledCount = 0;
let totalRules = 0;
let totalRegex = 0;
for (const res of manifest.declarative_net_request.rule_resources) {
    if (res.enabled !== true) { continue; }
    enabledCount++;
    const d = details.find(x => x.id === res.id);
    if (!d) { continue; }
    // the compiler's ruleset-details.json stamps rule counts under `rules`
    // (see uBOL make-rulesets.js) — `counts`/`stats` were never present, so
    // the gate used to silently count 0 rules and always pass.
    const counts = d.rules || d.counts || d.stats || {};
    totalRules += (counts.total ?? (
        (counts.plain || 0) + (counts.regex || 0) +
        (counts.strictblock || 0) + (counts.urlskip || 0) +
        (counts.redirect || 0) + (counts.modifyHeaders || 0) +
        (counts.removeparam || 0)));
    totalRegex += counts.regex || 0;
}

const BUDGET = { rules: 28000, enabled: 10, regex: 900 };
const failures = [];
if (totalRules > BUDGET.rules) {
    failures.push(`static rules ${totalRules} > ${BUDGET.rules}`);
}
if (enabledCount > BUDGET.enabled) {
    failures.push(`enabled rulesets ${enabledCount} > ${BUDGET.enabled}`);
}
if (totalRegex > BUDGET.regex) {
    failures.push(`regex rules ${totalRegex} > ${BUDGET.regex}`);
}

/******************************************************************************/

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`[patch] ${platform}/${mode}: ` +
    `${enabledCount} enabled rulesets, ~${totalRules} static rules, ` +
    `${totalRegex} regex, ${stripped} strictblock rules stripped`);
if (failures.length) {
    console.error('[patch] BUDGET GATE FAILED:');
    for (const f of failures) { console.error(`  - ${f}`); }
    process.exit(2);
}
console.log('[patch] budget gate OK');
