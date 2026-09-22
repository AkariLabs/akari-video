export interface ItemKeyframePoint {
  t: number;
  transform?: Partial<Record<"x" | "y" | "scale" | "scaleX" | "scaleY" | "rotate", number>>;
  opacity?: number;
  easing?: string | Partial<Record<"x" | "y" | "scale" | "scaleX" | "scaleY" | "rotate" | "opacity", string>> | {
    transform?: string | Partial<Record<"x" | "y" | "scale" | "scaleX" | "scaleY" | "rotate", string>>;
  };
}

export interface ItemKeyframeState {
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  rotate: number;
  opacity: number;
}

export function interpolateKeyframes(
  points: readonly ItemKeyframePoint[] | unknown,
  localFrame: number,
  options?: { statics?: Partial<ItemKeyframeState> },
): ItemKeyframeState;
