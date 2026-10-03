export const frame2 = {
  curves: { master: [
    { in: 0, out: 0 },
    { in: 0.2682291666666667, out: 0.6645900181361607 },
    { in: 0.3793402777777778, out: 0.25030430385044644 },
    { in: 0.5571180555555556, out: 0.778875732421875 },
    { in: 0.6571180555555556, out: 0.20744716099330363 },
    { in: 0.7783298068576389, out: 0.9158887590680803 },
    { in: 1, out: 1 },
  ] },
  wheels: { offset: { r: 0.09023294118946425, g: -0.08244624749232439, b: -0.007786693697139856 } },
  hue: { hue: [
    { hue: 0, value: 0.5 },
    { hue: 0.16721869574652778, value: 0.7885550362723215 },
    { hue: 0.3333333333333333, value: 0.5 },
    { hue: 0.495501708984375, value: 0.2560878208705357 },
    { hue: 0.687420654296875, value: 0.6521915980747768 },
    { hue: 0.8333333333333334, value: 0.5 },
  ] },
  sections: { basic: false, wheels: false, hue: false, lut: false, fx: false },
};

export function channelRotationLut() {
  const size = 2;
  const data = new Float32Array(size ** 3 * 3);
  for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) {
    const i = ((b * size + g) * size + r) * 3;
    data[i] = b;
    data[i + 1] = r;
    data[i + 2] = g;
  }
  return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

export const userLut = channelRotationLut();
export const bakeCases = {
  basic: [{ basic: { exposure: 0.37, contrast: -0.2, highlights: 0.3, shadows: -0.4, temperature: 0.2, saturation: 0.5 } }],
  curve4: [{ curves: { master: [{ in: 0, out: 0 }, { in: 0.25, out: 0.6 }, { in: 0.75, out: 0.3 }, { in: 1, out: 1 }] } }],
  curve7: [{ curves: frame2.curves }],
  wheels: [{ wheels: { lift: { r: 0.1, b: -0.1 }, gamma: { g: 0.2 }, gain: { b: 0.3 }, offset: { r: -0.05 } } }],
  hue: [{ hue: frame2.hue }],
  frame2Bypass: [frame2],
  frame2All: [{ ...frame2, sections: undefined }],
  userLutHalf: [{ basic: { exposure: -0.25 }, lut: { lut: 'rotation', intensity: 0.5 } }, userLut],
};
