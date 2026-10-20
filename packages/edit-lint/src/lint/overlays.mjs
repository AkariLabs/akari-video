import { readFileSync, realpathSync, statSync } from "node:fs";
import { lintText } from '../i18n.mjs';
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { describeFragmentAssetHint, extractFragmentAssetReferences, extractAbsoluteFragmentAssetReferences } from "../../../render-cut/src/fragment-assets.mjs";
import { readFontCodepoints } from "../../../render-cut/src/font-cmap.mjs";
import { collectFragmentCodepoints, fragmentFontFaces } from "../../../render-cut/src/fragment-text.mjs";
import { htmlTags, rawTextElements, stripHtmlComments } from "../../../render-cut/src/html-scan.mjs";
import { validateWorldSceneDeclaration } from "../world-scene-declaration.mjs";
import { resolveLibraryFallback } from "../library-reference.mjs";
import { inspectHtmlFragment, parseHtmlAttributes } from "./html-fragment.mjs";
import { parseOverlayStyles, splitCssTopLevel, missingProperties, normalizeMotionSelector, referencedKeyframeNames, baseHiddenState, endpointClearsHiddenState } from "./overlay-css.mjs";
import { validateFragmentCssCollisions } from "./fragment-css-collision.mjs";
import { validateFragmentBoxSizing } from "./fragment-box-sizing.mjs";
import { EPSILON, addFinding, formatNumber, isFiniteNumber, isNonEmptyString, isPositiveNumber, isRecord, isRegularFile, isRegularFileSync, readRequiredText, relativePath, resolveReferenceBinding } from "./shared.mjs";
import { findTrackOverlaps } from "./cuts-tracks.mjs";

export async function validateOverlays(overlays, timeline, findings, paths) {
  if (!Array.isArray(overlays)) return;
  const ids = new Set();
  const cssUsages = [];
  const boxSizingChecked = new Set();
  for (const [index, overlay] of overlays.entries()) {
    const itemPath = `edit.json#overlays[${index}]`;
    if (!isRecord(overlay)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.structure",
        message: "overlay must be an object",
        path: itemPath,
      });
      continue;
    }
    if (!isNonEmptyString(overlay.id)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.id",
        message: "overlay id must be a non-empty string",
        path: itemPath,
      });
    } else if (ids.has(overlay.id)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.id",
        message: `duplicate overlay id: ${overlay.id}`,
        path: itemPath,
      });
    } else {
      ids.add(overlay.id);
    }

    if (
      Object.hasOwn(overlay, "track") &&
      (!Number.isInteger(overlay.track) || overlay.track < 0)
    ) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.track",
        message: "overlay track must be a non-negative integer when present",
        path: `${itemPath}.track`,
      });
    }

    if (!isFiniteNumber(overlay.start) || overlay.start < 0) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: "overlay start must be a non-negative finite number",
        path: itemPath,
      });
    }
    if (!isPositiveNumber(overlay.duration)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: "overlay duration must be greater than zero",
        path: itemPath,
      });
    }
    if (
      timeline !== null &&
      isFiniteNumber(overlay.start) &&
      isPositiveNumber(overlay.duration) &&
      overlay.start + overlay.duration > timeline + EPSILON
    ) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.timeline",
        message: `overlay ends after timeline duration ${formatNumber(timeline)}s`,
        path: itemPath,
        range: { start: overlay.start, end: overlay.start + overlay.duration },
      });
    }
    if (!isNonEmptyString(overlay.html)) continue;
    const htmlBinding = resolveReferenceBinding(paths.editPath, overlay.html, paths);
    const htmlPath = htmlBinding.path;
    const isHtmlFile = await isRegularFile(htmlPath);
    // overlay.html は file 参照（相対パス）とインライン HTML の両方をとりうる。参照でなければ
    // フィールドの値そのものを断片本文として扱う（inspectHtmlFragment 以降のルート要素検証は
    // 既存どおり file 参照限定のまま — 挙動変更を避ける）。
    const html = isHtmlFile ? await readRequiredText(htmlPath, overlay.html) : overlay.html;
    cssUsages.push({
      clipId: isNonEmptyString(overlay.id) ? overlay.id : itemPath,
      html,
      label: isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      identity: isHtmlFile ? realpathSync(htmlPath) : `inline:${html}`,
      start: overlay.start,
      duration: overlay.duration,
    });
    const fragmentLabel = isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`;
    const fragmentIdentity = isHtmlFile ? realpathSync(htmlPath) : `inline:${html}`;
    if (!boxSizingChecked.has(fragmentIdentity)) {
      boxSizingChecked.add(fragmentIdentity);
      validateFragmentBoxSizing(html, fragmentLabel, findings);
    }
    validateOverlayReservedCssVarReferences(
      html,
      isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      findings,
    );
    validateOverlayMotionRules(
      html,
      isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      findings,
    );
    for (const finding of validateWorldSceneDeclaration(html, await readFile(join(paths.projectRoot, "planning/world-map.json"), "utf8").catch(error => error?.code === "ENOENT" ? null : Promise.reject(error)), isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`)) addFinding(findings, finding);
    validateThreeCanvas(
      html,
      isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      findings,
      {
        projectRoot: paths.projectRoot,
        fragmentPath: isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : null,
      },
    );
    validateThreeTextFlags(html, isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`, findings);
    if (isHtmlFile) {
      validateOverlayFragmentAssets(html, overlay, paths, findings);
      runOverlayFragmentFontGlyphCheck(html, overlay, paths, findings);
    }
    // 単一ルート違反は 3D の threeRuntime が初期化時に落ちるが、lint は書き出し前に
    // 静的に検出する。file 参照だけでなく inline の html item（3D に限らない）も対象にする。
    // ただし未取得の file 参照（パス文字列）を inline HTML と誤認しないよう、markup を含む
    // 値だけを断片として検査する。
    const fragment = isHtmlFile || /<[A-Za-z!/]/u.test(html) ? inspectHtmlFragment(html) : null;
    if (fragment && (fragment.rootCount !== 1 || fragment.hasTopLevelText || fragment.unbalanced)) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.html-root",
        message: "overlay HTML must contain exactly one balanced root element",
        path: isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`,
      });
      continue;
    }
    if (!isHtmlFile) continue;
    // ランタイムは edit.json から作る外側コンテナの時刻だけを使う。
    // 旧ライブラリ断片をプロジェクトへ写した場合も、ルートの時刻は案内だけにする。
    const libraryFragment = htmlBinding.scope === "library";
    if (
      !libraryFragment
      && (Object.hasOwn(fragment.rootAttributes, "data-start")
        || Object.hasOwn(fragment.rootAttributes, "data-duration"))
    ) {
      addFinding(findings, {
        severity: "warning",
        check: "overlays.root-data-attributes",
        message: lintText('lint-messages.overlays.root.attributes'),
        path: relativePath(paths.projectRoot, htmlPath),
      });
    }
    // テキスト分割断片の CSS animation は [data-akari-active] ゲートの中で宣言する
    // （skills/author-overlay/telop.md「テキスト分割と stagger 規約」）。
    // getAnimations() のコストはドキュメント全体の animation 総数に比例するため、
    // ゲート無しの断片が 1 つでも混ざると全体の tick が落ちる。分割はその危険を
    // 分割数ぶんに増幅する（実測: 1,200 断片 × 8 分割 = 9,600 本で 221ms/tick。
    // テロップの動きの文法の契約（2026-08-15）§6）。
    if (/\bdata-akari-split\s*=/.test(html) && /(^|[^-\w])animation\s*:/.test(html)) {
      const gated = /\[data-akari-active\][^{}]*\.[^{}]*\{[^{}]*animation\s*:/.test(html);
      if (!gated) {
        addFinding(findings, {
          severity: "error",
          check: "overlays.split-animation-gate",
          message:
            "text-split fragment must declare animations under a [data-akari-active] selector",
          path: relativePath(paths.projectRoot, htmlPath),
        });
      }
    }

  }
  validateFragmentCssCollisions(cssUsages, findings);
}

