// Ethereals N ADS — mode-manager semantics (GPL-3.0)
import './mock-chrome.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reset } from './mock-chrome.mjs';
import * as modeManager from '../../src/js/mode-manager.js';
import { getModes, setModes, setSettings } from '../../src/js/storage.js';

beforeEach(() => reset());

test('effectiveMode: most-specific hostname match wins', async () => {
    await setModes({ none: [], complete: [], optimal: ['all-urls'], basic: ['a.b.com'] });

    assert.equal(await modeManager.effectiveMode('a.b.com'), 'basic');
    assert.equal(await modeManager.effectiveMode('c.a.b.com'), 'basic');
    assert.equal(await modeManager.effectiveMode('b.com'), 'optimal');
    assert.equal(await modeManager.effectiveMode('other.org'), 'optimal');
});

test('effectiveMode: falls back to defaultMode when nothing matches', async () => {
    await setModes({ none: [], basic: [], optimal: [], complete: [] });
    await setSettings({ defaultMode: 'basic', defaultToggles: {}, modules: {}, quickFix: {} });
    assert.equal(await modeManager.effectiveMode('x.org'), 'basic');
});

test('setSiteMode none prunes descendants from every list', async () => {
    await setModes({ none: [], basic: [], complete: ['a.b.com'], optimal: [] });
    await modeManager.setSiteMode('b.com', 'none');
    const after = await getModes();
    assert.deepEqual(after.none.sort(), ['b.com']);
    assert.ok(!after.complete.includes('a.b.com'),
        'descendant of a none-site must not stay in other lists');
});

test('setSiteMode moves a host between lists exactly once', async () => {
    await modeManager.setSiteMode('x.org', 'optimal');
    await modeManager.setSiteMode('x.org', 'basic');
    const modes = await getModes();
    assert.ok(modes.basic.includes('x.org'));
    assert.ok(!modes.optimal.includes('x.org'));
});

test('forgetHost drops the host so defaultMode takes over', async () => {
    await modeManager.setSiteMode('x.org', 'none');
    await modeManager.forgetHost('x.org');
    const modes = await getModes();
    assert.deepEqual(modes, { none: [], basic: [], optimal: [], complete: [] });
});

test('seedDefaults sets optimal all-urls on a fresh install only', async () => {
    await modeManager.seedDefaults();
    assert.deepEqual((await getModes()).optimal, ['all-urls']);

    await modeManager.setSiteMode('y.org', 'basic');
    await modeManager.seedDefaults(); // must not clobber existing choices
    const modes = await getModes();
    assert.ok(modes.basic.includes('y.org'));
    assert.ok(modes.optimal.includes('all-urls'));
});

test('apply() writes the exact uBOL rule shapes for none-sites', async () => {
    await setModes({ none: ['b.com', 'a.b.com'], basic: [], optimal: ['all-urls'], complete: [] });
    await modeManager.apply();
    const rules = await import('../../src/js/dynamic-rules.js');
    const ours = await rules.getOurRules();
    assert.equal(ours.dynamic.filter(r => r.id === 1).length, 1);
    const allow = ours.dynamic.find(r => r.id === 1);
    assert.equal(allow.action.type, 'allowAllRequests');
    assert.deepEqual(allow.condition.requestDomains.sort(), ['a.b.com', 'b.com']);
    assert.deepEqual(allow.condition.resourceTypes, ['main_frame']);
});
