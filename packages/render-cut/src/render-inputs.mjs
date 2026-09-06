import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPTION_FONT_REPOSITORY_RELATIVE_PATH, CAPTION_FONT_ROLE } from "./caption-font.mjs";
import {
  resolveAkariAssetsDir,
  resolveLibraryFallback,
} from "./library-reference.mjs";

const PRESETS_LUTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "presets", "luts");
const EXTERNAL_HTML_REFERENCE_PATTERN = /(?:\b(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+))/giu;
export const ABSENT_DECLARED_INPUT_SENTINEL = "AKARI_DECLARED_INPUT_ABSENT/v1";

import { extractRuntimeAssetReferences, RenderInputError } from "../../overlay-runtime/runtimes.mjs";
export * from "../../overlay-runtime/runtimes.mjs";

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
    assertNoUndeclaredHtmlAssets(html, role);
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

export async function hashDeclaredRenderInputs(inputs, { useConsumedText = false } = {}) {
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
    const currentPath = assertCurrentInputBinding(input);
    const info = await stat(currentPath);
    const consumedText = useConsumedText && typeof input.text === "string" ? input.text : null;
    result.push({
      role: input.role,
      path: input.path,
      ...(input.scope === "akari" || input.scope === "library" ? { scope: input.scope } : {}),
      bytes: consumedText === null ? info.size : Buffer.byteLength(consumedText),
      sha256: consumedText === null ? await sha256File(currentPath) : sha256(consumedText),
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
        akariAssetsDir: resolveAkariAssetsDir(env),
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
    akariAssetsDir: resolveAkariAssetsDir(env),
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

function assertNoUndeclaredHtmlAssets(html, overlayLabel) {
  let match;
  EXTERNAL_HTML_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = EXTERNAL_HTML_REFERENCE_PATTERN.exec(html)) !== null) {
    const reference = (match[1] ?? match[2] ?? "").trim();
    if (reference === "" || reference.startsWith("#") || reference.startsWith("data:")) continue;
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
