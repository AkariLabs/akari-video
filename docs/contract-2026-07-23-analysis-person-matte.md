# analysis.json v0 人物マット（tracks.person_matte）データ契約

- 日付: 2026-07-23
- 改訂: 2026-08-27（§8 の format 席を開き mask_path / mask_format を追加）
- 状態: 実装ラウンドの SSOT（`tracks.person_matte` の値のみ確定）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（版必須・追加のみ進化・明示マイグレの三原則）、
  `contract-2026-07-13-m5-analysis-report.md`（`analysis.json` v0 の器と `tracks` の枠。
  `tracks.faces` / `person_matte` を「リフレーミングと text-behind-person の共通基盤」と位置づけた原典）、
  `contract-2026-07-22-edit-json-v1-beats.md`（体裁・劣化規約・検証分担の先例）
- 根拠: 2026-07-23 の実現性スパイク（非公開の内部記録）。方式・既定 quality・格納形式は
  そこでの実測で確定済みであり、本契約はその確定事項をデータ契約として正文化する
- スコープ: `analysis.json` の `tracks.person_matte` の**値の形**のみ。マットを**消費する側**
  （text-behind-person の実配線、囲い・ラメなどの人物演出、overlay 断片への `src` 供給、
  `<video>` の時刻同期）は**別タスク**であり、本書はデータの器と検証責務の正文化のみを行う

## 0. version 運用（後方互換）

`contract-2026-07-22-edit-json-v1-beats.md` §0 と同じ運用を踏襲する。**`version` は bump しない。**

`analysis.json` v0 は既に `tracks.person_matte` という**枠**を持っている
（`{"type": ["string", "null"], "minLength": 1}` = 生成済みマットへの単一パス、未生成は `null`）。
本契約はこの枠を捨てず、**同じキーが取りうる値に object 形を追加する**。

- `tracks.person_matte` の**キー自体は従来どおり必須**である（`tracks` の `required` を変更しない）。
  人物マットの**生成が任意**なのであって、キーの記載が任意になるわけではない。未生成は `null` と書く
- 既存の `analysis.json`（`person_matte` が `null` または string）は一切影響を受けない。
  新しい値の形を追加しただけであり、`contract-2026-07-17-data-contract-versioning.md` 原則 1
  （版必須・追加のみ進化）どおり `version` の bump を要しない
- **string 形は非推奨だが有効なまま**とする。読み手は string を `{ "path": <string> }` の糖衣として扱う
  （§4）。既存ファイルを書き換えるマイグレーションは行わない
- キーを `required` から外さなかったのは、`packages/analysis-report` が
  `hasOwn(analysis.tracks, "person_matte")` を前提に検査しているためである。キーの任意化は
  既存の読み手を壊す**削除方向**の変更であり、追加のみ進化の原則に反する

## 1. 呼称

| 文脈 | 呼称 |
|---|---|
| データモデル（analysis.json のフィールド名・スキーマ・コード・エラーメッセージ） | `tracks.person_matte` |
| 人間向け（レポート・UI・ドキュメント本文・オーナーとの会話） | **人物マット** |

この 2 つを正文とし、他の呼称（切り抜き、アルファ動画、セグメンテーション結果、cutout 等）を
新設しない。`analysis-report` の既存表示（「人物マット: あり / なし」）と一致する。

## 2. 確定スキーマ

```jsonc
{
  "version": 0,
  "source": "../../clip.mp4",
  "transcript": [],
  "keyframes": [],
  "events": [],
  "tracks": {
    "speakers": [],
    "faces": [],

    "person_matte": {                        // null（未生成）/ string（旧形）も有効
      "path": "matte/person-matte.webm",     // 必須。VP9 alpha WebM への相対 or 絶対パス
      "mask_path": "matte/person-matte.mask.mp4", // 任意。追加のグレースケール H.264 マスク
      "mask_format": "gray-h264-fullrange", // 任意。mask_path の形式
      "fps": 24,                             // 必須。マット動画の fps（元素材と異なってよい）
      "quality": "balanced",                 // 任意。fast / balanced / accurate / best を例示（enum 強制はしない）
      "generated_at": "2026-07-23T01:33:30.069Z",  // 任意。ISO8601
      "tool": "vision-person-segmentation"   // 任意。生成手段の記録
    }
  }
}
```

