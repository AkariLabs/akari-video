#!/usr/bin/env node

// 素材ライブラリ契約 v0 の構造を、Node.js 組み込み機能だけで検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-asset.mjs assets/overlay/<id>";
const assetArgument = process.argv[2];

if (!assetArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (assetArgument === "--help" || assetArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const assetDir = path.resolve(assetArgument);
const metaPath = path.join(assetDir, "meta.json");
const previewPath = path.join(assetDir, "preview.png");
const errors = [];

// fragment.html 内の <script type="application/json" data-akari-3d-scene> 宣言を抽出する
// （属性の順序は問わない。packages/render-cut/src/render-inputs.mjs の THREE_SCENE_SCRIPT_PATTERN と同じ流儀）。
const SCENE_DECLARATION_PATTERN =
  /<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'))(?=[^>]*\bdata-akari-3d-scene\b)[^>]*>([\s\S]*?)<\/script\s*>/iu;

if (!isDirectory(assetDir)) {
  fail(`素材ディレクトリが見つかりません: ${assetDir}`);
  finish();
}

if (!isRegularFile(metaPath)) {
  fail(`meta.json が見つかりません: ${metaPath}`);
  finish();
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
} catch (error) {
  fail(`meta.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateMeta(meta);
validateDirectoryContract(meta);
validateFiles();
finish();

function validateMeta(value) {
  if (!isPlainObject(value)) {
    fail("meta.json のルートは object である必要があります");
    return;
  }

  const requiredFields = [
    "id",
    "category",
    "title",
    "description",
    "when_to_use",
    "tags",
    "knobs",
    "ai_usage",
    "requires",
    "provenance",
    "author",
    "license",
    "price",
  ];
  // source / remote / matched_by / version / min_app_version / min_overlay_runtime_version / motion_presets は
  // 任意フィールド。後方互換のため必須フィールドには加えない（version は 2026-07-30 導入で、既存エントリは未設定。
  // min_overlay_runtime_version は 2026-08-06 層ミラー規約の導入で新設。motion_presets は同日 laptop-live-asset
  // タスクで新設 — scene3d ライブ経路の glb 内蔵クリップ一覧を機械可読にする）。
  const optionalFields = [
    "source",
    "remote",
    "matched_by",
    "version",
    "min_app_version",
    "min_overlay_runtime_version",
    "motion_presets",
  ];
  const allowedFields = [...requiredFields, ...optionalFields];
  for (const field of requiredFields) {
    if (!hasOwn(value, field)) fail(`必須フィールドがありません: ${field}`);
  }

  const unknownFields = Object.keys(value).filter((field) => !allowedFields.includes(field));
  for (const field of unknownFields) fail(`未定義のトップレベルフィールドです: ${field}`);

  validateNonEmptyString(value.id, "id");
  if (typeof value.id === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) {
    fail("id は英小文字・数字の kebab-case である必要があります");
  }

  // 2026-07-29: 主題（3d/motion/telop/thumbnail）から配布物の形へ切り替え。主題は tags に逃がす。
  const categories = new Set(["overlay", "still", "scene3d", "audio", "broll", "font"]);
  if (typeof value.category !== "string" || !categories.has(value.category)) {
    fail("category は overlay / still / scene3d / audio / broll / font のいずれかである必要があります");
  }

  for (const field of ["title", "description", "when_to_use", "ai_usage", "author"]) {
    validateNonEmptyString(value[field], field);
  }

  validateStringArray(value.tags, "tags");
  validateStringArray(value.requires, "requires");
  validateKnobs(value.knobs);
  validateProvenance(value.provenance);
  validateLicense(value.license);

  if (value.price !== null && (!isFiniteNumber(value.price) || value.price < 0)) {
    fail("price は null または 0 以上の有限数である必要があります");
  }

  if (hasOwn(value, "version")) {
    if (!Number.isInteger(value.version) || value.version < 1) {
      fail("version は 1 以上の整数である必要があります");
    }
  }

  if (hasOwn(value, "min_app_version") && !/^\d+\.\d+\.\d+$/.test(String(value.min_app_version))) {
    fail("min_app_version は x.y.z 形式である必要があります");
  }

  if (
    hasOwn(value, "min_overlay_runtime_version") &&
    !/^\d+\.\d+\.\d+$/.test(String(value.min_overlay_runtime_version))
  ) {
    fail("min_overlay_runtime_version は x.y.z 形式である必要があります");
  }

  const matchedByValues = new Set(["title-normalized"]);
  if (hasOwn(value, "matched_by") && !matchedByValues.has(value.matched_by)) {
    fail(`matched_by は ${[...matchedByValues].join(" / ")} のいずれかである必要があります`);
  }

  const isRemote = value.remote === true;
  if (hasOwn(value, "remote") && typeof value.remote !== "boolean") {
    fail("remote は boolean である必要があります");
  }
  if (hasOwn(value, "source")) {
    validateSource(value.source);
  }
  if (isRemote && !hasOwn(value, "source")) {
    fail("remote: true のエントリには source ブロックが必須です");
  }

  if (hasOwn(value, "motion_presets")) {
    validateMotionPresets(value.motion_presets);
  }
}

function validateMotionPresets(motionPresets) {
  if (!Array.isArray(motionPresets) || motionPresets.length === 0) {
    fail("motion_presets は 1 件以上の配列である必要があります");
    return;
  }

  const presetFields = ["clip", "label", "note"];
  motionPresets.forEach((preset, index) => {
    if (!isPlainObject(preset)) {
      fail(`motion_presets[${index}] は object である必要があります`);
      return;
    }
    for (const field of presetFields) {
      if (!hasOwn(preset, field)) fail(`motion_presets[${index}].${field} は必須です`);
    }
    for (const field of Object.keys(preset)) {
      if (!presetFields.includes(field)) fail(`motion_presets[${index}].${field} は未定義のフィールドです`);
    }
    validateNonEmptyString(preset.clip, `motion_presets[${index}].clip`);
    validateNonEmptyString(preset.label, `motion_presets[${index}].label`);
    validateNonEmptyString(preset.note, `motion_presets[${index}].note`);
  });
}

function validateSource(source) {
  if (!isPlainObject(source)) {
    fail("source は object である必要があります");
    return;
  }

  const sourceFields = ["url", "acquisition", "license_at_source", "attribution_required", "preview_url"];
  const requiredSourceFields = ["url", "acquisition", "license_at_source", "attribution_required"];
  for (const field of requiredSourceFields) {
    if (!hasOwn(source, field)) fail(`source.${field} は必須です`);
  }
  for (const field of Object.keys(source)) {
    if (!sourceFields.includes(field)) fail(`source.${field} は未定義のフィールドです`);
  }

  validateHttpUrl(source.url, "source.url");

  const acquisitionTypes = new Set(["direct", "login", "purchase"]);
  if (typeof source.acquisition !== "string" || !acquisitionTypes.has(source.acquisition)) {
    fail("source.acquisition は direct / login / purchase のいずれかである必要があります");
  }

  validateNonEmptyString(source.license_at_source, "source.license_at_source");

  if (typeof source.attribution_required !== "boolean") {
    fail("source.attribution_required は boolean である必要があります");
  }

  if (hasOwn(source, "preview_url")) {
    validateHttpUrl(source.preview_url, "source.preview_url");
  }
}

function validateHttpUrl(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} は空でない文字列である必要があります`);
    return;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} は有効な URL である必要があります: ${value}`);
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`${label} は http(s) URL である必要があります: ${value}`);
  }
}

function validateKnobs(knobs) {
  if (!Array.isArray(knobs)) {
    fail("knobs は配列である必要があります");
    return;
  }

  const knobTypes = new Set(["text", "color", "slider", "dropdown", "checkbox", "media"]);
  const cssVars = new Set();
  const params = new Set();
  for (const [index, knob] of knobs.entries()) {
    const label = `knobs[${index}]`;
    if (!isPlainObject(knob)) {
      fail(`${label} は object である必要があります`);
      continue;
    }

    for (const field of ["type", "group"]) {
      if (!hasOwn(knob, field)) fail(`${label}.${field} は必須です`);
    }

    // バインド先は cssVar（オーバーレイ素材）か param（3D ベイクレシピ）のどちらか一方（2026-07-14 追記）
    const hasCssVar = hasOwn(knob, "cssVar");
    const hasParam = hasOwn(knob, "param");
    if (hasCssVar === hasParam) {
      fail(`${label} は cssVar か param のどちらか一方を必須とします`);
    }

    if (hasCssVar) {
      validateNonEmptyString(knob.cssVar, `${label}.cssVar`);
      if (typeof knob.cssVar === "string") {
        if (!/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(knob.cssVar)) {
          fail(`${label}.cssVar は CSS カスタムプロパティ名である必要があります`);
        }
        if (cssVars.has(knob.cssVar)) fail(`${label}.cssVar が重複しています: ${knob.cssVar}`);
        cssVars.add(knob.cssVar);
      }
    }

    if (hasParam) {
      validateNonEmptyString(knob.param, `${label}.param`);
      if (typeof knob.param === "string") {
        if (!/^[a-z_][a-z0-9_]*$/.test(knob.param)) {
          fail(`${label}.param は snake_case（英小文字・数字・アンダースコア）である必要があります`);
        }
        if (params.has(knob.param)) fail(`${label}.param が重複しています: ${knob.param}`);
        params.add(knob.param);
      }
    }

    if (typeof knob.type !== "string" || !knobTypes.has(knob.type)) {
      fail(`${label}.type は ${[...knobTypes].join(" / ")} のいずれかである必要があります`);
    }
    validateNonEmptyString(knob.group, `${label}.group`);
    if (hasOwn(knob, "label")) validateNonEmptyString(knob.label, `${label}.label`);
    if (hasOwn(knob, "min") && !isFiniteNumber(knob.min)) {
      fail(`${label}.min は有限数である必要があります`);
    }
    if (hasOwn(knob, "max") && !isFiniteNumber(knob.max)) {
      fail(`${label}.max は有限数である必要があります`);
    }
    if (isFiniteNumber(knob.min) && isFiniteNumber(knob.max) && knob.min > knob.max) {
      fail(`${label}.min は max 以下である必要があります`);
    }
    if (hasOwn(knob, "unit") && typeof knob.unit !== "string") {
      fail(`${label}.unit は文字列である必要があります`);
    }
  }
}

function validateProvenance(provenance) {
  if (!isPlainObject(provenance)) {
    fail("provenance は object である必要があります");
    return;
  }

  for (const field of ["origin", "generator"]) {
    if (!hasOwn(provenance, field)) fail(`provenance.${field} は必須です`);
  }
  for (const field of Object.keys(provenance)) {
    if (!["origin", "generator"].includes(field)) {
      fail(`provenance.${field} は未定義のフィールドです`);
    }
  }
  validateNonEmptyString(provenance.origin, "provenance.origin");
  if (provenance.generator !== null) {
    validateNonEmptyString(provenance.generator, "provenance.generator");
  }
}

function validateLicense(license) {
  if (!isPlainObject(license)) {
    fail("license は object である必要があります");
    return;
  }

  const licenseFields = [
    "spdx",
    "scope",
    "attribution_required",
    "ai_training_allowed",
  ];
  for (const field of licenseFields) {
    if (!hasOwn(license, field)) fail(`license.${field} は必須です`);
  }
  for (const field of Object.keys(license)) {
    if (!licenseFields.includes(field)) fail(`license.${field} は未定義のフィールドです`);
  }

  validateNonEmptyString(license.spdx, "license.spdx");
  validateNonEmptyString(license.scope, "license.scope");
  if (typeof license.attribution_required !== "boolean") {
    fail("license.attribution_required は boolean である必要があります");
  }
  if (typeof license.ai_training_allowed !== "boolean") {
    fail("license.ai_training_allowed は boolean である必要があります");
  }
}

function validateDirectoryContract(value) {
  if (!isPlainObject(value)) return;

  const assetId = path.basename(assetDir);
  const categoryDir = path.basename(path.dirname(assetDir));
  if (typeof value.id === "string" && value.id !== assetId) {
    fail(`id と素材ディレクトリ名が一致しません: ${value.id} != ${assetId}`);
  }
  if (typeof value.category === "string" && value.category !== categoryDir) {
    fail(`category と親ディレクトリ名が一致しません: ${value.category} != ${categoryDir}`);
  }
}

function validateFiles() {
  if (isPlainObject(meta) && meta.remote === true) {
    // remote: true のエントリは実体（fragment.html / preview.png / バイナリ等）を持たない。
    // source ブロックの妥当性は validateMeta 側（validateSource）で検証済み。
    return;
  }

  if (!isRegularFile(previewPath)) {
    fail(`preview.png が見つかりません: ${previewPath}`);
  } else {
    validatePng(previewPath);
  }

  let payloadFiles;
  try {
    payloadFiles = listRegularFiles(assetDir).filter(
      (filePath) => filePath !== metaPath && filePath !== previewPath,
    );
  } catch (error) {
    fail(`素材ディレクトリを列挙できません: ${messageOf(error)}`);
    return;
  }
  if (payloadFiles.length === 0) {
    fail("実体ファイルがありません（meta.json / preview.png 以外に 1 ファイル以上必要です）");
    return;
  }

  const category = path.basename(path.dirname(assetDir));
  if (["overlay", "still"].includes(category)) {
    const fragmentPath = path.join(assetDir, "fragment.html");
    if (!isRegularFile(fragmentPath)) {
      fail(`${category} 素材には fragment.html が必要です`);
    }
  }

  if (category === "scene3d") {
    // scene3d は fragment.html（経路 A: オーバーレイ）か scene.py（経路 B: ベイクレシピ）のどちらか一方
    // （契約: docs/contract-2026-07-14-3d-bake-recipe.md）
    const hasFragment = isRegularFile(path.join(assetDir, "fragment.html"));
    const hasScene = isRegularFile(path.join(assetDir, "scene.py"));
    if (hasFragment === hasScene) {
      fail("scene3d 素材は fragment.html（オーバーレイ）か scene.py（ベイクレシピ）のどちらか一方を実体に持つ必要があります");
    }
    if (
      hasFragment &&
      requiresGltfModel(path.join(assetDir, "fragment.html")) &&
      !payloadFiles.some((filePath) => /\.(?:glb|gltf)$/i.test(filePath))
    ) {
      fail("scene3d 素材には glTF 実体（.glb または .gltf）が必要です");
    }
  }

  if (Array.isArray(meta?.requires) && meta.requires.includes("glass-runtime")) {
    for (const filePath of payloadFiles) {
      const name = relativeToAsset(filePath).replaceAll("\\", "/");
      if (name === "fragment.html" || /^variants\/[^/]+\.html$/i.test(name)) validateGlassDeclaration(filePath);
    }
  }
  for (const filePath of payloadFiles) {
    if (/\.(?:html?|css|svg|m?js|cjs)$/i.test(filePath)) validateLocalReferences(filePath);
    else if (/\.gltf$/i.test(filePath)) validateGltfReferences(filePath);
  }
}

function validateGlassDeclaration(filePath) {
  const source = fs.readFileSync(filePath, "utf8").replace(/<!--[\s\S]*?-->/gu, "");
  const pattern = /<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'))(?=[^>]*\bdata-akari-glass-scene\b)[^>]*>([\s\S]*?)<\/script\s*>/giu;
  const declarations = [...source.matchAll(pattern)];
  if (!declarations.length) fail(`${relativeToAsset(filePath)} に data-akari-glass-scene 宣言が見つかりません`);
  const elements = source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, "");
  if (declarations.length && !/<[a-z][^>]*\sdata-akari-glass(?=\s|=|\/?>)/iu.test(elements)) {
    fail(`${relativeToAsset(filePath)}: 宣言があるのにガラス面が無い`);
  }
  for (const match of declarations) {
    let descriptor;
    try { descriptor = JSON.parse(match[1]); }
    catch (error) { fail(`data-akari-glass-scene の JSON を読めません: ${messageOf(error)}`); continue; }
    if (!isPlainObject(descriptor)) { fail("data-akari-glass-scene は JSON object である必要があります"); continue; }
    if (descriptor.backdrop === undefined) continue;
    const backdrop = descriptor.backdrop;
    if (typeof backdrop !== "string" || !backdrop.trim() || /^[a-z][a-z\d+.-]*:|^[\/\\]/iu.test(backdrop) || backdrop.includes("\\")) {
      fail("data-akari-glass-scene.backdrop は相対パスである必要があります");
      continue;
    }
    validateReference(filePath, backdrop);
  }
}

// data-akari-3d-scene 宣言が model を持たず、かつ非空の texts[] を持つときだけ glb を任意化する
// （overlay-runtime/src/three-runtime.js の readDescriptor と同じ判定。texts[] も model も
// 無い宣言・宣言を読めない場合は従来どおり glb を必須のまま扱う＝安全側デフォルト）。
function requiresGltfModel(fragmentPath) {
  const descriptor = readSceneDeclaration(fragmentPath);
  if (descriptor === null) return true;
  const hasModel = descriptor.model !== undefined;
  const hasNonEmptyTexts = Array.isArray(descriptor.texts) && descriptor.texts.length > 0;
  return hasModel || !hasNonEmptyTexts;
}

function readSceneDeclaration(fragmentPath) {
  let source;
  try {
    source = fs.readFileSync(fragmentPath, "utf8");
  } catch (error) {
    fail(`fragment.html を読めません: ${messageOf(error)}`);
    return null;
  }

  const match = source.match(SCENE_DECLARATION_PATTERN);
  if (!match) {
    fail('fragment.html に <script type="application/json" data-akari-3d-scene> 宣言が見つかりません');
    return null;
  }

  let descriptor;
  try {
    descriptor = JSON.parse(match[1]);
  } catch (error) {
    fail(`data-akari-3d-scene の JSON を読めません: ${messageOf(error)}`);
    return null;
  }

  if (!isPlainObject(descriptor)) {
    fail("data-akari-3d-scene は JSON object である必要があります");
    return null;
  }
  return descriptor;
}

function validatePng(filePath) {
  try {
    const header = fs.readFileSync(filePath).subarray(0, 24);
    if (
      header.length < 24 ||
      header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    ) {
      fail("preview.png は有効な PNG シグネチャを持つ必要があります");
    }
  } catch (error) {
    fail(`preview.png を読めません: ${messageOf(error)}`);
  }
}

function validateLocalReferences(filePath) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`参照元ファイルを読めません: ${relativeToAsset(filePath)}: ${messageOf(error)}`);
    return;
  }

  const references = new Set();
  const patterns = [
    /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi,
    /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /@import\s+["']([^"']+)["']/gi,
    /\bfetch\s*\(\s*["']([^"']+)["']/gi,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']/gi,
    /\.load(?:Async)?\s*\(\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      // new URL(url, base) is a dynamic JS constructor, not CSS url().
      // Limit this correction to glass packs; keep literal CSS and JS loaders checked.
      if (pattern === patterns[1] && meta?.requires?.includes("glass-runtime")
          && /\.(?:m?js|cjs)$/i.test(filePath) && match[0].startsWith("URL(")
          && /\bnew\s*$/u.test(source.slice(0, match.index))) continue;
      references.add(match[1].trim());
    }
  }

  for (const match of source.matchAll(/\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gi)) {
    if (isPathLikeReference(match[1])) references.add(match[1].trim());
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/gi)) {
    if (isPathLikeReference(match[1])) references.add(match[1].trim());
  }
  for (const match of source.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    if (match[1].trim().startsWith("data:")) continue;
    for (const candidate of match[1].split(",")) {
      const reference = candidate.trim().split(/\s+/, 1)[0];
      if (reference) references.add(reference);
    }
  }

  for (const reference of references) validateReference(filePath, reference);
}

function validateGltfReferences(filePath) {
  let gltf;
  try {
    gltf = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${relativeToAsset(filePath)} を glTF JSON として読めません: ${messageOf(error)}`);
    return;
  }

  if (!isPlainObject(gltf)) {
    fail(`${relativeToAsset(filePath)} のルートは object である必要があります`);
    return;
  }

  for (const collectionName of ["buffers", "images"]) {
    const collection = gltf[collectionName];
    if (collection === undefined) continue;
    if (!Array.isArray(collection)) {
      fail(`${relativeToAsset(filePath)}.${collectionName} は配列である必要があります`);
      continue;
    }

    for (const [index, entry] of collection.entries()) {
      if (!isPlainObject(entry)) {
        fail(`${relativeToAsset(filePath)}.${collectionName}[${index}] は object である必要があります`);
        continue;
      }
      if (!hasOwn(entry, "uri")) continue;
      if (typeof entry.uri !== "string" || entry.uri.trim().length === 0) {
        fail(`${relativeToAsset(filePath)}.${collectionName}[${index}].uri は空でない文字列である必要があります`);
        continue;
      }
      validateReference(filePath, entry.uri.trim());
    }
  }
}

