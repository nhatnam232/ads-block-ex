// Ethereals N ADS — storage helpers (GPL-3.0)
import './mock-chrome.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reset } from './mock-chrome.mjs';
import {
    local, getSettings, setSettings, getModes, setModes,
    getMyRules, setMyRules, getFilterLists, setFilterLists, getSites,
} from '../../src/js/storage.js';

beforeEach(() => reset());

test('getWithDefaults deep-merges nested defaults with stored values', async () => {
    await local.set('settings', { defaultMode: 'complete', modules: { youtube: false } });
    const s = await getSettings();
    assert.equal(s.defaultMode, 'complete');           // stored wins
    assert.equal(s.modules.youtube, false);            // stored nested wins
    assert.equal(s.modules.spotify, true);             // on out of the box, no clicks
    assert.equal(s.quickFix.intervalHours, 168);       // default nested object
    assert.equal(s.defaultToggles.aab, true);
});

test('a fresh install gets a full structured default', async () => {
    const s = await getSettings();
    assert.equal(s.defaultMode, 'basic');
    assert.deepEqual(Object.keys(s.defaultToggles).sort(),
        ['aab', 'ads', 'annoyances', 'cosmetic', 'https']);
});

test('modes round-trip and reject malformed shapes', async () => {
    await setModes({ none: ['a.test'], basic: [], optimal: ['all-urls'], complete: [] });
    assert.deepEqual(await getModes(), { none: ['a.test'], basic: [], optimal: ['all-urls'], complete: [] });

    await local.set('modes', { none: 'not-an-array' }); // corrupted
    const m = await getModes();
    assert.deepEqual(m, { none: [], basic: [], optimal: [], complete: [] });
});

test('myRules defaults to the two-channel shape', async () => {
    assert.deepEqual(await getMyRules(), { permanent: [], temporary: [] });
    await setMyRules({ permanent: ['||x.test^'], temporary: [] });
    assert.deepEqual(await getMyRules(), { permanent: ['||x.test^'], temporary: [] });
});

test('filterLists validates its shape before use', async () => {
    assert.deepEqual(await getFilterLists(), { builtin: {}, custom: [] });
    await setFilterLists({ builtin: { easylist: true }, custom: [] });
    assert.equal((await getFilterLists()).builtin.easylist, true);

    await local.set('filterLists', { builtin: null }); // corrupted
    assert.deepEqual(await getFilterLists(), { builtin: {}, custom: [] });
});

test('sites is a plain empty map to start', async () => {
    assert.deepEqual(await getSites(), {});
});
