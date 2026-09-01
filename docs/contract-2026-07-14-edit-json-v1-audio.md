# edit.json v1 音声スキーマ契約

- 日付: 2026-07-14
- 状態: 実装ラウンドの SSOT（`audio` フィールドのみ確定。crop 等は未確定・対象外）
- 前提: `contract-2026-07-13-m1-m4.md`（edit.json v0 の確定契約）、
  `notes-2026-07-13-edit-json-v1.md` §5（本契約はこの節を昇格したもの）
- スコープ: edit.json の `audio` フィールド（BGM / SFX）のみ。
  `notes-2026-07-13-edit-json-v1.md` §2 の crop は**次段**（別契約で扱う。本書では言及のみ）

## 0. version 運用（後方互換）

**`version` は `0` のまま据え置く。**bump しない。

- `audio` はトップレベルの**任意フィールド**（`Option`）。存在しなければ v0 と完全に同じ挙動
  （BGM/SFX なし・音声は source 由来のダイアログのみ）
- 「v1」は本書・notes ファイルの通称（機能ウェーブの呼び名）であり、edit.json の
  `version: u32` 整数値とは**別軸**。整数 bump は構造的破壊変更（例: 将来 crop が
  `cuts` の意味を変える場合）のために温存する
- 既存の `validate_edit`（`src-tauri/src/export/mod.rs` — legacy Tauri シェル実装。
  現行モノレポでは対応する検証ロジックの再実装先を指す参照として読む）が `version != 0` を
  拒否するロジックは変更不要。`audio: Option<Audio>` を追加するだけで v0 ファイル
  （`audio` 欠落）は従来どおり読み書きできる

## 1. 確定スキーマ

```jsonc
{
  "version": 0,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "source": { "path": "sample.mp4", "proxy": null },
  "cuts": [ { "in": 5.0, "out": 10.0 }, { "in": 30.0, "out": 35.0 } ],
  "overlays": [ /* v0 のまま */ ],

  "audio": {                                 // 省略可。省略 = v0 と同じ（音声なし）
    "bgm": {                                 // 省略可。オブジェクト（配列ではない = 全体で 1 本）
      "path": "assets/bgm.m4a",              // edit.json からの相対 or 絶対
      "gain_db": -18,                        // 省略時 0.0（unity gain）。範囲 [-60, 12]
      "ducking": true                        // 省略時 false
    },
    "sfx": [                                 // 省略可。配列（シーン単位 = 複数あってよい）
      { "path": "assets/pop.m4a", "t": 12.3, "gain_db": -6 }
    ]
  }
}
```

### フィールド表

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `audio` | object \| 省略 | 否 | 省略 = 音声なし | — |
| `audio.bgm` | object \| 省略 | 否 | 省略 = BGM なし | — |
| `audio.bgm.path` | string | `bgm` があれば必須 | — | edit.json からの相対（`edit::resolve` で解決） |
| `audio.bgm.gain_db` | number | 否 | `0.0` | dB。クランプ範囲 `[-60, 12]`（§4） |
| `audio.bgm.ducking` | bool | 否 | `false` | — |
| `audio.sfx` | array | 否 | `[]` | シーン単位イベントの配列 |
| `audio.sfx[].path` | string | 必須（要素内） | — | edit.json からの相対 |
| `audio.sfx[].t` | number | 必須（要素内） | — | **タイムライン秒**（カット連結後。`overlays[].start` と同じ座標系。source 秒ではない） |
| `audio.sfx[].gain_db` | number | 否 | `0.0` | dB。クランプ範囲 `[-60, 12]` |

`bgm` が**オブジェクト**（単数）で `sfx` が**配列**なのは意図的なスキーマ設計（§6 参照）。

## 2. パス解決規約

`audio.bgm.path` / `audio.sfx[].path` は `source.path` / `overlays[].html` と**同一規約**:
edit.json の親ディレクトリを基準にした相対パス（絶対パスも許容）。実装は
`edit::resolve(base, rel)`（`src-tauri/src/video_plane/edit.rs` — legacy Tauri シェル実装。
現行モノレポでは対応する解決関数を再利用する設計を踏襲する）をそのまま再利用する。
音声専用の解決ロジックを新設しない。

