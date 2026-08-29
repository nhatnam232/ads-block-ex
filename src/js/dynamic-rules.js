// dynamic/session DNR rule store (single writer) - part of Ethereals N ADS (GPL-3.0).

import { RULE_ID } from './constants.js';
import { dnr, probeCaps } from './ext-compat.js';

function sameRule(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function diffRules(current, desired) {
    const removeIds = current
        .filter(r => !desired.some(d => d.id === r.id && sameRule(d, r)))
        .map(r => r.id);
    const add = desired
        .filter(d => !current.some(r => r.id === d.id && sameRule(r, d)));
    return { removeIds, add };
}

function inRanges(id, ranges) {
    return ranges.some(([lo, hi]) => id >= lo && id <= hi);
}

// which of our id ranges live in the dynamic vs session store
const DYNAMIC_RANGES = [
    [RULE_ID.modeAllowDynamic, RULE_ID.modeAllowDynamic],
    RULE_ID.customRules,
    RULE_ID.myRulesPermanent,
    RULE_ID.quickFix,
];
const SESSION_RANGES = [
    [RULE_ID.modeAllowSession, RULE_ID.modeAllowSession],
    RULE_ID.myRulesTemporary,
];

async function readStore(getter, ranges) {
    const rules = (await getter()) || [];
    return rules.filter(r => inRanges(r.id, ranges));
}

async function writeStore(updater, current, desired) {
    const { removeIds, add } = diffRules(current, desired);
    if (removeIds.length === 0 && add.length === 0) { return { changed: false }; }
    const caps = await probeCaps();
    if (add.length > 0) {
        if (desired.length > caps.dynamicRules) {
            console.warn(`[dynamic-rules] budget: ${desired.length} > ${caps.dynamicRules}`);
        }
    }
    await updater({ removeRuleIds: removeIds, addRules: add });
    return { changed: true, removed: removeIds.length, added: add.length };
}

/******************************************************************************/

export async function applyModeRules(dynamicDesired, sessionDesired) {
    const [dyn, sess] = await Promise.all([
        readStore(dnr.getDynamicRules, DYNAMIC_RANGES),
        readStore(dnr.getSessionRules, SESSION_RANGES),
    ]);
    // mode rules are exactly id 1 (dynamic) / id 2 (session)
    const mergedDynamic = [
        ...dyn.filter(r => r.id !== RULE_ID.modeAllowDynamic),
        ...dynamicDesired,
    ];
    const mergedSession = [
        ...sess.filter(r => r.id !== RULE_ID.modeAllowSession),
        ...sessionDesired,
    ];
    await Promise.all([
        writeStore(dnr.updateDynamicRules, dyn, mergedDynamic),
        writeStore(dnr.updateSessionRules, sess, mergedSession),
    ]);
}

// replace every rule in a range (used by custom rules / my rules / quick-fix)
export async function applyRange(range, rules, store = 'dynamic') {
    const isSession = store === 'session';
    const ranges = [range];
    const getter = isSession ? dnr.getSessionRules : dnr.getDynamicRules;
    const updater = isSession ? dnr.updateSessionRules : dnr.updateDynamicRules;
    const current = await readStore(getter, ranges);
    // the range now contains EXACTLY `rules` — ids are ours (single writer),
    // callers re-compile their whole section, so nothing survives a replace
    // (the old merge kept stale rules around and made clearRange a no-op)
    const caps = await probeCaps();
    const cap = isSession ? caps.sessionRules : caps.dynamicRules;
    let applied = rules;
    if (rules.length > cap) {
        applied = rules.slice(rules.length - cap); // oldest-first drop by id
        console.warn(`[dynamic-rules] range capped to ${cap} (dropped ${rules.length - cap})`);
    }
    await writeStore(updater, current, applied);
    return { applied: applied.length, dropped: rules.length - applied.length };
}

export async function clearRange(range, store = 'dynamic') {
    return applyRange(range, [], store);
}

export async function getBudgets() {
    const caps = await probeCaps();
    const [dyn, sess] = await Promise.all([
        dnr.getDynamicRules(), dnr.getSessionRules(),
    ]);
    const dynCount = (dyn || []).filter(r => inRanges(r.id, DYNAMIC_RANGES)).length;
    const sessCount = (sess || []).filter(r => inRanges(r.id, SESSION_RANGES)).length;
    return {
        dynamicUsed: dynCount,
        dynamicCap: caps.dynamicRules,
        sessionUsed: sessCount,
        sessionCap: caps.sessionRules,
        regexCap: caps.regexRules,
    };
}

export async function getOurRules() {
    const [dyn, sess] = await Promise.all([
        readStore(dnr.getDynamicRules, DYNAMIC_RANGES),
        readStore(dnr.getSessionRules, SESSION_RANGES),
    ]);
    return { dynamic: dyn, session: sess };
}
