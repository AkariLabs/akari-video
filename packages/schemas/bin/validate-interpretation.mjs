#!/usr/bin/env node

// interpretation.json v0（複数素材を横断する解釈層）の構造と、JSON Schema 単体では表せない
// 参照・意味制約（evidence 必須・省略 vs null・start/end の対関係・ダングリング参照）を検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-interpretation.mjs <interpretation.json>";
const interpretationArgument = process.argv[2];

if (!interpretationArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (interpretationArgument === "--help" || interpretationArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const interpretationPath = path.resolve(interpretationArgument);
const schemaPath = fileURLToPath(new URL("../interpretation.schema.json", import.meta.url));
const errors = [];

const FLAG_TYPES = new Set(["orphan", "unclear", "trouble_overlap"]);
const OPEN_QUESTION_STATUSES = new Set(["open", "answered"]);

if (!isRegularFile(interpretationPath)) {
  fail(`interpretation.json が見つかりません: ${interpretationPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`interpretation.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:interpretation:v0") {
  fail("interpretation.schema.json の $id が v0 契約と一致しません");
  finish();
}

let interpretation;
try {
  interpretation = JSON.parse(fs.readFileSync(interpretationPath, "utf8"));
} catch (error) {
  fail(`interpretation.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateInterpretation(interpretation);
finish();

function validateInterpretation(value) {
  if (!isPlainObject(value)) {
    fail("interpretation.json のルートは object である必要があります");
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

  const rootFields = ["version", "inputs", "assets", "arc", "open_questions"];
  for (const field of rootFields) {
    if (!hasOwn(value, field)) fail(`${field} は必須です`);
  }
  rejectUnknownFields(value, rootFields, "ルート");

  const analysisRefs = validateInputs(value.inputs);
  const assetRefs = validateAssets(value.assets);
  validateAnalysesAssetCorrespondence(analysisRefs, assetRefs);
  validateArc(value.arc, assetRefs);
  validateOpenQuestions(value.open_questions);
}

function validateInputs(value) {
  const analysisRefs = new Set();
  if (!isPlainObject(value)) {
    fail("inputs は object である必要があります");
    return analysisRefs;
  }
  const fields = ["analyses", "context"];
  if (!hasOwn(value, "analyses")) fail("inputs.analyses は必須です");
  rejectUnknownFields(value, fields, "inputs");

  if (hasOwn(value, "analyses")) {
    if (!Array.isArray(value.analyses) || value.analyses.length === 0) {
      fail("inputs.analyses は 1 件以上の配列である必要があります");
    } else {
      for (const [index, entry] of value.analyses.entries()) {
        const label = `inputs.analyses[${index}]`;
        if (!isPlainObject(entry)) {
          fail(`${label} は object である必要があります`);
          continue;
        }
        const entryFields = ["ref", "path", "source"];
        for (const field of entryFields) {
          if (!hasOwn(entry, field)) fail(`${label}.${field} は必須です`);
        }
        rejectUnknownFields(entry, entryFields, label);
        if (hasOwn(entry, "ref")) {
          if (!isNonEmptyString(entry.ref)) {
            fail(`${label}.ref は空でない文字列である必要があります`);
          } else if (analysisRefs.has(entry.ref)) {
            fail(`inputs.analyses[].ref が重複しています: ${entry.ref}`);
          } else {
            analysisRefs.add(entry.ref);
          }
        }
        if (hasOwn(entry, "path")) validateNonEmptyString(entry.path, `${label}.path`);
        if (hasOwn(entry, "source")) validateNonEmptyString(entry.source, `${label}.source`);
      }
    }
  }

  if (hasOwn(value, "context")) validateContext(value.context);
  return analysisRefs;
}

// inputs.analyses[].ref と assets[].ref は 1:1 対応（過不足・重複なし）でなければならない
// （2026-07-22 A3.2 の swap 実証: 位置対応づけは無警告で入れ替わるため FK 化した）。
// 重複自体は各バリデータ側で既に検出済みなので、ここでは集合として過不足のみを見る。
function validateAnalysesAssetCorrespondence(analysisRefs, assetRefs) {
  for (const ref of analysisRefs) {
    if (!assetRefs.has(ref)) {
      fail(`inputs.analyses[].ref が assets[].ref に存在しません: ${ref}`);
    }
  }
  for (const ref of assetRefs) {
    if (!analysisRefs.has(ref)) {
      fail(`assets[].ref に対応する inputs.analyses[].ref がありません: ${ref}`);
    }
  }
}

function validateContext(value) {
  if (!isPlainObject(value)) {
    fail("inputs.context は object である必要があります（省略はできても null 化はできません）");
    return;
  }
  const fields = ["intake", "past_projects", "interview", "notes"];
  for (const field of ["past_projects", "interview"]) {
    if (!hasOwn(value, field)) fail(`inputs.context.${field} は必須です（値が空でもキーは省略しない）`);
  }
  rejectUnknownFields(value, fields, "inputs.context");

  if (hasOwn(value, "intake") && !isPlainObject(value.intake)) {
    fail("inputs.context.intake は object である必要があります（省略可。null にしない）");
  }

  if (hasOwn(value, "past_projects")) {
    if (!Array.isArray(value.past_projects)) {
      fail("inputs.context.past_projects は配列である必要があります");
    } else {
      for (const [index, entry] of value.past_projects.entries()) {
        const label = `inputs.context.past_projects[${index}]`;
        if (!isPlainObject(entry)) {
          fail(`${label} は object である必要があります`);
          continue;
        }
        const entryFields = ["ref", "notes"];
        for (const field of entryFields) {
          if (!hasOwn(entry, field)) fail(`${label}.${field} は必須です`);
        }
        rejectUnknownFields(entry, entryFields, label);
        if (hasOwn(entry, "ref")) validateNonEmptyString(entry.ref, `${label}.ref`);
        if (hasOwn(entry, "notes")) validateNonEmptyString(entry.notes, `${label}.notes`);
      }
    }
  }

  if (hasOwn(value, "interview")) {
    if (!Array.isArray(value.interview)) {
      fail("inputs.context.interview は配列である必要があります");
    } else {
      for (const [index, entry] of value.interview.entries()) {
        const label = `inputs.context.interview[${index}]`;
        if (!isPlainObject(entry)) {
          fail(`${label} は object である必要があります`);
          continue;
        }
        const entryFields = ["q", "a"];
        for (const field of entryFields) {
          if (!hasOwn(entry, field)) fail(`${label}.${field} は必須です`);
        }
        rejectUnknownFields(entry, entryFields, label);
        if (hasOwn(entry, "q")) validateNonEmptyString(entry.q, `${label}.q`);
        if (hasOwn(entry, "a")) validateNonEmptyString(entry.a, `${label}.a`);
      }
    }
  }

  if (hasOwn(value, "notes")) validateNonEmptyString(value.notes, "inputs.context.notes");
}

function validateAssets(value) {
  const refs = new Set();
  if (!Array.isArray(value) || value.length === 0) {
    fail("assets は 1 件以上の配列である必要があります");
    return refs;
  }
  for (const [index, asset] of value.entries()) {
    const label = `assets[${index}]`;
    if (!isPlainObject(asset)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const requiredFields = ["ref", "role", "summary", "relations", "flags"];
    const allFields = ["ref", "role", "summary", "sections", "relations", "flags"];
    for (const field of requiredFields) {
      if (!hasOwn(asset, field)) fail(`${label}.${field} は必須です`);
    }
    rejectUnknownFields(asset, allFields, label);

    if (hasOwn(asset, "ref")) {
      if (!isNonEmptyString(asset.ref)) {
        fail(`${label}.ref は空でない文字列である必要があります`);
      } else if (refs.has(asset.ref)) {
        fail(`assets[].ref が重複しています: ${asset.ref}`);
      } else {
        refs.add(asset.ref);
      }
    }
    if (hasOwn(asset, "role")) validateNonEmptyString(asset.role, `${label}.role`);
    if (hasOwn(asset, "summary")) validateNonEmptyString(asset.summary, `${label}.summary`);
    if (hasOwn(asset, "sections")) validateSections(asset.sections, label);
    if (hasOwn(asset, "relations")) validateRelations(asset.relations, label);
    if (hasOwn(asset, "flags")) validateFlags(asset.flags, label);
  }
  // relations[].target のダングリング参照は全 assets を読み終えてからでないと判定できないため二周目で確認する。
  for (const [index, asset] of value.entries()) {
    if (!isPlainObject(asset) || !Array.isArray(asset.relations)) continue;
    const label = `assets[${index}]`;
    for (const [relIndex, relation] of asset.relations.entries()) {
      if (!isPlainObject(relation) || !isNonEmptyString(relation.target)) continue;
      const relLabel = `${label}.relations[${relIndex}]`;
      if (!refs.has(relation.target)) {
        fail(`${relLabel}.target が assets[].ref を参照していません: ${relation.target}`);
      } else if (relation.target === asset.ref) {
        fail(`${relLabel}.target が自素材への自己参照になっています: ${relation.target}`);
      }
    }
  }
  return refs;
}

function validateSections(value, assetLabel) {
  if (!Array.isArray(value)) {
    fail(`${assetLabel}.sections は配列である必要があります`);
    return;
  }
  const ids = new Set();
  for (const [index, section] of value.entries()) {
    const label = `${assetLabel}.sections[${index}]`;
    if (!isPlainObject(section)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const fields = ["id", "start", "end", "title", "role", "evidence"];
    for (const field of fields) {
      if (!hasOwn(section, field)) fail(`${label}.${field} は必須です`);
    }
    rejectUnknownFields(section, fields, label);

    if (hasOwn(section, "id")) {
      if (!isNonEmptyString(section.id)) {
        fail(`${label}.id は空でない文字列である必要があります`);
      } else if (ids.has(section.id)) {
        fail(`${assetLabel}.sections[].id が重複しています: ${section.id}`);
      } else {
        ids.add(section.id);
      }
    }
    validateSecondsPair(section, label);
    if (hasOwn(section, "title")) validateNonEmptyString(section.title, `${label}.title`);
    if (hasOwn(section, "role")) validateNonEmptyString(section.role, `${label}.role`);
    if (hasOwn(section, "evidence")) validateNonEmptyString(section.evidence, `${label}.evidence`);
  }
}

function validateRelations(value, assetLabel) {
  if (!Array.isArray(value)) {
    fail(`${assetLabel}.relations は配列である必要があります`);
    return;
  }
  for (const [index, relation] of value.entries()) {
    const label = `${assetLabel}.relations[${index}]`;
    if (!isPlainObject(relation)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const requiredFields = ["target", "kind", "evidence"];
    const allFields = ["target", "kind", "evidence", "note"];
    for (const field of requiredFields) {
      if (!hasOwn(relation, field)) fail(`${label}.${field} は必須です`);
    }
    rejectUnknownFields(relation, allFields, label);
    if (hasOwn(relation, "target")) validateNonEmptyString(relation.target, `${label}.target`);
    if (hasOwn(relation, "kind")) validateNonEmptyString(relation.kind, `${label}.kind`);
    if (hasOwn(relation, "evidence")) validateNonEmptyString(relation.evidence, `${label}.evidence`);
    if (hasOwn(relation, "note")) validateNonEmptyString(relation.note, `${label}.note`);
  }
}

function validateFlags(value, assetLabel) {
  if (!Array.isArray(value)) {
    fail(`${assetLabel}.flags は配列である必要があります`);
    return;
  }
  for (const [index, flag] of value.entries()) {
    const label = `${assetLabel}.flags[${index}]`;
    if (!isPlainObject(flag)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const requiredFields = ["type", "evidence"];
    const allFields = ["type", "evidence", "start", "end", "note"];
    for (const field of requiredFields) {
      if (!hasOwn(flag, field)) fail(`${label}.${field} は必須です`);
    }
    rejectUnknownFields(flag, allFields, label);

    if (hasOwn(flag, "type") && !FLAG_TYPES.has(flag.type)) {
      fail(`${label}.type は orphan / unclear / trouble_overlap のいずれかである必要があります`);
    }
    if (hasOwn(flag, "evidence")) validateNonEmptyString(flag.evidence, `${label}.evidence`);
    if (hasOwn(flag, "note")) validateNonEmptyString(flag.note, `${label}.note`);
    validateSecondsPair(flag, label);
  }
}

function validateArc(value, assetRefs) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("arc は 1 件以上の配列である必要があります");
    return;
  }
  const orders = new Set();
  for (const [index, entry] of value.entries()) {
    const label = `arc[${index}]`;
    if (!isPlainObject(entry)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const fields = ["order", "title", "refs", "purpose", "evidence"];
    for (const field of fields) {
      if (!hasOwn(entry, field)) fail(`${label}.${field} は必須です`);
    }
    rejectUnknownFields(entry, fields, label);

    if (hasOwn(entry, "order")) {
      if (!Number.isInteger(entry.order) || entry.order < 1) {
        fail(`${label}.order は 1 以上の整数である必要があります`);
      } else if (orders.has(entry.order)) {
        fail(`arc[].order が重複しています: ${entry.order}`);
      } else {
        orders.add(entry.order);
      }
    }
    if (hasOwn(entry, "title")) validateNonEmptyString(entry.title, `${label}.title`);
    if (hasOwn(entry, "purpose")) validateNonEmptyString(entry.purpose, `${label}.purpose`);
    if (hasOwn(entry, "evidence")) validateNonEmptyString(entry.evidence, `${label}.evidence`);

    if (hasOwn(entry, "refs")) {
      if (!Array.isArray(entry.refs) || entry.refs.length === 0) {
        fail(`${label}.refs は 1 件以上の配列である必要があります`);
      } else {
        for (const [refIndex, ref] of entry.refs.entries()) {
          const refLabel = `${label}.refs[${refIndex}]`;
          if (!isPlainObject(ref)) {
            fail(`${refLabel} は object である必要があります`);
            continue;
          }
          const refFields = ["asset", "start", "end"];
          if (!hasOwn(ref, "asset")) fail(`${refLabel}.asset は必須です`);
          rejectUnknownFields(ref, refFields, refLabel);
          if (hasOwn(ref, "asset")) {
            if (!isNonEmptyString(ref.asset)) {
              fail(`${refLabel}.asset は空でない文字列である必要があります`);
            } else if (!assetRefs.has(ref.asset)) {
              fail(`${refLabel}.asset が assets[].ref を参照していません: ${ref.asset}`);
            }
          }
          validateSecondsPair(ref, refLabel);
        }
      }
    }
  }
}

function validateOpenQuestions(value) {
  if (!Array.isArray(value)) {
    fail("open_questions は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, entry] of value.entries()) {
    const label = `open_questions[${index}]`;
    if (!isPlainObject(entry)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const requiredFields = ["id", "question", "fills", "status"];
    const allFields = ["id", "question", "fills", "status", "answer"];
    for (const field of requiredFields) {
      if (!hasOwn(entry, field)) fail(`${label}.${field} は必須です`);
    }
    rejectUnknownFields(entry, allFields, label);

    if (hasOwn(entry, "id")) {
      if (!isNonEmptyString(entry.id)) {
        fail(`${label}.id は空でない文字列である必要があります`);
      } else if (ids.has(entry.id)) {
        fail(`open_questions[].id が重複しています: ${entry.id}`);
      } else {
        ids.add(entry.id);
      }
    }
    if (hasOwn(entry, "question")) validateNonEmptyString(entry.question, `${label}.question`);
    if (hasOwn(entry, "fills")) validateNonEmptyString(entry.fills, `${label}.fills`);
    if (hasOwn(entry, "status") && !OPEN_QUESTION_STATUSES.has(entry.status)) {
      fail(`${label}.status は open / answered のいずれかである必要があります`);
    }
    if (entry.status === "answered" && !isNonEmptyString(entry.answer)) {
      fail(`${label}.answer は status が answered のとき必須です`);
    }
    if (entry.status === "open" && hasOwn(entry, "answer")) {
      fail(`${label}.answer は status が open のとき省略する必要があります（null にしない）`);
    }
  }
}

function validateSecondsPair(value, label) {
  const hasStart = hasOwn(value, "start");
  const hasEnd = hasOwn(value, "end");
  if (hasStart && !isFiniteNumber(value.start)) {
    fail(`${label}.start は有限数（秒）である必要があります`);
  }
  if (hasEnd && !isFiniteNumber(value.end)) {
    fail(`${label}.end は有限数（秒）である必要があります`);
  }
  if (hasStart !== hasEnd) {
    fail(`${label} は start/end を両方指定するか、両方省略する必要があります`);
    return;
  }
  if (hasStart && hasEnd && isFiniteNumber(value.start) && isFiniteNumber(value.end)) {
    if (value.start < 0 || value.end < 0) {
      fail(`${label}.start/end は 0 以上である必要があります`);
    } else if (value.end <= value.start) {
      fail(`${label} は end > start を満たす必要があります`);
    }
  }
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) fail(`${label}.${field} は未定義のフィールドです`);
  }
}

function validateNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) fail(`${label} は空でない文字列である必要があります`);
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

function finish() {
  if (errors.length > 0) {
    console.error(`NG: ${interpretationPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${interpretationPath}`);
  process.exit(0);
}
