# 承認後の実行

## 原則

このファイルは Checkpoint 3 の明示承認後だけ読む。承認された manifest を [M1〜M4 契約](../../docs/contract-2026-07-13-m1-m4.md) の `edit.json` と authoring 規約へ忠実に変換し、表現できない計画を独自フィールドで補わない。使ってよいのは公開契約が定めたフィールドだけである（[SKILL.md](SKILL.md) のハードルール）。

## 1. source 構成を確定する

**複数の映像素材が最終構成に必要なら、`edit.json v1`（`sources[]` + `cuts[].src`）で書く**。これが第一選択肢であり、[マルチソース契約](../../docs/contract-2026-07-18-edit-json-v1-sources.md) が定める公開フィールドである。render-cut は v1 の複数入力書き出しに対応済みで、素材をまたぐ順序・同じ素材の再登場・並べ替えをそのまま書き出せる。

素材構成は次から選び、選んだ理由を `decision-log.md` に追記する。

- **v1 マルチソース（複数素材の既定）**: `sources[]` へ素材、`cuts[]` へ `src` 付きクリップ列を書き、`version` を `1` にする。素材別の keep-range 編集性を保ったまま複数素材を並べられるので、B ロールや別テイクの差し込みもここで表す。
- **主素材 1 本の v0（単一素材で足りる場合の既定）**: 主素材 1 本だけで構成が成立するなら `version: 0` + 単一 `source` を維持する。version を上げる必要はない。
- **単一中間マスターへ conform（代替手段）**: v1 でも表現しにくい合成 — 焼き込みエフェクト、素材そのものを作り替える加工、公開契約に無い合成 — が要るときだけ、承認済み順序と区間を ffmpeg で 1 本にし、そのファイルを source にする。複数素材を 1 本として扱える一方、元素材別の keep-range 編集性が下がる。素材・source 時刻・master 時刻の対応表は `decision-log.md` に残す。

素材別に独立した `edit.json` を作る案が要件を満たす場合は併記してよい。承認を得ずに黙って concat したり、公開契約に無い `source_id` や独自 track を発明したりしない。

BGM と SFX は [音声契約](../../docs/contract-2026-07-14-edit-json-v1-audio.md) の `audio`（version を問わない任意フィールド）で書き、ナレーションは [narration 契約](../../docs/contract-2026-07-20-edit-json-v1-narration.md) の `audio.narration[]` で書く。動画 B ロールは v1 の `sources[]` + `cuts[].src` で表す。いずれの契約でも表せない計画は、中間マスターへ焼き込むか、計画のみとして未実行にするかを manifest で区別する。

### v1 で書くときの注意

- **`cuts` が空 = 空タイムライン**。v0 の「空 = source 全体を使う」と意味が違う。v1 で素材全体を使いたいなら `{ "src": "s1", "in": 0, "out": <素材尺> }` を明示的に書く。素材尺が取得できず全体 cut を作れないときは、推測せず停止して報告する。空タイムラインは契約上は合法なので edit-lint も PASS し、書き出し段で `no output duration because cuts is empty` として初めて止まる。
- **字幕・注釈・解析結果は (`src`, source 秒) でアンカーする**。同じ素材区間がタイムライン上に複数回現れ得るため source 秒 → timeline 秒は一対多であり、timeline 秒へ変換した結果を永続化しない。字幕（`captions.json`）と注釈（`review.json` の `annotations[]`）の各項目は `src` に `sources[].id` を書く。`src` の省略は単一ソース互換の意味になり、素材が 2 本以上ある edit では当該項目が警告付きでスキップされる。
- **`sources[].id` は `s1`, `s2`, … の連番を推奨**。参照は path ではなく安定した id で行うので、素材の差し替えや path 変更で cut・サイドカーの参照が壊れない。id はファイル内で一意にする。
- `source` と `sources[]` は排他である。v0 のまま `sources[]` を書いたり、`version: 1` で単一 `source` を残したりしない。
- `overlays[].start`、`audio.bgm`、`audio.sfx[].t` は v0 / v1 を問わずアウトプットタイムライン座標であり、この source 秒アンカー規則の対象外である。

## 2. edit.json を作る

承認値を次の形へ入れる。例の数値を既定値として流用しない。

**単一素材（v0）**

```json
{
  "version": 0,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "source": {
    "path": "source/master.mp4",
    "proxy": "source/master-proxy.mp4"
  },
  "cuts": [
    { "in": 5.0, "out": 10.0 }
  ],
  "overlays": [
    {
      "id": "chapter-setup",
      "html": "overlays/chapter-setup.html",
      "start": 1.0,
      "duration": 4.0,
      "transform": { "x": 0, "y": -80, "scale": 1, "rotate": 0 },
      "vars": { "--color": "#ffffff" }
    }
  ]
}
```

