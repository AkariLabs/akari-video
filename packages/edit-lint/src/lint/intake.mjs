import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addFinding, isPositiveNumber, isRecord, relativePath } from "./shared.mjs";

const INTAKE_TASK_IDS = new Set([
  "transcribe-captions",
  "silence-cut",
  "bgm-sfx",
  "narration",
  "3d-inserts",
]);

const INTAKE_AUTONOMY_VALUES = new Set(["full-auto", "checkpoint", "collaborative"]);

const INTAKE_STATUS_VALUES = new Set(["draft", "submitted"]);

export const INTAKE_ROOT_FIELDS = [
  "version",
  "title",
  "tasks",
  "target",
  "autonomy",
  "status",
  "submitted_at",
];

const INTAKE_REQUIRED_ROOT_FIELDS = [
  "version",
  "tasks",
  "target",
  "autonomy",
  "status",
  "submitted_at",
];

const INTAKE_TARGET_FIELDS = ["duration_s", "keep_length", "taste"];

// intake.schema.json（packages/schemas/intake.schema.json）を手書きで再検証する。
// edit-lint は依存ゼロ・自己完結の規律のため、他パッケージのバリデータを import しない
// （review / captions と同じ「ルールをこちらにも手書きで写す」流儀）。
export async function lintDecisionLogPredict({ projectRoot, intake, edit, findings }) {
  if (intake?.status !== "submitted"
    || !["checkpoint", "full-auto"].includes(intake.autonomy)
    || edit?.version !== 2
    || !Array.isArray(edit.tracks)
    || !edit.tracks.some(track => Array.isArray(track?.items) && track.items.length > 0)) {
    return;
  }

  let decisionLog;
  try {
    decisionLog = await readFile(join(projectRoot, "decision-log.md"), "utf8");
  } catch {
    // 読み込みエラーも帳面が見つからない場合と同じ warning に留める。
  }
  if (decisionLog?.includes("machine:director")) {
    return;
  }
  addFinding(findings, {
    severity: "warning",
    check: "decision-log.predict-missing",
    message: "decision-log.md に機械の予測行（決定者 machine:director）がありません。提案つき / そのままモードでは、入れた物 1 件ごとに予測 1 行を追記してください（判子は一回 契約 §10）"
      + (decisionLog === undefined ? "（decision-log.md が見つかりません）" : ""),
    path: "decision-log.md",
  });
}

export function validateIntake(intake, findings, paths) {
  const intakeRelative = relativePath(paths.projectRoot, paths.intakePath);
  if (!isRecord(intake)) {
    intakeFinding(findings, "intake.schema", "intake.json root must be an object", intakeRelative);
    return;
  }
  if (Number.isInteger(intake.version) && intake.version > 1) {
    intakeFinding(
      findings,
      "intake.version",
      `intake.json version ${intake.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
      `${intakeRelative}#version`,
    );
    return;
  }

  for (const field of INTAKE_REQUIRED_ROOT_FIELDS) {
    if (!Object.hasOwn(intake, field)) {
      intakeFinding(findings, "intake.schema", `${field} is required`, intakeRelative);
    }
  }
  for (const field of Object.keys(intake)) {
    if (!INTAKE_ROOT_FIELDS.includes(field)) {
      intakeFinding(
        findings,
        "intake.schema",
        `${field} is not defined by intake.schema.json`,
        intakeRelative,
        "warning",
      );
    }
  }
  if (intake.version !== 1) {
    intakeFinding(findings, "intake.schema", "version must be 1", `${intakeRelative}#version`);
  }

  if (!Array.isArray(intake.tasks)) {
    intakeFinding(findings, "intake.schema", "tasks must be an array", `${intakeRelative}#tasks`);
  } else {
    const seen = new Set();
    intake.tasks.forEach((task, index) => {
      const itemPath = `${intakeRelative}#tasks[${index}]`;
      if (typeof task !== "string" || !INTAKE_TASK_IDS.has(task)) {
        intakeFinding(findings, "intake.tasks", `unknown task id: ${JSON.stringify(task)}`, itemPath);
        return;
      }
      if (seen.has(task)) {
        intakeFinding(findings, "intake.tasks", `duplicate task id: ${task}`, itemPath);
      }
      seen.add(task);
    });
  }

  validateIntakeTarget(intake.target, findings, `${intakeRelative}#target`);

  if (Object.hasOwn(intake, "autonomy") && !INTAKE_AUTONOMY_VALUES.has(intake.autonomy)) {
    intakeFinding(
      findings,
      "intake.schema",
      "autonomy must be one of full-auto / checkpoint / collaborative",
      `${intakeRelative}#autonomy`,
    );
  }
  if (Object.hasOwn(intake, "status") && !INTAKE_STATUS_VALUES.has(intake.status)) {
    intakeFinding(findings, "intake.schema", "status must be draft or submitted", `${intakeRelative}#status`);
  }

  if (intake.status === "submitted") {
    if (typeof intake.submitted_at !== "string" || !isIsoDateTime(intake.submitted_at)) {
      intakeFinding(
        findings,
        "intake.submitted_at",
        "submitted_at must be an ISO 8601 timestamp when status is submitted",
        `${intakeRelative}#submitted_at`,
      );
    }
  } else if (intake.status === "draft") {
    if (intake.submitted_at !== null && intake.submitted_at !== undefined) {
      intakeFinding(
        findings,
        "intake.submitted_at",
        "submitted_at must be null while status is draft",
        `${intakeRelative}#submitted_at`,
      );
    }
    intakeFinding(
      findings,
      "intake.status",
      "intake.json is still a draft; the plan is not confirmed yet — settle tasks / target / autonomy with the user (form or conversation) before following it",
      intakeRelative,
      "warning",
    );
  }
}

function validateIntakeTarget(target, findings, itemPath) {
  if (!isRecord(target)) {
    intakeFinding(findings, "intake.schema", "target must be an object", itemPath);
    return;
  }
  for (const field of ["duration_s", "keep_length"]) {
    if (!Object.hasOwn(target, field)) {
      intakeFinding(findings, "intake.schema", `target.${field} is required`, itemPath);
    }
  }
  for (const field of Object.keys(target)) {
    if (!INTAKE_TARGET_FIELDS.includes(field)) {
      intakeFinding(
        findings,
        "intake.schema",
        `target.${field} is not defined by intake.schema.json`,
        itemPath,
        "warning",
      );
    }
  }

  const hasDuration = target.duration_s !== null && target.duration_s !== undefined;
  if (hasDuration && !isPositiveNumber(target.duration_s)) {
    intakeFinding(
      findings,
      "intake.schema",
      "target.duration_s must be null or a positive finite number",
      itemPath,
    );
  }
  if (Object.hasOwn(target, "keep_length") && typeof target.keep_length !== "boolean") {
    intakeFinding(findings, "intake.schema", "target.keep_length must be a boolean", itemPath);
  }
  if (hasDuration && target.keep_length === true) {
    intakeFinding(
      findings,
      "intake.target-exclusive",
      "target.duration_s and target.keep_length: true must not both be set",
      itemPath,
    );
  }
  if (Object.hasOwn(target, "taste") && target.taste !== null && typeof target.taste !== "string") {
    intakeFinding(findings, "intake.schema", "target.taste must be null or a string", itemPath);
  }
}

function intakeFinding(findings, check, message, path, severity = "error") {
  addFinding(findings, { severity, check, message, path });
}

function isIsoDateTime(value) {
  const timestamp = Date.parse(value);
  return typeof value === "string" && Number.isFinite(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}