### フィールド表

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `tracks.person_matte` | object \| string \| null | **必須（キー）** | — | `null` = 未生成。string = 旧形（`{path}` の糖衣・非推奨） |
| `person_matte.path` | string | **必須** | — | マット動画へのパス。相対パスは **analysis.json の所在ディレクトリ**基準、区切りは `/`。実体は VP9 alpha WebM（§3） |
| `person_matte.fps` | number | **必須** | — | マット動画の fps。0 より大きい。**元素材の fps と一致しなくてよい**（§4 の時刻対応は fps に依存しない） |
| `person_matte.quality` | string | 否 | — | 生成品質。`fast` / `balanced` / `accurate` / `best` を例示。**enum 強制はしない** |
| `person_matte.generated_at` | string | 否 | — | 生成時刻（ISO8601） |
| `person_matte.tool` | string | 否 | — | 生成手段の記録。`vision-person-segmentation` を例示 |

`quality` を enum で固定しないのは、`beats[].kind`（`contract-2026-07-22-edit-json-v1-beats.md` §2）
および `audio.narration[].provenance.provider` と同じ理由による。生成手段が増えれば品質の語彙も
増えるため、契約側で列挙を固定すると語を足すたびにスキーマ改訂が要る。書き手が新しい `quality` を
使っても検証は通り、消費側は未知の値を無視して既定の扱いへ倒す。`tool` も同様に自由文字列とする。

`fps` を必須にしたのは、マット動画の**尺と時刻の対応を消費側が自分で計算できる**ようにするためである。
マットは元素材と同じ fps である必要がなく（人物の動きが緩い素材では 12fps で足りることがある）、
コンテナのメタデータを読まずに `フレーム番号 / fps = source 秒` を成立させるにはこの値が要る。

`width` / `height` / `spans` / `provenance` は本契約では**定義しない**（§8）。

## 3. 格納形式 — VP9 alpha WebM

**`path` が指す実体は VP9 alpha WebM（`.webm`・コンテナに `alpha_mode=1`）とする。**

スパイクの実測で確定した事項であり、本契約で覆さない。根拠:

- 容量が HEVC alpha MOV の **1/4.8**（8 秒素材で 1.5 MB 対 7.2 MB）
- **GPU デコードに依存しない**。HEVC alpha は Chromium 系でも透過再生できたが、
  `--disable-gpu` で起動したヘッドレスレンダラーでは素の HEVC すら再生できない。
  書き出し経路の起動オプション次第で丸ごと落ちる形式を既定にしない
- 既存のベイクプレビュー経路と同形式であり、再生系を増やさない

**アルファは straight（非 premultiplied）で書く。** RGB は元フレームの値をそのまま持ち、
アルファがマット値を持つ。半透明の輪郭画素（実測で全画素の 2.7〜3.7%）は、premultiplied を
straight として解釈させると二重に暗くなり、輪郭に黒い縁が出る。

**アルファ付き動画を ffmpeg のデコーダに通さない。** ffmpeg は HEVC の alpha レイヤを読めず
（`pix_fmt` を `yuv420p` と報告する）、VP9 alpha も自身の再デコードではアルファを出せない。
中継すると**無言でアルファが落ちる**。既に出来上がったマット動画を再エンコードしない。

HEVC alpha MOV は「Apple 系ツールへの受け渡しが要るとき」の第 2 形式であり、
`analysis.json` に載せる既定ではない。第 2 形式を `person_matte` に載せる必要が生じたときは、
`format` フィールドの追加として別契約で扱う（§8）。

## 4. 座標系 — source 秒アンカー

**マット動画の時刻 0 は素材（`analysis.source`）の時刻 0 と一致する。両者は source 秒で 1:1 に対応する。**

- マットは**解析結果**（この素材のどこに人物が居るかという素材固有の事実）であり、編集の結果
  （どこに置いたか）ではない。したがって `contract-2026-07-18-edit-json-v1-sources.md` §3 の
  「解析結果は (`src`, source 秒) で永続化し、timeline 秒へ変換した結果を永続化してはならない」
  がそのまま適用される。`beats` / `emphasis_words` と同じ扱いである
