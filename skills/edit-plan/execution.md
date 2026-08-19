# 承認後の実行

> **edit.json v2**: トップレベルは exact で、`version` / `output` / `sources` / `tracks` /
> `audio` / `captions` / `thumbnail` 以外を書けない。`beats` / `emphasis_words` / `direction` は
> v2 の `edit.json` へ書かず、判断記録に置く。再受け入れは別タスクとする。

## 原則

このファイルは Checkpoint 3 の明示承認後だけ読む。承認された manifest を [M1〜M4 契約](../../docs/contract-2026-07-13-m1-m4.md) の `edit.json` と authoring 規約へ忠実に変換し、表現できない計画を独自フィールドで補わない。使ってよいのは公開契約が定めたフィールドだけである（[SKILL.md](SKILL.md) のハードルール）。

cut candidate report がある場合も、それ自体は実行承認ではない。`decision:"REVIEW_REQUIRED"` の
候補を直接 cuts へ写さず、人間が今回の report に対して採否を明示し、append-only decision log に
追記されたものだけを使う。final edit の fps が 30 以外、speed が 1 以外、track が 0 以外、または
timeline `at` を加える場合、report の pause frame proposal は無効として再計算・再 review する。
Checkpoint 3 まで `edit.json` を変更しない。

候補適用後も完了を自動判定しない。同じ preview/render 版について、人間が
`POST_CUT_ASR_REVIEW`（cut 後の再文字起こしと原音照合）、`POST_CUT_INFORMATION_RETENTION`
（前後文脈と必要情報の保持）、`POST_CUT_UI_TIMING_REVIEW`（クリック・遷移・読込待ち・結果表示）、
`POST_CUT_AUDIO_BOUNDARY_REVIEW`（click、語頭語尾、呼吸、残響、無音）を確認し、最後に
`HUMAN_APPLY_GATE` を明示承認するまで完成扱いにしない。どれかを修正した場合は新しい版で全項目を
再確認し、結果を append-only `decision-log.md` に追記する。

## 1. 素材と段を確定する

**新規に作る `edit.json` は素材数に関係なく v2 で書く。** `sources[]` に素材を宣言し、
`tracks[].items[]` にクリップを置く。旧 `cuts` / `layers` / `overlays` キーは作らない。

- 段は `lane: "visual" | "audio"` と `tracks[]` の配列順だけを持つ。visual の重なりは配列の
  後ろほど前面。「本編」「レイヤー」という種別で段を分けない。
- クリップの出力位置 `at` / `duration` は整数フレーム、media の素材区間
  `source.in` / `source.out` は秒で書く。
- 素材の種類は段ではなく `source.kind`（`media` / `html` / `telop` / `filter`）で表す。
- 空の `items[]` を持つ宣言済み段は残す。移動で空になっても自動削除しない。
- v0 / v1 を開いたときの変換は読み込み層の提案 → 明示承認へ任せ、スキルが独自変換しない。

### 音楽の配置はクリップが標準（2026-08-18 決定）

**動画の一部区間だけに音楽を敷きたいときは、audio 段へ media クリップとして置くのが標準**である。`source.in` / `source.out` は素材秒、`at` / `duration` は整数フレーム。映像クリップと同じく移動・トリムできる。

```json
{
  "id": "music-1",
  "at": 360,
  "duration": 480,
  "source": { "kind": "media", "src": "music", "in": 48.0, "out": 64.0 }
}
```

上の例は 30fps で素材 48.0〜64.0 秒を出力 12.0 秒から鳴らす。`sources[]` には
`{ "id": "music", "path": "assets/audio/theme-song.m4a" }` を宣言する。

`audio.bgm` は**全編に敷くだけの最短表現（ベッド）として後方互換で残る**（新規プロジェクトの既定はクリップ）。曲を頭から流し、動画尺に合わせて自動ループ・自動追従させたいだけなら `bgm`（`t`/`out` を書かず尺を気にしなくてよい）を使う。部分区間だけに敷きたい・複数曲を切り替えたい・任意の位置で明示的にトリムしたい場合は、音楽であっても `sfx[]` のクリップで書く。

### v2 で書くときの注意

