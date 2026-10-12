# Generate candidate-list HTML

## 1. When to run

- During first-time setup.
- After updating `catalog/audio/candidates.json` (new sources/categories).
- After another lane such as audio-import registers new entries in `catalog/audio/`
  (refresh already-owned gray-out state).

## 2. Run

```sh
node packages/audio-library-setup/bin/generate-candidates-html.mjs
```

Default output: `catalog/audio/candidates.html`. Arguments can override:

```sh
node packages/audio-library-setup/bin/generate-candidates-html.mjs \
  --candidates catalog/audio/candidates.json \
  --catalog-dir catalog/audio \
  --out catalog/audio/candidates.html
```

After generation, show the user `open catalog/audio/candidates.html` (or the generated absolute path)
and ask them to open it in a browser.

## 3. What happens

- A **default-source AKARI Sounds banner** appears at the top with track count, bulk-acquisition command,
  and Release link. This is the BGM/jingle default ([first-party.md](first-party.md)).
- Displays the 13 candidate cards from `catalog/audio/candidates.json` (v2, owner ruling 2026-08-03),
  in 3 categories: applause / failure sounds / Japanese-style or battle hits and thuds, all missing from AKARI Sounds.
  v1's 68 cards (including 27 external BGM cards and overlapping SFX cards) are preserved unchanged as legacy
  `catalog/audio/candidates-legacy.json` and not displayed in HTML.
- Every card links **only to a download-page URL** (`target="_blank"`). Clicking opens the legitimate source page
  in a new tab; no audio file is acquired.
- **Ownership is calculated dynamically on every run by reading `catalog/audio/*/meta.json`.** An exact
  `source.url` match marks already-owned and grays out the card; a hostname-only match marks existing registration
  from the same distributor. This reflects other lanes' registrations without hardcoding.
- Cards display confidence badges (verified in this lane / verified during research / not automatically verifiable,
  manual check required) and license badges (credit requirements / AI training permission).
- Candidates with `credit_template` (sources requiring credit) display the exact wording prescribed by their terms.
  Prioritize accuracy for direct copying during editing; do not summarize or paraphrase.
- Note: Generator support for v1 BGM `mood[]` / `tempo` badges and collapsible `songs[]` still exists;
  future cards with `songs[]` will display as-is. See legacy JSON records for mood vocabulary and BGM mix design.

## 4. User guidance (template)

```text
音源の候補リストを用意しました: catalog/audio/candidates.html
「ダウンロードページを開く」を押すと配布元の正規ページが開きます。ご自身で保存する場合は
~/.akari/audio-drop/（無ければ作成してください）に置くと、次に登録スクリプトを
実行したときに自動で拾われます。
「取得して」と指示いただければ、保存までこちらで代行することもできます
（取得できなかった配布元はその場でお伝えします）。
```

## Common mistakes

- Replacing generated HTML links with direct audio-file URLs (always use distribution-page URLs).
- Hardcoding already-owned state (prevents other lanes' registrations from being reflected).
- Displaying `blocked_unverifiable` confidence items as verified.