## 3. 責務分担 — プレビュー（AVFoundation）と書き出し（ffmpeg）

サンドイッチ構造の不変原則（`design-2026-07-13-agent-native-architecture.md`）と同じく、
**プレビューは近似、正確さは書き出しが持つ**（M1〜M4 契約の時間系と同じ力学）。

| 項目 | プレビュー側（M1 / `video_plane/macos.rs`） | 書き出し側（M4 / `export/ffmpeg.rs`） |
|---|---|---|
| BGM の挿入 | 新規 `AVMutableCompositionTrack`（audio）を作り、`insertTimeRange` を繰り返して timeline 長までループ挿入（末尾は timeline 長でクランプ） | 新規入力として BGM を読み込み、`aloop` または `-stream_loop -1` でループしてから合成（後述） |
| SFX の挿入 | 各要素ごとに 1 本の composition audio track を新設し、`t` の位置に `insertTimeRange` | `adelay=<t*1000>` で `t` 秒だけ遅延させてから合成 |
| gain 適用 | `AVMutableAudioMix` + `AVMutableAudioMixInputParameters.setVolume`（`gain_db` を線形 `10^(gain_db/20)` に変換） | `volume=<linear>` フィルタ（同じ変換式） |
| ducking | **静的近似**: `ducking: true` のとき BGM トラックへ固定の追加減衰（例: -12dB）を足すだけ。動的な音量追従はしない | **動的・正確**: `sidechaincompress`（§4）でダイアログ音量に追従して BGM を実時間で下げる。こちらが正 (authoritative) |
| 尺の丸め | composition 全体の duration が timeline 長を決める（既存 `load_edit` のまま） | 最終エンコードは常に `-t <duration>`（`append_encode_args`）で timeline 長にクランプ済み。BGM/SFX がそれより長くはみ出しても自動的に切り詰められる（追加のトリム処理は不要） |

プレビューの ducking が静的近似である点は**既知の制約**として v1 で受け入れる（M1〜M4 契約が
シークの ±数十ms 誤差をプレビューに許容しているのと同じ判断基準）。プレビューでダッキングの
「効き方」を厳密確認したい場合は書き出し結果で判断する。

## 4. ducking の v1 定義

> 2026-09-02 更新: `sidechaincompress` 方式は廃止した。現在は narration と speech の宣言区間を鍵に、
> attack / release を持つ共通決定論エンベロープをプレビューと書き出しの両方で使う。
> 以下は当初 v1 の設計記録として残す。

**採用: `sidechaincompress`（書き出し側のみ、ffmpeg 標準フィルタ）。**
「字幕/発話区間ベースの単純 gain」は不採用。

### 選定理由

1. **analysis.json 非依存で完結する。** 発話区間ベースの gain 制御は
   `analysis.json`（`schemas/analysis.schema.json`）の `transcript` か、独自の VAD
   （音声区間検出）が必要になる。しかし M5 契約（`contract-2026-07-13-m5-analysis-report.md`）は
   「状態: 設計確定… 実装契約への昇格は M1〜M4 安定後」であり、本ラウンドの実装順
   （notes 記載: 音声 → crop → 出力プロファイル → レイアウト）より後段。edit.json の
   音声契約が analysis.json に依存すると実装がブロックされる
2. **ローカル環境に追加依存なしで動く。** `ffmpeg -filters` で `sidechaincompress` の
   搭載を確認済み（ffmpeg 8.1.1）。ダイアログ音声は `render_cuts` が既に確定させている
   source 由来の音声トラックそのものをサイドチェイン入力に使えるため、発話区間の
   事前計算・別データ構造が一切不要（音量そのものが動的トリガーになる）
3. **スキーマが 1 bool で足りる。** `ducking: true/false` のみでよく、
   `notes-2026-07-13-edit-json-v1.md` の元案どおりのフィールド数に収まる。閾値/比率等の
   パラメータはコード側の初期値として持ち、運用で調整する（§後述）。将来パラメータの
   外出しが要るなら `ducking: { enabled, threshold_db, ratio }` のようなオブジェクト化を
   v2 で検討する（bool → object は破壊的変更なのでここでは行わない）
