// The webview and OSR consume the render-cut recipe file bundled with the product.
import recipes = require('../../../../../../packages/render-cut/src/caption-animation-recipes.json');

// Keep one-shot loop behavior in sync with frame-engine and render-cut.
export const PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS = ['spin-in', 'rotate-in', 'roll-in', 'spiral-in'] as const;

export const PREVIEW_CAPTION_ANIMATION_RECIPES: Record<string, string> = recipes;