**複数素材（v1）**

```json
{
  "version": 1,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [
    { "id": "s1", "path": "source/interview.mp4", "proxy": "source/interview-proxy.mp4" },
    { "id": "s2", "path": "source/broll-workshop.mp4", "proxy": null }
  ],
  "cuts": [
    { "src": "s1", "in": 5.0, "out": 10.0 },
    { "src": "s2", "in": 12.0, "out": 15.5 },
    { "src": "s1", "in": 40.0, "out": 44.0 }
  ],
  "overlays": [
    {
      "id": "chapter-setup",
      "html": "overlays/chapter-setup.html",
      "start": 1.0,
      "duration": 4.0,
      "transform": { "x": 0, "y": -80, "scale": 1, "rotate": 0 },
      "vars": { "--color": "#ffffff" }
    }
  ]
}
```

- v0 の `source.path`、v1 の `sources[].path` は原本または承認済み中間マスター、`proxy` は対応する 720p preview。原本を proxy へ置き換えない。proxy が無い素材は `null` を書く。
- path は `edit.json` からの相対または絶対。可搬性のため同一ツリーでは相対を使う。
- v0 の `cuts` は source 秒の keep-range で昇順・非重複。空配列は source 全体を使う。
- v1 の `cuts` は `src` で素材を指すクリップ列で、**配列順がそのままタイムライン順**になる。同じ `src` の再登場と任意の並べ替えを認め、昇順・非重複は強制しない。各要素は `0 <= in < out` を満たし、`src` は `sources[].id` を指す。空配列は空タイムラインである。
- `overlays.start` は cut 連結後の timeline 秒。source 秒の event をそのまま入れない。
- overlay ID は一意、HTML path は存在し、`duration > 0` とする。

v0 では、source 時刻 `s` が keep-range `[in, out]` にあるとき、timeline 時刻は「それ以前の keep-range 長の合計 + `(s - in)`」で求める。v1 では `cuts` を配列順にギャップなく連結し、各 cut の長さを `out - in` として同じ式で求める（上の例なら s1 5.0–10.0 が timeline 0.0–5.0、s2 12.0–15.5 が 5.0–8.5、s1 40.0–44.0 が 8.5–12.5）。同じ `(src, source 秒)` が複数の cut に含まれるなら、対応する timeline 時刻も複数になる。境界にある overlay は実フレームを確認し、カットで消える区間へ置かない。

### 切り出し・先出しクリップの発話スナップと呼吸

トレーラー・オープニングフック・引用など、本編とは別に短く切り出すクリップ（以下「切り出し・先出しクリップ」）の `in` / `out` は、**クリップ内の発話を `analysis.json` の word-level 実測（`transcript[].words`）で拾い、発話へスナップして決める**。ハードルール:

- **窓 = クリップ内発話の頭 − 0.25s / 末尾 + 0.25s**（前後合わせて呼吸 0.5s。オーナー指針 2026-07-24）。発話の頭・末尾ギリギリで詰めず、前後に無音の呼吸を残して急な切替感を消す。
- coarse な segment 時刻（whisper の 2 秒量子化・句読点境界）や**見せ場スコア位置の機械窓のまま切り出さない**。機械窓は発話の外で切れていることがあり、意図した発話が窓の外へ落ちる。
- **発話を含まない切り出し窓を作らない**。見せ場スコアが指す位置に発話が無ければ、窓ではなく発話の実測区間を正本にして取り直す。
- **全文表示が 1.0 秒未満になる字幕を含むクリップを作らない**。収まらないなら窓を字幕が読める長さまで延ばすか、その字幕を落とす（読めない字幕を出さない）。
- スナップに使う `words` は source 秒。窓（`cuts[].in/out`）も source 秒で書く（§1 の source 秒アンカー規則）。

呼吸 0.5s（頭 0.25s / 末尾 0.25s）は、将来 `direction` のプリセット / `intensity` 写像（`join_breathing`）に載る予定である（席の予約。ここでは写像を定義せず、現時点の採用値は固定値として `decision-log.md` に記す）。

## 3. オーバーレイ HTML を作る

最初に [overlay-authoring](../overlay-authoring/SKILL.md) を読み、必要なリーフだけを追加で読む。利用不能なら [CLAUDE.md の authoring 規約](../../CLAUDE.md) を読み、fallback を `decision-log.md` に追記する。