4. **エンジンは合成だけ、という設計原則に合う。** M5 契約の「素材計画」章は BGM/SFX の
   採否を人間承認するが、ducking の「効かせ方」はエンジン内部の実行詳細であり、
   分析・判断層に染み出させない

### 実装ノート（書き出し側、初期パラメータ）

- フィルタ方向: `main` = BGM（下げられる側）、`sidechain` = ダイアログ（トリガー）。
  `[bgm][dialogue]sidechaincompress=...[bgm_ducked]`
- 初期値（運用で調整可。analysis.schema.json の `scoreValue` 同様、閾値は運用で詰める前提）:
  `threshold` ≈ -24dB 相当（線形 `~0.063`）、`ratio=8`、`attack=5`（ms）、`release=300`（ms）
- 最終ミックスは `amix`。**`normalize=0` を明示すること**（既定 `true` は入力数で自動的に
  音量を割り引くため、`gain_db` で指定した絶対値が意味を失う。よくある間違い §7 参照）
- BGM ループは `aloop`（または `-stream_loop -1` 入力オプション）+ 後段の `-t <duration>`
  クランプで timeline 長を満たす。ループ境界のクロスフェードは v1 スコープ外（既知の制約）

## 5. 欠落ファイル・不正値時の劣化規約

音声要素は**装飾**であり、映像本体の書き出し成否を左右してはならない
（M5 契約「だめなら使わない」三択判断と同じ設計哲学: 使えないものは黙って外し、
全体は止めない）。

| 状況 | 挙動 |
|---|---|
| `audio` フィールドなし | v0 と同一動作（BGM/SFX なし）。エラーにしない |
| `audio.bgm.path` を解決したファイルが存在しない | BGM 全体を無視（warning ログ + 成果報告に明記）。書き出しは継続 |
| `audio.bgm.path` が壊れている（ffprobe 失敗） | 同上。BGM のみ無視して継続 |
| `audio.sfx[].path` が存在しない／壊れている | その SFX 1 件のみ無視。他の SFX / BGM / 映像には影響しない |
| `gain_db` が非有限値（NaN/Infinity） | 該当要素（BGM 全体 or 該当 SFX）を無視 + warning |
| `gain_db` が `[-60, 12]` の範囲外（有限値） | 範囲内にクランプ + warning（クリッピング/無音化の安全弁。`overlays[].transform` の
  有限値チェックと同じ「壊れた入力で落とさない」思想だが、こちらは棄却ではなくクランプを選ぶ —
  音量は多少ズレても再生できる方が、無音より実害が小さいため） |
| `sfx[].t` が非有限値 or 負値 | その SFX を無視 |
| `sfx[].t` が timeline 長以上 | その SFX を無視（鳴らす対象時間がない） |
| `sfx[].t` が timeline 終端付近で尻切れになる | 追加処理不要。最終エンコードの `-t <duration>` クランプが自動的に切り詰める（§3 表） |
| `ducking: true` だが `bgm` 自体が省略されている | no-op（無視。エラーにしない） |
| `sfx` 側に `ducking` 相当のフィールドは存在しない | 仕様どおり（SFX は短い効果音のためダッキング対象外。§6 で明示） |

いずれの劣化も「その音声要素だけを欠落させる」に留め、映像・オーバーレイ・他の音声要素の
書き出しを巻き込んで失敗させない。`overlay::render` の `warnings` と同じパターンで
成果報告に反映する。

## 6. データ設計意図 — 「BGM は全体 / SFX はシーン単位」

`notes-2026-07-13-edit-json-v1.md` §5 の原案どおり、**スキーマの形そのもの**で意図を語る:

- `audio.bgm` は**単数のオブジェクト**（配列ではない）。1 プロジェクトに BGM は 1 本という
  制約をスキーマレベルで強制し、「なぜここに BGM があるか」を迷わせない
- `audio.sfx` は**配列**。各要素が `t`（タイムライン上の一点）を持ち、シーンの特定の瞬間に
  紐づく効果音であることが型から読み取れる
