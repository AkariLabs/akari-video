#!/usr/bin/env node

// research-plan.json v0（企画・調査工程の SSOT）の構造と、JSON Schema 単体では表せない
// 参照・一貫性制約を検証する。sources 未記載など助言レベルの所見は warning（stderr）に
// 出し、exit code は errors のみで決定する（packages/schemas/bin/validate-plan.mjs と同じ規律）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-research-plan.mjs <research-plan.json>";
const planArgument = process.argv[2];

if (!planArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (planArgument === "--help" || planArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const planPath = path.resolve(planArgument);
const planDirectory = path.dirname(planPath);
const schemaPath = fileURLToPath(new URL("../research-plan.schema.json", import.meta.url));
const errors = [];
const warnings = [];

const CATEGORIES = new Set(["hub", "hero", "help"]);
const MONETIZATION_POTENTIALS = new Set(["high", "medium", "low"]);
const SHOT_LIST_STATUSES = new Set(["planned", "ok", "ng"]);
const SOURCE_COSTS = new Set(["free", "paid"]);

if (!isRegularFile(planPath)) {
  fail(`research-plan.json が見つかりません: ${planPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`research-plan.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:research-plan:v0") {
  fail("research-plan.schema.json の $id が v0 契約と一致しません");
  finish();
}

let plan;
try {
  plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
} catch (error) {
  fail(`research-plan.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validatePlan(plan);
finish();

function validatePlan(value) {
  if (!isPlainObject(value)) {
    fail("research-plan.json のルートは object である必要があります");
    return;
  }
  if (Number.isInteger(value.version) && value.version > 0) {
    fail(
      `version ${value.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
    );
    return;
  }
  if (value.version !== 0) {
    fail("version は 0 である必要があります");
    return;
  }

  const candidateIds = validateTopic(value.topic);
  validateTarget(value.target);
  const chapterIds = validateStructureChapters(value.structure);
  const shotIds = validateStructureShots(value.structure, chapterIds);
  validateStructureRoot(value.structure);
  validateShotList(value.shot_list, shotIds);
  const sourceCount = validateSources(value.sources);
  validateFeedback(value.feedback);

  if (isPlainObject(value.topic) && isNonEmptyString(value.topic.selected) && sourceCount === 0) {
    warn("sources が空です（由来記録が無いまま確定しています）");
  }
  if (
    isPlainObject(value.topic) &&
    isNonEmptyString(value.topic.selected) &&
    candidateIds.size > 0 &&
    !candidateIds.has(value.topic.selected)
  ) {
    // すでに validateTopic 内で fail 済み（ここには到達しない防御的記述）。
  }
}

function validateTopic(value) {
  const ids = new Set();
  if (!isPlainObject(value)) {
    fail("topic は object である必要があります");
    return ids;
  }
  for (const field of ["candidates", "selected", "decided_at"]) {
    if (!hasOwn(value, field)) fail(`topic.${field} は必須です（値は null 許容でもキーは省略しない）`);
  }

  if (value.candidates !== undefined) {
    if (!Array.isArray(value.candidates)) {
      fail("topic.candidates は配列である必要があります");
    } else {
      for (const [index, candidate] of value.candidates.entries()) {
        const label = `topic.candidates[${index}]`;
        if (!isPlainObject(candidate)) {
          fail(`${label} は object である必要があります`);
          continue;
        }
        for (const field of ["id", "title", "category", "monetization_potential", "rationale"]) {
          if (!hasOwn(candidate, field)) fail(`${label}.${field} は必須です`);
        }
        if (!isNonEmptyString(candidate.id)) {
          fail(`${label}.id は空でない文字列である必要があります`);
        } else if (ids.has(candidate.id)) {
          fail(`topic.candidates[].id が重複しています: ${candidate.id}`);
        } else {
          ids.add(candidate.id);
        }
        if (hasOwn(candidate, "title") && !isNonEmptyString(candidate.title)) {
          fail(`${label}.title は空でない文字列である必要があります`);
        }
        if (hasOwn(candidate, "category") && !CATEGORIES.has(candidate.category)) {
          fail(`${label}.category は hub / hero / help のいずれかである必要があります`);
        }
        if (
          hasOwn(candidate, "monetization_potential") &&
          !MONETIZATION_POTENTIALS.has(candidate.monetization_potential)
        ) {
          fail(`${label}.monetization_potential は high / medium / low のいずれかである必要があります`);
        }
        if (hasOwn(candidate, "rationale") && !isNonEmptyString(candidate.rationale)) {
          fail(`${label}.rationale は空でない文字列である必要があります`);
        }
      }
    }
  }

  if (hasOwn(value, "selected")) {
    if (value.selected !== null && !isNonEmptyString(value.selected)) {
      fail("topic.selected は null または空でない文字列である必要があります");
    } else if (isNonEmptyString(value.selected) && !ids.has(value.selected)) {
      fail(`topic.selected が topic.candidates[].id を参照していません: ${value.selected}`);
    }
  }

  if (hasOwn(value, "selected") && hasOwn(value, "decided_at")) {
    const selected = isNonEmptyString(value.selected) ? value.selected : null;
    if (selected !== null && value.decided_at === null) {
      fail("topic.selected が確定していますが topic.decided_at が null です（decision-cards の確定時刻を記入する）");
    }
    if (selected === null && value.decided_at !== null) {
      fail("topic.selected が null（未決定）なのに topic.decided_at が非 null です");
    }
    if (value.decided_at !== null && typeof value.decided_at !== "string") {
      fail("topic.decided_at は null または ISO-8601 文字列である必要があります");
    }
  }

  return ids;
}

function validateTarget(value) {
  if (!isPlainObject(value)) {
    fail("target は object である必要があります");
    return;
  }
  for (const field of ["audience", "competitors", "japan_sns"]) {
    if (!hasOwn(value, field)) fail(`target.${field} は必須です（値は null 許容でもキーは省略しない）`);
  }
  validateNullableNonEmptyString(value.audience, "target.audience");

  if (value.competitors !== undefined) {
    if (!Array.isArray(value.competitors)) {
      fail("target.competitors は配列である必要があります");
    } else {
      for (const [index, competitor] of value.competitors.entries()) {
        const label = `target.competitors[${index}]`;
        if (!isPlainObject(competitor)) {
          fail(`${label} は object である必要があります`);
          continue;
        }
        for (const field of ["name", "url", "notes", "gap"]) {
          if (!hasOwn(competitor, field)) fail(`${label}.${field} は必須です`);
        }
        if (hasOwn(competitor, "name") && !isNonEmptyString(competitor.name)) {
          fail(`${label}.name は空でない文字列である必要があります`);
        }
        if (
          competitor.url !== null &&
          competitor.url !== undefined &&
          (!isNonEmptyString(competitor.url) || !/^https?:\/\//.test(competitor.url))
        ) {
          fail(`${label}.url は null または http(s):// で始まる文字列である必要があります`);
        }
        if (competitor.notes !== undefined && competitor.notes !== null && typeof competitor.notes !== "string") {
          fail(`${label}.notes は null または文字列である必要があります`);
        }
        if (competitor.gap !== undefined && competitor.gap !== null && typeof competitor.gap !== "string") {
          fail(`${label}.gap は null または文字列である必要があります`);
        }
      }
    }
  }

  if (!isPlainObject(value.japan_sns)) {
    fail("target.japan_sns は object である必要があります（日本語 SNS 事情は必須調査軸）");
  } else {
    for (const field of ["platforms", "notes"]) {
      if (!hasOwn(value.japan_sns, field)) fail(`target.japan_sns.${field} は必須です`);
    }
    if (value.japan_sns.platforms !== undefined && !Array.isArray(value.japan_sns.platforms)) {
      fail("target.japan_sns.platforms は配列である必要があります");
    }
    if (hasOwn(value.japan_sns, "notes") && !isNonEmptyString(value.japan_sns.notes)) {
      fail(
        "target.japan_sns.notes は空でない文字列である必要があります（必須調査軸。無償手段で確認できない場合もその旨と理由を書く）",
      );
    }
  }
}

function validateStructureChapters(value) {
  const ids = new Set();
  if (!isPlainObject(value)) return ids;
  if (value.chapters === undefined) return ids;
  if (!Array.isArray(value.chapters)) {
    fail("structure.chapters は配列である必要があります");
    return ids;
  }
  for (const [index, chapter] of value.chapters.entries()) {
    const label = `structure.chapters[${index}]`;
    if (!isPlainObject(chapter)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of ["id", "title", "duration_estimate_seconds", "notes"]) {
      if (!hasOwn(chapter, field)) fail(`${label}.${field} は必須です`);
    }
    if (!isNonEmptyString(chapter.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(chapter.id)) {
      fail(`structure.chapters[].id が重複しています: ${chapter.id}`);
    } else {
      ids.add(chapter.id);
    }
    if (hasOwn(chapter, "title") && !isNonEmptyString(chapter.title)) {
      fail(`${label}.title は空でない文字列である必要があります`);
    }
    if (
      hasOwn(chapter, "duration_estimate_seconds") &&
      chapter.duration_estimate_seconds !== null &&
      (!isFiniteNumber(chapter.duration_estimate_seconds) || chapter.duration_estimate_seconds <= 0)
    ) {
      fail(`${label}.duration_estimate_seconds は null または 0 より大きい有限数（秒）である必要があります`);
    }
    if (chapter.notes !== undefined && chapter.notes !== null && typeof chapter.notes !== "string") {
      fail(`${label}.notes は null または文字列である必要があります`);
    }
  }
  return ids;
}

function validateStructureShots(value, chapterIds) {
  const ids = new Set();
  if (!isPlainObject(value)) return ids;
  if (value.shots === undefined) return ids;
  if (!Array.isArray(value.shots)) {
    fail("structure.shots は配列である必要があります");
    return ids;
  }
  for (const [index, shot] of value.shots.entries()) {
    const label = `structure.shots[${index}]`;
    if (!isPlainObject(shot)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of ["id", "chapter_id", "shot_type", "description", "duration_estimate_seconds", "image_path"]) {
      if (!hasOwn(shot, field)) fail(`${label}.${field} は必須です`);
    }
    if (!isNonEmptyString(shot.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(shot.id)) {
      fail(`structure.shots[].id が重複しています: ${shot.id}`);
    } else {
      ids.add(shot.id);
    }
    if (hasOwn(shot, "chapter_id")) {
      if (shot.chapter_id !== null && !isNonEmptyString(shot.chapter_id)) {
        fail(`${label}.chapter_id は null または空でない文字列である必要があります`);
      } else if (isNonEmptyString(shot.chapter_id) && !chapterIds.has(shot.chapter_id)) {
        fail(`${label}.chapter_id が structure.chapters[].id を参照していません: ${shot.chapter_id}`);
      }
    }
    validateNullableNonEmptyString(shot.shot_type, `${label}.shot_type`);
    if (hasOwn(shot, "description") && !isNonEmptyString(shot.description)) {
      fail(`${label}.description は空でない文字列である必要があります`);
    }
    if (
      hasOwn(shot, "duration_estimate_seconds") &&
      shot.duration_estimate_seconds !== null &&
      (!isFiniteNumber(shot.duration_estimate_seconds) || shot.duration_estimate_seconds <= 0)
    ) {
      fail(`${label}.duration_estimate_seconds は null または 0 より大きい有限数（秒）である必要があります`);
    }
    validateNullableNonEmptyString(shot.image_path, `${label}.image_path`);
    if (isNonEmptyString(shot.image_path)) {
      requireRegularFile(shot.image_path, `${label}.image_path`);
    }
  }
  return ids;
}

function validateStructureRoot(value) {
  if (!isPlainObject(value)) {
    fail("structure は object である必要があります");
    return;
  }
  for (const field of ["chapters", "shots", "opening_hook", "confirmed", "confirmed_at"]) {
    if (!hasOwn(value, field)) fail(`structure.${field} は必須です（値は null 許容でもキーは省略しない）`);
  }
  validateNullableNonEmptyString(value.opening_hook, "structure.opening_hook");

  if (hasOwn(value, "confirmed") && typeof value.confirmed !== "boolean") {
    fail("structure.confirmed は真偽値である必要があります");
  }
  if (hasOwn(value, "confirmed") && hasOwn(value, "confirmed_at")) {
    if (value.confirmed === true && value.confirmed_at === null) {
      fail("structure.confirmed が true ですが structure.confirmed_at が null です（decision-cards の確定時刻を記入する）");
    }
    if (value.confirmed === false && value.confirmed_at !== null) {
      fail("structure.confirmed が false（未確定）なのに structure.confirmed_at が非 null です");
    }
    if (value.confirmed_at !== null && typeof value.confirmed_at !== "string") {
      fail("structure.confirmed_at は null または ISO-8601 文字列である必要があります");
    }
  }
}

function validateShotList(value, shotIds) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("shot_list は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, entry] of value.entries()) {
    const label = `shot_list[${index}]`;
    if (!isPlainObject(entry)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of ["id", "ref_shot_id", "location", "equipment", "checklist", "status"]) {
      if (!hasOwn(entry, field)) fail(`${label}.${field} は必須です`);
    }
    if (!isNonEmptyString(entry.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(entry.id)) {
      fail(`shot_list[].id が重複しています: ${entry.id}`);
    } else {
      ids.add(entry.id);
    }
    if (hasOwn(entry, "ref_shot_id")) {
      if (entry.ref_shot_id !== null && !isNonEmptyString(entry.ref_shot_id)) {
        fail(`${label}.ref_shot_id は null または空でない文字列である必要があります`);
      } else if (isNonEmptyString(entry.ref_shot_id) && !shotIds.has(entry.ref_shot_id)) {
        fail(`${label}.ref_shot_id が structure.shots[].id を参照していません: ${entry.ref_shot_id}`);
      }
    }
    validateNullableNonEmptyString(entry.location, `${label}.location`);
    if (hasOwn(entry, "equipment") && !isStringArray(entry.equipment)) {
      fail(`${label}.equipment は空でない文字列の配列である必要があります`);
    }
    if (hasOwn(entry, "checklist") && !isStringArray(entry.checklist)) {
      fail(`${label}.checklist は空でない文字列の配列である必要があります`);
    }
    if (hasOwn(entry, "status") && !SHOT_LIST_STATUSES.has(entry.status)) {
      fail(`${label}.status は planned / ok / ng のいずれかである必要があります`);
    }
  }
}

function validateSources(value) {
  if (value === undefined) return 0;
  if (!Array.isArray(value)) {
    fail("sources は配列である必要があります");
    return 0;
  }
  const ids = new Set();
  for (const [index, source] of value.entries()) {
    const label = `sources[${index}]`;
    if (!isPlainObject(source)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of ["id", "url", "retrieved_at", "cost", "note"]) {
      if (!hasOwn(source, field)) fail(`${label}.${field} は必須です`);
    }
    if (!isNonEmptyString(source.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(source.id)) {
      fail(`sources[].id が重複しています: ${source.id}`);
    } else {
      ids.add(source.id);
    }
    validateNullableNonEmptyString(source.url, `${label}.url`);
    if (source.retrieved_at !== undefined && source.retrieved_at !== null && typeof source.retrieved_at !== "string") {
      fail(`${label}.retrieved_at は null または ISO-8601 文字列である必要があります`);
    }
    if (hasOwn(source, "cost") && !SOURCE_COSTS.has(source.cost)) {
      fail(`${label}.cost は free / paid のいずれかである必要があります`);
    }
    if (source.note !== undefined && source.note !== null && typeof source.note !== "string") {
      fail(`${label}.note は null または文字列である必要があります`);
    }
  }
  return value.length;
}

function validateFeedback(value) {
  if (!isPlainObject(value)) {
    fail("feedback は object である必要があります");
    return;
  }
  for (const field of ["reserved", "note"]) {
    if (!hasOwn(value, field)) fail(`feedback.${field} は必須です`);
  }
  if (hasOwn(value, "reserved") && value.reserved !== true) {
    fail("feedback.reserved は true である必要があります（80 配信後分析からの還流は v0 非実装の予約フィールド）");
  }
  if (value.note !== undefined && value.note !== null && typeof value.note !== "string") {
    fail("feedback.note は null または文字列である必要があります");
  }
}

function requireRegularFile(reference, label) {
  const filePath = path.isAbsolute(reference) ? reference : path.resolve(planDirectory, reference);
  if (!isRegularFile(filePath)) {
    fail(`${label} が実ファイルに解決できません: ${reference}`);
  }
}

function validateNullableNonEmptyString(value, label) {
  if (value === undefined || value === null) return;
  if (!isNonEmptyString(value)) {
    fail(`${label} は null または空でない文字列である必要があります`);
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function finish() {
  for (const warning of warnings) console.error(`warning: ${warning}`);
  if (errors.length > 0) {
    console.error(`NG: ${planPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${planPath}${warnings.length > 0 ? ` (${warnings.length} warnings)` : ""}`);
  process.exit(0);
}
