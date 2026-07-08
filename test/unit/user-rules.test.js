// Ethereals N ADS — user-rule mini-compiler (GPL-3.0)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserRule, compileLines } from '../../src/js/user-rules.js';
import { PRIORITY, RULE_ID } from '../../src/js/constants.js';

test('||host^ compiles to a domain-anchored urlFilter block', () => {
    const r = parseUserRule('||ads.example.com^');
    assert.equal(r.ok, true);
    assert.equal(r.rule.action.type, 'block');
    assert.equal(r.rule.priority, PRIORITY.userBlock);
    assert.equal(r.rule.condition.urlFilter, '||ads.example.com^');
});

test('@@ exceptions compile to high-priority allow', () => {
    const r = parseUserRule('@@||trusted.example.com^');
    assert.equal(r.ok, true);
    assert.equal(r.rule.action.type, 'allow');
    assert.equal(r.rule.priority, PRIORITY.userAllow);
});

test('bare hostname (hosts-file style) is anchored like ||host^', () => {
    const r = parseUserRule('ads.example.com');
    assert.equal(r.ok, true);
    assert.equal(r.rule.condition.urlFilter, '||ads.example.com^');
});

test('path suffix survives into the urlFilter', () => {
    const r = parseUserRule('||cdn.example.com/ads/');
    assert.equal(r.ok, true);
    assert.equal(r.rule.condition.urlFilter, '||cdn.example.com/ads/');
});

test('$domain= maps to initiatorDomains', () => {
    const r = parseUserRule('||tracker.net^$domain=news.test|blog.test');
    assert.equal(r.ok, true);
    assert.deepEqual(r.rule.condition.initiatorDomains.sort(), ['blog.test', 'news.test']);
});

test('resource-type options map to resourceTypes', () => {
    const r = parseUserRule('||cdn.test^$image,stylesheet');
    assert.deepEqual(r.rule.condition.resourceTypes.sort(), ['image', 'stylesheet']);
});

test('regex filters map to regexFilter with validation', () => {
    const ok = parseUserRule('/ads\\/v\\d+/');
    assert.equal(ok.ok, true);
    assert.equal(ok.rule.condition.regexFilter, 'ads\\/v\\d+');

    assert.equal(parseUserRule('/(?<=x)ads/').ok, false); // lookbehind — RE2 no
});

test('cosmetic and scriptlet filters are rejected with a clear error', () => {
    const cosmetic = parseUserRule('example.com##.ad-slot');
    assert.equal(cosmetic.ok, false);
    assert.match(cosmetic.error, /[Cc]osmetic/);

    const scriptlet = parseUserRule('example.com##+js(set-constant, ads, false)');
    assert.equal(scriptlet.ok, false);
    assert.match(scriptlet.error, /[Ss]criptlet/);
});

test('unsupported action options are rejected, not silently dropped', () => {
    for (const line of [
        '||x.test^$removeparam=utm_*',
        '||x.test^$redirect=noop.js',
        '||x.test^$denyallow=a.com|b.com',
    ]) {
        const r = parseUserRule(line);
        assert.equal(r.ok, false, line);
    }
});

test('comments and blanks are skipped', () => {
    assert.equal(parseUserRule('! a comment').skip, true);
    assert.equal(parseUserRule('   ').skip, true);
    assert.equal(parseUserRule('[Adblock Plus 2.0]').skip, true);
});

test('compileLines assigns dense ids and collects per-line errors', () => {
    const { rules, errors } = compileLines([
        '||a.test^',
        '! comment skipped — next id still dense',
        '||b.test^',
        'example.com##.oops',
        '@@||c.test^',
    ], RULE_ID.customRules[0]);

    assert.deepEqual(rules.map(r => r.id), [
        RULE_ID.customRules[0],
        RULE_ID.customRules[0] + 1,
        RULE_ID.customRules[0] + 2,
    ]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].text, 'example.com##.oops');
});
