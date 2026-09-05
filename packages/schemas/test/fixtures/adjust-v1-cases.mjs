export const validAdjust = {
  curves: { master: [{ in: 0, out: 0 }, { in: 0.4, out: 0.3 }, { in: 1, out: 1 }] },
  wheels: { lift: { r: 0.25, g: -0.25 }, gamma: { r: 0.5, b: -0.5 }, gain: { g: 0.5, b: -0.5 }, offset: { r: 0.1, b: -0.1 } },
  hue: { hue: [{ hue: 0, value: 0.75 }], sat: [{ hue: 0, value: 0 }, { hue: 1, value: 1 }], luma: [{ hue: 1, value: 0.5 }] },
  sections: { basic: false, lut: false, curves: true, wheels: true, hue: true },
};

export const invalidAdjustCases = [
  ['curves null', { curves: null }, 'curves', 'structure'],
  ['curves unknown channel', { curves: { rgb: [] } }, 'curves.rgb', 'unknown-key'],
  ['curves short', { curves: { r: [{ in: 0, out: 0 }] } }, 'curves.r', 'points'],
  ['curves long', { curves: { r: Array.from({ length: 17 }, (_, i) => ({ in: i / 16, out: 0 })) } }, 'curves.r', 'points'],
  ['curves duplicate', { curves: { r: [{ in: 0, out: 0 }, { in: 0, out: 1 }] } }, 'curves.r[1].in', 'order'],
  ['curves descending', { curves: { r: [{ in: 1, out: 0 }, { in: 0, out: 1 }] } }, 'curves.r[1].in', 'order'],
  ['curves missing output', { curves: { r: [{ in: 0 }, { in: 1, out: 1 }] } }, 'curves.r[0].out', 'range'],
  ['curves output range', { curves: { r: [{ in: 0, out: -0.1 }, { in: 1, out: 1 }] } }, 'curves.r[0].out', 'range'],
  ['curves unknown point key', { curves: { r: [{ in: 0, out: 0, extra: 0 }, { in: 1, out: 1 }] } }, 'curves.r[0].extra', 'unknown-key'],
  ['wheels null', { wheels: null }, 'wheels', 'structure'],
  ['wheels unknown wheel', { wheels: { slope: {} } }, 'wheels.slope', 'unknown-key'],
  ['wheels invalid channel object', { wheels: { lift: [] } }, 'wheels.lift', 'structure'],
  ['wheels unknown channel', { wheels: { gamma: { a: 0 } } }, 'wheels.gamma.a', 'unknown-key'],
  ...Object.entries({ lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 }).flatMap(([wheel, limit]) => [-1, 1].map(sign => [wheel + ' range ' + sign, { wheels: { [wheel]: { r: sign * (limit + 0.001) } } }, 'wheels.' + wheel + '.r', 'range'])),
  ['hue null', { hue: null }, 'hue', 'structure'],
  ['hue empty', { hue: { sat: [] } }, 'hue.sat', 'points'],
  ['hue long', { hue: { sat: Array.from({ length: 17 }, (_, i) => ({ hue: i / 16, value: 0.5 })) } }, 'hue.sat', 'points'],
  ['hue duplicate', { hue: { luma: [{ hue: 0.2, value: 0.1 }, { hue: 0.2, value: 0.2 }] } }, 'hue.luma[1].hue', 'order'],
  ['hue descending', { hue: { hue: [{ hue: 0.5, value: 0.1 }, { hue: 0.2, value: 0.2 }] } }, 'hue.hue[1].hue', 'order'],
  ['hue missing value', { hue: { hue: [{ hue: 0.5 }] } }, 'hue.hue[0].value', 'range'],
  ['hue axis range', { hue: { hue: [{ hue: 1.1, value: 0.5 }] } }, 'hue.hue[0].hue', 'range'],
  ['hue value range', { hue: { hue: [{ hue: 0.1, value: 1.1 }] } }, 'hue.hue[0].value', 'range'],
  ['hue unknown channel', { hue: { rgb: [] } }, 'hue.rgb', 'unknown-key'],
  ['hue unknown point key', { hue: { sat: [{ hue: 0, value: 0.5, extra: 1 }] } }, 'hue.sat[0].extra', 'unknown-key'],
];

export function editWithAdjust(adjust) {
  return { version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [{ id: 'main', path: 'main.mp4' }], tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 30, source: { kind: 'media', src: 'main', in: 0, out: 1 }, adjust }] }] };
}
