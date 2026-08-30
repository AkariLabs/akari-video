export interface ItemKeyframePoint {
  t: number;
  transform?: Partial<Record<"x" | "y" | "scale" | "rotate", number>>;
  opacity?: number;
  easing?: string | Partial<Record<"x" | "y" | "scale" | "rotate" | "opacity", string>> | {
    transform?: string | Partial<Record<"x" | "y" | "scale" | "rotate", string>>;
  };
}

export interface ItemKeyframeState {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
}

export function interpolateKeyframes(
  points: readonly ItemKeyframePoint[] | unknown,
  localFrame: number,
  options?: { statics?: Partial<ItemKeyframeState> },
): ItemKeyframeState;