function validateReference(sourcePath, reference) {
  if (isExternalReference(reference)) return;

  if (reference.startsWith("file:")) {
    let filePathReference;
    try {
      filePathReference = fileURLToPath(reference);
    } catch {
      fail(`${relativeToAsset(sourcePath)} の file: 参照が不正です: ${reference}`);
      return;
    }
    validateReferenceTarget(sourcePath, reference, filePathReference);
    return;
  }

  const withoutSuffix = reference.split(/[?#]/, 1)[0];
  if (!withoutSuffix) return;

  let decoded;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    fail(`${relativeToAsset(sourcePath)} の参照を URL デコードできません: ${reference}`);
    return;
  }

  validateReferenceTarget(sourcePath, reference, path.resolve(path.dirname(sourcePath), decoded));
}

function validateReferenceTarget(sourcePath, reference, targetPath) {
  const relativeTarget = path.relative(assetDir, targetPath);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    fail(`${relativeToAsset(sourcePath)} が素材ディレクトリ外を参照しています: ${reference}`);
    return;
  }
  if (!isRegularFile(targetPath)) {
    fail(`${relativeToAsset(sourcePath)} の参照ファイルが見つかりません: ${reference}`);
    return;
  }

  try {
    const realAssetDir = fs.realpathSync(assetDir);
    const realTargetPath = fs.realpathSync(targetPath);
    const realRelativeTarget = path.relative(realAssetDir, realTargetPath);
    if (realRelativeTarget.startsWith("..") || path.isAbsolute(realRelativeTarget)) {
      fail(`${relativeToAsset(sourcePath)} が symlink 経由で素材ディレクトリ外を参照しています: ${reference}`);
    }
  } catch (error) {
    fail(`${relativeToAsset(sourcePath)} の参照先を解決できません: ${reference}: ${messageOf(error)}`);
  }
}

function isExternalReference(reference) {
  return (
    !reference ||
    reference.startsWith("#") ||
    reference.startsWith("//") ||
    reference.startsWith("var(") ||
    /^(?:https?|data|blob|mailto|javascript):/i.test(reference)
  );
}

function isPathLikeReference(reference) {
  return /^(?:\.{0,2}\/|file:)/.test(reference);
}

function validateStringArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} は配列である必要があります`);
    return;
  }

  const seen = new Set();
  for (const [index, item] of value.entries()) {
    validateNonEmptyString(item, `${label}[${index}]`);
    if (typeof item === "string") {
      if (seen.has(item)) fail(`${label} に重複があります: ${item}`);
      seen.add(item);
    }
  }
}

function validateNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} は空でない文字列である必要があります`);
  }
}

function listRegularFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listRegularFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function relativeToAsset(filePath) {
  return path.relative(assetDir, filePath) || ".";
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function finish() {
  if (errors.length > 0) {
    console.error(`NG: ${assetDir}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`OK: ${assetDir}`);
  process.exit(0);
}
