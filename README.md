# Ethereals N ADS

A fast, privacy-first, cross-browser ad blocker in the spirit of Brave
Shields and uBlock Origin Lite. Chrome MV3 **and** Firefox MV3 from one
shared code base. **GPL-3.0.**

- **No host permissions at install** (Chrome): per-site origins are granted
  from the popup, uBOL-style. Firefox grants `<all_urls>` at install but
  revocation is re-checked continuously.
- **No telemetry. No remote code.** Filter lists are data; scriptlet code is
  always packaged.
- **Zero npm dependencies.** Build tooling is plain Node stdlib; the ruleset
  compiler is uBlock Origin's, borrowed at build time (see
  `tools/vendored-README.md`).

## Architecture

```
platform/{chromium,firefox}/manifest.json   per-platform MV3 manifests
src/js/          background modules
  background.js    entry: message router (popup/options ⇄ SW), lifecycle
  constants.js     single source of truth: caps, priorities, ids, MSG protocol
  ext-compat.js    chrome/firefox compatibility + promisified helpers
  storage.js       typed storage helpers (local: durable, session: per-tab)
  mode-manager.js  per-site filtering modes (uBOL semantics)
  dynamic-rules.js single writer for dynamic/session DNR rules
  ruleset-policy.js toggles/modules → enabled static rulesets
  user-rules.js    user filter text → DNR rules (mini-compiler)
  tab-stats.js     per-tab block tallies + durable stats
  permissions.js   host-permission tracking + popup grant funnel
src/popup/       toolbar popup (mode picker, toggles, recent blocks)
src/options/     settings page (8 tabs incl. backup/restore, diagnostics)
src/_locales/    en + vi
filters/         curated local lists (anti-anti-adblock, YouTube, Spotify)
rulesets.json    upstream + local list selection (14 lists, grouped)
tools/           build orchestrator + post-compile budget gate
```

Filtering levels per site (uBOL semantics): `none` (allowAllRequests) →
`basic` (network only, no host permissions needed) → `optimal` (+ cosmetic,
needs the site origin) → `complete` (generic cosmetics everywhere).

## Build

Requirements: Node 20+, `git`, network for the first `assets` download.

```sh
make assets      # download upstream filter lists into build/lists/ (cached)
make chromium    # dist/chromium  (DEV=1 make chromium → dev extras)
make firefox     # dist/firefox
make all         # both
make icons       # regenerate src/img/ PNGs
make test        # unit (node:test) + e2e build smoke
```

`make compile` stages uBO's compiler from a shallow clone of `gorhill/uBlock`
(`build/ubo-src`, gitignored), runs it against the cached lists plus
`filters/*.txt` through a loopback HTTP server, then applies
`tools/patch-manifest.mjs`:

- **hard budget gate** — fails the build above 28 000 enabled static rules,
  10 enabled rulesets, or 900 regex rules (Firefox throws above 30 000);
- strips `strictblock` redirect rules (v1 ships no interstitial);
- `DEV=1` adds `declarativeNetRequestFeedback`, enables the deterministic
  `test-1` ruleset (reserved `.test` TLD), switches the gecko id to dev.

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
`dist/chromium`; Firefox: `about:debugging` → This Firefox → Load Temporary
Add-on → `dist/firefox/manifest.json`.

## Tests

```sh
node --test test/unit/   # constants, mode-manager, dynamic-rules, user-rules,
                         # storage, ruleset-policy — against an in-memory
                         # chrome.* mock
node test/e2e/run.mjs    # full build of both platforms + dist layout asserts
                         # (skips itself when offline with no cache)
```

## Deferred to v2 (marked `TODO(v2)` in code)

Element picker (`MSG.openPicker` / `epickerCommit` are wired but answered
with a clear error), remote quick-fix channel (alarm + seed only), userscripts
onboarding flow, Firefox badge tally, generic cosmetic filtering.

## Site scriptlets (v2)

Packaged MAIN-world bundles injected per navigation
(`webNavigation.onCommitted` → `scripting.executeScript`, world MAIN) —
gated by module toggles + host permissions, no remote code:

- `src/scriptlets/site/spotify-patcher.js` — rewrites the player state
  machine so ad states are skipped or finish instantly (opt-in module,
  ToS acknowledgement required).
- `src/scriptlets/site/youtube-patcher.js` — prunes ad scheduling from
  player payloads (json-prune family), appends inner-tube client-hint
  tokens so the server returns ad-free responses, and auto-skips
  leaked ads. SSAI stream-stitched ads are a known ecosystem-wide limit.

## License & attributions

GPL-3.0 — see `LICENSE`. The ruleset build pipeline is borrowed from
[uBlock Origin](https://github.com/gorhill/uBlock) (© Raymond Hill &
contributors, GPL-3.0); nothing vendored is committed to this repository.
Shipped filter lists: uBlock filters, EasyList, EasyPrivacy, Peter Lowe,
URLhaus, ABPVN (🇻🇳), plus our curated local lists — full attributions live
in each `filters/*.txt` header and in the extension's About tab.
