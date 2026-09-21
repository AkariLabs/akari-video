import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPTION_FONT_REPOSITORY_RELATIVE_PATH, CAPTION_FONT_ROLE } from "./caption-font.mjs";
import { extractFragmentAssetReferences } from "./fragment-assets.mjs";
import { stripHtmlComments } from "./html-scan.mjs";
import {
  resolveAssetLibraryRoots,
  resolveLibraryFallback,
} from "./library-reference.mjs";

const PRESETS_LUTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "presets", "luts");
const EXTERNAL_HTML_REFERENCE_PATTERN = /(?:\b(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+))/giu;
export const ABSENT_DECLARED_INPUT_SENTINEL = "AKARI_DECLARED_INPUT_ABSENT/v1";

import { extractRuntimeAssetReferences, RenderInputError } from "../../overlay-runtime/runtimes.mjs";
export * from "../../overlay-runtime/runtimes.mjs";

// 解決規則は enumerator に集約する。用途によらず library として解決した全入力を渡す。
export function buildRenderMediaReferences(inputs) {
  return Object.fromEntries(inputs.filter((input) => input.scope === "library").map((input) => [
    input.path.replaceAll("\\", "/"),
    { absolute: input.absolute_path, library_root: input.library_root },
  ]));
}

// ffmpeg の計画だけが消費する写し。宣言・receipt・ページの /media/ URL は変更しない。
// パス欄だけを書き換え、同じ文字列を持つ ID・テキスト・HTML には触れない。
export function projectResolvedMediaPaths({ projectRoot, edit, inputs }) {
  const bindings = new Map(inputs.filter(input => input.scope === "library").map(input => [
    resolve(projectRoot, input.path), input.absolute_path,
  ]));
  const path = value => typeof value === "string"
    ? bindings.get(resolve(projectRoot, value)) ?? value
    : value;
  const copy = structuredClone(edit);
  for (const source of copy.sources ?? []) {
    source.path = path(source.path);
    if (source.chroma_key?.background) source.chroma_key.background = path(source.chroma_key.background);
  }
  for (const layer of copy.layers ?? []) layer.src = path(layer.src);
  const audioItem = item => {
    if (typeof item === "string") return path(item);
    if (item && typeof item === "object" && typeof item.path === "string") item.path = path(item.path);
    return item;
  };
  if (copy.audio) {
    if (copy.audio.bgm !== undefined) copy.audio.bgm = audioItem(copy.audio.bgm);
    for (const role of ["sfx", "narration", "speech"]) {
      if (Array.isArray(copy.audio[role])) copy.audio[role] = copy.audio[role].map(audioItem);
    }
  }
  return copy;
}

export async function enumerateDeclaredRenderInputs({
  projectRoot,
  edit,
  editText = null,
  captionFontAsset = null,
  internalEdit = null,
  env = process.env,
}) {
  const root = realpathSync(resolve(projectRoot));
  const inputs = [];
  const addInput = (role, value, options = {}) => addProjectInput(
    inputs,
    root,
    role,
    value,
    { ...options, env },
  );
  const addOptionalInput = (role, value) => addOptionalProjectInput(
    inputs,
    root,
    role,
    value,
    env,
  );
  addInput("edit", "edit.json", { text: editText });

  const used = new Set((edit.cuts ?? []).map((cut) => cut?.src));
  for (const source of (edit.sources ?? []).filter((value) => used.has(value.id))) {
    addInput(`source:${source.id}`, source.path);
    const chromaBackground = source?.chroma_key?.background;
    if (isPathBackedChromaBackground(chromaBackground)) {
      addInput(`chroma-background:${source.id}`, chromaBackground);
    }
  }

  const captionsPath = join(root, "captions.json");
  if (existsSync(captionsPath)) addInput("caption", "captions.json");
  if (captionFontAsset !== null) addBoundCaptionFontInput(inputs, captionFontAsset);

  for (const [index, overlay] of (edit.overlays ?? []).entries()) {
    const role = `overlay:${overlay.id ?? index}`;
    const entry = addInput(role, overlaySourcePath(overlay));
    const html = readFileSync(entry.absolute_path, "utf8");
    for (const reference of extractRuntimeAssetReferences(html, overlaySourcePath(overlay), role)) {
      addInput(`${role}:${reference.role}`, reference.path);
    }
    const fragmentReferences = extractFragmentAssetReferences(html, overlaySourcePath(overlay), role);
    for (const reference of fragmentReferences) {
      try {
        addInput(`${role}:fragment-asset`, reference.path);
      } catch (error) {
        if (error instanceof RenderInputError) {
          error.message = `${role} fragment ${overlaySourcePath(overlay)} の参照 "${reference.raw}": ${error.message}`;
        }
        throw error;
      }
    }
    assertNoUndeclaredHtmlAssets(html, role, fragmentReferences);
  }

  const bgm = audioPath(edit.audio?.bgm);
  if (bgm) addInput("audio:bgm", bgm);
  for (const [index, sfx] of (edit.audio?.sfx ?? []).entries()) {
    const path = audioPath(sfx);
    if (path) addInput(`audio:sfx:${index}`, path);
  }
  for (const [index, narration] of (edit.audio?.narration ?? []).entries()) {
    const path = audioPath(narration);
    if (path) addOptionalInput(`audio:narration:${narration?.id ?? index}`, path);
  }
  for (const [index, speech] of (edit.audio?.speech ?? []).entries()) {
    const path = audioPath(speech);
    if (path) addOptionalInput(`audio:speech:${speech?.id ?? index}`, path);
  }
  for (const [index, layer] of (edit.layers ?? []).entries()) {
    if (typeof layer?.src !== "string" || layer.src === "") continue;
    addInput(`layer:${layer?.id ?? index}`, layer?.src);
  }
  if (edit.thumbnail?.path) addInput("thumbnail", edit.thumbnail.path);

  const lut = edit.output?.look?.lut;
  if (typeof lut === "string" && lut !== "") {
    const absolute = resolveLutPath(root, lut);
    if (isWithin(root, absolute)) {
      addInput("lut", absolute);
    } else {
      addAkariInput(inputs, "lut", absolute);
    }
  }

  return inputs.sort(
    (left, right) => left.role.localeCompare(right.role, "en")
      || left.path.localeCompare(right.path, "en"),
  );
}

