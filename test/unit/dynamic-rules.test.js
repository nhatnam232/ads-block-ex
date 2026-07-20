// Ethereals N ADS — dynamic-rules store semantics (GPL-3.0)
import './mock-chrome.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, reset } from './mock-chrome.mjs';
import * as dynamicRules from '../../src/js/dynamic-rules.js';
import { RULE_ID } from '../../src/js/constants.js';

beforeEach(() => reset());

const mk = (id, domain) => ({
    id,
    priority: 10002,
    action: { type: 'block' },
    condition: { urlFilter: `||${domain}^` },
});

test('applyRange replaces only its own range and skips redundant writes', async () => {
    const r1 = mk(RULE_ID.customRules[0], 'a.test');
    await dynamicRules.applyRange(RULE_ID.customRules, [r1]);
    assert.equal(state.dynamic.state.calls, 1);

    // identical desired state → no write
    await dynamicRules.applyRange(RULE_ID.customRules, [mk(RULE_ID.customRules[0], 'a.test')]);
    assert.equal(state.dynamic.state.calls, 1, 'identical rules must not trigger a DNR write');

    // changed rule → single diff write
    await dynamicRules.applyRange(RULE_ID.customRules, [mk(RULE_ID.customRules[0], 'b.test')]);
    assert.equal(state.dynamic.state.calls, 2);
    const rules = state.dynamic.state.rules;
    assert.equal(rules.length, 1);
    assert.equal(rules[0].condition.urlFilter, '||b.test^');
});

test('rules outside our ranges are invisible to applyRange', async () => {
    // a foreign rule the extension does not own (another range entirely)
    state.dynamic.state.rules.push(mk(9000, 'foreign.test'));
    await dynamicRules.applyRange(RULE_ID.quickFix, [mk(RULE_ID.quickFix[0], 'q.test')]);
    const ids = state.dynamic.state.rules.map(r => r.id);
    assert.ok(ids.includes(9000), 'foreign rules must survive untouched');
    assert.ok(ids.includes(RULE_ID.quickFix[0]));
});

test('clearRange empties the range', async () => {
    await dynamicRules.applyRange(RULE_ID.myRulesPermanent,
        [mk(RULE_ID.myRulesPermanent[0], 'p.test')]);
    await dynamicRules.clearRange(RULE_ID.myRulesPermanent);
    const ids = state.dynamic.state.rules.map(r => r.id);
    assert.ok(!ids.some(id => id >= RULE_ID.myRulesPermanent[0] && id <= RULE_ID.myRulesPermanent[1]));
});

test('session store is separate from the dynamic store', async () => {
    await dynamicRules.applyRange(RULE_ID.myRulesTemporary,
        [mk(RULE_ID.myRulesTemporary[0], 't.test')], 'session');
    assert.equal(state.dynamic.state.rules.length, 0);
    assert.equal(state.sessionRules.state.rules.length, 1);
});

test('getBudgets counts only our ranges', async () => {
    state.dynamic.state.rules.push(mk(9000, 'foreign.test')); // not ours
    await dynamicRules.applyRange(RULE_ID.customRules,
        [mk(RULE_ID.customRules[0], 'a.test'), mk(RULE_ID.customRules[0] + 1, 'b.test')]);
    const budgets = await dynamicRules.getBudgets();
    assert.equal(budgets.dynamicUsed, 2);
    assert.equal(budgets.dynamicCap, 4000);
});
