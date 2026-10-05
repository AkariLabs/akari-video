import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export const {
  areCutsAdjacent,
  cutOverlapFrames,
  findCrossTrackLayerEvacuations,
  findUnsupportedDeclaredTrackTransitions,
  isStillImageSourcePath,
  planTransitionHandleWindow,
  projectLegacyEdit,
  readInternalEdit,
  resolveItemAnchors,
  resolveCaptionDisplay,
  timelineDurationSeconds,
  toAnchorCaptions,
  TRANSITION_TYPE_IDS,
  withoutItemAnchors,
} = createRequire(import.meta.url)("../../../edit-store/lib/index.js");

export const { captionsHaveRenderableCues, collectFitBasisCandidates } = createRequire(import.meta.url)(
  "../../../edit-store/lib/migrate/index.js",
);

const CAPTIONS_SCHEMA = JSON.parse(readFileSync(
  new URL("../../../schemas/captions.schema.json", import.meta.url),
  "utf8",
));

export const CAPTION_TEXT_STYLE_FIELDS = new Set(
  Object.keys(CAPTIONS_SCHEMA.$defs.textStyle.properties),
);

export const CAPTION_ANIMATION_SLOTS = new Set(
  Object.keys(CAPTIONS_SCHEMA.$defs.textAnimation.properties),
);

export const CAPTION_ANIMATION_SLOT_FIELDS = new Set(
  Object.keys(CAPTIONS_SCHEMA.$defs.textAnimationSlot.properties),
);

export const CAPTION_TEXTANIM_IDS = new Set(
  readFileSync(new URL("../../../../presets/textanim/index.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line).id),
);
