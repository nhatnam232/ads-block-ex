# Changelog - Ethereals N ADS

## 0.1.0 - 2026-09-19
- Fix `isIPAddress` check sai voi IPv6 co ngoac (`constants.js`). Truoc do `::1` tra ve false.
- Dong bo version manifest chromium/firefox len 0.1.0 cho khop package.json.
- Them `make clean-win` cho may Windows, `make clean` cu giu nguyen.
- Doi dau `—` trong comment thanh `-` vai file js cho nhe.

## 0.0.9 - 2026-09-12
- Sua budget gate dem 0 rules (doc nham field `counts` trong ruleset-details.json, thuc te compiler ghi `rules`).
- Patch manifest chay truoc gate de ban dev bat test-1 khong lot.
- Strip strictblock redirect vi v1 chua co trang interstitial.

## 0.0.8 - 2026-09-05
- Build hay rot kieu "Filter list should not be empty" do undici dung socket dang dong.
  Fix tam: server list local tra `connection: close`, retry fetch 3 lan, khong cache file rong.
- Them log `[build] staged compiler hardened` de biet da patch.

## 0.0.7 - 2026-08-28
- `dynamic-rules`: bo kieu merge cu, chuyen sang replace dung range. Truoc do `clearRange` goi xong van con rule cu.
- Tach session store vs dynamic store cho myRules temporary.
- Bui: youtube patcher doi sang check `movie_player` 2s/lan, han che reload vo han.

## 0.0.6 - 2026-08-18
- Spotify patcher: rewire state machine theo endpoint `replace_state`, null track `ads/inject_tracks`.
  Ghi nhan 09/2026: uri nam o `metadata.uri`, `content_type == AD`.
- Them diag tab hien `scriptletSyncStatus` de thay vi sao dang ky rot.
- Spotify can 3 cong: module on + chiu ToS + co host permission.

## 0.0.5 - 2026-08-02
- Viet lai popup theo kieu cong tac nguon (VPN-style), nho `lastMode` de bat lai dung che do cu.
- Them grant funnel xin host permission tu popup, giu trong click gesture.
- Compact so 1.2K / 3.4M cho o thong ke.

## 0.0.4 - 2026-07-20
- Ruleset policy: default group truoc, malware sau, con lai sau. Per-list override thang toggle.
- Spotify mac dinh off vi ToS, youtube mac dinh on.
- Them tieng Viet cho popup + options, con vai cau de nguyen tieng Anh cho de sua sau.

## 0.0.3 - 2026-07-08
- Mini-compiler user rules: chi nhan network filter (`||host^`, `|https://`, `/regex/`, `@@`).
  Cosmetic `##` va scriptlet bao loi ro rang chu khong im lang.
- Tu choi `redirect/removeparam/csp/denyallow` vi DNR khong bieu dien trung thuc duoc.

## 0.0.2 - 2026-06-25
- Dung pipeline ruleset cua uBlock (`make-rulesets.js`) qua loopback server, khong vendor code vao repo.
- Viet `make-icons.mjs` tu ve shield PNG bang stdlib (do luoi cai deps).
- Chay duoc lan dau tren chromium unpacked + firefox temporary addon.

## 0.0.1 - 2026-06-15
- Khoi tao repo: background router, constants lam source of truth, storage typed.
- Chua co cosmetic engine, picker moi wire message nhung tra loi "ships in v2".