// camera.keys（宣言的カメラキーフレーム）の宣言検査。three-runtime.js の validateCameraKeys と
// 同じ規則を、ランタイムを起動せずに lint でも読めるようにしたもの。並べ替えはしない。
const THREE_CAMERA_KEY_EASES = new Set(["linear", "easeInOut"]);
const THREE_CAMERA_KEY_FIELDS = new Set(["t", "position", "lookAt", "ease"]);

function threeCameraVectorProblem(value, field) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    return `${field} must be an array of 3 finite numbers.`;
  }
  return null;
}

function threeCameraKeysProblem(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return "data-akari-3d-scene.camera.keys must be a non-empty array.";
  }
  for (const [index, entry] of keys.entries()) {
    const field = `data-akari-3d-scene.camera.keys[${index}]`;
    if (!isRecord(entry)) return `${field} must be an object.`;
    const unknown = Object.keys(entry).find(name => !THREE_CAMERA_KEY_FIELDS.has(name));
    if (unknown) return `${field} has an unknown field: ${unknown}.`;
    if (!isFiniteNumber(entry.t)) return `${field}.t must be a finite number.`;
    const positionProblem = threeCameraVectorProblem(entry.position, `${field}.position`);
    if (positionProblem) return positionProblem;
    const lookAtProblem = threeCameraVectorProblem(entry.lookAt, `${field}.lookAt`);
    if (lookAtProblem) return lookAtProblem;
    if (entry.ease !== undefined && !THREE_CAMERA_KEY_EASES.has(entry.ease)) {
      return `${field}.ease must be "linear" or "easeInOut".`;
    }
    if (index > 0 && entry.t <= keys[index - 1].t) {
      return `data-akari-3d-scene.camera.keys must be ordered by ascending t:`
        + ` keys[${index}].t=${entry.t} is not greater than keys[${index - 1}].t=${keys[index - 1].t}`
        + " (keys are not sorted automatically; reorder them or fix t).";
    }
  }
  return null;
}

