// Ethereals N ADS — constants invariants (GPL-3.0)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    RUNTIME_CAPS, PRIORITY, RULE_ID, MODES, TOGGLE_KEYS, MSG, RULESET_GROUPS,
} from '../../src/js/constants.js';

test('dynamic-rule id ranges are pairwise disjoint', () => {
    const ranges = [
        [RULE_ID.modeAllowDynamic, RULE_ID.modeAllowDynamic],
        [RULE_ID.modeAllowSession, RULE_ID.modeAllowSession],
        RULE_ID.customRules,
        RULE_ID.myRulesPermanent,
        RULE_ID.myRulesTemporary,
        RULE_ID.quickFix,
    ];
    for (let i = 0; i < ranges.length; i++) {
        const [alo, ahi] = ranges[i];
        assert.ok(alo <= ahi, `range ${i} is inverted`);
        for (let j = i + 1; j < ranges.length; j++) {
            const [blo, bhi] = ranges[j];
            assert.ok(ahi < blo || bhi < alo,
                `ranges ${i} and ${j} overlap`);
        }
    }
});

test('budgets stay under cross-browser floors', () => {
    assert.ok(RUNTIME_CAPS.staticRulesTarget <= 30000); // Firefox throws above 30K
    assert.ok(RUNTIME_CAPS.dynamicRules <= 5000);
    assert.ok(RUNTIME_CAPS.sessionRules <= 5000);
    assert.ok(RUNTIME_CAPS.regexRules <= 1000);
    assert.ok(RUNTIME_CAPS.enabledRulesets <= 20);
});

test('mode priorities outrank static rules but stay internal', () => {
    assert.ok(PRIORITY.modeAllow > PRIORITY.quickFixBlock);
    assert.ok(PRIORITY.quickFixBlock > PRIORITY.staticPlain);
    assert.ok(PRIORITY.userBlock > PRIORITY.userAllow);
    assert.ok(PRIORITY.userAllow > PRIORITY.modeAllow);
});

test('MODES/TOGGLE_KEYS/MSG values are unique', () => {
    for (const [name, arr] of [['MODES', MODES], ['TOGGLE_KEYS', TOGGLE_KEYS],
        ['MSG keys', Object.values(MSG)]]) {
        assert.equal(new Set(arr).size, arr.length, `${name} has duplicates`);
    }
});

test('RULESET_GROUPS covers itself consistently', () => {
    for (const [id, group] of Object.entries(RULESET_GROUPS)) {
        assert.equal(RULESET_GROUPS[id], group);
        assert.ok(typeof group === 'string' && group.length > 0, `${id} has empty group`);
    }
    assert.equal(RULESET_GROUPS['test-1'], 'test');
    assert.equal(RULESET_GROUPS['spotify-1'], 'media');
});
