import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CAPTION_FONT_ROLE = "caption-font";
export const CAPTION_FONT_REPOSITORY_RELATIVE_PATH = "assets/font/noto-sans-jp/NotoSansJP-Variable.ttf";
export const CAPTION_FONT_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CAPTION_FONT_LEXICAL_PATH = join(
  CAPTION_FONT_REPOSITORY_ROOT,
  CAPTION_FONT_REPOSITORY_RELATIVE_PATH,
);
export const CAPTION_FONT_FILE_URL = pathToFileURL(CAPTION_FONT_LEXICAL_PATH).href;

/** Resolve the only supported render-cut topology: a repository checkout root. */
export function resolveCanonicalCaptionFontAsset({ repositoryRoot = CAPTION_FONT_REPOSITORY_ROOT } = {}) {
  let root;
  try {
    root = realpathSync(resolve(repositoryRoot));
  } catch (error) {
    throw new Error(`unsupported caption font distribution topology: ${messageOf(error)}`);
  }
  const packageMarker = join(root, "packages", "render-cut", "package.json");
  try {
    if (!lstatSync(packageMarker).isFile()) throw new Error("render-cut package marker is not a regular file");
  } catch (error) {
    throw new Error(`unsupported caption font distribution topology: ${messageOf(error)}`);
  }
  const lexicalPath = join(root, CAPTION_FONT_REPOSITORY_RELATIVE_PATH);
  let info;
  let absolutePath;
  try {
    info = lstatSync(lexicalPath);
    absolutePath = realpathSync(lexicalPath);
  } catch (error) {
    throw new Error(`canonical caption font is unavailable: ${messageOf(error)}`);
  }
  if (!info.isFile() || info.isSymbolicLink() || !isWithin(root, absolutePath)
      || relative(root, absolutePath).split(sep).join("/") !== CAPTION_FONT_REPOSITORY_RELATIVE_PATH) {
    throw new Error("canonical caption font must be the regular checkout asset and cannot escape through a symlink");
  }
  return Object.freeze({
    role: CAPTION_FONT_ROLE,
    repository_relative_path: CAPTION_FONT_REPOSITORY_RELATIVE_PATH,
    lexical_path: lexicalPath,
    absolute_path: absolutePath,
    repository_root: root,
    scope: "akari",
    file_url: pathToFileURL(absolutePath).href,
  });
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
