export declare const ITEM_V2_KEYS: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "mask", "source", "audio", "role", "link", "mute", "gain_db", "denoise", "lowcut_hz", "fade_in", "fade_out", "ducking", "duck_db", "duck_attack", "duck_release", "script", "reading", "provenance"];
export declare const ITEM_SOURCE_V2_KEYS: readonly ["kind", "src", "in", "out", "framing", "transition_out", "freeze", "fx", "speed", "gain_db", "mute", "chroma_key", "pitch_semitones", "formant", "path", "part", "style", "text", "exclude", "derivedFrom", "vars", "params", "shape", "preset", "baked", "from", "filter", "id"];
export declare const KEYFRAME_V2_KEYS: readonly ["t", "transform", "crop", "perspective", "opacity", "gain_db", "animator", "easing"];
export declare const MOTION_V0_KEYS: readonly ["in", "out", "loop"];
export declare const ANIMATOR_V0_KEYS: readonly ["id", "basis", "shape", "start", "end", "offset", "randomize", "amount", "ease"];
export declare const MOTION_FILE_V0_KEYS: readonly ["version", "group", "items"];
export declare const SOURCE_KIND_V2: readonly ["media", "html", "shape", "telop", "filter", "group", "captions", "caption"];
export declare const ITEM_V2_KEYS_BY_DEFINITION: {
    readonly itemV2Media: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "mask", "source", "audio"];
    readonly itemV2Html: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2Shape: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2Telop: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2Filter: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2Group: readonly ["id", "name", "hidden", "locked", "at", "duration", "anchor", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2Captions: readonly ["id", "name", "hidden", "locked", "at", "duration", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2Caption: readonly ["id", "name", "hidden", "locked", "at", "duration", "transform", "opacity", "blend", "crop", "adjust", "perspective", "motion", "animator", "keyframes", "items", "source"];
    readonly itemV2AudioMedia: readonly ["id", "name", "hidden", "locked", "at", "duration", "role", "link", "mute", "source", "gain_db", "denoise", "lowcut_hz", "keyframes", "fade_in", "fade_out", "ducking", "duck_db", "duck_attack", "duck_release", "script", "reading", "provenance"];
};
export declare const ITEM_SOURCE_V2_KEYS_BY_DEFINITION: {
    readonly itemSourceMediaV2: readonly ["kind", "src", "in", "out", "framing", "transition_out", "freeze", "fx", "speed", "gain_db", "mute", "chroma_key"];
    readonly itemSourceAudioMediaV2: readonly ["kind", "src", "in", "out", "speed", "pitch_semitones", "formant"];
    readonly itemSourceHtmlV2: readonly ["kind", "path", "part", "style", "text", "exclude", "derivedFrom", "vars", "params"];
    readonly itemSourceShapeV2: readonly ["kind", "shape", "params"];
    readonly itemSourceTelopV2: readonly ["kind", "preset", "params", "baked", "from"];
    readonly itemSourceFilterV2: readonly ["kind", "filter"];
    readonly itemSourceGroupV2: readonly ["kind"];
    readonly itemSourceCaptionsV2: readonly ["kind", "path", "exclude"];
    readonly itemSourceCaptionV2: readonly ["kind", "path", "id"];
};
