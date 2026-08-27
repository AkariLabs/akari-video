# edit.json v1 ナレーション音声データ契約

- 日付: 2026-07-20
- 状態: 実装ラウンドの SSOT（`audio.narration` フィールドのみ確定）
- 前提: `contract-2026-07-14-edit-json-v1-audio.md`（`audio.bgm` / `audio.sfx` の確定契約。
  本書はこれと同じ流儀で `audio.narration` を追加する）、
  `contract-2026-07-17-data-contract-versioning.md`（版必須・追加のみ進化・明示マイグレの三原則）
- スコープ: edit.json の `audio.narration` フィールド（ナレーション音声）のみ。
  `audio.bgm` / `audio.sfx` の既存契約は変更しない。ducking の実装（サイドチェイン入力の
  切り替え）は**別タスク**。本書は正文化のみ

## 0. version 運用（後方互換）

`contract-2026-07-14-edit-json-v1-audio.md` §0 と同じ運用を踏襲する。**`version` は bump しない。**

- `audio.narration` は `audio` オブジェクト配下の**任意フィールド**（`Option`）。存在しなければ
  従来（narration なし）と完全に同じ挙動
- 既存の `audio`（`bgm` / `sfx`）契約・実装は無改変。`audio.narration` の追加により
  既存の `edit.json`（`narration` フィールド無し）は一切影響を受けない
- `contract-2026-07-17-data-contract-versioning.md` 原則 1（版必須・追加のみ進化）どおり、
  任意フィールドの追加のみであり `version` の bump を要しない

## 1. 確定スキーマ

```jsonc
{
  "version": 0,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "source": { "path": "sample.mp4", "proxy": null },
  "cuts": [ { "in": 5.0, "out": 10.0 } ],
  "overlays": [ /* 既存のまま */ ],

  "audio": {
    "bgm": { "path": "assets/bgm.m4a", "gain_db": -18, "ducking": true },
    "sfx": [ /* 既存のまま */ ],

    "narration": [                       // 省略可。配列（シーン単位イベント。sfx と同じ思想）
      {
        "id": "n-0001",                  // 必須。^n-\d{4}$。edit.json 内で一意
        "path": "out/narration/n-0001.mp3",  // 必須。edit.json からの相対パス
        "t": 12.5,                       // 必須。タイムライン秒。0 以上
        "in": 5.8,                       // 任意。素材秒。省略時 0
        "out": 9.7,                      // 任意。素材秒。省略時 素材末尾
        "gain_db": 0,                    // 任意。既定 0。[-60, 12]（bgm/sfx と同一。範囲外はエラー）
        "script": "こんにちは、AKARI Videoです。",   // 任意。表示原稿（人間が読む正本）
        "reading": "こんにちわ、あかりびでおです。", // 任意。読み原稿（かな化後・生成に使った実テキスト）
        "provenance": {                  // 必須
          "provider": "voicevox",        // 必須。voicevox | fal | elevenlabs | human を例示（enum 強制はしない）
          "engine": "voicevox-0.25.2",   // 任意
          "voice": "speaker:3",          // 任意。例: speaker:3 / profile:owner-ja
          "credit": "VOICEVOX:ずんだもん", // provider が voicevox のとき必須（表記義務）。他は任意
          "generated_at": "2026-07-20T09:00:00+09:00"  // 任意（human のときは録音日など）
        }
      }
    ]
  }
}
```

### フィールド表

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `audio.narration` | array \| 省略 | 否 | 省略 = ナレーションなし | — |
| `audio.narration[].id` | string | 必須（要素内） | — | `^n-\d{4}$`。edit.json 内で一意 |
| `audio.narration[].path` | string | 必須（要素内） | — | edit.json からの相対（`audio.sfx[].path` と同一規約） |
| `audio.narration[].t` | number | 必須（要素内） | — | **タイムライン秒**（`audio.sfx[].t` / `overlays[].start` と同じ座標系）。0 以上 |
| `audio.narration[].in` | number | 否 | `0` | 素材秒。再生窓 `[in, out)` の始点。0 以上 |
| `audio.narration[].out` | number | 否 | 素材末尾 | 素材秒。再生窓 `[in, out)` の終点。0 より大きく `out > in` |
| `audio.narration[].gain_db` | number | 否 | `0.0` | dB。クランプ範囲 `[-60, 12]`（`audio.bgm` / `audio.sfx` と同一） |
| `audio.narration[].script` | string | 否 | — | 表示原稿（人間が読む正本。字幕連携等の元テキスト） |
| `audio.narration[].reading` | string | 否 | — | 読み原稿（かな化後・TTS 生成に実際に使ったテキスト） |
| `audio.narration[].provenance` | object | **必須** | — | 生成元メタデータ |
| `audio.narration[].provenance.provider` | string | 必須 | — | `voicevox` / `fal` / `elevenlabs` / `human` を例示（enum 強制はしない） |
| `audio.narration[].provenance.engine` | string | 否 | — | 例: `voicevox-0.25.2` |
| `audio.narration[].provenance.voice` | string | 否 | — | 例: `speaker:3` / `profile:owner-ja` |
| `audio.narration[].provenance.credit` | string | `provider === "voicevox"` のとき必須 | — | 表記義務（例: `VOICEVOX:ずんだもん`） |
| `audio.narration[].provenance.generated_at` | string | 否 | — | ISO8601（`human` のときは録音日など） |

