export const JOINT_NAMES = [
  "root", "right_hip", "right_knee", "right_ankle", "left_hip", "left_knee", "left_ankle",
  "spine", "center_shoulder", "center_head", "top_head", "left_shoulder", "left_elbow",
  "left_wrist", "right_shoulder", "right_elbow", "right_wrist",
];

// Vision の親子関係に沿う 16 本。順序も描画・テストの決定論の一部。
export const BONES = [
  ["root", "spine"],
  ["spine", "center_shoulder"],
  ["center_shoulder", "center_head"],
  ["center_head", "top_head"],
  ["center_shoulder", "left_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["center_shoulder", "right_shoulder"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["root", "left_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["root", "right_hip"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

function finiteProjection(joint) {
  return Array.isArray(joint?.projection) && joint.projection.length === 2
    && joint.projection.every((value) => Number.isFinite(Number(value)));
}

export function visibleSkeleton(joints, minConfidence = 0.3) {
  const visibleJoints = JOINT_NAMES.filter((name) => {
    const joint = joints?.[name];
    return finiteProjection(joint) && Number(joint.conf) >= minConfidence;
  });
  const visibleSet = new Set(visibleJoints);
  return {
    joints: visibleJoints,
    bones: BONES.filter(([from, to]) => visibleSet.has(from) && visibleSet.has(to)),
  };
}

export function parseColor(value) {
  const raw = String(value ?? "#00e5ff").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    throw new Error("--color は #RRGGBB または #RRGGBBAA 形式です");
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
    css: `#${hex.toLowerCase()}`,
  };
}

function paintPixel(pixels, width, height, x, y, color, coverage = 1) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = (y * width + x) * 4;
  const alpha = Math.round(color.a * Math.max(0, Math.min(1, coverage)));
  if (alpha <= pixels[offset + 3]) return;
  pixels[offset] = color.r;
  pixels[offset + 1] = color.g;
  pixels[offset + 2] = color.b;
  pixels[offset + 3] = alpha;
}

function drawDisc(pixels, width, height, cx, cy, radius, color) {
  const extent = Math.ceil(radius + 1);
  for (let y = Math.floor(cy) - extent; y <= Math.floor(cy) + extent; y += 1) {
    for (let x = Math.floor(cx) - extent; x <= Math.floor(cx) + extent; x += 1) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      paintPixel(pixels, width, height, x, y, color, radius + 0.5 - distance);
    }
  }
}

function drawLine(pixels, width, height, a, b, strokeWidth, color) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const radius = strokeWidth / 2;
  const minX = Math.floor(Math.min(a[0], b[0]) - radius - 1);
  const maxX = Math.ceil(Math.max(a[0], b[0]) + radius + 1);
  const minY = Math.floor(Math.min(a[1], b[1]) - radius - 1);
  const maxY = Math.ceil(Math.max(a[1], b[1]) + radius + 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const ratio = lengthSquared === 0 ? 0
        : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSquared));
      const distance = Math.hypot(px - (a[0] + ratio * dx), py - (a[1] + ratio * dy));
      paintPixel(pixels, width, height, x, y, color, radius + 0.5 - distance);
    }
  }
}

/** RGBA の透明フレームへ、閾値を通った骨と関節だけを決定論的に描く。 */
export function renderSkeletonFrame({
  width,
  height,
  joints,
  sourceWidth,
  sourceHeight,
  cropLeft = 0,
  cropTop = 0,
  strokeWidth = 4,
  jointRadius = 6,
  minConfidence = 0.3,
  color = parseColor("#00e5ff"),
}) {
  const pixels = new Uint8Array(width * height * 4);
  const point = (name) => [
    Number(joints[name].projection[0]) * sourceWidth - cropLeft,
    Number(joints[name].projection[1]) * sourceHeight - cropTop,
  ];
  const visible = visibleSkeleton(joints, minConfidence);
  for (const [from, to] of visible.bones) {
    drawLine(pixels, width, height, point(from), point(to), strokeWidth, color);
  }
  for (const name of visible.joints) {
    const [x, y] = point(name);
    drawDisc(pixels, width, height, x, y, jointRadius, color);
  }
  return pixels;
}