- **`items[]` が空の段は空のまま残る**。素材全体を使う場合も media クリップを明示する。
- **字幕・注釈・解析結果は (`src`, source 秒) でアンカーする**。同じ素材区間がタイムライン上に複数回現れ得るため source 秒 → timeline 秒は一対多であり、timeline 秒へ変換した結果を永続化しない。字幕（`captions.json`）と注釈（`review.json` の `annotations[]`）の各項目は `src` に `sources[].id` を書く。`src` の省略は単一ソース互換の意味になり、素材が 2 本以上ある edit では当該項目が警告付きでスキップされる。
- **`sources[].id` は `s1`, `s2`, … の連番を推奨**。参照は path ではなく安定した id で行うので、素材の差し替えや path 変更で cut・サイドカーの参照が壊れない。id はファイル内で一意にする。
- `version` は 2、素材表は `sources[]`、クリップは `tracks[].items[]` に限る。
- `at` / `duration` は出力フレーム、media の `source.in` / `source.out` は素材秒である。

### 静止画素材の扱い（2026-08-12）

- **静止画は visual 段へ media クリップとして直接置く**。画像 1 枚につき item 1 件にし、
  ffmpeg で連結しない。`at` / `duration` / `transform` / `crop` / `perspective` / `keyframes` は
  ほかの visual クリップと同じに使う。

### 重ねる media クリップの時間基準

人物切り抜き・B-roll など別の visual 段に重ねる素材では、**十数フレーム単位のズレを作り込みやすい**。
正本は `docs/contract-2026-08-02-preview-parity.md` §2.4 と
`docs/contract-2026-07-22-render-basics.md` §2-3。

- media クリップは `source.in` / `source.out` で素材区間、`at` / `duration` で出力区間を明示する。
  「パネルが先に出ているから素材にもプリロールがあるはず」といった**推測でのトリムをしない**。
  推測でトリムすると素材の頭が前へずれ、さらに `duration` を詰めた分だけ末尾で素材が尽きて
  「重ねた素材が消えて下地だけになる」瞬間が出る。
- 素材を事前に切り出した場合は
  **由来（元素材 / in / out / speed / fps）を素材の隣に必ず残す**。残さないと次に触る人が
  「この素材の頭は何の時刻か」を推測することになり、同じ事故を繰り返す。
- 段ごとに色を変える場合は filter item を明示し、`source.kind: "filter"` を使う。
- 時間対応を後から**実測**するときは、`blend=difference` の絶対差を使わない。上記の色差が
  支配して指標が平坦になり、誤った結論（適当な lag が「最小」に見える）に落ちる。
  **フレーム間差分エネルギーの時系列**（`format=gray,tblend=all_mode=difference` →
  `signalstats` の YAVG）を素材側とカット側で取り、正規化して**相互相関**させると、
  色に不変で lag を特定できる。カットに `speed` が掛かっている場合は、素材が
  「速度適用済みで焼かれている」のか「素材レートのまま」なのかもこの相関で判別できる。

## 2. edit.json を作る

承認値を次の形へ入れる。例の数値を既定値として流用しない。

**v2（30fps、映像 + HTML クリップ）**

```json
{
  "version": 2,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [
    { "id": "s1", "path": "source/master.mp4", "proxy": "source/master-proxy.mp4" }
  ],
  "tracks": [
    {
      "id": "v1", "lane": "visual", "name": "インタビュー",
      "items": [
        { "id": "clip-1", "at": 0, "duration": 150,
          "source": { "kind": "media", "src": "s1", "in": 5.0, "out": 10.0 } }
      ]
    },
    {
      "id": "v2", "lane": "visual", "name": "タイトル",
      "items": [
        { "id": "title-1", "at": 30, "duration": 120,
          "source": { "kind": "html", "path": "overlays/chapter-setup.html",
            "vars": { "--color": "#ffffff" } } }
      ]
    }
  ]
}
```

- `sources[].path` は原本、`proxy` は対応する 720p preview。原本を proxy へ置き換えない。
- track id / item id は文書内で一意にする。
- visual の重なりは `tracks[]` の配列順だけで決める。別の z フィールドを作らない。
- media は `0 <= source.in < source.out`、全 item は整数の `at >= 0` / `duration >= 0` を満たす。

### 切り出し・先出しクリップの発話スナップと呼吸

トレーラー・オープニングフック・引用など、短く先出しするクリップの `source.in` / `source.out` は、**クリップ内の発話を `analysis.json` の word-level 実測（`transcript[].words`）で拾い、発話へスナップして決める**。ハードルール:

