// Ethereals N ADS — enabled-ruleset policy (GPL-3.0)
import './mock-chrome.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reset } from './mock-chrome.mjs';
import { computePolicy, apply } from '../../src/js/ruleset-policy.js';
import { DEFAULT_SETTINGS } from '../../src/js/constants.js';
import { setSettings, setFilterLists } from '../../src/js/storage.js';

const DETAILS = [
    { id: 'ublock-filters', group: 'default', enabled: true },
    { id: 'easylist', group: 'default', enabled: true },
    { id: 'easyprivacy', group: 'default', enabled: true },
    { id: 'pgl', group: 'default', enabled: true },
    { id: 'ublock-badware', group: 'malware', enabled: true },
    { id: 'urlhaus-full', group: 'malware', enabled: true },
    { id: 'vie-1', group: 'regions', enabled: true },
    { id: 'aab-1', group: 'aab', enabled: true },
    { id: 'youtube-1', group: 'media', enabled: true },
    { id: 'spotify-1', group: 'media', enabled: false },
    { id: 'ublock-annoyances-cookies', group: 'annoyances', enabled: false },
    { id: 'ublock-annoyances-others', group: 'annoyances', enabled: false },
    { id: 'test-1', group: 'test', enabled: false },
];

const freshSettings = () => structuredClone(DEFAULT_SETTINGS);

beforeEach(() => reset());

test('default policy: core+malware+regions+aab+youtube on, annoyances+spotify off', () => {
    const enabled = computePolicy(freshSettings(), { builtin: {}, custom: [] }, DETAILS);
    assert.ok(enabled.includes('easylist'));
    assert.ok(enabled.includes('urlhaus-full'));
    assert.ok(enabled.includes('aab-1'));
    assert.ok(enabled.includes('youtube-1'));
    assert.ok(!enabled.includes('ublock-annoyances-cookies'));
    assert.ok(!enabled.includes('spotify-1'));
    assert.ok(!enabled.includes('test-1'));
    assert.equal(enabled.length, 9);
});

test('ads toggle off kills default+malware+regions but keeps modules', () => {
    const s = freshSettings();
    s.defaultToggles.ads = false;
    const enabled = computePolicy(s, { builtin: {}, custom: [] }, DETAILS);
    assert.ok(!enabled.includes('easylist'));
    assert.ok(!enabled.includes('urlhaus-full'));
    assert.ok(enabled.includes('youtube-1')); // module survives the ads toggle
});

test('spotify module requires the ToS acknowledgement', () => {
    const s = freshSettings();
    s.modules.spotify = true;
    s.modules.spotifyNoticeAccepted = false;
    let enabled = computePolicy(s, { builtin: {}, custom: [] }, DETAILS);
    assert.ok(!enabled.includes('spotify-1'));

    s.modules.spotifyNoticeAccepted = true;
    enabled = computePolicy(s, { builtin: {}, custom: [] }, DETAILS);
    assert.ok(enabled.includes('spotify-1'));
});

test('per-list overrides beat toggle-derived defaults in both directions', () => {
    const fl = { builtin: { easylist: false, 'ublock-annoyances-others': true }, custom: [] };
    const enabled = computePolicy(freshSettings(), fl, DETAILS);
    assert.ok(!enabled.includes('easylist'), 'explicit off must win');
    assert.ok(enabled.includes('ublock-annoyances-others'), 'explicit on must win');
});

test('policy caps at the enabled-rulesets budget, default group first', () => {
    const details = Array.from({ length: 15 }, (_, i) => ({
        id: `list-${i}`, group: i < 12 ? 'default' : 'annoyances', enabled: true,
    }));
    const s = freshSettings();
    s.defaultToggles.annoyances = true;
    const enabled = computePolicy(s, { builtin: {}, custom: [] }, details);
    assert.ok(enabled.length <= 10);
    assert.ok(enabled.includes('list-0'));
    assert.ok(!enabled.includes('list-14')); // annoyances fall off the cap first
});

test('aabProfile off disables the aab group even with the toggle on', () => {
    const s = freshSettings();
    s.aabProfile = 'off';
    const enabled = computePolicy(s, { builtin: {}, custom: [] }, DETAILS);
    assert.ok(!enabled.includes('aab-1'));
});

test('apply() drives the (mocked) DNR API from real storage', async () => {
    // getRulesetDetails() fetches the runtime URL — stub global fetch to
    // hand back the same details table the pure tests use
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => DETAILS });

    await setSettings(freshSettings());
    await setFilterLists({ builtin: { easylist: false }, custom: [] });
    const r = await apply();

    globalThis.fetch = realFetch;
    assert.equal(r.changed, true);
    assert.ok(!r.enabled.includes('easylist'));
    assert.ok(r.enabled.includes('easyprivacy'));
});
