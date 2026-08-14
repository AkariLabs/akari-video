import { readFileSync } from "node:fs";

export const EXPRESSION_NAMES = Object.freeze(["aa", "ih", "ou", "ee", "oh", "blink"]);
export const EMOTION_EXPRESSION_NAMES = Object.freeze(["happy", "sad", "angry", "surprised"]);
export const ALL_EXPRESSION_NAMES = Object.freeze([...EXPRESSION_NAMES, ...EMOTION_EXPRESSION_NAMES]);
export const MOUTH_EXPRESSION = Object.freeze({ a: "aa", i: "ih", u: "ou", e: "ee", o: "oh" });

const MOUTH_STATES = new Set(["closed", ...Object.keys(MOUTH_EXPRESSION)]);
const EYE_STATES = new Set(["open", "closed"]);
const HEAD_KEYS = new Set(["yaw", "pitch", "roll"]);
const EMOTION_STATES = new Set(["neutral", ...EMOTION_EXPRESSION_NAMES]);

function validateHeadState(state, index) {
  if (state == null) return null;
  if (typeof state !== "object" || Array.isArray(state)) {
    throw new Error(`drive.head[${index}] は object または null である必要があります`);
  }
  for (const key of Object.keys(state)) {
    if (!HEAD_KEYS.has(key)) throw new Error(`drive.head[${index}].${key} は未対応です`);
    if (!Number.isFinite(state[key])) throw new Error(`drive.head[${index}].${key} は有限数である必要があります`);
  }
  return Object.fromEntries(Object.entries(state));
}

export function validateDriveDocument(document) {
  const drive = document?.drive;
  if (!drive || typeof drive !== "object" || Array.isArray(drive)) throw new Error("drive object が必要です");
  if (!Number.isFinite(drive.fps) || drive.fps <= 0) throw new Error("drive.fps は正数である必要があります");
  if (!Array.isArray(drive.mouth) || !Array.isArray(drive.eyes)) {
    throw new Error("drive.mouth と drive.eyes は配列である必要があります");
  }
  if (drive.mouth.length === 0) throw new Error("drive.mouth と drive.eyes は 1 フレーム以上必要です");
  if (drive.mouth.length !== drive.eyes.length) {
    throw new Error(`drive.mouth と drive.eyes の長さが一致しません: ${drive.mouth.length} != ${drive.eyes.length}`);
  }
  if (drive.head !== undefined && !Array.isArray(drive.head)) {
    throw new Error("drive.head は配列である必要があります");
  }
  if (drive.head && drive.head.length !== drive.mouth.length) {
    throw new Error(`drive.head と drive.mouth の長さが一致しません: ${drive.head.length} != ${drive.mouth.length}`);
  }
  if (drive.emotion !== undefined && !Array.isArray(drive.emotion)) {
    throw new Error("drive.emotion は配列である必要があります");
  }
  if (drive.emotion && drive.emotion.length !== drive.mouth.length) {
    throw new Error(`drive.emotion と drive.mouth の長さが一致しません: ${drive.emotion.length} != ${drive.mouth.length}`);
  }
  drive.mouth.forEach((state, index) => {
    if (!MOUTH_STATES.has(state)) throw new Error(`drive.mouth[${index}] が不正です: ${state}`);
  });
  drive.eyes.forEach((state, index) => {
    if (!EYE_STATES.has(state)) throw new Error(`drive.eyes[${index}] が不正です: ${state}`);
  });
  drive.emotion?.forEach((state, index) => {
    if (!EMOTION_STATES.has(state)) throw new Error(`drive.emotion[${index}] が不正です: ${state}`);
  });
  return {
    fps: drive.fps,
    mouth: [...drive.mouth],
    eyes: [...drive.eyes],
    ...(drive.head ? { head: drive.head.map(validateHeadState) } : {}),
    ...(drive.emotion ? { emotion: [...drive.emotion] } : {}),
  };
}

export function loadDrive(path) {
  return validateDriveDocument(JSON.parse(readFileSync(path, "utf8")));
}

export function expressionValues(mouth, eyes) {
  if (!MOUTH_STATES.has(mouth)) throw new Error(`mouth state が不正です: ${mouth}`);
  if (!EYE_STATES.has(eyes)) throw new Error(`eyes state が不正です: ${eyes}`);
  const values = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0, blink: eyes === "closed" ? 1 : 0 };
  if (mouth !== "closed") values[MOUTH_EXPRESSION[mouth]] = 1;
  return values;
}

export function drivenExpressionValues(mouth, eyes, emotion = "neutral") {
  if (!EMOTION_STATES.has(emotion)) throw new Error(`emotion state が不正です: ${emotion}`);
  const values = { ...expressionValues(mouth, eyes) };
  for (const name of EMOTION_EXPRESSION_NAMES) values[name] = name === emotion ? 1 : 0;
  return values;
}