`audio.sfx` と同じく`narration` は**配列**（シーン単位イベントが複数あってよい）。
`audio.bgm` が単数オブジェクトである設計とは対照的で、`contract-2026-07-14-edit-json-v1-audio.md`
§6 の「BGM は全体 / SFX はシーン単位」という設計意図をナレーションにも継承する
（ナレーションも `t` という 1 点情報を持つシーン単位の演出であり、BGM のような
「プロジェクト全体で 1 本」という制約は当てはまらない）。

### 1.1 ナレーション素材のトリム

`in` / `out` は `audio.sfx[]` と同じ素材秒の語彙を使う。再生区間は `[in, out)`、タイムライン上の
開始は従来どおり `t` とする。`in` 省略時は 0、`out` 省略時は素材末尾まで再生する。
`out <= in` は edit-lint が error とし、実尺との整合は render-cut が解決する。`in` が素材実尺以上なら
0 にクランプして warning、`out` が素材実尺を超えれば素材末尾へクランプして warning、クランプ後に
`out <= in` となる場合はその narration 要素だけを skip して warning とする。

## 2. パス解決規約

`audio.narration[].path` は `audio.bgm.path` / `audio.sfx[].path` と**同一規約**:
edit.json の親ディレクトリを基準にした相対パス（絶対パスも許容）。音声専用の解決ロジックを
新設しない（`contract-2026-07-14-edit-json-v1-audio.md` §2 を踏襲）。

## 3. ducking の主従

`contract-2026-07-14-edit-json-v1-audio.md` §4 は `audio.bgm.ducking: true` のサイドチェイン
入力（トリガー）を「ダイアログ音声（source 由来の音声トラックそのもの）」と定義していた。
本契約でナレーションが第一級データになったことに伴い、この入力の**主従**を以下のとおり正文化する:

1. **`audio.narration` が 1 件以上存在する場合**: 書き出しのサイドチェイン入力は
   **narration トラック**（全 narration イベントを合流させた 1 本のトラック）が**主
   (authoritative)** となる。ナレーションは「聞かせたい本体の声」そのものであり、
   BGM を下げるべき対象を示す信号として、素材の生ダイアログよりも直接的で意図が明確なため
2. **`audio.narration` が省略されている場合**: 既存契約
   （`contract-2026-07-14-edit-json-v1-audio.md` §4）どおり、ダイアログ音声（source 由来）が
   引き続きトリガーとなる（**従 (fallback)**。既存の `edit.json`（narration 無し）の
   書き出し挙動を一切変えないため）

いずれの場合も §4 の実装方式（`sidechaincompress`、`main` = BGM / `sidechain` = トリガー、
初期パラメータ `threshold` ≈ -24dB・`ratio=8`・`attack=5ms`・`release=300ms`）は変更しない。
変わるのは `sidechain` 入力に流し込むトラックの選択規則のみ。

**実装は別タスク。本契約は正文化のみ**（§0 のスコープ節を参照）。

## 4. 欠落ファイル・不正値時の劣化規約

`contract-2026-07-14-edit-json-v1-audio.md` §5「音声は装飾であり、映像本体の書き出し成否を
左右してはならない」を narration にも適用する。

| 状況 | 挙動 |
|---|---|
| `audio.narration` フィールドなし | 従来どおり（ナレーションなし）。エラーにしない |
| `audio.narration[].path` を解決したファイルが存在しない | その narration 要素**のみ**無視
  （warning ログ + 成果報告に明記）。他の narration / BGM / SFX / 映像本体には影響しない |
| `audio.narration[].path` が壊れている（デコード失敗） | 同上。その要素のみ無視して継続 |
| `gain_db` が `[-60, 12]` の範囲外（有限値） | `audio.bgm` / `audio.sfx` と同じくクランプ + warning
  （§5 の「棄却ではなくクランプ」思想を踏襲） |