function validateThreeCameraKeys(source, path, findings) {
  for (const block of rawTextElements(source, "script")) {
    const attributes = parseHtmlAttributes(source.slice(block.start, block.bodyStart));
    if (attributes.type?.toLowerCase() !== "application/json"
      || !Object.hasOwn(attributes, "data-akari-3d-scene")) continue;
    let descriptor;
    try {
      descriptor = JSON.parse(source.slice(block.bodyStart, block.bodyEnd));
    } catch {
      // 壊れた JSON 自体は別の検査の担当。ここでは camera.keys だけを見る
      continue;
    }
    const camera = descriptor?.camera;
    if (!isRecord(camera) || camera.keys === undefined) continue;
    const problem = threeCameraKeysProblem(camera.keys);
    if (problem) addFinding(findings, {
      severity: "error", check: "overlays.three-camera-keys", message: problem, path,
    });
  }
}

function validateThreeCanvas(html, path, findings, context = {}) {
  const source = stripHtmlComments(html);
  const raw = [
    ...rawTextElements(source, "script"),
    ...rawTextElements(source, "style"),
  ].sort((left, right) => left.start - right.start);
  let rawIndex = 0;
  let scene = false;
  let marked = 0;
  let invalidMarked = false;
  let canvases = 0;
  for (const tag of htmlTags(source)) {
    while (rawIndex < raw.length && tag.start >= raw[rawIndex].end) rawIndex += 1;
    const block = raw[rawIndex];
    if (block && tag.start > block.start && tag.start < block.end) continue;
    const match = /^<([a-z][\w:-]*)\b/iu.exec(tag.text);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const attributes = parseHtmlAttributes(tag.text);
    if (name === "script" && Object.hasOwn(attributes, "data-akari-3d-scene")
      && attributes.type?.toLowerCase() === "application/json") scene = true;
    if (name === "canvas") canvases += 1;
    if (Object.hasOwn(attributes, "data-akari-3d-canvas")) {
      marked += 1;
      if (name !== "canvas") invalidMarked = true;
    }
  }
  if (!scene) return;
  validateThreeCameraKeys(source, path, findings);
  validateThreeRenderer(source, path, findings);
  validateThreeTerrain(source, path, findings, context);
  validateThreeLines(source, path, findings);
  if (marked > 1) addFinding(findings, {
    severity: "error", check: "overlays.three-canvas",
    message: `data-akari-3d-canvas must appear on at most one element (found ${marked}).`, path,
  });
  if (invalidMarked) addFinding(findings, {
    severity: "error", check: "overlays.three-canvas",
    message: "data-akari-3d-canvas must be attached to a <canvas> element.", path,
  });
  if (marked === 0 && canvases > 1) addFinding(findings, {
    severity: "warning", check: "overlays.three-canvas",
    message: "3D renders to the first canvas in document order; add data-akari-3d-canvas to the intended canvas.", path,
  });
}

// texts[].billboard / screenSpace は真偽値のみ（省略時は false）。型違いはランタイムが
// 宣言ごと初期化エラーにするため、同じ規則を lint でも前倒しして場所を名指しする。
// JSON が壊れている場合はここでは触らない（ランタイムのエラーが本文を持つ）
function validateThreeTextFlags(html, path, findings) {
  const source = stripHtmlComments(html);
  for (const block of rawTextElements(source, "script")) {
    const attributes = parseHtmlAttributes(source.slice(block.start, block.bodyStart));
    if (!Object.hasOwn(attributes, "data-akari-3d-scene")
      || attributes.type?.toLowerCase() !== "application/json") continue;
    let descriptor;
    try {
      descriptor = JSON.parse(source.slice(block.bodyStart, block.bodyEnd));
    } catch {
      continue;
    }
    if (!isRecord(descriptor) || !Array.isArray(descriptor.texts)) continue;
    for (const [index, entry] of descriptor.texts.entries()) {
      if (!isRecord(entry)) continue;
      const label = isNonEmptyString(entry.id) ? entry.id : String(index);
      for (const field of ["billboard", "screenSpace"]) {
        if (entry[field] === undefined || typeof entry[field] === "boolean") continue;
        addFinding(findings, {
          severity: "error", check: "overlays.three-text-flags",
          message: `texts[${label}].${field} must be a boolean.`, path,
        });
      }
    }
  }
}

// data-akari-3d-scene.renderer は "webgl" | "webgpu" のみ（省略 = "webgl"）。
// 未知の値は three-runtime.js が初期化エラーにするため、同じ規則を lint でも前倒しする。
const THREE_SCENE_RENDERERS = new Set(["webgl", "webgpu"]);
function validateThreeRenderer(html, path, findings) {
  const source = stripHtmlComments(html);
  for (const block of rawTextElements(source, "script")) {
    const attributes = parseHtmlAttributes(source.slice(block.start, block.bodyStart));
    if (!Object.hasOwn(attributes, "data-akari-3d-scene")
      || attributes.type?.toLowerCase() !== "application/json") continue;
    let descriptor;
    try {
      descriptor = JSON.parse(source.slice(block.bodyStart, block.bodyEnd));
    } catch {
      continue;
    }
    if (!isRecord(descriptor) || descriptor.renderer === undefined) continue;
    if (typeof descriptor.renderer === "string" && THREE_SCENE_RENDERERS.has(descriptor.renderer)) continue;
    addFinding(findings, {
      severity: "error", check: "overlays.three-renderer",
      message: 'data-akari-3d-scene.renderer must be "webgl" or "webgpu".', path,
    });
  }
}

