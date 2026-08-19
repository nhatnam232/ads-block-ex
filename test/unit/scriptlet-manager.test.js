// Ethereals N ADS — site scriptlet policy (GPL-3.0)
import './mock-chrome.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRegistrations } from '../../src/js/scriptlet-manager.js';
import { DEFAULT_SETTINGS } from '../../src/js/constants.js';

const spotifyOn = () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.modules.spotify = true;
    s.modules.spotifyNoticeAccepted = true;
    return s;
};

test('spotify bundle is off by default (module + ToS gates)', () => {
    assert.equal(computeRegistrations(structuredClone(DEFAULT_SETTINGS), ['*://*.open.spotify.com/*'], false).length, 0);
});

test('module on but ToS not acknowledged → still off', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.modules.spotify = true;
    assert.equal(computeRegistrations(s, ['*://*.open.spotify.com/*'], false).length, 0);
});

test('no host grant → off even with module + ToS', () => {
    assert.equal(computeRegistrations(spotifyOn(), [], false).length, 0);
    assert.equal(computeRegistrations(spotifyOn(), ['*://*.unrelated.org/*'], false).length, 0);
});

test('<all_urls> grant → registered at document_start in MAIN world', () => {
    const regs = computeRegistrations(spotifyOn(), [], true);
    // youtube ships enabled by default; spotify needs module + ToS (on here)
    assert.equal(regs.length, 2);
    const spot = regs.find(r => r.id === 'eth-spotify');
    assert.equal(spot.world, 'MAIN');
    assert.equal(spot.runAt, 'document_start');
    assert.equal(spot.persistAcrossSessions, true);
    assert.deepEqual(spot.matches, ['*://open.spotify.com/*']);
    assert.equal(spot.js[0], '/scriptlets/site/spotify-patcher.js');
    const yt = regs.find(r => r.id === 'eth-youtube');
    assert.equal(yt.js[0], '/scriptlets/site/youtube-patcher.js');
    assert.deepEqual(yt.matches, ['*://youtube.com/*']);
});

test('a covering per-site origin is enough (suffix match)', () => {
    // *.spotify.com covers open.spotify.com
    assert.equal(computeRegistrations(spotifyOn(), ['*://*.spotify.com/*'], false).length, 1);
    // the exact origin covers itself
    assert.equal(computeRegistrations(spotifyOn(), ['*://*.open.spotify.com/*'], false).length, 1);
});
