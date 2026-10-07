import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { describeFragmentAssetHint, extractFragmentAssetReferences, extractAbsoluteFragmentAssetReferences } from "../../../render-cut/src/fragment-assets.mjs";
import { readFontCodepoints } from "../../../render-cut/src/font-cmap.mjs";
import { collectFragmentCodepoints, fragmentFontFaces } from "../../../render-cut/src/fragment-text.mjs";
import { htmlTags, rawTextElements, stripHtmlComments } from "../../../render-cut/src/html-scan.mjs";
import { validateWorldSceneDeclaration } from "../world-scene-declaration.mjs";
import { resolveLibraryFallback } from "../library-reference.mjs";
import { inspectHtmlFragment, parseHtmlAttributes } from "./html-fragment.mjs";
import { parseOverlayStyles, splitCssTopLevel, missingProperties, normalizeMotionSelector, referencedKeyframeNames, baseHiddenState, endpointClearsHiddenState } from "./overlay-css.mjs";
import { EPSILON, addFinding, formatNumber, isFiniteNumber, isNonEmptyString, isPositiveNumber, isRecord, isRegularFile, isRegularFileSync, readRequiredText, relativePath, resolveReferenceBinding } from "./shared.mjs";
import { findTrackOverlaps } from "./cuts-tracks.mjs";

export async function validateOverlays(overlays, timeline, findings, paths) {
  if (!Array.isArray(overlays)) return;
  const ids = new Set();
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
    validateThreeCanvas(html, isHtmlFile ? relativePath(paths.projectRoot, htmlPath) : `${itemPath}.html`, findings);
    if (!isHtmlFile) continue;

    validateOverlayFragmentAssets(html, overlay, paths, findings);
    runOverlayFragmentFontGlyphCheck(html, overlay, paths, findings);
    const fragment = inspectHtmlFragment(html);
    if (fragment.rootCount !== 1 || fragment.hasTopLevelText || fragment.unbalanced) {
      addFinding(findings, {
        severity: "error",
        check: "overlays.html-root",
        message: "overlay HTML must contain exactly one balanced root element",
        path: relativePath(paths.projectRoot, htmlPath),
      });
      continue;
    }
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
        message: "断片ルートの data-start / data-duration は使われません。edit.json の時刻が正です。素材の長さは data-akari-natural-duration に記録してください",
        path: relativePath(paths.projectRoot, htmlPath),
      });
    }
    // テキスト分割断片の CSS animation は [data-akari-active] ゲートの中で宣言する
    // （skills/overlay-authoring/telop.md「テキスト分割と stagger 規約」）。
    // getAnimations() のコストはドキュメント全体の animation 総数に比例するため、
    // ゲート無しの断片が 1 つでも混ざると全体の tick が落ちる。分割はその危険を
    // 分割数ぶんに増幅する（実測: 1,200 断片 × 8 分割 = 9,600 本で 221ms/tick。
    // akari-video-internal contract-2026-08-15-telop-motion-grammar-v0 §6）。
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
}

function validateThreeCanvas(html, path, findings) {
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

function validateOverlayFragmentAssets(html, overlay, paths, findings) {
  if (overlay.html.trimStart().startsWith("<")) return;
  const root = realpathSync(paths.projectRoot);
  const outside = target => {
    const local = relative(root, target).replaceAll("\\", "/");
    return local === ".." || local.startsWith("../") || isAbsolute(local);
  };
  const finding = (reference, check, detail) => addFinding(findings, {
    severity: "error", check: `overlay-fragment-asset-${check}`,
    message: `overlay:${overlay.id} fragment ${overlay.html} の参照 "${reference.raw}"${check === "missing" ? " " : ": "}${detail}`,
    path: relativePath(paths.projectRoot, resolve(paths.projectRoot, overlay.html)),
  });
  for (const reference of extractAbsoluteFragmentAssetReferences(html, overlay.html)) {
    finding(reference, "absolute-path", "断片からの相対パスで書く");
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
    finding(reference, "missing", "が見つからない。" + describeFragmentAssetHint({
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
      message: `overlay:${overlay.id} fragment ${overlay.html}: 字形検査を飛ばしました（${name}）。`,
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
    add("info", "script が生成する字は静的に集めきれません。data-akari-font-chars で宣言できます。");
  }
  const fontSets = [];
  const fontPaths = [];
  const seenSources = new Set();
  let unreadable = false;
  for (const face of faces) if (face.sources.length === 0) {
    unreadable = true;
    add("info", `@font-face (${face.family || "名称なし"}) に読める書体参照がありません。`);
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
        add("info", `書体 ${label} はプロジェクト外の参照なので読みません。`);
        continue;
      }
      const binding = resolveReferenceBinding(paths.editPath, source.path, paths);
      try {
        const real = realpathSync(binding.path);
        if (binding.scope !== "library" && outside(real)) {
          unreadable = true;
          fontPaths.push(label);
          add("info", `書体 ${label} はプロジェクト外の参照なので読みません。`);
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
      add("info", `書体 ${label} は${result.missing ? "見つからない" : "読めない（書体データを解析できません）"}。`);
      continue;
    }
    fontSets.push(result.codepoints);
  }
  if (fontSets.length === 0 || unreadable) return;
  const missing = [...codepoints].filter(cp => !fontSets.some(points => points.has(cp))).sort((a, b) => a - b);
  if (missing.length) {
    const sample = missing.slice(0, 20).map(cp => `${String.fromCodePoint(cp)}(U+${cp.toString(16).toUpperCase().padStart(4, "0")})`).join(" ");
    add("warning", `書体 ${fontPaths.join(", ")} の和集合に無い字 ${missing.length} 件 (${sample})。要素ごとの書体の欠けは検出できません。`);
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
