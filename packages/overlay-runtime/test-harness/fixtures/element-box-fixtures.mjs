export const BOX_FRAGMENTS = {
  bars: `<div class="chart" style="position:absolute;left:90px;top:50px;width:360px;height:240px;display:flex;align-items:end;gap:20px;font:15px Arial;color:#111">
    <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label">55</span><div class="bar" style="width:38px;height:55px;background:#3c6fb8"></div></div>
    <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label">78</span><div class="bar" style="width:38px;height:78px;background:#3c6fb8"></div></div>
    <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label" style="color:#d83838">95</span><div class="bar" style="width:38px;height:95px;background:#18a878"></div></div>
    <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label">72</span><div class="bar" style="width:38px;height:72px;background:#3c6fb8"></div></div>
  </div>`,
  inline: `<div><div class="plate" style="position:absolute;left:90px;top:100px;width:400px;font:24px/40px Arial;color:white"><span class="text">LONG TELOP TEXT HERE</span></div></div>`,
  small: `<div><span class="tiny" style="position:absolute;left:200px;top:150px;width:24px;height:16px;background:#18a878;font:10px Arial">Hi</span></div>`,
  svg: `<div><svg class="mini-chart" viewBox="0 0 220 130" width="220" height="130" style="position:absolute;left:350px;top:20px;background:#e8f2fb"><rect x="22" y="48" width="35" height="70" fill="#18a878"/></svg></div>`
};

// シェル実機の L1（evidence/preview-element-box-rotate-v1）用。プレビューの表示倍率（出力 640px → 画面 約 332px = 約 0.52）でも
// 棒の辺が画面上 36px 以上になる大きさにしてある（辺ハンドルが出る・角ハンドルが外へ逃げない）。
// 値ラベルは棒の上に積む（棒の高さを変えると同じだけ動く = 組み直りの物差し）。緑の棒と赤いラベルは書き出しの画像から拾う目印。
const shellBars = (left, top, width, height, barWidth, gap) => `<div class="chart" style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;display:flex;align-items:end;gap:${gap}px;font:15px Arial;color:#111">
  <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label">55</span><div class="bar" style="width:${barWidth}px;height:55px;background:#3c6fb8"></div></div>
  <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label">78</span><div class="bar" style="width:${barWidth}px;height:78px;background:#3c6fb8"></div></div>
  <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label" style="color:#e02020;font-weight:bold">95</span><div class="bar" style="width:${barWidth}px;height:95px;background:#18a878"></div></div>
  <div class="column" style="display:flex;flex-direction:column;align-items:center"><span class="value-label">72</span><div class="bar" style="width:${barWidth}px;height:72px;background:#3c6fb8"></div></div>
</div>
`;
export const SHELL_BOX_FRAGMENTS = {
  // 平らなプロジェクト: 棒 3 本目 = x 280〜360・y 155〜250（下端 250 で揃う）
  bars: shellBars(60, 20, 520, 230, 80, 30),
  // 拡縮・回転つきのアイテム用: 図の中心 = 出力の中心（回転の中心）に置く
  scaledBars: shellBars(176, 105, 288, 150, 60, 16),
  // テロップの文字 = inline の span。文字の箱の高さが画面上 30px 以上になる大きさ（左右の辺ハンドルが出る）
  inline: `<div><div class="plate" style="position:absolute;left:40px;top:50px;width:560px;font:60px/80px Arial;color:#14263a;background:#d9e8f6"><span class="text">TELOP TEXT</span></div></div>
`,
  // 画面上 約 24×16px の文字ラベル
  small: `<div><span class="tiny" style="position:absolute;left:300px;top:160px;width:46px;height:31px;background:#18a878;color:#fff;font:20px/31px Arial;text-align:center">Hi</span></div>
`,
  svg: `<div><svg class="mini-chart" viewBox="0 0 220 130" width="220" height="130" style="position:absolute;left:200px;top:80px;background:#e8f2fb">
  <rect x="22" y="48" width="35" height="70" fill="#18a878"/>
  <rect x="85" y="22" width="35" height="96" fill="#3c6fb8"/>
  <rect x="148" y="38" width="35" height="80" fill="#3c6fb8"/>
</svg></div>
`
};
// L1 が作る作業用プロジェクト（フォルダ名 → アイテム id・断片・アイテムの transform）。手順のまとまりごとに別のプロジェクトを使い、状態を持ち越さない。
// 下位のフォルダ名は "edit.json" より後ろに並ぶ名前（sub-…）にする: シェルは見つけた順の最初のプロジェクトでタイムラインを開き、
// プレビューの書き込みを undo の履歴へ積めるのはそのタイムラインのプロジェクトだけなので、undo を見る手順は根のプロジェクトで行う。
export const SHELL_BOX_PROJECTS = {
  'project': { id: 'bars', fragment: 'bars' },
  'project/sub-corner-project': { id: 'bars', fragment: 'bars' },
  'project/sub-scaled-a-project': { id: 'bars', fragment: 'scaledBars', transform: { x: 0, y: 0, scale: 1.5, rotate: 20 } },
  'project/sub-scaled-b-project': { id: 'bars', fragment: 'scaledBars', transform: { x: 0, y: 0, scale: 1.5, rotate: 20 } },
  'project/sub-small-project': { id: 'small', fragment: 'small' },
  'project/sub-inline-project': { id: 'inline', fragment: 'inline' },
  'project/sub-svg-project': { id: 'svg', fragment: 'svg' },
  'project/sub-cancel-project': { id: 'bars', fragment: 'bars' },
  'project/sub-export-project': { id: 'bars', fragment: 'bars' }
};
