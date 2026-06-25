# Vendored code provenance

Ethereals N ADS borrows the **ruleset build pipeline** from
[uBlock Origin](https://github.com/gorhill/uBlock) (uBOL, `platform/mv3/`).
The files are fetched at build time by `tools/build.mjs` from a shallow clone
of `gorhill/uBlock` into `build/ubo-src` (kept out of git) and staged into
`build/stage/` — nothing vendored is committed to this repository.

Borrowed pieces (all © Raymond Hill & contributors, **GPL-3.0**):

| File (in build/stage/) | Origin |
|---|---|
| `make-rulesets.js` | `platform/mv3/make-rulesets.js` — patched **at stage time only** by `tools/build.mjs` (`hardenStagedCompiler`): list-fetch retry + never cache empty results. The vendored source in `build/ubo-src` is never modified. |
| `salvage-ruleids.mjs` | `platform/mv3/salvage-ruleids.mjs` — unmodified |
| `firefox/patch-ruleset.js` | `platform/mv3/firefox/patch-ruleset.js` — unmodified |
| `js/static-filtering-parser.js` | `src/js/` — unmodified |
| `js/static-dnr-filtering.js` | `src/js/` — unmodified |
| `js/*`, `lib/*`, `js/offscreen/*`, `js/resources/*`, `scriptlets/*`, `web_accessible_resources/*` | staged per `tools/make-nodejs.sh` + `tools/make-mv3.sh` layout — unmodified |

Our modifications live **outside** the vendored tree:
`tools/build.mjs` (staging/orchestration), `tools/patch-manifest.mjs`
(post-compile budget gate + strictblock strip + dev extras), `rulesets.json`,
`filters/*.txt` (curated lists with attribution headers).

Filter-list attributions ship in the extension's About tab and in each
`filters/*.txt` header. See LICENSE (GPL-3.0).
