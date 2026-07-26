#!/usr/bin/env node

// avatar ディレクトリ（avatar.json + AVATAR.md + renditions/*/rendition.json）を検証する。
// docs/contract-2026-07-26-avatar-registry-v0.md 参照。
//
// 検証対象は単一ファイルではなく「1 アバター = 1 ディレクトリ」全体:
//   <avatar-dir>/avatar.json
//   <avatar-dir>/AVATAR.md
//   <avatar-dir>/renditions/<id>/rendition.json + アセット実ファイル
//
// schema 構造検証に加え、以下のルール検査を行う:
//   (a) rights 欄必須（欠落 = fail）
//   (b) rights.subject:"person" × rights.distribution:"sellable" = fail
//   (c) rights.subject:"person" のアバターが公開リポ catalog/avatars/ 配下パスにある = fail
//   (d) AVATAR.md が 136 行以上 = fail（上限 135）
//   (e) rendition.json のアセット参照が実ファイルへ解決できない = fail（全数列挙）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-avatar.mjs <avatar-dir>";
const avatarDirArgument = process.argv[2];

if (!avatarDirArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (avatarDirArgument === "--help" || avatarDirArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const avatarDir = path.resolve(avatarDirArgument);
const errors = [];

const AVATAR_SCHEMA_PATH = fileURLToPath(new URL("../avatar.schema.json", import.meta.url));
const RENDITION_SCHEMA_PATH = fileURLToPath(new URL("../avatar-rendition.schema.json", import.meta.url));

const AVATAR_MD_MAX_LINES = 135;
const RENDITION_KINDS = new Set(["2d", "3d", "photo"]);
const VOICE_LANES = new Set(["voicevox", "fal-clone", "recorded"]);
const DEFAULT_ROLES = new Set(["explainer", "listener", "tsukkomi", "narrator", "guest"]);
const RIGHTS_SUBJECTS = new Set(["person", "original", "third_party"]);
const RIGHTS_DISTRIBUTIONS = new Set(["private", "org", "sellable"]);
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

if (!isDirectory(avatarDir)) {
  fail(`avatar ディレクトリが見つかりません: ${avatarDir}`);
  finish();
}

checkSchemaId(AVATAR_SCHEMA_PATH, "urn:akari-video:schema:avatar:v0", "avatar.schema.json");
checkSchemaId(RENDITION_SCHEMA_PATH, "urn:akari-video:schema:avatar-rendition:v0", "avatar-rendition.schema.json");

const avatarJsonPath = path.join(avatarDir, "avatar.json");
const avatarMdPath = path.join(avatarDir, "AVATAR.md");

let avatar;
if (!isRegularFile(avatarJsonPath)) {
  fail(`avatar.json が見つかりません: ${avatarJsonPath}`);
} else {
  try {
    avatar = JSON.parse(fs.readFileSync(avatarJsonPath, "utf8"));
  } catch (error) {
    fail(`avatar.json を JSON として読めません: ${messageOf(error)}`);
  }
}

// ルール (d): AVATAR.md 行数上限
if (!isRegularFile(avatarMdPath)) {
  fail(`AVATAR.md が見つかりません: ${avatarMdPath}`);
} else {
  const content = fs.readFileSync(avatarMdPath, "utf8");
  const lineCount = countLines(content);
  if (lineCount > AVATAR_MD_MAX_LINES) {
    fail(
      `AVATAR.md が上限 ${AVATAR_MD_MAX_LINES} 行を超えています（wc -l 相当の実測 ${lineCount} 行・内部契約 §3）`,
    );
  }
}

if (avatar !== undefined) {
  validateAvatar(avatar);
}

finish();

function validateAvatar(value) {
  if (!isPlainObject(value)) {
    fail("avatar.json のルートは object である必要があります");
    return;
  }

  if (!hasOwn(value, "version")) {
    fail("version は必須です");
  } else if (Number.isInteger(value.version) && value.version > 0) {
    fail(
      `version ${value.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
    );
    return;
  } else if (value.version !== 0) {
    fail("version は 0 である必要があります");
  }

  if (!hasOwn(value, "id")) {
    fail("id は必須です");
  } else if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    fail(`id は kebab-case（小文字英数字とハイフン）の文字列である必要があります: ${JSON.stringify(value.id)}`);
  }

  if (!hasOwn(value, "display_name")) {
    fail("display_name は必須です");
  } else if (!isNonEmptyString(value.display_name)) {
    fail("display_name は空でない文字列である必要があります");
  }

  if (!hasOwn(value, "variants")) {
    fail("variants は必須です");
  } else {
    validateStringArray(value.variants, "variants", ID_PATTERN, "kebab-case");
  }

  if (!hasOwn(value, "persona")) {
    fail("persona は必須です");
  } else {
    validatePersona(value.persona);
  }

  if (!hasOwn(value, "voice")) {
    fail("voice は必須です");
  } else {
    validateVoiceRef(value.voice);
  }

  let renditionIds = null;
  if (!hasOwn(value, "renditions")) {
    fail("renditions は必須です");
  } else {
    renditionIds = validateRenditionSummaries(value.renditions);
  }

  if (!hasOwn(value, "default_rendition")) {
    fail("default_rendition は必須です");
  } else if (value.default_rendition !== null) {
    if (typeof value.default_rendition !== "string" || !ID_PATTERN.test(value.default_rendition)) {
      fail("default_rendition は null または kebab-case の文字列である必要があります");
    } else if (renditionIds && !renditionIds.has(value.default_rendition)) {
      fail(`default_rendition ${value.default_rendition} が renditions[] に存在しません`);
    }
  }

  // ルール (a): rights 欄必須
  if (!hasOwn(value, "rights")) {
    fail("rights は必須です（rights 欄必須・欠落は fail。内部契約 §6-3）");
  } else {
    validateRights(value.rights);
  }

  if (renditionIds) {
    for (const renditionId of renditionIds) {
      validateRenditionFile(renditionId);
    }
  }
}

function validatePersona(value) {
  if (!isPlainObject(value)) {
    fail("persona は object である必要があります");
    return;
  }
  if (!hasOwn(value, "first_person")) {
    fail("persona.first_person は必須です");
  } else if (!isNonEmptyString(value.first_person)) {
    fail("persona.first_person は空でない文字列である必要があります");
  }
  if (!hasOwn(value, "tone")) {
    fail("persona.tone は必須です");
  } else if (!isNonEmptyString(value.tone)) {
    fail("persona.tone は空でない文字列である必要があります");
  }
  if (!hasOwn(value, "speech_style")) {
    fail("persona.speech_style は必須です");
  } else if (!isNonEmptyString(value.speech_style)) {
    fail("persona.speech_style は空でない文字列である必要があります");
  }
  if (!hasOwn(value, "verbal_tics")) {
    fail("persona.verbal_tics は必須です");
  } else {
    validateStringArray(value.verbal_tics, "persona.verbal_tics");
  }
  if (!hasOwn(value, "energy")) {
    fail("persona.energy は必須です");
  } else if (!Number.isInteger(value.energy) || value.energy < 0 || value.energy > 100) {
    fail("persona.energy は 0-100 の整数である必要があります（ドパ度とは別軸のキャラ熱量。契約 §4）");
  }
  if (!hasOwn(value, "ng")) {
    fail("persona.ng は必須です");
  } else {
    validateStringArray(value.ng, "persona.ng");
  }
  if (!hasOwn(value, "default_role")) {
    fail("persona.default_role は必須です");
  } else if (!DEFAULT_ROLES.has(value.default_role)) {
    fail("persona.default_role は explainer / listener / tsukkomi / narrator / guest のいずれかである必要があります");
  }
}

function validateVoiceRef(value) {
  if (!isPlainObject(value)) {
    fail("voice は object である必要があります");
    return;
  }
  if (!hasOwn(value, "lane")) {
    fail("voice.lane は必須です");
  } else if (!VOICE_LANES.has(value.lane)) {
    fail("voice.lane は voicevox / fal-clone / recorded のいずれかである必要があります");
  }
  if (!hasOwn(value, "ref")) {
    fail("voice.ref は必須です");
  } else if (!isNonEmptyString(value.ref)) {
    fail("voice.ref は空でない文字列である必要があります");
  }
  if (!hasOwn(value, "credit")) {
    fail("voice.credit は必須です");
  } else if (value.credit !== null && !isNonEmptyString(value.credit)) {
    fail("voice.credit は null または空でない文字列である必要があります");
  }
}

function validateRenditionSummaries(value) {
  if (!Array.isArray(value)) {
    fail("renditions は配列である必要があります");
    return null;
  }
  // 0 件 = voice-only アバター（声のみ登録。S2 改訂 2026-07-26 で minItems 1→0 へ緩和）。
  const ids = new Set();
  for (const [index, rendition] of value.entries()) {
    const label = `renditions[${index}]`;
    if (!isPlainObject(rendition)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (!hasOwn(rendition, "id") || !isNonEmptyString(rendition.id) || !ID_PATTERN.test(rendition.id)) {
      fail(`${label}.id は kebab-case の文字列である必要があります`);
    } else {
      if (ids.has(rendition.id)) fail(`renditions の id が重複しています: ${rendition.id}`);
      ids.add(rendition.id);
    }
    if (!hasOwn(rendition, "kind") || !RENDITION_KINDS.has(rendition.kind)) {
      fail(`${label}.kind は 2d / 3d / photo のいずれかである必要があります`);
    }
    if (!hasOwn(rendition, "capabilities")) {
      fail(`${label}.capabilities は必須です`);
    } else {
      validateCapabilities(rendition.capabilities, `${label}.capabilities`);
    }
  }
  return ids;
}

function validateCapabilities(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  if (!hasOwn(value, "lipsync") || typeof value.lipsync !== "boolean") {
    fail(`${label}.lipsync は boolean である必要があります`);
  }
  if (!hasOwn(value, "expressions")) {
    fail(`${label}.expressions は必須です`);
  } else {
    validateStringArray(value.expressions, `${label}.expressions`);
  }
  if (!hasOwn(value, "framing")) {
    fail(`${label}.framing は必須です`);
  } else {
    validateStringArray(value.framing, `${label}.framing`);
  }
}

function validateRights(value) {
  if (!isPlainObject(value)) {
    fail("rights は object である必要があります");
    return;
  }
  if (!hasOwn(value, "subject") || !RIGHTS_SUBJECTS.has(value.subject)) {
    fail("rights.subject は person / original / third_party のいずれかである必要があります");
  }
  if (!hasOwn(value, "consent")) {
    fail("rights.consent は必須です");
  } else if (!isValidConsent(value.consent)) {
    fail("rights.consent は self / signed:<path> / terms:<url> のいずれかの形式である必要があります");
  }
  if (!hasOwn(value, "credit_required") || typeof value.credit_required !== "boolean") {
    fail("rights.credit_required は boolean である必要があります");
  }
  if (!hasOwn(value, "distribution") || !RIGHTS_DISTRIBUTIONS.has(value.distribution)) {
    fail("rights.distribution は private / org / sellable のいずれかである必要があります");
  }

  // ルール (b): person × sellable
  if (value.subject === "person" && value.distribution === "sellable") {
    fail(
      "rights.subject が person のアバターは rights.distribution を sellable にできません（実在人物は販売不可。内部契約 §6-3）",
    );
  }

  // ルール (c): person アバターが公開リポ catalog/avatars/ 配下にある
  if (value.subject === "person" && isUnderPublicCatalogAvatars(avatarDir)) {
    fail(
      `rights.subject が person のアバターは公開リポ catalog/avatars/ 配下に置けません（実体は個人スコープへ。内部契約 §1）: ${avatarDir}`,
    );
  }
}

function isValidConsent(value) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  return value === "self" || /^signed:\S+$/.test(value) || /^terms:https?:\/\/\S+$/.test(value);
}

function isUnderPublicCatalogAvatars(dir) {
  const normalized = dir.split(path.sep).join("/");
  return /(^|\/)catalog\/avatars(\/|$)/.test(normalized);
}

function validateRenditionFile(renditionId) {
  const renditionDir = path.join(avatarDir, "renditions", renditionId);
  const renditionJsonPath = path.join(renditionDir, "rendition.json");
  if (!isRegularFile(renditionJsonPath)) {
    fail(`rendition.json が見つかりません: ${renditionJsonPath}`);
    return;
  }
  let rendition;
  try {
    rendition = JSON.parse(fs.readFileSync(renditionJsonPath, "utf8"));
  } catch (error) {
    fail(`${renditionJsonPath} を JSON として読めません: ${messageOf(error)}`);
    return;
  }
  if (!isPlainObject(rendition)) {
    fail(`${renditionJsonPath} のルートは object である必要があります`);
    return;
  }
  if (!hasOwn(rendition, "version") || rendition.version !== 0) {
    fail(`${renditionJsonPath}: version は 0 である必要があります`);
  }
  if (!hasOwn(rendition, "id") || rendition.id !== renditionId) {
    fail(`${renditionJsonPath}: id はディレクトリ名 ${renditionId} と一致する必要があります`);
  }
  if (!hasOwn(rendition, "kind") || !RENDITION_KINDS.has(rendition.kind)) {
    fail(`${renditionJsonPath}: kind は 2d / 3d / photo のいずれかである必要があります`);
  }
  if (!hasOwn(rendition, "capabilities")) {
    fail(`${renditionJsonPath}: capabilities は必須です`);
  } else {
    validateCapabilities(rendition.capabilities, `${renditionJsonPath} capabilities`);
  }
  if (!hasOwn(rendition, "assets")) {
    fail(`${renditionJsonPath}: assets は必須です`);
    return;
  }
  validateAssetsResolve(rendition.assets, renditionDir, renditionJsonPath);
}

// ルール (e): アセット参照の実ファイル解決（欠落は全数列挙）
function validateAssetsResolve(assets, renditionDir, renditionJsonPath) {
  if (!isPlainObject(assets)) {
    fail(`${renditionJsonPath}: assets は object である必要があります`);
    return;
  }
  let sawAny = false;
  for (const group of ["expressions", "lipsync"]) {
    if (!hasOwn(assets, group)) continue;
    const map = assets[group];
    if (!isPlainObject(map)) {
      fail(`${renditionJsonPath}: assets.${group} は object である必要があります`);
      continue;
    }
    for (const [key, filename] of Object.entries(map)) {
      sawAny = true;
      if (!isNonEmptyString(filename)) {
        fail(`${renditionJsonPath}: assets.${group}.${key} は空でない文字列である必要があります`);
        continue;
      }
      const resolved = path.join(renditionDir, filename);
      if (!isRegularFile(resolved)) {
        fail(
          `アセット参照が実ファイルに解決できません: ${renditionJsonPath} assets.${group}.${key} = "${filename}"（解決先 ${resolved}）`,
        );
      }
    }
  }
  if (!sawAny) {
    fail(`${renditionJsonPath}: assets.expressions または assets.lipsync に最低 1 件のエントリが必要です`);
  }
}

function checkSchemaId(schemaPath, expectedId, label) {
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (error) {
    fail(`${label} を JSON として読めません: ${messageOf(error)}`);
    finish();
    return;
  }
  if (schema.$id !== expectedId) {
    fail(`${label} の $id が v0 契約と一致しません`);
    finish();
  }
}

function validateStringArray(value, label, pattern, patternLabel) {
  if (!Array.isArray(value)) {
    fail(`${label} は配列である必要があります`);
    return;
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (!isNonEmptyString(item)) {
      fail(`${itemLabel} は空でない文字列である必要があります`);
      continue;
    }
    if (pattern && !pattern.test(item)) {
      fail(`${itemLabel} は ${patternLabel} である必要があります: ${item}`);
    }
    if (seen.has(item)) {
      fail(`${label} に重複があります: ${item}`);
    } else {
      seen.add(item);
    }
  }
}

function countLines(content) {
  return (content.match(/\n/g) || []).length;
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    console.error(`NG: ${avatarDir}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${avatarDir}`);
  process.exit(0);
}