// terrain / lines（task 2026-10-21-scene3d-terrain-lines）の宣言検査。
// three-runtime.js の validateTerrain / validateLines と同じ規則を、書き出し前に読める形にする。
const THREE_TERRAIN_ENCODINGS = new Set(["grayscale", "gsi-dem"]);
const THREE_TERRAIN_FIELDS = new Set([
  "heightmap", "texture", "encoding", "exaggeration", "size", "segments",
]);
const THREE_TERRAIN_MIN_EXAGGERATION = 0.01;
const THREE_TERRAIN_MAX_EXAGGERATION = 100;
const THREE_TERRAIN_MAX_SEGMENTS = 512;
const THREE_LINE_FIELDS = new Set(["points", "color", "width", "progress", "keys"]);
const THREE_LINE_KEY_FIELDS = new Set(["t", "progress", "ease"]);
const THREE_LINE_MAX_WIDTH = 64;
const THREE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const THREE_TEXTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function forEachThreeDescriptor(source, visit) {
  for (const block of rawTextElements(source, "script")) {
    const attributes = parseHtmlAttributes(source.slice(block.start, block.bodyStart));
    if (!Object.hasOwn(attributes, "data-akari-3d-scene")
      || attributes.type?.toLowerCase() !== "application/json") continue;
    let descriptor;
    try {
      descriptor = JSON.parse(source.slice(block.bodyStart, block.bodyEnd));
    } catch {
      continue;
    }
    if (isRecord(descriptor)) visit(descriptor);
  }
}

function threeReferenceProblem(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    return `${field} must be a non-empty relative path.`;
  }
  if (/^data:/iu.test(value)) return null;
  if (isAbsolute(value) || /^[a-z][a-z\d+.-]*:/iu.test(value) || value.includes("\\")) {
    return `${field} must be a relative path inside the project.`;
  }
  return null;
}

function threeReferenceFile(value, context) {
  const root = realpathSync(context.projectRoot);
  const candidates = [];
  if (context.fragmentPath) {
    candidates.push(resolve(root, dirname(context.fragmentPath), value));
  }
  candidates.push(resolve(root, value));
  for (const candidate of candidates) {
    const local = relative(root, candidate).replaceAll("\\", "/");
    if (local === ".." || local.startsWith("../") || isAbsolute(local)) continue;
    if (isRegularFileSync(candidate)) return candidate;
  }
  return null;
}

