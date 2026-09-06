**本編（cut）の映像と音声の分離 v0 — 設計草案**

状態: 草案・司令塔 / オーナー未裁定

基準: `3e878921464e1d5c73938346325818d3d5185247`（2026-09-06）。§1 はこの版の実装を読んだ事実、§2 以降は未実装の提案である。本票の成果物は本書と日英索引へのリンクだけで、コード・スキーマ・テストは変更しない。

## 1. 現状の模型（事実）

**本編音声の永続的な所有者は visual lane の media item である。** 独立した audio lane の item は BGM・ナレーション・SE 用に存在するが、cut を置くとその音声が自動でそちらへ分かれる構造ではない。以下の `path:line` はすべて上記コミットのリポジトリ相対パスであり、提案フィールドの実装根拠ではない。

| 領域 | 現状と根拠（3e878921） |
|---|---|
| cut の音声 | `packages/schemas/edit.schema.json:1312` の `itemSourceMediaV2` が素材参照、素材内秒の in/out、speed、freeze とともに `gain_db` / `mute` を持つ。`packages/schemas/edit.schema.json:1330` は埋め込み音声を speech と呼び、省略時は 0 dB・鳴ると定義する。独立音声へのリンクはない。 |
| visual item の境界 | `packages/schemas/edit.schema.json:1446` の `itemV2Media` は `additionalProperties: false`。`packages/schemas/edit.schema.json:1683` の `itemV2` は visual 用の閉じた oneOf。現行に item 直下の `audio` はない。`packages/edit-store/src/edit-v2.ts:203` の `ItemV2Base` と `packages/edit-store/src/edit-v2.ts:226` の `MediaItemV2` にもない。 |
| 独立音声の語彙 | `packages/schemas/edit.schema.json:1645` の `itemV2AudioMedia` は別の閉じた型で、role は sfx / narration / bgm、省略時 sfx。item に gain_db、fade_in/out、ducking、音量 keyframes、denoise、lowcut_hz を持つ。`packages/edit-store/src/edit-v2.ts:93` の音声 source に speed / pitch_semitones / formant がある。汎用の `envelope` / `fx` キーがあるという意味ではなく、これらの宣言からエンベロープや FX 処理を組み立てる。 |
| 音声 fixture | `packages/schemas/examples/edit-v2-audio-track-valid/edit.json:14` は SE の gain/fade と duration:0、同ファイルの `:30` は narration、`:42` は bgm/ducking を示す。duration:0 は未解決尺のセンチネルで、無音や分離済みを意味しない。 |
| トラックミュート | `packages/schemas/edit.schema.json:1705` で lane に応じ item の型を分け、`packages/schemas/edit.schema.json:1750` で visual の muted は cut の埋め込み音声、audio の muted は音声 item をプレビュー・書き出しから除外すると明記する。映像自体を非表示にする意味ではない。 |
| exact keys と直列化 | `packages/edit-store/src/edit-v2.ts:355` の ITEM_KEYS / AUDIO_ITEM_KEYS、`:516` の音声検証、`:600` の visual 検証、`:642` の media source 検証も未知キーを拒否する。`packages/edit-store/src/canonical.ts:9` は既定のキー順、`:138` は生成キー集合も使った item 直列化。`packages/edit-store/src/generated/edit-v2-keys.ts:4` も更新対象になるため、型だけ足す変更では足りない。 |
| migrate / normalize | `packages/edit-store/src/migrate/index.ts:253` は v0/v1 cut を visual の media source に移し、音声 item の対は作らない。`:393` から SE、`:434` から narration、`:480` から bgm を別途移す。`:554` の移行記録も追加音源の tracks 化である。`:724` 以降の normalize は既存 v2 を複製して正規化し、`:766` で serializeEdit する。明示 normalize は整形を変え得るので「全入力が再直列化しても元バイトと一致」とは言えない。 |
| 内部表現と互換ビュー | `packages/edit-store/src/internal-model.ts:1249` は source.gain_db / mute を互換 cut へ持ち越す。`:1392` の projectLegacyEdit は tracks から旧配列を作り、`:1433` で visual track の muted を cut.mute に反映する。`packages/edit-store/src/legacy-audio-view.ts:19` は独立音声 item だけを sfx/narration/bgm に射影し、audio track の muted を除外する。cut 音声はこの三つの配列に含まれない。 |
| frame-engine preview | `packages/edit-store/src/audio-schedule.ts:492` の projectSpeechDeclarations が cut から speech 宣言を作り、`:512` で cut.mute を除外、`:532` 以降で freeze 前後を分ける。`packages/frame-engine/src/audio/preview-audio-supply.ts:368` は speech を mutedCutTracks / allCutsMuted、それ以外を mutedAudioTracks / allAudioMuted に振り分ける。`:1692` の setMutedTracks が cuts / audio / allCuts / allAudio を受け、`:1711` で稼働中 GainNode にも反映する。ここでいう cuts はミュートする段番号の集合で、cut 宣言の配列ではない。 |
| render-cut の射影 | `packages/render-cut/src/internal-render.mjs:48` で mutedVisualItemIds / mutedAudioItemIds を別に集める。`:74` はミュートした独立音声を除外し、`:85` は visual cut に mute:true を付ける。cut 自体は映像用に残す。`packages/render-cut/src/plan.mjs:988` は素材に音声があり cut.mute が true でない場合のみ取り込み、`:1007` はそれ以外を尺付き無音にする。ギャップ対応側にも `packages/render-cut/src/plan.mjs:1245` の同種の分岐がある。 |
| GPU の音声入口 | `packages/render-cut/src/render-cut.mjs:380` で cut_audio 計画を実行し、`:403` / `:408` の audioSourcePath を GPU/OSR 共通オプションに渡す。`packages/gpu-export/src/index.mjs:125` は渡された本編音声を mux し、未指定なら映像のみ。低レベル GPU は edit.json の音声を自前で再ミックスしない。 |
| OSR の音声入口 | `packages/osr-export/src/index.mjs:63` は PNG 出力なら audio.wav へ、`:74` は通常出力なら渡された audioSourcePath を mux する。`:270` の muxSourceAudio は音声ストリームの有無を調べる。GPU と OSR の下流入口を直すだけでは cut の所有権は変わらない。 |
| 書き出しの共通順序 | `packages/render-cut/src/plan.mjs:78` は本編音声の生成、`:105` は合成後の映像／音声を入力にする追加音源ミックスを計画する。実行も `packages/render-cut/src/render-cut.mjs:478` で GPU/OSR の合成後に audio_mix を行う。したがって「全音源のミックスを GPU/OSR の前に完了する」とは異なる。4 経路のうち書き出し三経路はこの共有処理を利用する。 |
| preview-server | `packages/preview-server/src/frame-engine-client.ts:140` は配信された audio.speech があればそれを使い、なければ normalizedCuts から projectSpeechDeclarations を呼ぶ。`:646` で独立音声 declarations と speech を createPreviewAudioSupply に渡す。`:850` は更新時にも speech を再供給する。サーバー側の `packages/preview-server/src/preview-audio-summary.mjs:47` にも cut → speech の射影がある。初回・更新・フォールバックのすべてが対象になる。 |
| タイムラインの派生行 | `apps/shell/extensions/akari-annotations/src/common/derive-timeline-tracks.ts:63` の withAudioDisplaySupplement は **BGM があり、audio 行がない場合だけ** `t-audio-implied` を表示用に足す。本編の埋め込み音声を全 cut から派生する行ではない。ここをそのまま「本編音声」と読み替えると BGM と衝突する。 |
| 見出し | `apps/shell/extensions/akari-annotations/src/common/track-header-controls.ts:4` は video/overlay/layer に目とスピーカー、audio にスピーカー、caption/beat に目を出す。`apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts:7935` は cuts 行の目とミュートを別々に配線する。この基準版のボタン集合に鍵の追加はまだ含まれず、別票 timeline-track-lock と接続する必要がある。 |
| 波形の二系統 | `apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts:8984` は cut の src/in/out で波形を引き、`:10434` は cut チップ下部に白い波形を描く。一方、独立音声は `:10140` の updateAudioClipWaveform、`:10268` の audioLoudnessBucketColors で gain/keyframes/fade を使った波形、`:10300` でその canvas の除去を行う。独立音声用の関数だけ変えても cut 下の波形は移動しない。 |
| インスペクター | `apps/shell/extensions/akari-annotations/src/browser/akari-inspector-widget.ts:687` は cut 選択時の audio セクションに「埋め込み音声」の gain と mute を出す。独立音声は `:1490` の audio、`:1494` の audio:fades、`:1570` の audio:keyframes、`:1607` の audio:pitch-time、`:1635` の audio:enhancement を持つ。cut 選択だけで独立音声と同じ編集機能が出るわけではない。 |
| lint | `packages/edit-lint/src/edit-lint.mjs:194` は内部モデルから音声を射影して検査入力を作る。`:1243` の audio lane 分岐で gain、エンベロープ、source/item の FX、fade、in/out を検査し、`:1302` で audio の duration:0 と visual の正尺を区別する。cut の source.gain_db / mute の型・範囲は前述の schema / edit-store reader が守る。現行には A/V link の参照整合・二重供給を判定する規則はない。 |