- マットに `--ss` 相当のオフセットを持たせない。素材の途中区間だけを切り出したマットを
  `person_matte` に載せない（載せると時刻 0 の一致が壊れる）
  - 一方で、**カット単位に切り出したマットを `layers[].src` へ直接置く**運用（`analysis.json` を
    経由しない、プロジェクト固有の `assets/matte/*.mov` など）は本契約の管轄外である。
    その場合は本節の「時刻 0 一致」が成り立たないので、**切り出しの由来（元素材 / in / out /
    speed / fps）を素材の隣に必ず残す**こと。由来が無いと消費側は素材の頭が何の時刻かを
    推測するしかなく、十数フレーム単位でずれたまま気づけない（2026-08-14 に実害）。
    運用上の注意は `docs/contract-2026-08-02-preview-parity.md` §2.4 と
    `skills/edit-plan/execution.md`「レイヤー素材の時間基準」を参照
- 消費側は表示・書き出しのたびに `cuts[]` から timeline 秒へ射影する。射影結果を永続化しない。
  同一 source 区間が複数回現れれば、1 本のマットが複数の timeline 位置へ射影される
- マットの尺が素材の尺より短い場合、超えた範囲は**マット無し**として扱う（エラーではない）。
  fps が異なっても対応は秒で決まるため、この規則は fps に依存しない
- string 形（旧形）は `{ "path": <string> }` の糖衣として読む。`fps` を持たないため、
  読み手はコンテナのメタデータから fps を得るか、fps を必要としない使い方に限る

## 5. 劣化規約

`contract-2026-07-14-edit-json-v1-audio.md` §5「音声は装飾であり、映像本体の書き出し成否を
左右してはならない」と同じ設計哲学を人物マットにも適用する。
**人物マットは演出の入力であり、映像本体の書き出し成否を左右してはならない。**

| 状況 | 挙動 |
|---|---|
| `person_matte` が `null` | 従来どおり（人物マットなし）。エラーにしない |
| `person_matte` が object でも string でも `null` でもない | マットを無いものとして扱い warning。書き出しは継続する |
| `path` が解決できない・実ファイルが無い | 同上（人物演出なしで続行 + warning） |
| マット動画が壊れている・アルファを持たない | 同上。**人物演出を諦めるのであって、映像本体を止めない** |
| `fps` が不正（欠落・0 以下・非数値） | 同上 |
| 未知の `quality` / `tool` | エラーにしない。消費側は既定の扱いへフォールバックする |
| マットの尺が素材より短い | エラーでも warning でもない。超えた範囲はマット無しとして扱う（§4） |

**書き手は厳格・読み手は寛容。** 静的検証（§7）が形式不正をエラーとして弾くことと、消費側が
実行時に壊れたマットを無視して継続することは矛盾しない。前者は「壊れたファイルを書かせない」
ためのゲート、後者は「壊れたファイルを渡されても映像を出す」ための保険である。この二段構えは
`beats`（`contract-2026-07-22-edit-json-v1-beats.md` §4）で確立済みの先例に従う。

## 6. 生成は任意工程である

**人物マットを全素材で常時生成しない。** 人物演出（text-behind-person 等）を使うと決めた素材でだけ
生成する。`analyze-footage` の既定フローは人物マットを作らず `null` を書く。

理由はコストである。実測（負荷のあるマシン・8 秒 / 1280x720 / 24fps / balanced）:

| 工程 | 実時間比 | 備考 |
|---|---|---|
| Vision セグメンテーション | 約 1.7 倍（58ms/frame） | quality = balanced。マットは 512x384 固定 |
| VP9 alpha エンコード | 残り全部 | **壁時計時間の支配項**。全体で 7.7 倍（8 秒 → 62 秒） |

quality を上げると Vision の側が伸びる（`accurate` は 135ms/frame・peak 638MB）。
`fast` は輪郭が階段状になり本番品質に達しないため、当たり付け専用とする。

