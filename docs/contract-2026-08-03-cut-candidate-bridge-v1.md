# Cut candidate bridge v1 契約

更新日: 2026-08-03
status: implemented / review-only

## 1. 所有権と停止点

cut candidate bridge は `edit-plan` Checkpoint 1 の semantic keep/drop 承認後に、無音短縮と
filler/trouble の review 候補を作る補助経路である。新しい top-level command や skill ではない。
出力は derived report で、`edit.json`、decision log、承認状態を変更しない。全候補は
`decision:"REVIEW_REQUIRED"`、report は `approved_to_apply:false` と `edit_json_modified:false` を固定する。
Checkpoint 3 の明示承認前に適用してはならない。

## 2. 入力

公開呼出しは次だけである。

```sh
node <resolved-edit-plan-skill>/bin/propose-cut-candidates.mjs \
  --project <project-root> \
  --keep-plan .akari/work/semantic-keep-plan.json \
  --decision-log edit-plan/decision-log.md \
  --approval-ref checkpoint-1/<subject>/<yyyy-mm-dd> [--write]
```

project は `.akari/connections.json` を持つ。keep plan は
`packages/schemas/semantic-keep-plan.schema.json` の closed v1 object で、v0 mapping は source 1 件と
`id:null`、v1 mapping は unique string id を使う。`occurrences[]` 順が semantic output 順で、range は
source 秒の `explicit [in,out)` または `full_source` だけである。0 occurrence は合法な空 timeline で、
unused source を probe・分析しない。approval ref は caller assertion であり本人証明ではない。

active source は project-contained regular file でなければならない。analysis は mirrored sidecar parent の
collision-safe `*.analysis/analysis.json` を列挙し、`analysis.source` が同じ source を指す schema-valid
候補が一つだけのとき採用する。analysis v0 は source hash/解析日時を持たないため freshness は
`UNVERIFIED_CONTRACT_LIMIT` として残す。transcript が空、または words が欠ける segment が一つでもある
source では silence detector を走らせず、各 occurrence に `WORD_TIMING_UNAVAILABLE` を一件出す。

## 3. media と A4 pause 演算

ffprobe は MP4/MOV 系と Matroska/WebM の finite positive format duration、全 stream、audio stream
ちょうど一つを要求する。audio が 0/複数、format と finite audio duration の差が 1 秒超なら停止する。
detector は選択済み stream を `-map 0:<index>` で固定し、`silencedetect=noise=-35dB:d=0.45` を使う。

silence 全体が一つの keep occurrence に包含され、前後 1 秒以内の word context がある場合だけ pause
候補を計算する。chapter event、実 segment 終端句読点、default の順で target を 0.30 / 0.166667 /
0.10 秒に分類する。中央へ target を残し、次で 30fps cell へ snap する。

```text
start_frame = ceil((silence.start + target/2 - 1e-9) * 30)
end_frame   = floor((silence.end - target/2 + 1e-9) * 30)
```

表示秒と actual retained は 6 桁へ丸める。例 `[10,10.8)`, target `0.1` は frame `302..322`、
表示 `10.066667..10.733333`、actual retained `0.133334` になる。±0.033333 秒 guard に word が重なる、
occurrence を跨ぐ、frame cell が無い、実効短縮が無い、target に届かない場合は closed skip code とする。

## 4. candidate family

- `semantic_event_review`: analysis の filler/trouble と occurrence の非空交差を occurrence ごとに提示する。
  partial projection は `PARTIAL_EVENT_OCCURRENCE` を持ち、自動統合・drop しない。
- `pause_shortening_review`: containment、word context、classification、frame math、speech guard を通った
  silence だけを提示する。

両 family は `UI_WAIT_UNRESOLVED` と `screen_review_required:true` を常に持つ。context keyframe は証拠で
あり、操作待ち解決の推測には使わない。keyframe 不在は `SCREEN_CONTEXT_MISSING`、semantic candidate は
`INFORMATION_RETENTION_REVIEW` を持つ。

## 5. report、identity、安全境界

report schema は `packages/schemas/cut-candidates.schema.json`。canonical JSON は recursive code-point key
order、compact UTF-8、LF 一個で、`--write` 有無の stdout bytes は同一である。保存先は
`.akari/reports/cut-candidates/<report-bytes-sha256>.json` だけとし、ancestor symlink を拒否し、同一 bytes
だけを再利用する。

入力、policy、実行 module、standalone schema validator と vendor runtime、ffmpeg/ffprobe/Node binary の
bytes/SHA を report へ記録し、serialize 直前に再検査する。child env は `LC_ALL=C`、`LANG=C`、
`AV_LOG_FORCE_NOCOLOR=1` だけである。動的 library closure と悪意ある swap-and-restore は証明しないため、
`DYNAMIC_LIBRARY_CLOSURE_UNVERIFIED` と `CONCURRENT_RETARGET_NOT_PROVEN` を常に残す。

schema と report 単体の semantic 検査が証明するのは、report 内の receipt・集計・候補間の自己整合までである。
元入力との完全な binding は生成時に、open 済み keep plan、source、analysis、detector silence、keyframe と
純粋候補生成結果を照合してから入力 hash を再検査する。後から同じ binding を再検証する場合は report だけで
推測せず、receipt が指す元入力 bytes を揃えて helper を再実行する。

失敗時 stdout は空、stderr は固定 message の canonical `akari-cut-candidate-error-v1` 一行だけで、
exit 2/3/4/5/6 を contract・integrity・probe・detector・report/write の境界に割り当てる。raw stderr、
source 発話、absolute path を error に反射しない。

## 6. 適用後の人間確認ゲート

Checkpoint 3 で候補適用を承認しても、cut 後の完成性を自動承認してはならない。候補を反映した
preview/render を作った後、次の五つを同じ版に対して人間が確認し、結果を append-only decision log に
記録する。失敗した項目があれば完成扱いせず、修正版をもう一度すべて確認する。

- `POST_CUT_ASR_REVIEW`: cut 後音声を再文字起こしし、語欠落、語頭・語尾切れ、誤結合を原音と照合する。
- `POST_CUT_INFORMATION_RETENTION`: 前後文脈、filler/trouble の扱い、意味上必要な情報が保持されたか確認する。
- `POST_CUT_UI_TIMING_REVIEW`: クリック、画面遷移、読込待ち、結果表示が説明音声より早過ぎたり遅過ぎたりしないか確認する。
- `POST_CUT_AUDIO_BOUNDARY_REVIEW`: 各 cut 境界を試聴し、click、破裂、無音欠落、不自然な呼吸・残響断絶がないか確認する。
- `HUMAN_APPLY_GATE`: 上記四項目の証拠を人間が明示承認する。helper、ASR、validator、過去承認はこの gate を代行しない。

## 7. 配布と検証

3 schema の Ajv standalone validator と実際に参照する runtime/license は
`scripts/gen-cut-candidate-validators.mjs` が生成する。`--check` は bare import 0、relative closure、license、
repo `node_modules` を外した detached startup を検査する。checkout、npm package、project scaffold、copied
plugin の edit-plan skill は同じ helper/schema/runtime bytes を持たなければならない。