function threeHeightmapProblem(value, context) {
  const referenceProblem = threeReferenceProblem(value, "data-akari-3d-scene.terrain.heightmap");
  if (referenceProblem) return referenceProblem;
  if (/^data:/iu.test(value)) {
    return /^data:image\/png[;,]/iu.test(value)
      ? null
      : "data-akari-3d-scene.terrain.heightmap must be a PNG image.";
  }
  if (extname(value).toLowerCase() !== ".png") {
    return "data-akari-3d-scene.terrain.heightmap must be a .png file.";
  }
  const file = threeReferenceFile(value, context);
  if (!file) {
    return `data-akari-3d-scene.terrain.heightmap does not exist: ${value}.`;
  }
  let header;
  try {
    const contents = readFileSync(file);
    header = contents.subarray(0, 24);
    if (contents.length < 24) return `data-akari-3d-scene.terrain.heightmap is not a readable PNG: ${value}.`;
  } catch {
    return `data-akari-3d-scene.terrain.heightmap cannot be read: ${value}.`;
  }
  if (!header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString("ascii", 12, 16) !== "IHDR") {
    return `data-akari-3d-scene.terrain.heightmap is not a PNG file: ${value}.`;
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (!(width > 0) || !(height > 0)) {
    return `data-akari-3d-scene.terrain.heightmap has no image dimensions: ${value}.`;
  }
  return null;
}

function threeTextureProblem(value, context) {
  const referenceProblem = threeReferenceProblem(value, "data-akari-3d-scene.terrain.texture");
  if (referenceProblem) return referenceProblem;
  if (/^data:/iu.test(value)) {
    return /^data:image\//iu.test(value)
      ? null
      : "data-akari-3d-scene.terrain.texture must be an image.";
  }
  if (!THREE_TEXTURE_EXTENSIONS.has(extname(value).toLowerCase())) {
    return "data-akari-3d-scene.terrain.texture must be a .png, .jpg, .jpeg, .webp, .gif, .avif, or .bmp file.";
  }
  if (!threeReferenceFile(value, context)) {
    return `data-akari-3d-scene.terrain.texture does not exist: ${value}.`;
  }
  return null;
}

function threeTerrainProblems(terrain, context) {
  if (!isRecord(terrain)) return ["data-akari-3d-scene.terrain must be an object."];
  const problems = [];
  for (const key of Object.keys(terrain)) {
    if (!THREE_TERRAIN_FIELDS.has(key)) {
      problems.push(`data-akari-3d-scene.terrain has an unknown field: ${key}.`);
    }
  }
  const heightmapProblem = threeHeightmapProblem(terrain.heightmap, context);
  if (heightmapProblem) problems.push(heightmapProblem);
  if (terrain.encoding !== undefined && !THREE_TERRAIN_ENCODINGS.has(terrain.encoding)) {
    problems.push('data-akari-3d-scene.terrain.encoding must be "grayscale" or "gsi-dem".');
  }
  if (terrain.texture !== undefined) {
    const textureProblem = threeTextureProblem(terrain.texture, context);
    if (textureProblem) problems.push(textureProblem);
  }
  if (terrain.exaggeration !== undefined) {
    if (!isFiniteNumber(terrain.exaggeration)
      || terrain.exaggeration < THREE_TERRAIN_MIN_EXAGGERATION
      || terrain.exaggeration > THREE_TERRAIN_MAX_EXAGGERATION) {
      problems.push(
        `data-akari-3d-scene.terrain.exaggeration must be a number from`
        + ` ${THREE_TERRAIN_MIN_EXAGGERATION} to ${THREE_TERRAIN_MAX_EXAGGERATION}.`
      );
    }
  }
  if (terrain.size !== undefined) {
    if (!Array.isArray(terrain.size)
      || terrain.size.length !== 2
      || !terrain.size.every(value => isFiniteNumber(value) && value > 0)) {
      problems.push(
        "data-akari-3d-scene.terrain.size must be an array of 2 positive finite numbers [width, depth]."
      );
    }
  }
  if (terrain.segments !== undefined) {
    if (!Number.isInteger(terrain.segments)
      || terrain.segments < 1
      || terrain.segments > THREE_TERRAIN_MAX_SEGMENTS) {
      problems.push(
        `data-akari-3d-scene.terrain.segments must be an integer from 1 to ${THREE_TERRAIN_MAX_SEGMENTS}.`
      );
    }
  }
  return problems;
}

function threeLineKeysProblems(keys, field) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return [`${field} must be a non-empty array.`];
  }
  const problems = [];
  for (const [index, entry] of keys.entries()) {
    const label = `${field}[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${label} must be an object.`);
      continue;
    }
    const unknown = Object.keys(entry).find(name => !THREE_LINE_KEY_FIELDS.has(name));
    if (unknown) problems.push(`${label} has an unknown field: ${unknown}.`);
    if (!isFiniteNumber(entry.t)) problems.push(`${label}.t must be a finite number.`);
    if (!isFiniteNumber(entry.progress) || entry.progress < 0 || entry.progress > 1) {
      problems.push(`${label}.progress must be a number from 0 to 1.`);
    }
    if (entry.ease !== undefined && entry.ease !== "linear" && entry.ease !== "easeInOut") {
      problems.push(`${label}.ease must be "linear" or "easeInOut".`);
    }
    if (index > 0 && isFiniteNumber(entry.t) && isFiniteNumber(keys[index - 1]?.t)
      && entry.t <= keys[index - 1].t) {
      problems.push(
        `${field} must be ordered by ascending t:`
        + ` keys[${index}].t=${entry.t} is not greater than keys[${index - 1}].t=${keys[index - 1].t}`
        + " (keys are not sorted automatically; reorder them or fix t)."
      );
    }
  }
  return problems;
}

function threeLinesProblems(lines) {
  if (!Array.isArray(lines)) return ["data-akari-3d-scene.lines must be an array."];
  const problems = [];
  for (const [index, entry] of lines.entries()) {
    const field = `data-akari-3d-scene.lines[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${field} must be an object.`);
      continue;
    }
    const unknown = Object.keys(entry).find(name => !THREE_LINE_FIELDS.has(name));
    if (unknown) problems.push(`${field} has an unknown field: ${unknown}.`);
    if (!Array.isArray(entry.points) || entry.points.length < 2) {
      problems.push(`${field}.points must be an array of at least 2 points.`);
    } else {
      for (const [pointIndex, point] of entry.points.entries()) {
        if (!Array.isArray(point) || point.length !== 3 || !point.every(isFiniteNumber)) {
          problems.push(`${field}.points[${pointIndex}] must be an array of 3 finite numbers [x, y, z].`);
        }
      }
    }
    if (entry.color !== undefined
      && (typeof entry.color !== "string" || !THREE_COLOR_PATTERN.test(entry.color))) {
      problems.push(`${field}.color must be a 6-digit hex color.`);
    }
    if (entry.width !== undefined
      && (!isFiniteNumber(entry.width) || entry.width <= 0 || entry.width > THREE_LINE_MAX_WIDTH)) {
      problems.push(`${field}.width must be a number greater than 0 and at most ${THREE_LINE_MAX_WIDTH}.`);
    }
    if (entry.progress !== undefined
      && (!isFiniteNumber(entry.progress) || entry.progress < 0 || entry.progress > 1)) {
      problems.push(`${field}.progress must be a number from 0 to 1.`);
    }
    if (entry.keys !== undefined) {
      problems.push(...threeLineKeysProblems(entry.keys, `${field}.keys`));
    }
  }
  return problems;
}

function validateThreeTerrain(source, path, findings, context) {
  forEachThreeDescriptor(source, descriptor => {
    if (descriptor.terrain === undefined) return;
    for (const problem of threeTerrainProblems(descriptor.terrain, context)) {
      addFinding(findings, {
        severity: "error", check: "overlays.three-terrain", message: problem, path,
      });
    }
  });
}

