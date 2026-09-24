import { deflateSync } from 'node:zlib';

const FONT = {
  A:['010','101','111','101','101'],B:['110','101','110','101','110'],C:['011','100','100','100','011'],
  D:['110','101','101','101','110'],E:['111','100','110','100','111'],F:['111','100','110','100','100'],
  G:['011','100','101','101','011'],H:['101','101','111','101','101'],I:['111','010','010','010','111'],
  J:['001','001','001','101','010'],K:['101','101','110','101','101'],L:['100','100','100','100','111'],
  M:['101','111','111','101','101'],N:['101','111','111','111','101'],O:['010','101','101','101','010'],
  P:['110','101','110','100','100'],Q:['010','101','101','111','011'],R:['110','101','110','101','101'],
  S:['011','100','010','001','110'],T:['111','010','010','010','010'],U:['101','101','101','101','111'],
  V:['101','101','101','101','010'],W:['101','101','111','111','101'],X:['101','101','010','101','101'],
  Y:['101','101','010','010','010'],Z:['111','001','010','100','111'],
  '0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['110','001','010','100','111'],
  '3':['110','001','010','001','110'],'4':['101','101','111','001','001'],'5':['111','100','110','001','110'],
  '6':['011','100','110','101','010'],'7':['111','001','010','010','010'],'8':['010','101','010','101','010'],
  '9':['010','101','011','001','110'],'-':['000','000','111','000','000'],' ':['000','000','000','000','000'],
};

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const check = Buffer.alloc(4); check.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, check]);
}

export function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1)
    Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(scanlines, y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function contactSheet(luts, transitions) {
  const width = 940;
  const height = 40 + 5 * 210 + 42 + 10 * 85;
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(246);
  const point = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = (y * width + x) * 3;
    rgb.set(color, p);
  };
  const label = (text, x, y) => {
    for (const character of text.toUpperCase()) {
      const glyph = FONT[character] ?? FONT[' '];
      glyph.forEach((row, gy) => [...row].forEach((pixel, gx) => {
        if (pixel === '1') for (let yy = 0; yy < 2; yy += 1) for (let xx = 0; xx < 2; xx += 1)
          point(x + gx * 2 + xx, y + gy * 2 + yy, [30, 38, 45]);
      }));
      x += 8;
    }
  };
  const paste = (art, x0, y0) => {
    for (let y = 0; y < art.height; y += 1)
      for (let x = 0; x < art.width; x += 1)
        point(x0 + x, y0 + y, art.palette[art.indices[y * art.width + x]]);
  };
  label('LUT BEFORE AFTER', 16, 13);
  luts.forEach(({ id, art }, index) => {
    const x = 16 + (index % 2) * 455;
    const y = 40 + Math.floor(index / 2) * 210;
    label(id, x, y); paste(art, x, y + 16);
    label('BEFORE', x + 7, y + 198); label('AFTER', x + 169, y + 198);
  });
  const start = 40 + 5 * 210;
  label('TRANSITIONS A MID B', 16, start + 14);
  transitions.forEach(({ id, art }, index) => {
    const x = 16 + (index % 3) * 307;
    const y = start + 42 + Math.floor(index / 3) * 85;
    label(id, x, y); paste(art, x, y + 15);
  });
  return png(width, height, rgb);
}