function overlaySourcePath(overlay) {
  const html = overlay?.html;
  if (typeof html === "string" && html.trimStart().startsWith("<")) {
    if (typeof overlay?.htmlPath !== "string" || overlay.htmlPath === "") {
      throw new RenderInputError("inline overlay html requires htmlPath");
    }
    return overlay.htmlPath;
  }
  return html;
}

function addBoundCaptionFontInput(inputs, asset) {
  if (!isRecord(asset) || asset.role !== CAPTION_FONT_ROLE || asset.scope !== "akari"
      || asset.repository_relative_path !== CAPTION_FONT_REPOSITORY_RELATIVE_PATH
      || typeof asset.repository_root !== "string" || typeof asset.lexical_path !== "string"
      || typeof asset.absolute_path !== "string") {
    throw new RenderInputError("caption-font binding does not match the canonical renderer asset");
  }
  const expectedLexical = join(asset.repository_root, CAPTION_FONT_REPOSITORY_RELATIVE_PATH);
  if (resolve(asset.lexical_path) !== resolve(expectedLexical)
      || !isWithin(asset.repository_root, asset.absolute_path)) {
    throw new RenderInputError("caption-font binding escapes the canonical AKARI root");
  }
  inputs.push({
    role: CAPTION_FONT_ROLE,
    path: `akari:${CAPTION_FONT_REPOSITORY_RELATIVE_PATH}`,
    lexical_path: asset.lexical_path,
    absolute_path: asset.absolute_path,
    repository_root: asset.repository_root,
    scope: "akari",
    text: null,
  });
}

/**
 * 宣言済み入力 1 件の実体を 1 回読み、バイト数と sha256 を返す。
 * hashDeclaredRenderInputs の既定実装。テストが読み込み回数を数えるための差し替え口でもある。
 */
export async function measureDeclaredInputFile(path) {
  const info = await stat(path);
  return { bytes: info.size, sha256: await sha256File(path) };
}

/**
 * 不具合メモ第23項（2026-09-18）: 参照用途ごとに入力項目を列挙する設計はそのままで、
 * 「用途別の結果行を残す必要」と「同じ実体を何度も読み直す必要」を切り離す。
 * 88 分 4K の保存記録では入力 115 項目に対して一意の実体は 7 件しかなく、
 * 4K 原本を 1 件読むだけで数十秒級なので、同じ実体の再読み込みがそのまま無駄になっていた。
 *
 * **キャッシュの寿命はこの関数呼び出し 1 回（= 1 スナップショット）の内部だけ**。
 * measurements は呼び出しごとに新しく作られ、戻り値と一緒に捨てられるのでモジュール外へ出ない。
 * render-receipt.mjs の照合は「レンダ中に素材が差し替わっていないか」を見るための
 * **別スナップショット**なので、そこでは必ず再計測が走る（= 差し替えを見逃さない）。
 * スナップショットを跨いで共有すると検証が無意味になるため、ここを跨がせてはならない。
 */