- **窓 = クリップ内発話の頭 − 0.25s / 末尾 + 0.25s**（前後合わせて呼吸 0.5s。オーナー指針 2026-07-24）。発話の頭・末尾ギリギリで詰めず、前後に無音の呼吸を残して急な切替感を消す。
- coarse な segment 時刻（whisper の 2 秒量子化・句読点境界）や**見せ場スコア位置の機械窓のまま切り出さない**。機械窓は発話の外で切れていることがあり、意図した発話が窓の外へ落ちる。
- **発話を含まない切り出し窓を作らない**。見せ場スコアが指す位置に発話が無ければ、窓ではなく発話の実測区間を正本にして取り直す。
- **全文表示が 1.0 秒未満になる字幕を含むクリップを作らない**。収まらないなら窓を字幕が読める長さまで延ばすか、その字幕を落とす（読めない字幕を出さない）。
- スナップに使う `words` は source 秒。窓（media の `source.in` / `source.out`）も source 秒で書く。

呼吸 0.5s（頭 0.25s / 末尾 0.25s）の採用値は `decision-log.md` に記す。

## 3. オーバーレイ HTML を作る

最初に [overlay-authoring](../overlay-authoring/SKILL.md) を読み、必要なリーフだけを追加で読む。利用不能なら [CLAUDE.md の authoring 規約](../../CLAUDE.md) を読み、fallback を `decision-log.md` に追記する。

- 断片のルート要素は 1 個にする。
- 調整可能な値を `--x`、`--y`、`--scale`、`--font-size`、`--color` 等の CSS 変数にする。
- HTML item の `at` / `duration` を SSOT とし、断片内に独立した時刻源を作らない。
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

### 字幕スタイルを適用する

ユーザーが「このスタイルで」など preset 名・系統を指定した場合は、`presets/textstyle/INDEX.md` または `presets/textstyle/index.jsonl` から対応する preset id を引く。プロジェクト全体へ適用するときはリポジトリルートから次を実行する。

```sh
node packages/render-cut/bin/akari-apply-textstyle.mjs <project-dir> <preset-id>
```

特定の字幕行だけへ適用するときは、0-based index または caption id を `--caption` に指定する（複数回指定可）。

```sh
node packages/render-cut/bin/akari-apply-textstyle.mjs <project-dir> <preset-id> --caption <index|id>
```

書き込み前に差分 JSON を確認する場合は、どちらのコマンドにも `--dry-run` を加える。preset が持つフィールドは既存の `default_text_style` または `captions[].text_style` へマージされ、preset が宣言していない既存フィールドは保持される。preset の語彙にない微調整、または preset を使わない微調整は、従来どおり `text_style` を `captions.json` に直接書いて行う。

## 5. 検証して判断記録を閉じる

- [edit-lint](../edit-lint/SKILL.md) を実行し、v2 構造、track / item id の一意性、source 参照、
  整数フレーム時刻、HTML root が PASS になるまで findings を修正する。
- overlay の CSS 変数と禁止 CSS は overlay-authoring 規約に照らして確認する。
- 中間マスターを作った場合は、素材別対応表と実フレームで境界を確認する。
- `decision-log.md` に実行結果（生成物一覧・provenance・実行日時）を追記し、Checkpoint 3
  が実行済みであることを記録する。過去の log 行は変更しない。

## よくある間違い

- 新規の `edit.json` を v0 / v1 で作る（新規は v2）。
- 静止画を並べるために ffmpeg で連結する（画像は visual 段へ item として置く）。
- 旧 `cuts` / `layers` / `overlays` キーや、v2 トップレベルに無い独自 field を足す。
- `sources[].id` に無い id を media の `source.src` へ書く。
- visual の重なりに独自 z を足す（z の権威は `tracks[]` の配列順だけ）。
- 字幕・注釈・解析結果を timeline 秒へ変換して永続化する（正本は (`src`, source 秒)）。
- **caption の表示区間を segment 境界で敷き詰め（`end = 次の caption の start`）、無発話区間にも字幕を残す**（実発話が終われば字幕も終わる。§4）。
- 按分 fallback を「区間の拡張」に使い、末尾語の推定 end を越えて次 caption まで字幕を伸ばす（§4）。
- **切り出し・先出しクリップを見せ場スコア位置の機械窓（segment 量子化時刻）のまま切り出し、意図した発話を窓の外へ落とす／全文 1.0s 未満の読めない字幕を出す**（発話へスナップし呼吸 0.5s を残す。§2）。
- item の `at` / `duration` を秒で書く（v2 は整数フレーム）。
- media の `source.in` / `source.out` を出力フレームで書く（素材秒である）。
- 重ねた素材とカットの時間ズレを `blend=difference` の絶対差で測る（色が違うと指標が平坦になり
  誤った結論に落ちる。フレーム間差分の相互相関で測る。§1 重ねる media クリップの時間基準）。
- 実行承認前に中間マスターや overlay を作る。
- authoring skill がないことを理由に規約を省略する。
- edit.json の sample 値を、承認されていない出力仕様として使う。
