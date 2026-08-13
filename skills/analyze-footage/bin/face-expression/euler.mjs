const GIMBAL_EPSILON = 1e-7;

function matrixData(matrix) {
  if (Array.isArray(matrix) || ArrayBuffer.isView(matrix)) return [...matrix];
  if (matrix?.rows !== 4 || matrix?.columns !== 4) {
    throw new Error("facial transformation matrix は 4x4 である必要があります");
  }
  return [...(matrix.data ?? [])];
}

function finite(value, index) {
  if (!Number.isFinite(value)) throw new Error(`matrix[${index}] が有限数ではありません`);
  return value;
}

/**
 * MediaPipe の row-major 4x4 同次変換から頭部姿勢をラジアンで得る。
 *
 * 回転規約は R = Rz(roll) * Ry(yaw) * Rx(pitch)。右手系で +X は画像右、+Y は画像下、
 * +Z は canonical face の前方と解釈するため、yaw 正 = 画面右向き、pitch 正 = 上向き、
 * roll 正 = 時計回りになる。平行移動と一様 scale は使わず、上左 3x3 の各行を正規化して
 * rotation だけを分解する。gimbal lock では roll=0 に固定し、pitch を残す。
 */
export function matrixToEuler(matrix) {
  const data = matrixData(matrix);
  if (data.length !== 16) throw new Error("facial transformation matrix は 16 要素である必要があります");

  const row0 = [finite(data[0], 0), finite(data[1], 1), finite(data[2], 2)];
  const row1 = [finite(data[4], 4), finite(data[5], 5), finite(data[6], 6)];
  const row2 = [finite(data[8], 8), finite(data[9], 9), finite(data[10], 10)];
  for (const row of [row0, row1, row2]) {
    const length = Math.hypot(...row);
    if (!(length > 0)) throw new Error("facial transformation matrix の回転行がゼロです");
    for (let index = 0; index < row.length; index += 1) row[index] /= length;
  }

  const yawRaw = Math.asin(Math.max(-1, Math.min(1, -row2[0])));
  const yaw = Object.is(yawRaw, -0) ? 0 : yawRaw;
  const cosYaw = Math.cos(yaw);
  if (Math.abs(cosYaw) > GIMBAL_EPSILON) {
    return {
      yaw,
      pitch: Math.atan2(row2[1], row2[2]),
      roll: Math.atan2(row1[0], row0[0]),
    };
  }
  return {
    yaw,
    pitch: Math.atan2(-row1[2], row1[1]),
    roll: 0,
  };
}