export async function hashDeclaredRenderInputs(inputs, {
  useConsumedText = false,
  measureFileImpl = measureDeclaredInputFile,
} = {}) {
  const measurements = new Map();
  // 同じ実体を指す項目は 1 回だけ読む。realpath 済みの absolute_path を鍵にするので、
  // シンボリックリンク経由の別名で宣言された項目も同じ実体として 1 回に収まる。
  const measureOnce = (currentPath, identity) => {
    const key = identity ?? currentPath;
    let pending = measurements.get(key);
    if (pending === undefined) {
      pending = measureFileImpl(currentPath);
      measurements.set(key, pending);
    }
    return pending;
  };
  const result = [];
  for (const input of inputs) {
    if (input.missing === true) {
      assertMissingProjectInputBinding(input);
      result.push({
        role: input.role,
        path: input.path,
        state: "absent",
        bytes: 0,
        sha256: sha256(`${ABSENT_DECLARED_INPUT_SENTINEL}:${input.role}:${input.path}`),
      });
      continue;
    }
    // 束縛の検証は共有しない: 項目ごとに毎回 realpath/lstat で確認する（読み込みだけを共有する）。
    const currentPath = assertCurrentInputBinding(input);
    const consumedText = useConsumedText && typeof input.text === "string" ? input.text : null;
    // 消費済みテキストを持つ項目は実体ではなくそのテキストが証拠なので、実体読み込みは行わない。
    const measurement = consumedText === null
      ? await measureOnce(currentPath, input.absolute_path)
      : null;
    result.push({
      role: input.role,
      path: input.path,
      ...(input.scope === "akari" || input.scope === "library" ? { scope: input.scope } : {}),
      bytes: consumedText === null ? measurement.bytes : Buffer.byteLength(consumedText),
      sha256: consumedText === null ? measurement.sha256 : sha256(consumedText),
    });
  }
  return result;
}

export function resolveDeclaredProjectInput(
  projectRoot,
  value,
  label = "render input",
  env = process.env,
) {
  return resolveDeclaredProjectInputBinding(projectRoot, value, label, env).absolute;
}

function resolveDeclaredProjectInputBinding(projectRoot, value, label, env) {
  const root = realpathSync(resolve(projectRoot));
  if (typeof value !== "string" || value.trim() === "") throw new RenderInputError(`${label} path is required`);
  const lexical = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (!isWithin(root, lexical)) throw new RenderInputError(`${label} escapes the project root`);
  let actual;
  try {
    actual = realpathSync(lexical);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      const fallback = resolveLibraryFallback({
        projectRoot: root,
        declaredPath: lexical,
        libraryRoots: resolveAssetLibraryRoots(env).read,
      });
      if (fallback.path !== null) {
        return {
          absolute: fallback.path,
          lexical: fallback.path,
          libraryRoot: fallback.libraryRoot,
          scope: "library",
        };
      }
    }
    throw new RenderInputError(`${label} could not be resolved: ${messageOf(error)}`);
  }
  if (!isWithin(root, actual) || !lstatSync(actual).isFile()) {
    throw new RenderInputError(`${label} is not a regular project file`);
  }
  return { absolute: actual, lexical, libraryRoot: null, scope: "project" };
}

export function resolveLutPath(projectRoot, lutRef) {
  if (!lutRef.includes("/") && !lutRef.includes("\\")) {
    return join(PRESETS_LUTS_ROOT, lutRef, `${lutRef}.cube`);
  }
  return resolve(projectRoot, lutRef);
}

function addProjectInput(inputs, root, role, value, { text = null, env = process.env } = {}) {
  const lexical = resolveProjectLexicalPath(root, value, role);
  const binding = resolveDeclaredProjectInputBinding(root, value, role, env);
  const entry = {
    role,
    path: relative(root, lexical),
    lexical_path: binding.lexical,
    absolute_path: binding.absolute,
    project_root: root,
    scope: binding.scope,
    text,
    ...(binding.scope === "library" ? { library_root: binding.libraryRoot } : {}),
  };
  inputs.push(entry);
  return entry;
}

function addOptionalProjectInput(inputs, root, role, value, env = process.env) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const lexical = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (!isWithin(root, lexical)) throw new RenderInputError(`${role} escapes the project root`);
  if (existsSync(lexical)) return addProjectInput(inputs, root, role, lexical, { env });
  const fallback = resolveLibraryFallback({
    projectRoot: root,
    declaredPath: value,
    libraryRoots: resolveAssetLibraryRoots(env).read,
  });
  if (fallback.path !== null) return addProjectInput(inputs, root, role, lexical, { env });
  const parentBinding = resolveNearestExistingParentBinding(root, lexical, role);
  const entry = {
    role,
    path: relative(root, lexical),
    absolute_path: null,
    lexical_path: lexical,
    project_root: root,
    parent_lexical_path: parentBinding.lexical,
    parent_absolute_path: parentBinding.actual,
    scope: "project",
    text: null,
    missing: true,
  };
  inputs.push(entry);
  return entry;
}