| quality | engine | 用途・実測 |
|---|---|---|
| `fast` | Vision | 当たり付け専用。256x192 のマット |
| `balanced`（既定） | Vision | 通常の本番用途。512x384 のマット |
| `accurate` | Vision | 寄りカットの仕上げ。2016x1512 のマット |
| `best` | RVM mobilenetv3 | 髪の毛レベルの細部が必要なときだけ明示指定。CPU 実測 **約 178〜289 ms/frame** |
| `best --model resnet50` | RVM resnet50 | 処理時間をさらに許容できる場合のこだわり指定 |

Mac では `fast` / `balanced` / `accurate` に Vision、`best` に RVM を使う。Windows の対応は
§6.2 で定める。

### 6.1 RVM の ExecutionProvider 規律

RVM は **CPU のみ**で実行する。較正ではアクセラレーション用 EP が CPU と異なるマットを出し、
二値マスク IoU が 0.8057 まで崩れた。将来別の EP を追加するときは、採用候補と CPU の出力一致を
同一 raw BGRA 入力で測り、**IoU ≈ 1.0 を実測してから**有効化することを受け入れ条件とする。

### 6.2 Windows

Windows（`win32`）では Vision を利用できないため、**全品質段を RVM へ接続する**。`quality` は
ユーザーが指定した値をそのまま結果と `tracks.person_matte.quality` に残すが、実行エンジンと既定モデルは
次の表に固定する。

| quality | engine | 既定モデル |
|---|---|---|
| `fast` | RVM | mobilenetv3 |
| `balanced`（既定） | RVM | mobilenetv3 |
| `accurate` | RVM | mobilenetv3 |
| `best` | RVM | mobilenetv3 |
| `best --model resnet50` | RVM | resnet50 |

Windows では RVM が唯一のエンジンなので、mobilenetv3 モデルの配備を必須とする。`--check` はモデルが
無ければ `available:false` と取得用の `fetchHint` を返す。Mac では従来どおり、RVM モデルが無くても
Vision の品質段を使えるため `available:true` のままとする。

ffmpeg / ffprobe は OS の PATH 名を直接起動せず、`packages/media-bin` の `resolveFfmpeg()` /
`resolveFfprobe()` で解決する。これにより Windows では同梱されたプラットフォーム別バイナリも探索対象に
なり、デコード、VP9 alpha エンコード、出力検証の全工程で同じ解決規則を使う。

手順は `skills/analyze-footage/person-matte.md`（`bin/person-matte/` のヘルパー）に置く。

## 7. 検証

| 層 | 検証すること |
|---|---|
| `packages/schemas/analysis.schema.json` | `$defs/personMatteTrack` として object 形の構造（`path` / `fps` の必須・型・範囲、`additionalProperties: false`）を定義し、`tracks.person_matte` から `null` / string / object の `oneOf` として参照する |
| 生成ヘルパー（`bin/person-matte/person-matte.mjs`） | 書き出した WebM が `codec_name = vp9` かつコンテナタグ `alpha_mode = 1` であることを ffprobe で確認してから成功を返す。アルファが落ちた出力を成功扱いにしない。タグキーの大文字小文字は書き込み経路によって変わりうるため、照合は大文字小文字非依存で行う |
| 追加マスク（`mask_path`） | `codec_name = h264`、`color_range = pc`、幅・高さ・`r_frame_rate`・`nb_frames` が VP9 alpha WebM と一致し、`start_pts = 0` であることを ffprobe で確認する |
| `skills/analyze-footage/analysis-json.md` の意味制約 | JSON Schema で表せない条件（`path` が解決でき実ファイルがある、マット動画の時刻 0 が素材の時刻 0 と一致する、`fps` がマット動画の実 fps と一致する）を確定前に人が検査する |

**`analysis.json` 専用の検証 CLI は本契約では新設しない。** `packages/schemas/bin/` には
`validate-edit` 等はあるが `validate-analysis` は存在せず、`packages/edit-lint` も `analysis.json` を
JSON として読めるかまでしか見ていない（`analysis.schema` チェックは構文エラーのみ）。
`analysis.json` の構造検証は `analyze-footage` の手順（Draft 2020-12 validator による検証）が
担う設計であり、この分担を本契約で変えない。器の追加に検証機構の新設を抱き合わせない。

**edit-lint はマット動画をデコードしない。** `--media` なしでメディアをデコードしない規律を
維持するためであり、`beats`（同 §7）と同じ理由・同じ分担である。

