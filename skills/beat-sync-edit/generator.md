# 生成器の書き方

生成器（既定名 `<project>/.akari/work/gen-timeline.mjs`）は、**宣言 → オーバーレイ HTML + edit.json**
を一方向に変換する純関数的なスクリプト。プロジェクトルートには置かない（生成物は `.akari/work/`）。

## 1. ビートマップ（時刻の唯一のソース）

`bin/beatmap.mjs` が `declarations.json` + 音源から作る:

```sh
node skills/beat-sync-edit/bin/beatmap.mjs <project> <track-id> [--out .akari/work/beatmap.json]
```

| キー | 中身 | 使い道 |
|---|---|---|
| `beats[]` | 頭拍から BPM 刻みの全拍時刻 | すべての配置の基準 |
| `beat_intensity[]` | 拍ごとの音量ピーク（0〜1） | **音反応モーション**の強度 |
| `env30[]` | 30fps の RMS エンベロープ | 波形の描画・プレイヘッド |
| `sections[]` / `hits[]` | 宣言そのまま | 構成の割り付け・キメの演出 |

生成時に**区間境界と拍グリッドの一致を照合**する（ズレが大きいなら宣言か BPM が疑わしい）。

生成器の中では拍番号だけで書く:

```js
const B = (n) => beats[n];        // 拍番号 → 秒
OV('hook', 'ov-hook.html', B(32), r3(B(64) - B(32)));   // 8 小節ぶん
S('impact-boom-big', B(32), -2);                         // ドロップ頭に一発
```

## 2. 区間の割り付け

`sections` のラベルがそのまま構成の骨になる。**ドロップに山場を、ブリッジに静けさを**置く。

| ラベル | 置くもの |
|---|---|
| `intro` / `build` | 引き（無音気味・ティック・ライザー）。最後にライザーで期待を作る |
| `drop` | 山場。ロゴスラム・大判タイポ・図解の一斉表示・ヒットフラッシュ |
| `bridge` | 静けさ。主張の一文・メタ情報など「読ませる」もの |
| `outro` | CTA・ロゴ・締め |

`hit_points` は**そのままフラッシュ・スイープの位置**に使う（人が耳で「ここ」と決めた点なので、
自動検出より確実に気持ちがいい）。

## 3. オーバーレイの生成

断片の書き方は [overlay-authoring](../overlay-authoring/SKILL.md) に従う。生成器側の要点:

- 断片ごとに**関数 1 つ**にして、拍番号から `animation-delay` を計算する
- ウィンドウ開始が拍上なら、断片内の遅延はそのまま拍位置になる（`B(n) - start`）
- **繰り返し要素は配列 + map** で書く（チップ 12 個・カード 16 枚・テロップ 39 種などは
  手で並べない）

```js
const chipCss = feats.map((_, i) =>
  `${ACT(`.rcp__c${i}`)} { animation: rcp__pop 0.36s ... ${r3(B(210 + i) - r0)}s both; }`
).join('\n    ');   // 1 拍 1 個で点灯
```

## 4. 音反応モーション（焼き込み方式）

**実行時に音を解析しない。** ビートマップの実測値を CSS keyframes に焼き込む。決定的でシーク安全。

```js
// 全 267 拍の実測強度を 1 本の keyframes に
const stops = ['0% { opacity: 0.08; }'];
for (let n = 0; n < beats.length; n++) {
  const t = beats[n], hi = 0.12 + 0.6 * (beat_intensity[n] ?? 0.5);
  const p = (x) => r3((x / DUR) * 100);
  if (t > 0.3) stops.push(`${p(t - 0.28)}% { opacity: 0.08; }`);   // 直前で戻す
  stops.push(`${p(t)}% { opacity: ${r3(hi)}; }`);                   // 拍で光る
}
```

- **背景の光**・**イコライザ**・**波形のプレイヘッド**がこの方式で作れる
- イコライザのような周期物は `animation-duration` を拍長（`60/BPM`）にして
  `infinite alternate` にすれば位相が合う

## 5. edit.json の組み立て

生成器の末尾で 1 回だけ書き出す。**必ず入れる検査**:

```js
const missing = sfx.filter((s) => !fs.existsSync(path.join(ROOT, s.path)));
if (missing.length) throw new Error('missing sfx: ' + ...);        // 存在しない音を参照しない
overlays.sort((a, b) => rank(a) - rank(b) || a.start - b.start);   // 重なり順を明示的に
```

**重なり順（z 順）は配列順**。背景 → B ロール → 3D → 図解/タイポ → スイープ/フラッシュ の
順に並べる（`rank()` で機械的に）。

## 6. 生成器を書くときの心得

- **定数を上に集める**（色・フォント・尺）。レビュー指摘の多くはここ 1 箇所で直る
- **同じ演出は関数化**（スイープ・フラッシュ・Ken Burns）。窓の数だけ呼ぶ
- ファイル名が衝突しうる生成物（同じ画像を 2 窓で使う等）は**連番を付ける**。
  同名だと後勝ちで前の設定が消える
- 実行するたび**全オーバーレイを作り直す**前提にする（部分更新を作らない）