function addAkariInput(inputs, role, absolute) {
  const lexical = resolve(absolute);
  const repositoryRoot = resolve(PRESETS_LUTS_ROOT, "..", "..");
  let actual;
  try {
    actual = realpathSync(lexical);
  } catch (error) {
    throw new RenderInputError(`${role} could not be resolved: ${messageOf(error)}`);
  }
  if (!lstatSync(actual).isFile()) throw new RenderInputError(`${role} is not a regular file`);
  const relativePreset = relative(repositoryRoot, actual);
  if (!isWithin(repositoryRoot, actual)) throw new RenderInputError(`${role} escapes AKARI preset roots`);
  inputs.push({
    role,
    path: `akari:${relativePreset}`,
    lexical_path: lexical,
    absolute_path: actual,
    repository_root: repositoryRoot,
    scope: "akari",
    text: null,
  });
}

function assertNoUndeclaredHtmlAssets(html, overlayLabel, fragmentReferences = []) {
  const declared = new Set(fragmentReferences.map((reference) => reference.raw));
  const activeHtml = stripHtmlComments(html);
  let match;
  EXTERNAL_HTML_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = EXTERNAL_HTML_REFERENCE_PATTERN.exec(activeHtml)) !== null) {
    const reference = (match[1] ?? match[2] ?? "").trim();
    if (reference === "" || reference.startsWith("#") || reference.startsWith("data:")) continue;
    if (!/^href\b/iu.test(match[0]) && declared.has(reference)) continue;
    throw new RenderInputError(`${overlayLabel} contains an undeclared local/network asset reference: ${reference}`);
  }
}

function audioPath(value) {
  return typeof value === "string" ? value : value?.path;
}

function isPathBackedChromaBackground(value) {
  return typeof value === "string" && value !== "" && !isColorLike(value);
}

function isColorLike(value) {
  return /^(?:#|0x)[0-9a-f]{3,8}$/iu.test(value)
    || new Set(["black", "white", "red", "green", "blue", "yellow", "cyan", "magenta", "gray", "grey", "orange", "transparent"]).has(value.toLowerCase());
}

function isRelativeReference(value) {
  return typeof value === "string" && value !== "" && !value.startsWith("/") && !/^[a-z][a-z\d+.-]*:/iu.test(value);
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function resolveNearestExistingParentBinding(root, target, label) {
  let candidate = dirname(target);
  while (!existsSync(candidate) && candidate !== dirname(candidate)) candidate = dirname(candidate);
  try {
    const actual = realpathSync(candidate);
    if (!isWithin(root, actual)) throw new RenderInputError(`${label} escapes the project root through a symlink`);
    return { lexical: candidate, actual };
  } catch (error) {
    if (error instanceof RenderInputError) throw error;
    throw new RenderInputError(`${label} parent could not be resolved: ${messageOf(error)}`);
  }
}

function resolveProjectLexicalPath(root, value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new RenderInputError(`${label} path is required`);
  const lexical = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (!isWithin(root, lexical)) throw new RenderInputError(`${label} escapes the project root`);
  return lexical;
}

function assertCurrentInputBinding(input) {
  const lexical = input.lexical_path ?? input.absolute_path;
  let actual;
  let actualInfo;
  try {
    actual = realpathSync(lexical);
    actualInfo = lstatSync(actual);
  } catch (error) {
    throw new RenderInputError(`${input.role} binding could not be resolved: ${messageOf(error)}`);
  }
  if (!actualInfo.isFile() || actual !== input.absolute_path) {
    throw new RenderInputError(`${input.role} lexical input binding changed during rendering`);
  }
  if (input.scope === "project" && !isWithin(input.project_root, actual)) {
    throw new RenderInputError(`${input.role} lexical input binding escapes the project root`);
  }
  if (input.scope === "akari" && (!input.repository_root || !isWithin(input.repository_root, actual))) {
    throw new RenderInputError(`${input.role} lexical input binding escapes the AKARI root`);
  }
  if (input.scope === "library" && (!input.library_root || !isWithin(input.library_root, actual))) {
    throw new RenderInputError(`${input.role} lexical input binding escapes the AKARI library root`);
  }
  return lexical;
}

function assertMissingProjectInputBinding(input) {
  try {
    lstatSync(input.lexical_path);
    throw new RenderInputError(`${input.role} appeared during rendering`);
  } catch (error) {
    if (error instanceof RenderInputError) throw error;
    if (error?.code !== "ENOENT") {
      throw new RenderInputError(`${input.role} absence could not be verified: ${messageOf(error)}`);
    }
  }
  const current = resolveNearestExistingParentBinding(input.project_root, input.lexical_path, input.role);
  if (current.lexical !== input.parent_lexical_path || current.actual !== input.parent_absolute_path) {
    throw new RenderInputError(`${input.role} absent-input parent binding changed during rendering`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