function validateThreeLines(source, path, findings) {
  forEachThreeDescriptor(source, descriptor => {
    if (descriptor.lines === undefined) return;
    for (const problem of threeLinesProblems(descriptor.lines)) {
      addFinding(findings, {
        severity: "error", check: "overlays.three-lines", message: problem, path,
      });
    }
  });
}

function validateOverlayFragmentAssets(html, overlay, paths, findings) {
  if (overlay.html.trimStart().startsWith("<")) return;
  const root = realpathSync(paths.projectRoot);
  const outside = target => {
    const local = relative(root, target).replaceAll("\\", "/");
    return local === ".." || local.startsWith("../") || isAbsolute(local);
  };
  const finding = (reference, check, detail) => addFinding(findings, {
    severity: "error", check: `overlay-fragment-asset-${check}`,
    message: lintText('lint-messages.overlays.fragment.assetReference', { id: overlay.id, html: overlay.html, reference: reference.raw, separator: check === "missing" ? " " : ": ", detail }),
    path: relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html)),
  });
  for (const reference of extractAbsoluteFragmentAssetReferences(html, overlay.html)) {
    finding(reference, "absolute-path", lintText('lint-messages.overlays.fragment.relativePath'));
  }
  for (const reference of extractFragmentAssetReferences(html, overlay.html, overlay.id)) {
    const target = resolve(root, reference.path);
    let actual = target;
    try { actual = realpathSync(target); } catch { /* Missing files are checked below. */ }
    if (outside(target) || outside(actual)) {
      finding(reference, "escapes-project", "escapes the project root");
      continue;
    }
    if (isRegularFileSync(target)) continue;
    const fallback = resolveLibraryFallback({
      projectRoot: paths.projectRoot, declaredPath: reference.path,
      references: paths.assetReferences, libraryRoots: paths.libraryRoots,
    });
    if (fallback.path !== null) continue;
    finding(reference, "missing", lintText('lint-messages.overlays.fragment.missing') + describeFragmentAssetHint({
      projectRoot: paths.projectRoot, htmlPath: overlay.html, ...reference,
    }));
  }
}

const fontCmapCache = new Map();

export function runOverlayFragmentFontGlyphCheck(html, overlay, paths, findings, check = validateOverlayFragmentFontGlyphs) {
  const before = findings.length;
  try { check(html, overlay, paths, findings); }
  catch (error) {
    findings.splice(before);
    const name = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]*$/u.test(error.name)
      ? error.name : "Error";
    addFinding(findings, {
      severity: "info", check: "overlays.fragment-font-glyphs",
      message: lintText('lint-messages.overlays.fragment.glyphSkipped', { id: overlay.id, html: overlay.html, name }),
      path: relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html)),
    });
  }
}

function validateOverlayFragmentFontGlyphs(html, overlay, paths, findings) {
  const faces = fragmentFontFaces(html, overlay.html);
  if (faces.length === 0) return;
  const fragmentPath = relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html));
  const context = `overlay:${overlay.id} fragment ${overlay.html}`;
  const add = (severity, message) => addFinding(findings, {
    severity, check: "overlays.fragment-font-glyphs", message: `${context}: ${message}`, path: fragmentPath,
  });
  const { codepoints, hasDynamicScript } = collectFragmentCodepoints(html, {
    params: overlay.params, vars: overlay.vars, mode: "render",
  });
  let rootTag;
  for (const tag of htmlTags(stripHtmlComments(html))) {
    if (/^<[a-z]/iu.test(tag.text)) { rootTag = tag; break; }
  }
  const hasDeclaredChars = rootTag && Object.hasOwn(parseHtmlAttributes(rootTag.text), "data-akari-font-chars");
  if (hasDynamicScript && !hasDeclaredChars) {
    add("info", lintText('lint-messages.overlays.font.scriptChars'));
  }
  const fontSets = [];
  const fontPaths = [];
  const seenSources = new Set();
  let unreadable = false;
  for (const face of faces) if (face.sources.length === 0) {
    unreadable = true;
    add("info", lintText('lint-messages.overlays.font.faceUnreadable', { family: face.family || lintText('lint-messages.overlays.font.unnamed') }));
  }
  const root = realpathSync(paths.projectRoot);
  const outside = target => {
    const local = relative(root, target).replaceAll("\\", "/");
    return local === ".." || local.startsWith("../") || isAbsolute(local);
  };
  for (const face of faces) for (const source of face.sources) {
    const sourceKey = source.data ?? source.path;
    if (seenSources.has(sourceKey)) continue;
    seenSources.add(sourceKey);
    let result;
    let label;
    if (source.data) {
      label = "data:…";
      try {
        const comma = source.data.indexOf(",");
        if (comma < 0) throw Error("invalid data URI");
        const header = source.data.slice(0, comma);
        const bytes = /;base64$/iu.test(header)
          ? Buffer.from(source.data.slice(comma + 1), "base64")
          : Buffer.from(decodeURIComponent(source.data.slice(comma + 1)), "latin1");
        result = readFontCodepoints(bytes);
      } catch { result = { ok: false }; }
    } else {
      label = source.path;
      const target = resolve(root, source.path);
      if (outside(target)) {
        unreadable = true;
        fontPaths.push(label);
        add("info", lintText('lint-messages.overlays.font.outsideProject', { label }));
        continue;
      }
      const binding = resolveReferenceBinding(paths.editPath, source.path, paths);
      try {
        const real = realpathSync(binding.path);
        if (binding.scope !== "library" && outside(real)) {
          unreadable = true;
          fontPaths.push(label);
          add("info", lintText('lint-messages.overlays.font.outsideProject', { label }));
          continue;
        }
        const stat = statSync(real);
        if (!stat.isFile()) throw Error("not a file");
        const cached = fontCmapCache.get(real);
        if (cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs) result = cached.result;
        else {
          result = readFontCodepoints(real);
          fontCmapCache.set(real, { size: stat.size, mtimeMs: stat.mtimeMs, result });
        }
      } catch (error) { result = { ok: false, missing: error?.code === "ENOENT" }; }
    }
    fontPaths.push(label);
    if (!result.ok) {
      unreadable = true;
      add("info", lintText('lint-messages.overlays.font.unavailable', { label, reason: result.missing ? lintText('lint-messages.overlays.font.notFound') : lintText('lint-messages.overlays.font.unreadable') }));
      continue;
    }
    fontSets.push(result.codepoints);
  }
  if (fontSets.length === 0 || unreadable) return;
  const missing = [...codepoints].filter(cp => !fontSets.some(points => points.has(cp))).sort((a, b) => a - b);
  if (missing.length) {
    const sample = missing.slice(0, 20).map(cp => `${String.fromCodePoint(cp)}(U+${cp.toString(16).toUpperCase().padStart(4, "0")})`).join(" ");
    add("warning", lintText('lint-messages.overlays.font.glyphsMissing', { fonts: fontPaths.join(", "), count: missing.length, n: missing.length, sample }));
  }
}

