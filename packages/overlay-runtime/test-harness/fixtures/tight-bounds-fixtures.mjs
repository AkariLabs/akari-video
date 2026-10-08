// 「画面いっぱいの入れ物を選ばない・枠は見えている中身にぴったり」（2026-10-08-preview-tight-selection-bounds）の断片。
// 出力 640×360。ルートはどれも自分で何も描かない（背景・枠・影・直書きの文字なし）。
// SHELL_TIGHT_PROJECTS = シェル実機の L1 が開くアイテムの id と断片（L1 は 5 本を 1 プロジェクトに 4 秒ずつ順に並べる。単体テストからも同じ断片を使ってよい）。
const ROOT_FULL = 'position:absolute;inset:0';

export const SHELL_TIGHT_FRAGMENTS = {
  // 画面いっぱいの透明ルート + 絶対配置のグラフ（外枠を描く .chart + 棒 3 本）
  chart: `<div class="tsb-chart-root" style="${ROOT_FULL}">
  <div class="chart" style="position:absolute;left:180px;top:80px;width:280px;height:200px;box-sizing:border-box;background:#f4f6fb;border:3px solid #2d3a8c">
    <div class="bar" style="position:absolute;left:30px;bottom:20px;width:50px;height:90px;background:#e8473f"></div>
    <div class="bar" style="position:absolute;left:115px;bottom:20px;width:50px;height:140px;background:#2fa84f"></div>
    <div class="bar" style="position:absolute;left:200px;bottom:20px;width:50px;height:60px;background:#2f6fd8"></div>
  </div>
</div>`,
  // 幅 100% × 高さ 60% の透明ルート + 中身は小さい札 1 枚（98% に届かない = 穴 1）
  wide: `<div class="tsb-wide-root" style="position:absolute;left:0;top:72px;width:100%;height:60%">
  <div class="badge" style="position:absolute;left:40px;top:30px;width:120px;height:44px;background:#ffb703;border-radius:8px"></div>
</div>`,
  // 画面いっぱいの透明ルート > 透明な足場（80% × 80%・class あり）> カード 2 枚（左上に寄せて置く）
  scaffold: `<div class="tsb-scaffold-root" style="${ROOT_FULL}">
  <div class="scaffold" style="position:absolute;left:10%;top:10%;width:80%;height:80%">
    <div class="card" style="position:absolute;left:20px;top:20px;width:110px;height:70px;background:#8ecae6"></div>
    <div class="card" style="position:absolute;left:150px;top:20px;width:110px;height:70px;background:#219ebc"></div>
  </div>
</div>`,
  // 画面いっぱいの透明ルート > 親と同じ矩形の透明な入れ物（子 1 つ）> カード（文字入り）
  holder: `<div class="tsb-holder-root" style="${ROOT_FULL}">
  <div class="holder" style="position:absolute;left:220px;top:110px;width:200px;height:120px">
    <div class="card" style="position:absolute;inset:0;background:#023047;color:#fff">
      <div class="label" style="position:absolute;left:16px;top:14px;font:20px/24px sans-serif">見出し</div>
    </div>
  </div>
</div>`,
  // 画面いっぱいの透明ルート > 2 つをまとめる透明な入れ物（箱 = 2 つの合併）> 札 2 枚
  pair: `<div class="tsb-pair-root" style="${ROOT_FULL}">
  <div class="pair" style="position:absolute;left:160px;top:140px;width:320px;height:80px">
    <div class="chip" style="position:absolute;left:0;top:0;width:140px;height:80px;background:#fb8500"></div>
    <div class="chip" style="position:absolute;right:0;top:0;width:140px;height:80px;background:#6a4c93"></div>
  </div>
</div>`,
};

// フォルダ名 → { id: アイテムの id, fragment: SHELL_TIGHT_FRAGMENTS のキー }
export const SHELL_TIGHT_PROJECTS = {
  'project-chart': { id: 'tsb-chart', fragment: 'chart' },
  'project-wide': { id: 'tsb-wide', fragment: 'wide' },
  'project-scaffold': { id: 'tsb-scaffold', fragment: 'scaffold' },
  'project-holder': { id: 'tsb-holder', fragment: 'holder' },
  'project-pair': { id: 'tsb-pair', fragment: 'pair' },
};

// 見えている中身の範囲（出力 px・ルートの座標 = 出力の座標）。L1 / 単体の期待値。
export const SHELL_TIGHT_CONTENT = {
  'tsb-chart': { left: 180, top: 80, width: 280, height: 200 },
  'tsb-wide': { left: 40, top: 102, width: 120, height: 44 },
  'tsb-scaffold': { left: 84, top: 56, width: 240, height: 70 },
  'tsb-holder': { left: 220, top: 110, width: 200, height: 120 },
  'tsb-pair': { left: 160, top: 140, width: 320, height: 80 },
};
