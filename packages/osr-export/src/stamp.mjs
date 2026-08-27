export const STAMP_BLUE = 0x55;
export const STAMP_MODULUS = 65_536;

export function encodeStamp(frameNumber) {
  const normalized = ((Number(frameNumber) % STAMP_MODULUS) + STAMP_MODULUS) % STAMP_MODULUS;
  return {
    red: normalized & 0xff,
    green: (normalized >> 8) & 0xff,
    blue: STAMP_BLUE,
    alpha: 0xff,
    css: `rgb(${normalized & 0xff}, ${(normalized >> 8) & 0xff}, ${STAMP_BLUE})`,
  };
}

export function stampFunctionSource() {
  return `(function encodeAkariStamp(frameNumber){const n=((Number(frameNumber)%65536)+65536)%65536;return{red:n&255,green:(n>>8)&255,blue:85,alpha:255,css:\`rgb(\${n&255}, \${(n>>8)&255}, 85)\`};})`;
}

export function decodeStampFromBgra(buffer, width, height) {
  const expectedBytes = width * (height + 1) * 4;
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError("BGRA bitmap must be a Buffer or Uint8Array");
  }
  if (buffer.length !== expectedBytes) {
    throw new RangeError(`BGRA bitmap has ${buffer.length} bytes; expected ${expectedBytes}`);
  }
  const rowOffset = width * height * 4;
  const points = [0, Math.floor((width - 1) / 2), width - 1];
  const samples = points.map((x) => {
    const offset = rowOffset + x * 4;
    const blue = buffer[offset];
    const green = buffer[offset + 1];
    const red = buffer[offset + 2];
    const alpha = buffer[offset + 3];
    return {
      x,
      frameNumber: red + (green << 8),
      bgra: [blue, green, red, alpha],
      validColor: blue === STAMP_BLUE && alpha === 0xff,
    };
  });
  return {
    frameNumber: samples[0].frameNumber,
    matched: samples.every((sample) => sample.validColor && sample.frameNumber === samples[0].frameNumber),
    samples,
  };
}

export function verifyStamp(buffer, width, height, expectedFrameNumber) {
  const decoded = decodeStampFromBgra(buffer, width, height);
  const expected = encodeStamp(expectedFrameNumber);
  const normalized = expected.red + (expected.green << 8);
  return { ...decoded, expectedFrameNumber: normalized, exact: decoded.matched && decoded.frameNumber === normalized };
}

export function stripStampRow(buffer, width, height) {
  const expectedBytes = width * (height + 1) * 4;
  if (buffer.length !== expectedBytes) {
    throw new RangeError(`BGRA bitmap has ${buffer.length} bytes; expected ${expectedBytes}`);
  }
  return buffer.subarray(0, width * height * 4);
}