// --x/--y/--scale/--rotate はランタイム予約変数（renderOverlayNode が
// .akari-overlay-container へ必ずインライン設定する。packages/render-cut/src/rasterize.mjs）。
// 断片が var(--x, 80px) のように参照すると、フォールバックではなくランタイムが設定した
// 継承値へ解決される（実機バグ報告 overlay-css-var-collision、2026-08-17）。エラーにはしない —
// ランタイムが設定した値を意図的に読む正当用途があり得るため警告に留める。
const RESERVED_OVERLAY_VARS = ["--x", "--y", "--scale", "--rotate"];

// 前方一致誤検知（--xanadu 等）を避けるため、予約名の直後が CSS カスタムプロパティ名の
// 継続文字（英数字・アンダースコア・ハイフン）でないことを確認する。
function findReservedOverlayVarReferences(html) {
  const found = [];
  for (const name of RESERVED_OVERLAY_VARS) {
    const pattern = new RegExp(`var\\(\\s*${name}(?![A-Za-z0-9_-])`);
    if (pattern.test(html)) found.push(name);
  }
  return found;
}

function validateOverlayReservedCssVarReferences(html, path, findings) {
  if (!isNonEmptyString(html)) return;
  for (const name of findReservedOverlayVarReferences(html)) {
    addFinding(findings, {
      severity: "warning",
      check: "overlays.reserved-css-var-reference",
      message:
        `overlay fragment references var(${name}, ...) -- ${name} is a runtime-reserved variable that `
          + "renderOverlayNode always sets inline on the container (packages/render-cut/src/rasterize.mjs), "
          + "so the fallback never applies and it resolves to the runtime's inherited value instead "
          + `(bug report: overlay-css-var-collision, 2026-08-17). Use a non-reserved name for custom knobs `
          + "(e.g. --block-left).",
      path,
    });
  }
}