内部資料として `akari-video-internal` の `planning/notes-2026-08-18-timeline-latency-and-track-model.md` §5 / §8 / §9、および `planning/notes-2026-09-02-audio-feature-inventory.md` を読み取り参照した。前者からは tracks を正本にし、出力時刻はフレーム・素材時刻は秒、出どころを source に閉じ込める原則を引き継ぐ。後者からは音量エンベロープのクリップ所有と、NLE → 音声編集 → DAW の段階導入を引き継ぐ。これらの過去時点の「未実装」一覧は、上表の現在の音声 keyframes / FX / muted の実装状況で補正する。内部 notes の内容・参照実装のコードは移植しない。

外部の操作参照では、Premiere はリンクを一単位として扱い、Clip > Unlink で独立させる（[Adobe 公式: Link audio and video clips](https://helpx.adobe.com/premiere/desktop/add-audio-effects/basic-audio-editing/link-audio-and-video-clips.html)）。Alt/Option で片側だけ選択・ドラッグする操作は [Adobe 公式リファレンスの linked clips 節](https://helpx.adobe.com/pdf/cs6/premiere_pro_reference.pdf)にある。Resolve も同録 A/V を自動リンクし、別に置いた音を Link Clips で関連付けられる（[Blackmagic Design 公式ガイド: Linking Clips](https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-15-Definitive-Guide.pdf)、検索で取得できた該当節を確認。PDF 全文の取得はできていない）。これらは操作の参考であり、AKARI のスキーマや最新他製品版の全挙動を規定しない。

## 2. 案の比較（3 案 × 8 観点）

A は表示だけの分離、B は新規 cut 挿入から実データをリンク付きで分離、C は埋め込みを既定のまま維持して「音声を分離」で B の形へ変換する案である。B/C の `audio: false` は **visual media item 直下**、`link: <cutId>` は **audio item 直下**への追加案で、現行フィールドではない。C の「音声を分離」は音声 item の生成、続く「リンク解除」は関連の削除であり、別操作とする。

| 観点 | A. 表示だけ分離 | B. 実データで分離（挿入時リンク） | C. 明示コマンドで段階分離 |
|---|---|---|---|
| 1. スキーマ・edit-store・migrate / normalize | 新しい音声データは不要。cut 由来の表示 ID → visual track/item ID の対応だけを持つ。exact keys / additionalProperties は不変。派生行を normalize / migrate が保存しない。 | visual の audio、audio item の link を schema / exact keys / 生成キー / canonical / internal model に追加。分離 speech と一時 mute の語彙も下記のとおり必要。新規挿入を原子的な A/V 2 item 書き込みに変更。v0→v2 と通常 normalize は自動分離しない。 | B と同じ読取語彙。挿入・migrate・normalize の既定出力は現状維持。分離コマンドだけが追加キーと音声 item を書く。既存の埋め込みと分離済みを同じ v2 文書で混在可能にする。 |
| 2. エンジン（4 経路 + preview-server） | frame-engine は現行 speech、render-cut は現行 cut_audio、GPU/OSR は現行 audioSourcePath のまま。preview-server の音声射影も同じ。派生行のスピーカーを従来の cuts ミュート先へ正しく配線する。 | frame-engine の speech 生成前と render-cut の互換射影で audio:false を尊重し、映像用 cut は残す。独立した speech は音声 item として一度だけ供給。GPU/OSR は共有 cut_audio / audio_mix の変更を受け、両 mux 出口で検証。preview-server の初回・更新・fallback とサイドカー ID も対応。 | B と同じ供給規則を全経路へ先行導入してからコマンドを公開。未分離は現行供給、分離済みは独立供給。新しい入力を黙って旧経路で再生しない。 |
| 3. タイムライン UX | 映像行は目 + 鍵、visual track ごとに「本編音声」派生行を出しスピーカーを移す。波形は派生行へ移動。派生チップの移動・トリム・削除は元 cut に作用し独立操作不可。映像 keyframes は cut に追従し、独立した音量 keyframes は新設しない。 | 新規 cut の映像行は目 + 鍵、実音声行はスピーカー。既定はリンク移動・トリム・削除、Alt は片側、リンク解除後は独立。映像 keyframes は映像、音量 keyframes と波形は実音声 item が所有。旧 cut には A 型の互換派生行が必要。 | 未分離 cut は A 型の派生行、分離済みは B 型の実音声行。「音声を分離」で移動先を明示し一度だけ置換。未分離は cut 追従、分離後はリンク操作・Alt・解除。波形を両行に二重表示しない。鍵はリンク相手にも適用して原子的に拒否する。 |
| 4. インスペクター | 派生チップの選択は cut の埋め込み音量・mute に案内する。表示名を「本編音声」としても書込先は source。音声 item 専用の FX/fade/keyframes が使えると誤表示しない。 | visual 側は分離状態と「音声を選択」を表示、audio 側で gain/fade/ducking/keyframes/FX を編集。source.mute と独立音声の mute を二重に操作させない。リンク有無と同期差を表示する。 | 未分離は従来の埋め込みセクション + 分離コマンド、分離後は B と同じ。未対応の cut は理由を出しコマンドを無効化する。 |
| 5. lint | 新しい link 規則は不要。派生表示は lint 入力に混ぜない。見出し名と書込先の対応は UI 検証で担保する。 | 型に加え参照先の実在・visual media 限定・自己/循環/重複リンク・audio:false の整合を検証。分離 speech の role、mute、素材時間、二重供給、同期差、キーフレーム尺を検査。意図した片側編集は同期差の warning とし禁止しない。 | B の規則は追加フィールド使用時に適用。未分離の旧文書へ「分離すべき」警告を増やさない。コマンド前後の供給同値と、再実行で音声 item を増やさないことを検証する。 |
| 6. 既存 edit.json の互換 | 読込・表示・再生・書出しで元ファイルを一切書き換えない。スピーカー操作時だけ従来の mute 変更。独立した J/L カットは実現しない。 | 旧ファイルは未分離として変換不要。新規挿入した対と明示移行だけ変化。旧アプリは追加キーを拒否し得るため、分離後ファイルの旧版読取互換までは約束しない。 | 分離しない限りファイルのバイト不変。明示した cut と受け皿の音声 track だけ変更し、無関係な要素・別ファイルは保持。解除や音声削除で埋め込み音声を勝手に復活させない。 |
| 7. 工数（実装票見積り） | 3 票: 派生模型/操作、見出し/波形/検査画面、回帰検証。track-lock 票を除く。後に独立編集へ進める場合は B/C 相当が追加で必要。 | 5 票以上: 語彙、供給、挿入/リンク操作、UI、経路横断検証。全 cut を既定分離するには freeze/transition/速度/入れ子を含む一般変換が必要で、追加 1〜2 票を見込む。 | 5 票: §4 の語彙、供給、明示変換/リンク操作、互換 UI、経路横断検証。初期の変換対象を限定する見積り。一般変換や既定 B 化は後続 1〜2 票。 |
| 8. リスク | 実データの所有と画面の行が違い、音だけ動かせると誤解しやすい。複数 visual track を一つのスピーカーへ束ねると既存の個別 mute を失う。長期的には二重の編集模型が残る。 | 全挿入経路の更新漏れ、二重再生、旧版拒否、cut の freeze/クロスフェードを単純コピーして音を変える危険。リンクを永続時刻の親子関係にすると Alt 編集を保存できない。 | 二種類の所有模型がしばらく共存する。移行境界で muted・speech のダッキング鍵・preview 更新が欠落しやすい。一方、失敗範囲を利用者が選んだ cut に限定できる。 |

**B/C 共通の提案語彙と不変条件。** `version: 2` の追加のみの進化として、`MediaItemV2.audio?: false`（省略 = 従来の埋め込みを供給）と `AudioMediaItemV2.link?: string` を追加する。audio を共通 ItemV2Base 全体に無条件で許さず visual media に限定する。`link` は同じ edit 内の永続 cut ID を指す編集上の関連であり、レンダー時に音声 source や at をリンク先から再計算する命令ではない。初期は一対一とし、audio item は自身の src / in / out / at / duration を正本にする。

分離後も dialogue を SE と誤分類しないため、audio role に `speech` を追加する案を含める。speech はダッキングの鍵としての意味、lane/所有 track はミュート先としての意味を担い、現行の「kind が speech なら cuts ミュート」という結合をほどく。役割を narration に代用すると narration ∪ transcript の鍵や auto-level の既定が変わり得る。解除後も role:speech は残す。現在の sfx/narration/bgm の列挙と legacy view は明示的に拡張し、未知 role を sfx へ黙って落とさない。

さらに `AudioMediaItemV2.mute?: boolean`（省略 = false）を追加する案とする。元 cut の source.mute はこの item mute に移し、元 visual track の muted は分離先の専用 audio track の muted に引き継ぐ。-60 dB を無音の代用にしない。分離後の可聴条件は「audio item が mute でない、かつ所有 audio track が muted でない」であり、元 visual track の muted は実音声には作用しない。元 cut の source.gain_db / mute は明示分離時に移して削除する。audio:false と残留 source 音量が手書きで併存した場合は効かない宣言として lint で通知する。

分離は、一つの編集トランザクションで新しい audio ID の確保、音声 item 作成、cut.audio:false、リンク設定を行う。素材ファイルはコピーせず同じ sources[].id を使い、書込み前の競合・ロック検証に失敗したら全体を取り消す。リンク解除は link だけを消し、source・時刻・音量・audio:false は保つ。リンクした通常削除は両 item、Alt で音声だけ削除なら cut.audio:false を残す。映像だけ削除なら存続音声の link を除去し孤立参照を残さない。「分離済み」判定は link の存在だけに依存させず、解除後の再分離で音を複製しない。

lint は link がある音声から参照先の audio:false を要求するが、逆向きの存在義務は置かない。audio:false だけ残る映像、link を持たない role:speech 音声は、削除・解除後の正当な状態である。同じ sources[].id を再利用するだけでは二重供給と判定せず、リンクされた対の埋め込み有効状態と実際の供給 ID を調べる。

## 3. 司令塔の推奨と理由

**推奨は C（明示分離）を実データ模型とし、未分離 cut の表示には A の互換派生行を使う。** これは司令塔への提案であり裁定済みではない。C 単独で映像行のスピーカーだけを消すと既存案件の音声入口を失うため、互換派生行までを初期導入に含める。A だけでは音だけの移動・音量 keyframes を持てず、B を既定にすると未検証の一般変換をすべての挿入に強制する。

目標へは次の順で移行する。

1. schema / reader / lint に追加語彙を用意し、旧文書の意味とバイトを保つ。供給対応前は分離書込を公開しない。手書きした新語彙も旧実行経路に流さないよう、edit-store の実行用読込境界で未対応機能エラーにする。検証用の構造読取とは分ける。
2. 4 経路と preview-server へ同じ所有規則を導入する。埋め込み側は audio:false のときゼロ回、独立側は一回だけ供給する。映像 item はタイムライン・字幕射影・合成に残す。分離 speech を audio item の時刻・所有トラックで鳴らし、ダッキング鍵はその出力位置へ射影する。リンク解除や音だけ移動したあと、元 cut 位置を speech 鍵として二重採用しない。
3. opt-in の「音声を分離」とリンク編集を出す。初期対象は **トップレベルの、anchor なし・入れ子なし・speed が省略または 1・freeze なし・前後に音声クロスフェードを伴う transition なしの cut**、かつ素材に音声があると確認できたものに限る。duration はフレーム丸めを含め素材区間と整合するもの。静止画・無音素材は対象外、未検出は結果が出るまで書込み保留。未対応対象は元のまま再生・書出しを続けられ、黙って近似変換しない。
4. visual track ごとに「本編音声（V1）」等の派生行を音声グループへ出し、そこに未分離 cut の波形とスピーカーを置く。ID は元 track ID から安定導出し、既存の BGM 用 t-audio-implied と別にする。派生行のスピーカーは元 visual track.muted に書き、実音声行のスピーカーは audio track.muted に書く。分離済み分は派生チップを消して実音声行にだけ描く。最後に映像系見出しを目 + 鍵、字幕を目 + 鍵、音声をスピーカーに統一する。M/S・ミキサーは後続とする。

派生行は edit.json の tracks に保存せず、z 順も変えない。分離先は元 visual track ごとの専用実音声 track を必要時に作る案とし、既存 BGM/SE の muted を変更しない。以前作った受け皿の muted が元 visual track と異なる場合は同じ mute 状態の別行を用意し、既存音声の状態を上書きしない。派生行が空になったらその表示だけを消す。

リンク中の通常移動は両側の at に同じ整数フレーム差を足す。トリムは各側の素材範囲と速度から境界を計算し、両方で成立する差だけを原子的に適用する。Alt で片側をずらしても link は維持し、その後の通常移動は現在の同期差を保つ。再読込で時刻を揃え直さない。初期対応範囲内で同期差は at と source.in から導出して表示できる。将来の速度変更は両側同時に扱えるまで拒否する。

映像の transform 等の keyframes は映像に残す。音量 keyframes は音声 item 内のローカル整数フレームを正本とし、移動では t 不変、先頭トリムでは t を境界差だけ移して範囲外を除き、新境界値を既存補間規則で補う。最低点数を満たさない場合は等価な一定 gain へ明示的に畳む。片側 keyframe の編集を相手へ複写しない。いずれかの変更対象 item/track が locked なら通常のリンク操作は全体を拒否し、Alt 操作でも実際に変える側のロックを回避しない。Undo/Redo は対とキー変更を一単位で戻す。

**互換性の範囲。** 分離しない既存 edit.json は、開く・表示・再生・書き出し・新機能非使用の処理によって書換えない。既存の正規直列化 fixture は新旧 serializer で同じバイト列を返す。非正規な空白・キー順を明示 normalize した場合まで原文一致とはしないが、今回の語彙追加に伴う default キーの補完や自動分離は禁止する。v0/v1 の既存移行手順は変更せず、現行が読めない旧形式の読取対応拡大を本票で約束しない。明示分離時は対象 cut と受け皿だけを局所編集し、無関係な item・sources の内容と順序、captions.json、motion ファイル、素材を変えない。分離後のファイルを旧アプリで開けることは別の互換条件である。

## 4. 段取り（実装契約の草案・5 票）

以下は今後起票する単位であり、本設計票では実施しない。所有欄のディレクトリはその票の候補境界を示し、起票時に既存の関連ファイル・テストと必要な新規ファイルへ絞る。同じファイルを使う票は依存順に編集し、特に UI と edit-store の変更を重ねて走らせない。別票 `2026-09-06-timeline-track-lock` の成果を第4票の前提にする。

| 票 | goal | 所有ファイル（候補） | 受け入れ条件の骨子 | 依存順・main へ入る条件 |
|---|---|---|---|---|
| 1. 分離語彙と読取境界 | schema + edit-store + lint に追加のみの席を作る。未対応エンジンへ新形を渡さない。 | `packages/schemas/edit.schema.json`、同 examples の専用 fixture、`packages/edit-store/src/edit-v2.ts` / `generated/edit-v2-keys.ts` / `canonical.ts` / `internal-model.ts` / `migrate/index.ts`、`packages/edit-lint/src/edit-lint.mjs`、各パッケージの関連テスト。 | audio:false / link / role:speech / item mute の型、media 限定、リンク整合を schema と reader で一致させる。旧正規 fixture の直列化バイト一致、未操作ファイル不変、migrate の既定出力不変。新形は検証可能だが実行用読込は明示エラー。変換・挿入 UI はまだ公開しない。 | 依存なし。エンジン未変更でも旧文書をそのまま扱え、新形を黙って誤再生しないので単独で main に入れられる。 |
| 2. 所有規則を全供給経路へ | 埋め込み停止と独立 speech の供給を揃える。 | `packages/edit-store/src/internal-model.ts` / `legacy-audio-view.ts` / `audio-schedule.ts` と関連音声射影、`packages/frame-engine/src/audio/`、`packages/render-cut/src/internal-render.mjs` / `plan.mjs` / `render-cut.mjs`、`packages/gpu-export/src/index.mjs` / `packages/osr-export/src/index.mjs` の入口と関連テスト、`packages/preview-server/src/frame-engine-client.ts` / `preview-audio-summary.mjs` と配信の関連ファイル。必要な生成バンドルは正規生成。 | 未分離は既存結果維持、分離済みは音が一回だけ鳴る。visual muted は埋め込みだけ、audio muted/item mute は所有音声だけ停止。preview 初回/更新/fallback、通常/ギャップ cut_audio、GPU/OSR mux 後の audio_mix まで fixture を通す。speech の鍵・素材参照・ID とサイドカー再利用が分離後に正しい。 | 第1票後。全消費経路を同一リリースで対応させてから実行用拒否を解除する。どれか未対応なら拒否を残し、変換 UI は未公開のまま。 |
| 3. 明示変換とリンク編集 | 対象を限定して音声分離・解除・片側編集を原子的に実現する。 | `packages/edit-store/src/` の mutation/API・対応テスト、`apps/shell/extensions/akari-annotations/src/common/` の edit-store/選択/操作契約、同 `src/node/` の書込サービス、同 `src/browser/akari-annotations-widget.ts` / `akari-inspector-widget.ts` と関連テスト。 | §3 の対象判定、同一 source 参照、音量/mute 移送、audio:false、安定 ID、局所差分、冪等性。通常/Alt の移動・トリム・削除、解除後の独立性、ロック/競合拒否、Undo/Redo、再読込を確認。拒否対象にはファイル差分ゼロ。分離後のインスペクターから音量・fade・keyframes・FX を所有音声へ書ける。 | 第2票後。既定挿入は変更しない。第4票以前は現行見出しを保ってよく、分離済み音声は実音声行で操作できること。 |
| 4. 互換派生行と目 + 鍵 | 旧 cut の音声操作を維持したまま見出しと波形を整理する。 | `apps/shell/extensions/akari-annotations/src/common/derive-timeline-tracks.ts` / `track-header-controls.ts` / 関連レイアウト、同 `src/browser/akari-annotations-widget.ts` / `akari-inspector-widget.ts` / 関連 CSS・テスト、ミュート通知の既存配線。 | 未分離だけの案件、全分離、混在、複数 visual track、BGM 併存で正しい行とスピーカーを表示。派生行は無書戻し、元 track に個別 mute が届く。cut 下の波形を除き、派生/実音声に一回表示。目 + 鍵 / スピーカー / 字幕の目 + 鍵を実機確認し、鍵は画素・可聴性を変えない。 | 第3票と timeline-track-lock 後。BGM 用 implied 行は維持。派生行を出す変更と映像スピーカーを消す変更を一緒に入れる。 |
| 5. 横断検収と導入範囲の固定 | 旧案件の無変換互換と新旧混在の経路同値を検証し、初期提供範囲を固定する。 | `packages/frame-engine/test/`、`packages/render-cut/test/`、`packages/gpu-export/test/`、`packages/osr-export/test/`、`packages/preview-server/test/`、`apps/shell/extensions/akari-annotations/` の既存検証領域、利用者向け導線文書と関連契約。 | 同じ合成素材を未分離/分離/解除/片側移動/音声削除で全4経路へ渡す。音声の開始/終了、無音区間、gain、二重再生なし、speech ダッキングを比較。旧 fixture の変更前後一致、ファイル hash 不変、初期/ホット更新/再読込を確認する。GPU/OSR は実出力まで検証し、plan の一致だけで代用しない。 | 第4票後。第1〜4票の局所試験に加える導入検収。未実測経路を対応済みとしない。既定 B 化・一般変換の可否はこの結果を基に別裁定へ渡す。 |

第1票は L0、第2〜5票は各タスクが扱う実行経路に応じ L0 + L1 を要求する。横断検収ではマスター処理を切ったテスト素材で供給回数と区間 gain を比較し、時間境界は 1 出力フレーム以内、同区間の RMS 差は 0.1 dB 以内を初期の受け入れ値案とする。二重供給は区間測定に加えて宣言 ID の列挙回数でも検出する。既存 DSP/codec の差を「ビット一致」とは呼ばず、マスター有効時は既存の音声 QC 条件も適用する。しきい値の調整は測定結果を根拠として実装票に明記する。

freeze・transition・速度変更・入れ子/anchor の一般変換は5票の対象外であり、対応するまで明示分離コマンドが拒否する。特に freeze の無音区間と前後音声を表すには複数音声 item や追加の時間写像が必要になり、一対一 link の拡張を先に決める必要がある。単に in/out と duration をコピーして対象拡大しない。

## 5. 未決事項（オーナー裁定・5 点以内）

- C + 互換派生行を初期提供とし、実測後に新規挿入の既定を B に切り替える方針でよいか。
- 初期の「音声を分離」を§3の単純 cut に限定してよいか。freeze / transition / 速度変更 / 入れ子の一般変換はどの順に後続化するか。
- 分離 speech の role と audio item mute の追加、一対一 link、Alt による同期差の保持、音声削除時に埋め込みを復活させない規則を採るか。
- 派生行名を「本編音声（V1）」、実音声の受け皿を元 visual track ごとの専用行とするか。並びと名称変更の入口をどう見せるか。
- 自動移行は行わない前提のまま、将来 opt-in の「選択 cut を一括分離」を提供するか。既存案件の一括変換は個別コマンドの検収後とするか。