- BGM は `t` を持たない = 常に timeline 全体（0 〜 duration）に紐づく。cut 境界をまたいでも
  BGM は途切れず鳴り続ける（BGM は timeline 時間軸に貼り付いており、source 側の
  カット構造とは独立）。SFX は逆に `t` という 1 点情報がすべてで、シーン単位の演出という
  役割が明確になる
- `contract-2026-07-13-m5-analysis-report.md` §「素材計画」の「全体で使うもの（BGM）と
  シーン単位（SFX / B ロール …）を分け」という記述と一致（上流の判断がそのまま
  下流スキーマの形に落ちている = 説明可能性の一貫性）

## 7. analysis.schema.json との整合確認

`schemas/analysis.schema.json`（v0）を確認した。`events`（filler/trouble/chapter/hook）・
`tracks`（speakers/faces/person_matte）のいずれにも音声選定（BGM/SFX）に関わるフィールドは
存在せず、本契約と衝突しない。将来 `events.hook` 等と `audio` を直接結合する設計は
**採らない**: 「素材のフック候補」から「使う BGM/SFX の決定」までは M5 契約の
編集判断レポート（人間承認）を経由する一方向フローであり、`audio` フィールドは
その承認結果の**実行形**（着地点）としてのみ存在する。エンジン層が analysis.json を
直接読みにいく経路は設けない（M5 契約「本体は合成だけ」原則の維持）。

## 8. よくある間違い

- **`sfx[].t` に source 秒を渡す** — 誤り。`t` は `overlays[].start` と同じ**タイムライン秒**
  （カット連結後）。source 側のどこで鳴らすかではなく、最終出力のどこで鳴らすかを指定する
- **`amix` の `normalize` を既定 (`true`) のまま使う** — `gain_db` で指定した絶対音量が
  入力数に応じて自動的に割り引かれ、スキーマの数値が実質無視される。必ず `normalize=0`
- **BGM が無いのに `ducking: true` を設定してもエラーにしようとする** — 規約上は no-op
  （§5）。呼び出し側の生成ミスを許容し、無駄な失敗を増やさない
- **`bgm` を配列にしてしまう** — スキーマ上は単数オブジェクト。複数 BGM を切り替えたい
  ユースケースが出た場合は v2 で改めて設計する（今は 1 プロジェクト 1 BGM の制約を守る）
- **gain_db の丸め/クランプを「エラーで弾く」判断にしてしまう** — 範囲外の有限値はクランプ
  （§5 表）。エラーにするのは非有限値のときだけ

## 9. 型定義スケッチ（参考。非拘束・実装ラウンドで確定。legacy Tauri 実装の草案）

`src-tauri/src/video_plane/edit.rs`（legacy Tauri シェル。現行実装ではない）への追加を
想定した草案。実装時にフィールド名・デフォルト実装の細部は変わってよい（本契約が拘束するのは
§1 の JSON スキーマと §3〜6 の挙動であり、Rust の型そのものではない）。

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edit {
    pub version: u32,
    #[serde(default)]
    pub output: Option<Output>,
    pub source: Source,
    #[serde(default)]
    pub cuts: Vec<Cut>,
    #[serde(default)]
    pub overlays: Vec<Overlay>,
    #[serde(default)]
    pub audio: Option<Audio>,   // v1 追加。省略時 = v0 と同じ挙動
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Audio {
    #[serde(default)]
    pub bgm: Option<Bgm>,
    #[serde(default)]
    pub sfx: Vec<Sfx>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bgm {
    pub path: String,
    #[serde(default)]
    pub gain_db: f64,   // 省略時 0.0
    #[serde(default)]
    pub ducking: bool,  // 省略時 false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sfx {
    pub path: String,
    pub t: f64,          // タイムライン秒
    #[serde(default)]
    pub gain_db: f64,    // 省略時 0.0
}
```

## 10. 次段（本契約のスコープ外）

`notes-2026-07-13-edit-json-v1.md` §2 の**カット単位 crop（リフレーミング）**は本契約では
扱わない。notes 記載の実装順（音声 → crop → 出力プロファイル → レイアウト）どおり、
音声契約確定後の次ラウンドで別途契約化する。
