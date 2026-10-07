// 名札なし・class ありの断片 4 枚。prepare-fixture.mjs が作業用プロジェクトへ書き出す。
// 棒グラフだけ断片のルートが class を持つ（ルート = アイテムそのもの、の経路を通す）。
// 棒は +60 / -40px（画面 px）動かしても出力の枠内に残る位置に置く（書き出しとの比較のため）。
// 残り 3 枚は class の無い包みをルートにして、中の要素が「選べる要素」になる形にしてある。
export const FRAGMENTS = {
  bars: `<div class="chart" style="position:absolute;left:24px;top:50px;width:280px;height:145px;display:flex;align-items:end;gap:10px;font:15px Arial;color:#111">
  <div class="bar" style="width:38px;height:55px;background:#3c6fb8"></div>
  <div class="bar" style="width:38px;height:78px;background:#3c6fb8"></div>
  <div class="bar" style="width:38px;height:95px;background:#18a878"></div>
  <div class="bar" style="width:38px;height:72px;background:#3c6fb8"></div>
  <div class="bar" style="width:38px;height:112px;background:#3c6fb8"></div>
  <span class="value-label" style="position:absolute;left:97px;top:18px">95</span>
</div>
`,
  svg: `<div><svg class="mini-chart" viewBox="0 0 220 130" width="220" height="130" style="position:absolute;left:350px;top:20px;background:#e8f2fb">
  <rect x="22" y="48" width="35" height="70" fill="#18a878"/>
  <rect x="85" y="22" width="35" height="96" fill="#18a878"/>
  <rect x="148" y="38" width="35" height="80" fill="#18a878"/>
</svg></div>
`,
  telop: `<div><div class="plate" style="position:absolute;left:24px;top:205px;width:280px;height:80px;background:#14263a;color:white;font:28px Arial">
  <span class="text" style="display:inline-block;margin:20px">TEXT</span>
</div></div>
`,
  card: `<div><div class="card" style="position:absolute;left:350px;top:205px;width:220px;height:80px;background:#d9e8f6;color:#14263a;font:20px Arial">
  <p style="margin:20px">NO CLASS</p>
</div></div>
`
};

// 拡縮・回転つきのアイテム用。回転の中心（画面中央）に棒グラフを置き、回しても画面内に残す。
export const CENTERED_BARS = FRAGMENTS.bars.replace('left:24px;top:50px', 'left:180px;top:108px');

export const FRAGMENT_IDS = Object.keys(FRAGMENTS);