## 8. 将来拡張の席（本契約のスコープ外）

- **`format`**（`vp9_alpha_webm` / `hevc_alpha_mov`）: 第 2 形式を載せる必要が出たときに開く席。
  現時点では実体を VP9 alpha WebM に固定する（§3）ため、形式を選ぶフィールドを持たない
- **`spans`**（マットが存在する source 時刻区間）: 素材の一部区間だけマットを持つ運用が必要に
  なったときに開く席。現時点は「時刻 0 から始まる 1 本」に固定する（§4）
- **`width` / `height`**: マット動画の寸法。コンテナから読めるため冗長であり、持たない
- **`provenance`**（engine / OS / モデル版）: `quality` と `tool` を超えた再現性情報が要る
  ようになったときに開く席

いずれも別契約で扱う。本契約は `tracks.person_matte` の器だけを確定し、これらの席が将来開く
可能性があることを記録するに留める。

### 8.1 `mask_path` / `mask_format`（2026-08-27 追加）

§8 の `format` の席を、VP9 alpha WebM を置換しない追加出力として開く。`path` が指す VP9 alpha
WebM の生成と既存消費は不変であり、`mask_path` は v2 frame-engine がハードウェアデコード可能な
グレースケールマスクを使うための追加物である。

| 項目 | 規格 |
|---|---|
| コンテナ / codec / profile | mp4 / H.264（`libx264`）/ High |
| 画素 | `yuv420p`、Y = アルファ（0 = 透明、255 = 不透明）、U/V = 128 |
| レンジ・色タグ | full range（`color_range=pc`）、BT.709 primaries / transfer / colorspace |
| GOP・品質 | GOP 1 秒以下、`crf 6`、`preset medium`、B frame なし |
| 時間 | 解像度・fps・尺・フレーム数はカラー元と一致し、先頭 PTS は 0 |
| 命名 | `<VP9 alpha WebM の basename>.mask.mp4` |

`mask_format` の現行値は `"gray-h264-fullrange"` とする。`mask_path` の相対パスは `path` と同じく
**analysis.json の所在ディレクトリ**を基準に解決し、区切りは `/` を使う。

`mask_path` が無い、または解決・検証できない場合、消費側は `path` の VP9 alpha WebM から一度だけ
同規格のマスクへ取り込み変換する。それも失敗した場合は人物演出を諦め、映像本体の処理は止めない。

### 8.1 edit.json v2 のマスク参照とアルファ素材の取り込み

v2 の visual media item は任意の `mask` を持てる。値は `sources[].id` への参照であり、参照先は
`gray-h264-fullrange` の動画とする。`mask` を省略した item の意味論は従来と同一である。

frame-engine を使う消費側は、VP9 alpha WebM または alpha pixel format を持つ MOV が layer の
`src` へ射影された場合、元素材と同じディレクトリへ `<basename>.color.mp4` と
`<basename>.mask.mp4` を一度だけ生成する。color は straight color の H.264 / yuv420p、mask は
本節の `gray-h264-fullrange` とし、解像度、fps、尺、フレーム数、先頭 PTS を一致させる。
明示 `mask` がある場合も color / mask の取り込みは行い、frame-engine のマスク入力には明示参照を優先する。

変換失敗は非致命警告とし、該当 layer だけを frame-engine から外す。旧 `<video>` プレビューは
元素材の `src` を維持し、legacy 書き出しの alpha filtergraph もこの取り込み変換を使わない。

## 9. 既知の追随事項（本契約が作る宿題）

- **`packages/analysis-report`** の軽量チェックは `tracks.person_matte` を「string か null」に
  限定しており（`render-analysis-report.mjs`）、object 形の `analysis.json` を**エラーとして弾く**。
  本タスクのファイル境界外のため未修正。object 形を実運用へ載せる前に、この読み手を
  `oneOf` へ追随させる必要がある（表示側の「人物マット: あり / なし」の判定も
  `tracks.person_matte` の真偽値で動くため、object 形でもそのまま「あり」になる）
  - `packages/analysis-report` は object 形と `quality` / マスク併産の表示へ追随済み（2026-08-28）
