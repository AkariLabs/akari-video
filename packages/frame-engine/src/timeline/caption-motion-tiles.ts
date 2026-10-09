export interface CaptionMotionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptionMotionCharacter {
  rects: readonly CaptionMotionRect[];
  inDelay: number;
  outDelay: number;
}

export interface CaptionMotionTile extends CaptionMotionRect {
  opacity?: number;
}

export interface CaptionMotionTileInput {
  plateRect: CaptionMotionRect | null;
  /** Union of visible text rows; percentage clip keyframes use this box. */
  inkRect?: CaptionMotionRect | null;
  textureRect: CaptionMotionRect;
  /** Normalized ink clip. A one-band recipe may provide the same clip in slices. */
  clip?: CaptionMotionRect;
  slices?: readonly CaptionMotionRect[];
  characters?: readonly CaptionMotionCharacter[];
  typewriterIn?: boolean;
  typewriterOut?: boolean;
  localSeconds: number;
}

function intersect(a: CaptionMotionRect, b: CaptionMotionRect): CaptionMotionRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function pixelTile(rect: CaptionMotionRect, opacity?: number): CaptionMotionTile {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return { x, y, width: Math.max(1, Math.ceil(rect.x + rect.width) - x),
    height: Math.max(1, Math.ceil(rect.y + rect.height) - y),
    ...(opacity === undefined ? {} : { opacity }) };
}

/** Pure plate clipping and grapheme reveal, in canvas pixel coordinates. */
export function captionMotionTiles(input: CaptionMotionTileInput): CaptionMotionTile[] | null {
  const { plateRect: plate, textureRect: texture, localSeconds } = input;
  if (!plate) return null;
  const clip = input.slices?.length === 1 ? input.slices[0] : input.clip;
  const ink = input.inkRect ?? plate;
  const plateClip = clip
    ? { x: ink.x + clip.x * ink.width, y: ink.y + clip.y * ink.height,
      width: clip.width * ink.width, height: clip.height * ink.height }
    : plate;
  const visible = intersect(plateClip, texture);
  if (!visible) return [];
  if (!input.typewriterIn && !input.typewriterOut) return clip ? [pixelTile(visible)] : null;
  const characters = input.characters ?? [];
  const progress = (seconds: number) => Math.max(0, Math.min(1, seconds / 0.01));
  const tiles: CaptionMotionTile[] = [];
  for (const character of characters) {
    const opacity = (input.typewriterIn ? progress(localSeconds - character.inDelay) : 1)
      * (input.typewriterOut ? 1 - progress(localSeconds - character.outDelay) : 1);
    if (opacity <= 0) continue;
    for (const rect of character.rects) {
      const clipped = intersect(visible, rect);
      if (clipped) tiles.push(pixelTile(clipped, opacity));
    }
  }
  return tiles;
}
