// enabled-ruleset policy - part of Ethereals N ADS (GPL-3.0). Copyright (C) 2026 nhatnam232.

import { RULESET_GROUPS, RUNTIME_CAPS } from './constants.js';
import { dnr, probeCaps, getRulesetDetails } from './ext-compat.js';
import { getSettings, getFilterLists } from './storage.js';

function groupOf(id, details) {
    const d = details?.find(x => x.id === id);
    return d?.group ?? RULESET_GROUPS[id] ?? 'default';
}

// pure: (settings, filterLists, rulesetDetails) → sorted enabled-id list
export function computePolicy(settings, filterLists, details) {
    const ids = (details || []).map(d => d.id);
    const toggles = settings.defaultToggles;
    const enabled = new Set();

    for (const id of ids) {
        const group = groupOf(id, details);
        if (group === 'test') { continue; }               // manifest-owned
        let on;
        switch (group) {
        case 'annoyances': on = toggles.annoyances === true; break;
        case 'aab':        on = toggles.aab !== false && settings.aabProfile !== 'off'; break;
        default:           on = toggles.ads !== false; break; // default+malware+regions
        }
        if (group === 'media') {
            if (id === 'youtube-1') { on = settings.modules?.youtube !== false; }
            if (id === 'spotify-1') {
                on = settings.modules?.spotify === true &&
                     settings.modules?.spotifyNoticeAccepted === true;
            }
        }
        // per-list override wins over the toggle-derived default
        const override = filterLists?.builtin?.[id];
        if (override !== undefined) { on = override === true; }
        if (on) { enabled.add(id); }
    }

    // honor the enabled-rulesets budget: default group first, then malware,
    // then everything else — deterministic ordering, no silent surprise.
    const rank = { default: 0, malware: 1 };
    return [...enabled]
        .sort((a, b) => (rank[groupOf(a, details)] ?? 2) - (rank[groupOf(b, details)] ?? 2) || a.localeCompare(b))
        .slice(0, RUNTIME_CAPS.enabledRulesets);
}

export async function apply() {
    const caps = await probeCaps();
    const [settings, filterLists, details] = await Promise.all([
        getSettings(),
        getFilterLists(),
        getRulesetDetails().catch(() => []),
    ]);
    const want = computePolicy(settings, filterLists, details).slice(0, caps.enabledRulesets);
    const current = (await dnr.getEnabledRulesets()) || [];
    // never touch the test group (dev builds own it via the manifest)
    const managed = (id) => groupOf(id, details) !== 'test';
    const enableRulesetIds = want.filter(id => !current.includes(id));
    const disableRulesetIds = current.filter(id => !want.includes(id) && managed(id));
    if (enableRulesetIds.length === 0 && disableRulesetIds.length === 0) {
        return { changed: false, enabled: current };
    }
    await dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    return { changed: true, enabled: want };
}