function validateOverlayMotionRules(html, path, findings) {
  if (!isNonEmptyString(html)) return;
  const parsed = parseOverlayStyles(html);

  for (const keyframes of parsed.keyframes.values()) {
    if (keyframes.steps.size < 2) continue;
    const properties = new Set();
    for (const declarations of keyframes.steps.values()) {
      for (const property of declarations.keys()) properties.add(property);
    }
    if (properties.size === 0) continue;
    const missingAtStart = missingProperties(properties, keyframes.steps.get(0));
    const missingAtEnd = missingProperties(properties, keyframes.steps.get(100));
    if (missingAtStart.length === 0 && missingAtEnd.length === 0) continue;
    const details = [
      ...(missingAtStart.length > 0 ? [`0% missing ${missingAtStart.join(", ")}`] : []),
      ...(missingAtEnd.length > 0 ? [`100% missing ${missingAtEnd.join(", ")}`] : []),
    ].join("; ");
    addFinding(findings, {
      severity: "warning",
      check: "overlays.keyframes-sparse",
      message: `@keyframes ${keyframes.name} has sparse endpoint declarations (${details}); declare every animated property at both endpoints.`,
      path,
    });
  }

  const rulesBySelector = new Map();
  for (const rule of parsed.rules) {
    const selectors = splitCssTopLevel(rule.selector, ",");
    if (selectors === null) continue;
    for (const selector of selectors) {
      const normalized = normalizeMotionSelector(selector);
      if (normalized === null) continue;
      const group = rulesBySelector.get(normalized.selector) ?? {
        selector: normalized.selector,
        baseDeclarations: new Map(),
        rules: [],
      };
      group.rules.push(rule.declarations);
      if (!normalized.gated) {
        for (const [property, value] of rule.declarations) {
          group.baseDeclarations.set(property, value);
        }
      }
      rulesBySelector.set(normalized.selector, group);
    }
  }

  for (const group of rulesBySelector.values()) {
    const animationNames = new Set();
    for (const declarations of group.rules) {
      for (const name of referencedKeyframeNames(declarations, parsed.keyframes)) {
        animationNames.add(name);
      }
    }
    if (animationNames.size === 0) continue;

    const hiddenState = baseHiddenState(group.baseDeclarations);
    const visibleAnimations = [...animationNames].filter((name) => {
      const endpoint = parsed.keyframes.get(name)?.steps.get(100);
      return endpoint !== undefined && endpointClearsHiddenState(endpoint, hiddenState);
    });
    if (hiddenState !== null && visibleAnimations.length > 0) {
      addFinding(findings, {
        severity: "warning",
        check: "overlays.base-hidden-state",
        message: `Selector ${JSON.stringify(group.selector)} has a hidden base state but animation ${JSON.stringify(visibleAnimations[0])} ends visible; make the base the final resting state and put the hidden state only in the 0% keyframe.`,
        path,
      });
    }

    const preserves3d = group.rules.some(
      (declarations) => declarations.get("transform-style")?.trim().toLowerCase() === "preserve-3d",
    );
    if (!preserves3d) continue;
    const opacityAnimations = [...animationNames].filter((name) => {
      const keyframes = parsed.keyframes.get(name);
      return keyframes !== undefined
        && [...keyframes.steps.values()].some((declarations) => declarations.has("opacity"));
    });
    if (opacityAnimations.length > 0) {
      addFinding(findings, {
        severity: "warning",
        check: "overlays.preserve-3d-opacity-animation",
        message: `Selector ${JSON.stringify(group.selector)} combines transform-style: preserve-3d with opacity animation ${JSON.stringify(opacityAnimations[0])}; Blink flattens transform-style while opacity is animated, so move opacity to a parent and keep the preserve-3d element dedicated to transforms.`,
        path,
      });
    }
  }
}

// 2026-08-07 オーナー裁定・確定: overlays[].role==="background"
// は「動かせない・必ずフレームを埋める」種別で、取りうる状態のほぼ全部が正しくなければならない。
// host（preview-server の app.js / shell の overlay-runtime.js の mount・render-cut の
// rasterize.mjs の renderOverlayNode）は role==="background" のとき --x/--y/--scale/--rotate を
// 無条件で恒等値へロックするため実害は出ないが、死んだ／誤解を招くデータ（動かないのに
// transform を持つ・vars 経由の抜け道・重なった区間）を保存させない最後の砦として、
// JSON Schema では表現できない 3 条件（vars の自由形・区間の重なりは兄弟要素比較）をここで弾く。
const BACKGROUND_LOCKED_VARS = new Set(["--x", "--y", "--scale", "--rotate"]);

export function validateOverlayBackgroundRole(overlays, findings) {
  if (!Array.isArray(overlays)) return;
  const segments = [];
  overlays.forEach((overlay, index) => {
    if (!isRecord(overlay) || !Object.hasOwn(overlay, "role")) return;
    const path = `edit.json#overlays[${index}]`;

    if (overlay.role !== "background") {
      addFinding(findings, {
        severity: "error",
        check: "overlays.role",
        message: 'overlay role must be "background" when present',
        path: `${path}.role`,
      });
      return;
    }

    if (Object.hasOwn(overlay, "transform")) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.role.transform",
        message: "background overlay must not declare transform (position is locked to the output frame)",
        path: `${path}.transform`,
      });
    }

    if (isRecord(overlay.vars)) {
      for (const key of Object.keys(overlay.vars)) {
        if (BACKGROUND_LOCKED_VARS.has(key)) {
          addFinding(findings, {
            severity: "error",
            check: "overlays.role.vars",
            message: `background overlay must not override ${key} via vars (would move the background off the output frame)`,
            path: `${path}.vars`,
          });
        }
      }
    }

    if (isFiniteNumber(overlay.start) && isPositiveNumber(overlay.duration)) {
      // 背景は「今どの場面か」を表す 1 枚地の差し替え物なので、track の値に関係なく
      // 同時に 2 枚以上表示できてはいけない（cuts.track-overlap と同じ error 重大度）。
      segments.push({
        index,
        track: "background",
        start: overlay.start,
        end: overlay.start + overlay.duration,
      });
    }
  });

  for (const segment of findTrackOverlaps(segments)) {
    addFinding(findings, {
      severity: "error",
      check: "overlays.role.overlap",
      message: "background overlay overlaps another background overlay (only one background may be visible at a time)",
      path: `edit.json#overlays[${segment.index}]`,
      range: { start: segment.start, end: segment.end },
    });
  }
}