- 断片のルート要素は 1 個にする。
- 調整可能な値を `--x`、`--y`、`--scale`、`--font-size`、`--color` 等の CSS 変数にする。
- `edit.json.overlays[].start/duration` を SSOT とし、ランタイム所有の外側コンテナに反映される `data-start` / `data-duration` と一致させる。断片内に独立した時刻源を作らない。
- アニメーションは transform / opacity 中心にし、4K 映像上の `filter: blur()` と `backdrop-filter` を使わない。
- wall-clock に依存せず、シーク時に Web Animations API の `currentTime` で同じ絵を再現できるようにする。
- 3D が必要なら Three.js + glTF、動画 texture は proxy を使う。
- transcript 等の可変文字列を HTML と CSS の文脈に合わせて escape する。

サムネ用の HTML 文字組を、タイミング付き動画 overlay として無条件に再利用しない。

## 4. 字幕（captions.json）の表示区間を作る

字幕を持つ計画では、各 caption の表示区間を**実発話区間**に一致させる。segment 境界を敷き詰めた（`end = 次の caption の start`）字幕は、ポーズ・無音・フィラー間にも字幕を残し、実発話より早く出る／長く残る。ハードルール:

- **`caption.start` = 先頭語（`words[0]`）の実測 start / `caption.end` = 末尾語（`words[-1]`）の実測 end + 読み切り猶予**。読み切り猶予は既定 **0.2〜0.4 秒**（採用値は `decision-log.md` に記す）。
- **次 caption の start まで引き伸ばさない**（敷き詰め禁止）。**無発話区間（発話 `words` が無い区間）は無字幕**とする。隙間が生まれるのが正であり、隙間を字幕で埋めない。
- caption の start / end は source 秒アンカー（§1）。`words[]` も同じ source 秒で持つ。
- **按分 fallback（`words` が取れず segment の start/end を文字数比で分配する推定）を使うときも、敷き詰め禁止は同じ**。按分は末尾語 end の**時刻の推定**であって**区間の拡張ではない**ので、推定した末尾 end + 読み切り猶予で閉じ、次 caption まで伸ばさない。
- 参照挙動: 旧 Akari-OS（video-on-os）の字幕表示。字幕の付ける/付けない・スタイル等の方針レベルは [report-guide.md](report-guide.md) の素材計画 §字幕枠で決め、ここでは区間の作り方だけを定める。

## 5. 検証して判断記録を閉じる

- [edit-lint](../edit-lint/SKILL.md) を実行し、`edit.json` の構造、cuts 整合、参照解決、
  overlay の timeline 時刻・ID・HTML root・data 属性が PASS になるまで findings を修正する。
  v1 では `sources[].id` の一意性と `cuts[].src` の参照整合も検査対象になる。
- overlay の CSS 変数と禁止 CSS は overlay-authoring 規約に照らして確認する。
- 中間マスターを作った場合は、素材別対応表と実フレームで境界を確認する。
- `decision-log.md` に実行結果（生成物一覧・provenance・実行日時）を追記し、Checkpoint 3
  が実行済みであることを記録する。過去の log 行は変更しない。

## よくある間違い

- `version: 0` のまま `sources[]` を書く（`sources[]` を使うファイルは `version: 1`）。
- `version: 1` で `cuts` を空のまま「素材全体を使う」つもりになる（v1 の空 `cuts` は空タイムライン）。
- `version: 1` で `cuts[].src` を省く、または `sources[].id` に無い id を書く。
- `source` と `sources[]` を併存させる（排他。lint エラー）。
- 複数素材を理由に、公開契約に無い `source_id` や独自 track を追加する。
- 素材計画にある BGM / SFX / ナレーションを、契約フィールド（`audio` / `audio.narration[]`）ではなく独自 field で書く。
- 字幕・注釈・解析結果を timeline 秒へ変換して永続化する（正本は (`src`, source 秒)）。
- **caption の表示区間を segment 境界で敷き詰め（`end = 次の caption の start`）、無発話区間にも字幕を残す**（実発話が終われば字幕も終わる。§4）。
- 按分 fallback を「区間の拡張」に使い、末尾語の推定 end を越えて次 caption まで字幕を伸ばす（§4）。
- **切り出し・先出しクリップを見せ場スコア位置の機械窓（segment 量子化時刻）のまま切り出し、意図した発話を窓の外へ落とす／全文 1.0s 未満の読めない字幕を出す**（発話へスナップし呼吸 0.5s を残す。§2）。
- `cuts` と overlay の時刻をどちらも source 秒で書く。
- 実行承認前に中間マスターや overlay を作る。
- authoring skill がないことを理由に規約を省略する。
- edit.json の sample 値を、承認されていない出力仕様として使う。