| `gain_db` が非有限値（NaN/Infinity） | 該当要素を無視 + warning |
| `t` が非有限値・負値・timeline 長以上 | その narration 要素を無視（鳴らす対象時間がない） |

いずれの劣化も「その narration 要素だけを欠落させる」に留め、映像・オーバーレイ・他の音声要素の
書き出しを巻き込んで失敗させない設計方針は BGM/SFX と共通である。

## 5. script と reading を両方持つ理由

`script`（表示原稿）と `reading`（読み原稿）は意図的に別フィールドとして持つ。理由は
**読み前処理が非可逆**であるため: 表示原稿から読み原稿への変換（漢字のかな化、数字・記号の
読み下し、ポーズ記号の挿入、TTS エンジン固有の発音制御タグの付与など）は多くの場合
人手または非決定的なルールベース処理を経ており、`reading` から `script` を機械的に逆算できず、
`script` だけを保存しても `reading`（実際に TTS へ渡した文字列）を再構成できない。
再生成（同じ音声を再度合成する・別エンジンに差し替える等）や人間によるレビュー（表示原稿は
読みやすい正本として、読み原稿は生成の実態を追跡する記録として）の両方に必要なため、
両方を独立フィールドとして永続化する。

## 6. 区間重複検出の限界

`audio.narration[].t` は単一時刻（開始点）のみを持ち、実際の音声ファイルの再生尺（duration）は
edit.json 側のデータに含まれない。そのため、**実尺ベースの区間重複検出（ある narration の
再生中に別の narration が重なって鳴るかどうかの判定）は本契約のスコープ外・将来課題**とする。

本契約で検証層（validate-edit / edit-lint）が検出するのは、**「同一 `t` の完全一致」**という
弱い近似のみである: 2 件以上の narration 要素が寸分違わず同じ `t` を持つ場合に警告する。
これは「同時刻に 2 本のナレーションを鳴らそうとしている」という明らかな入力ミスを拾うための
簡易チェックであり、実際の再生尺を考慮した重なり判定（例: `t=10.0` の 3 秒の音声と
`t=11.0` の音声が重なるかどうか）は行わない。実尺を考慮した重複検出が必要になった時点で、
narration 音声ファイルの実尺解析（ffprobe 等）を要する別契約として設計する。

## 7. プレビューと書き出しの扱い

`contract-2026-07-14-edit-json-v1-audio.md` §3 のサンドイッチ構造（プレビューは近似、
正確さは書き出しが持つ）を narration にも適用する。narration の挿入・gain 適用・ducking の
トリガー選択（§3）は BGM/SFX と同じ実装パターン（プレビュー側は composition track へ
`t` の位置で挿入、書き出し側は `adelay` + `volume` フィルタで合成）を踏襲する想定であるが、
**実装そのものは別タスク**であり、本契約はデータ構造と挙動の正文化のみを行う。

## 8. 検証

- `packages/schemas/edit.schema.json`: `audio.narration` の構造（型・`id` パターン・必須項目・
  `gain_db` 範囲）を JSON Schema として定義する。`audio` フィールド自体が現行スキーマで
  未定義（`bgm`/`sfx` を含め型定義がない）ため、narration の追加に必要な最小限のみを定義し、
  `bgm`/`sfx` の型定義には踏み込まない（判断の詳細は本タスクの `report.md` を参照）
- `packages/schemas/bin/validate-edit.mjs`: `audio.narration` があれば配列であること、各要素の
  `id` 形式・一意性、`path` の非空文字列、`t` の範囲、`gain_db` の範囲、`provenance` 必須・
  `provider` 必須・`provider === "voicevox"` のとき `credit` 必須を検証する。**`path` の
  ファイル実在チェックはここでは行わない**（validate-edit は現状ファイルシステムを見ない設計を
  踏襲する）
- `packages/edit-lint`（`src/edit-lint.mjs`）: validate-edit と同じ構造チェック（エラー）に加え、
  `path` のファイル実在チェック（欠落は**警告**。§4 の劣化規約に合わせる）、`t` がタイムライン尺
  （`cuts` 合計）を超える場合の警告、同一 `t` 完全一致の narration が複数ある場合の警告を行う

## 9. 次段（本契約のスコープ外）

- ducking のサイドチェイン入力を narration トラックへ切り替える実装（プレビュー/書き出し双方）
- narration の実尺を考慮した区間重複検出（§6）
- `audio.narration[].provenance.provider` の enum 強制（現状は文書上の例示のみ）