- **`<video>` の時刻同期が未実装**である（`packages/overlay-runtime`）。したがって
  「動く人物の text-behind-person」は本契約が整っても**まだ本番品質ではない**。
  マットが取れることと、それを本番の合成として出せることは別である
  （`skills/overlay-authoring/text-behind-person.md` の「現在の制約を先に判定する」と同じ判断）
- overlay 断片からの**相対 video URL の解決**（preview / 書き出し双方）が未整備

## 10. 配線コマンド person-cutout

`skills/analyze-footage/bin/person-matte/person-cutout.mjs` は、編集済みカットの人物マット生成と
v2 `edit.json` への配線を 1 回で行う決定論的 CLI である。§4 の素材全体マットとは異なり、これは
プロジェクト固有のカット区間マットを `analysis.json` を経由せず編集トラックへ直接置く。

### 10.1 引数と出力規律

```text
--project <dir>                         必須。edit.json を持つプロジェクト
--cut <index[,index...]>                必須。0 始まり
--quality fast|balanced|accurate|best   省略時 balanced
--model mobilenetv3|resnet50            best のときだけ指定可
--dry-run                               生成・書き換えを行わず予定だけ返す
```

v2 だけを受理し、v0/v1 は「v2 へ migrate してから」という復旧案内付きで失敗する。stdout は成功・
失敗とも 1 行 JSON とし、成功時は `ok`、マットのパスと実測値、追加または更新したレイヤー、track
変更の有無、検証結果を含む。失敗時は `ok:false` と `reason` を返し、exit code を非 0 にする。

`--dry-run` は edit.json とファイルシステムを変更しない。選択対象は v2 `tracks[]` を下から上、
各 `items[]` を宣言順に走査した visual `source.kind:"media"` item である。自動生成した
`person-N` item と `assets/matte/person-N.webm` source は index の母集団から除外するため、再実行後も
同じ index が同じ元カットを指す。

### 10.2 置き場、時間、速度

マットは `<project>/assets/matte/person-<cut index>.webm` に固定する。元カットの source path、
`source.in` / `source.out`、出力 `at` / `duration` を解決し、プロジェクトの整数 fps を使う。

`source.speed` がある場合は、ffmpeg の `setpts=(PTS-STARTPTS)/speed` 相当を**マット生成より先に**
適用する。省略時は source 区間と出力 duration が 1 フレーム以内なら 1 倍、それを超えて異なる場合は
`(out-in) / (duration/fps)` を実効速度とする。速度適用済みの一時動画は `os.tmpdir()` 下に置き、成功・
失敗を問わず削除する。`person-matte.mjs` には出力 fps を渡し、生成 item の `at` / `duration` は元
カットと同じ整数フレーム値にする。

### 10.3 v2 track と z 順

現行 v2 は旧版のトップレベル `layers[]` / `timeline.tracks` を持たない。`tracks[]` の配列順そのものが
画面の下から上への z 順で、各 visual track の `items[]` が旧 layer item の役割を持つ。このため
コマンドは次を v2 ネイティブ表現として出力する。

- `sources[]`: `{id:"person-cutout-N", path:"assets/matte/person-N.webm"}`
- 最前面 visual track: `{id:"person-cutout", lane:"visual", items:[...]}`
- item: 元カットと同じ `at` / `duration`、`source.kind:"media"`、`in:0`、
  `out:duration/fps`

既存 track の相互順は保持し、人物 track だけを末尾（最前面）へ挿入または移動する。これにより人物は
HTML overlay / telop より上に来る。`deriveTracks` 相当の既定順は変更しない。

### 10.4 冪等性と書き込みゲート

同じ cut の再実行では `person-cutout-N` source、`person-N` item、既存マットを更新し、重複を追加しない。
人物 track も常に 1 本である。複数 cut 指定では同じ track に item を集約し、`at`、次いで id の順に
決定的に並べる。

パッチ候補はまず v2 reader で閉じた語彙、参照、一意性、整数フレームを検証し、同一ディレクトリの
一時 edit.json に書いて `packages/schemas/bin/validate-edit.mjs` も通す。両方が成功した場合だけ元
`edit.json` へ atomic rename する。不合格なら一時ファイルを削除し、元 edit.json は一切変更しない。
バックアップは作らない（git 管理を復旧手段とする）。
