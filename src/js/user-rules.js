// user rule mini-compiler (filter text → DNR rule) — part of Ethereals N ADS (GPL-3.0).

import { PRIORITY } from './constants.js';

// abp option → DNR resourceTypes (1:n where the ABP notion is broader)
const RESOURCE_TYPES = {
    'document': ['main_frame'],
    'subdocument': ['sub_frame'],
    'image': ['image'],
    'stylesheet': ['stylesheet'],
    'script': ['script'],
    'xmlhttprequest': ['xmlhttprequest'],
    'fetch': ['xmlhttprequest'],
    'websocket': ['websocket'],
    'media': ['media'],
    'font': ['font'],
    'object': ['object'],
    'other': ['other'],
    'popup': ['main_frame'], // approximation: v2 needs documentLifecycle
};

const DOMAIN_TYPE = {
    'third-party': 'thirdParty',
    'first-party': 'firstParty',
};

// patterns we refuse, with the reason surfaced to the editor
function rejectLine(line) {
    if (/##\+js\(/.test(line)) {
        return 'Scriptlet filters are not supported yet (planned for v2).';
    }
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) {
        return 'Cosmetic filters are not supported yet (planned for v2).';
    }
    if (/\$(.*\b)?(removeparam|redirect|csp|permissions|header|replace|urlskip|strictblock)=?/i.test(line)) {
        return 'Action options (redirect, removeparam, …) are not supported in user rules.';
    }
    if (/\bdenyallow=/.test(line)) {
        return 'The $denyallow option is not supported in user rules.';
    }
    return null;
}

// parse the option string into condition fields; returns {error} on anything
// we cannot express faithfully in DNR (better a loud error than a silent
// mis-block).
function parseOptions(raw) {
    const condition = {};
    if (!raw) { return { condition }; }
    for (const opt of raw.split(',')) {
        const [key, val] = opt.split('=', 2);
        if (key === 'domain') {
            condition.initiatorDomains = val.split('|')
                .map(d => d.replace(/^~/, '').trim().toLowerCase())
                .filter(Boolean);
            if (val.includes('~')) {
                return { error: 'Negated $domain entries are not supported.' };
            }
        } else if (DOMAIN_TYPE[key]) {
            condition.domainType = DOMAIN_TYPE[key];
        } else if (RESOURCE_TYPES[key]) {
            condition.resourceTypes = [
                ...new Set([...(condition.resourceTypes || []), ...RESOURCE_TYPES[key]]),
            ];
        } else if (key === 'match-case' || key === 'important' || key === '1p' || key === '3p') {
            // DNR matching is case-insensitive and priority is ours; 1p/3p
            // map to domainType like their long forms.
            if (key === '1p') { condition.domainType = 'firstParty'; }
            if (key === '3p') { condition.domainType = 'thirdParty'; }
        } else {
            return { error: `Unsupported option: $${key}` };
        }
    }
    return { condition };
}

// validate a /regex/ filter for RE2 compatibility the cheap way: reject
// constructs RE2 lacks (lookaround, backrefs) plus the DNR 1024-char cap.
function regexToCondition(re) {
    if (re.length > 1024) { return { error: 'Regex longer than 1024 characters.' }; }
    if (/\\\d|\(\?[<=!]/.test(re)) {
        return { error: 'Regex uses backreferences or lookaround (unsupported).' };
    }
    try { new RegExp(re); } catch { return { error: 'Invalid regex.' }; }
    return { condition: { regexFilter: re, isUrlFilterCaseSensitive: false } };
}

function hostnameToCondition(host) {
    const clean = host.trim().toLowerCase();
    if (!clean || /[^a-z0-9.*-]/.test(clean)) {
        return { error: `Invalid hostname: "${host}"` };
    }
    // ||host^ ≡ "host or any subdomain, any scheme/path" — exactly DNR's
    // urlFilter domain anchor.
    return { condition: { urlFilter: `||${clean}^` } };
}

export function parseUserRule(line) {
    const text = (line || '').trim();
    if (text === '' || text.startsWith('!') || text.startsWith('# ') ||
        text.startsWith('[')) {
        return { ok: false, skip: true };
    }
    const rejected = rejectLine(text);
    if (rejected) { return { ok: false, error: rejected }; }

    const isException = text.startsWith('@@');
    const body = isException ? text.slice(2) : text;

    const dollar = body.lastIndexOf('$');
    const pattern = dollar === -1 ? body : body.slice(0, dollar);
    const opts = dollar === -1 ? '' : body.slice(dollar + 1);
    const { condition, error } = parseOptions(opts);
    if (error) { return { ok: false, error }; }

    let cond = condition;
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
        const re = regexToCondition(pattern.slice(1, -1));
        if (re.error) { return { ok: false, error: re.error }; }
        cond = { ...condition, ...re.condition };
    } else if (pattern.startsWith('||') || pattern.includes('.')) {
        // ||host^ / ||host/path / bare hostname (hosts-file style)
        const rest = pattern.startsWith('||') ? pattern.slice(2) : pattern;
        const slash = rest.indexOf('/');
        const hostPart = (slash === -1 ? rest : rest.slice(0, slash))
            .replace(/\^+$/, '').toLowerCase();
        const pathSuffix = slash === -1 ? '' : rest.slice(slash).toLowerCase();
        const hc = hostnameToCondition(hostPart);
        if (hc.error) { return { ok: false, error: hc.error }; }
        // keep a path suffix if the user wrote one (||host/ads/)
        if (pathSuffix !== '') {
            hc.condition.urlFilter = `||${hostPart}${pathSuffix}`;
        }
        cond = { ...condition, ...hc.condition };
    } else if (pattern.startsWith('|')) {
        // |https://… address anchor maps straight to urlFilter
        cond = { ...condition, urlFilter: pattern.toLowerCase() };
    } else {
        return { ok: false, error: `Cannot parse: "${text}"` };
    }

    return {
        ok: true,
        rule: {
            priority: isException ? PRIORITY.userAllow : PRIORITY.userBlock,
            action: { type: isException ? 'allow' : 'block' },
            condition: cond,
        },
    };
}

// compile N lines into {rules, errors} — ids assigned densely from `startId`
// upward, oldest-first by input order so re-compiles stay stable.
export function compileLines(lines, startId) {
    const rules = [];
    const errors = [];
    for (const line of (lines || [])) {
        const r = parseUserRule(line);
        if (r.skip) { continue; }
        if (!r.ok) { errors.push({ text: line, error: r.error }); continue; }
        rules.push({ id: startId + rules.length, ...r.rule });
    }
    return { rules, errors };
}
