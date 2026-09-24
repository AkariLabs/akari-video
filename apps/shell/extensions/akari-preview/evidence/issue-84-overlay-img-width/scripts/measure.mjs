// shell / Web UI 共通の計測式（webview / ページ内で評価する）。座標は overlay-stage 基準の論理 px に換算する。
export const OUTPUT_W = 1080, OUTPUT_H = 1920;
export const MEASURE_EXPR = `(() => {
  const q = s => document.querySelector(s);
  const stage = q('#overlay-stage');
  const sr = stage.getBoundingClientRect();
  const scale = sr.width / ${OUTPUT_W};
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const logical = el => { if (!el) return null; const r = el.getBoundingClientRect(); const f = n => Math.round(n * 1000) / 1000; return { x: f((r.left - sr.left) / scale), y: f((r.top - sr.top) / scale), w: f(r.width / scale), h: f(r.height / scale) }; };
  const img = q('.i84-img'); const frame = q('.i84-frame');
  const ir = img && img.getBoundingClientRect(); const fr = frame && frame.getBoundingClientRect();
  const cs = img ? getComputedStyle(img) : null;
  const pick = (s, keys) => s ? Object.fromEntries(keys.map(k => [k, s.getPropertyValue(k)])) : null;
  return {
    devicePixelRatio: window.devicePixelRatio,
    overlayStage: rect(stage), scale, stageCss: pick(getComputedStyle(stage), ['width', 'height', 'transform', 'zoom']),
    containers: [...document.querySelectorAll('#overlay-stage [data-overlay-id]')].map(c => ({ id: c.getAttribute('data-overlay-id'), logical: logical(c), css: pick(getComputedStyle(c), ['width', 'height', 'transform', 'zoom', 'container-type']) })),
    img: img ? { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, logical: logical(img),
      relToFrame: { x: Math.round((ir.left - fr.left) / scale * 1000) / 1000, y: Math.round((ir.top - fr.top) / scale * 1000) / 1000 },
      computed: pick(cs, ['width', 'height', 'max-width', 'max-height', 'min-width', 'left', 'top', 'position', 'box-sizing', 'object-fit', 'display']) } : null,
    frame: frame ? { logical: logical(frame), computed: pick(getComputedStyle(frame), ['width', 'height', 'left', 'top', 'overflow']) } : null,
    capImg: logical(q('.i84-cap-img')), capImgMaxWidth: q('.i84-cap-img') ? getComputedStyle(q('.i84-cap-img')).maxWidth : null,
    kbd: pick(q('.i84-kbd') && getComputedStyle(q('.i84-kbd')), ['border-top-width', 'border-top-style', 'background-color', 'box-shadow', 'padding-left', 'color', 'vertical-align']),
    code: pick(q('.i84-code') && getComputedStyle(q('.i84-code')), ['color', 'font-family']),
    capRoot: pick(q('.i84-cap-root') && getComputedStyle(q('.i84-cap-root')), ['font-family', 'font-size', 'color', 'color-scheme']),
    vwBox: logical(q('.i84-vw-box')), pxBox: logical(q('.i84-px-box')),
    seek: q('#seek') ? q('#seek').value : null
  };
})()`;
// 画素を読む論理座標（出力 1080×1920 基準）
export const SAMPLE_POINTS = {
  'frame:tl': [80, 860], 'frame:tc': [540, 860], 'frame:tr': [1000, 860],
  'frame:ml': [80, 960], 'frame:mc': [540, 960], 'frame:mr': [1000, 960],
  'frame:bl': [80, 1060], 'frame:bc': [540, 1060], 'frame:br': [1000, 1060],
  'frame:r-inner-900': [900, 960],
  'outside:right-of-frame': [1050, 960], 'outside:below-frame': [540, 1100],
  'cap:x200': [200, 1280], 'cap:x500': [500, 1280],
  'vw:center': [270, 192], 'px:center': [850, 1600], 'bg:top-left': [20, 20]
};
