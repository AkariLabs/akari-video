import { readFileSync } from "node:fs";

export const EXPRESSION_NAMES = Object.freeze(["aa", "ih", "ou", "ee", "oh", "blink"]);
export const MOUTH_EXPRESSION = Object.freeze({ a: "aa", i: "ih", u: "ou", e: "ee", o: "oh" });

const MOUTH_STATES = new Set(["closed", ...Object.keys(MOUTH_EXPRESSION)]);
const EYE_STATES = new Set(["open", "closed"]);

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
  drive.mouth.forEach((state, index) => {
    if (!MOUTH_STATES.has(state)) throw new Error(`drive.mouth[${index}] が不正です: ${state}`);
  });
  drive.eyes.forEach((state, index) => {
    if (!EYE_STATES.has(state)) throw new Error(`drive.eyes[${index}] が不正です: ${state}`);
  });
  return { fps: drive.fps, mouth: [...drive.mouth], eyes: [...drive.eyes] };
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
