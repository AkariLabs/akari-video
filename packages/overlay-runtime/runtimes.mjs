// Static, Node-only manifest. No third-party dependencies or browser globals.
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const runtimeRoot = SOURCE_DIRECTORY;
export const registryPath = resolve(runtimeRoot, "src/runtime-registry.js");
export class RenderInputError extends Error {}
const stripHtmlComments = html => html.replace(/<!--[\s\S]*?-->/gu, "");
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const messageOf = error => error instanceof Error ? error.message : String(error);
const isRelativeReference = value => typeof value === "string" && value !== "" && !value.startsWith("/") && !/^[a-z][a-z\d+.-]*:/iu.test(value);
const escapeScriptJson = json => json.replaceAll("<", "\\u003c");

export function declarationPattern(entry) {
  const attr = entry.declaration.attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(<script\\b(?=[^>]*\\btype\\s*=\\s*(?:"application/json"|'application/json'))(?=[^>]*\\s${attr}(?=\\s|=|/?>))[^>]*>)([\\s\\S]*?)(</script\\s*>)`, "giu");
}
export function readDeclarations(html, entry) {
  return [...stripHtmlComments(html).matchAll(declarationPattern(entry))].map(match => ({
    json: match[2], parse: () => JSON.parse(match[2]),
  }));
}
export function scriptApplies(script, descriptor) {
  return !script.when || (Array.isArray(descriptor?.[script.when.nonEmptyArray]) && descriptor[script.when.nonEmptyArray].length > 0);
}
// The legacy export artifact calls browserGlobal directly, so its browser-only
// registration trailer is not part of the frozen inline script bytes.
function exportDrawingSource(source) {
  const marker = "\n// Register with current hosts, or queue until a script-only host boots its registry.";
  const boundary = source.indexOf(marker);
  if (boundary < 0) throw new Error("runtime registration boundary is missing");
  return source.slice(0, boundary);
}
export const runtimes = [
  {
    id: "three", declaration: { attr: "data-akari-3d-scene" }, browserGlobal: "threeRuntime",
    scripts: [{path:"src/vendor/three-bundle.js"}, {path:"src/vendor/vendor-3d-text-bundle.js", when:{nonEmptyArray:"texts"}}, {path:"src/three-runtime.js", exportSource:exportDrawingSource}],
    usesVideoTextures: true, exportRenderOptions: false, exportSceneLabel: "3D",
    browserOptions: { defaultFontUrl: "/__akari/fonts/zen-kaku-gothic-new-black.ttf" },
    assetReferences: (descriptor, ctx) => threeReferences(descriptor, ctx.label),
    embed: (overlay, ctx) => embedThreeModels(overlay.html, ctx.projectRoot, overlay.id, overlay.vars ?? {}),
    appliesTo: () => true,
    requiredFor: (category, ctx) => category === "scene3d" && ctx.name === "fragment.html",
    missingMessage: 'fragment.html に <script type="application/json" data-akari-3d-scene> 宣言が見つかりません',
    validate(descriptor, ctx) {
      if (ctx.category === "scene3d" && ctx.name === "fragment.html" &&
          (!descriptor || descriptor.model !== undefined || !Array.isArray(descriptor.texts) || !descriptor.texts.length) &&
          !ctx.payloadFiles.some(file => /\.(?:glb|gltf)$/i.test(file))) ctx.fail("scene3d 素材には glTF 実体（.glb または .gltf）が必要です");
    },
  },
  {
    id: "glass", declaration: {attr:"data-akari-glass-scene"}, browserGlobal:"glassRuntime",
    scripts:[{path:"src/glass-runtime.js", exportSource:exportDrawingSource}], usesVideoTextures:false,
    fragmentBaseAttribute: "data-akari-glass-base",
    skipDynamicNewUrl: true,
    assetReferences: (descriptor, ctx) => glassReferences(descriptor, ctx.htmlPath, ctx.label),
    embed: (overlay, ctx) => embedGlassBackdrop(overlay, ctx.projectRoot, ctx.resolveDeclaredProjectInput),
    appliesTo: meta => Array.isArray(meta?.requires) && meta.requires.includes("glass-runtime"), requiredFor: () => true,
    validate(descriptor, ctx) {
      const elements = ctx.html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, "");
      if (ctx.first && !/<[a-z][^>]*\sdata-akari-glass(?=\s|=|\/?>)/iu.test(elements)) ctx.fail(`${ctx.name}: 宣言があるのにガラス面が無い`);
      if (!descriptor || descriptor.backdrop === undefined) return;
      const backdrop = descriptor.backdrop;
      if (typeof backdrop !== "string" || !backdrop.trim() || /^[a-z][a-z\d+.-]*:|^[\/\\]/iu.test(backdrop) || backdrop.includes("\\")) ctx.fail("data-akari-glass-scene.backdrop は相対パスである必要があります");
      else ctx.validateReference(backdrop);
    },
  },
  {
    id: "vgpu", declaration: { attr: "data-akari-vgpu-scene" }, browserGlobal: "vgpuRuntime",
    scripts: [
      { path: "src/vendor/vgpu-bundle.js" },
      { path: "src/vgpu-runtime.js", exportSource: exportDrawingSource },
    ],
    usesVideoTextures: false,
    exportRenderOptions: edit => `{ fps: ${edit.output.fps} }`,
    prepare: "probe",
    appliesTo: () => true,
    validate(descriptor, ctx) {
      // JSON object validation is shared; only one declaration is allowed.
      if (!ctx.first) { ctx.fail("data-akari-vgpu-scene は1個までです"); return; }
    },
  },
];
// Shared by the asset CLI and in-process callers (including test-only entries).
export function validateRuntimeDeclarations(html, ctx) {
  const errors = [];
  const fail = message => errors.push(message);
  for (const entry of runtimes) {
    if (entry.appliesTo && !entry.appliesTo(ctx.meta)) continue;
    const declarations = readDeclarations(html, entry);
    if (!declarations.length) {
      if (entry.requiredFor?.(ctx.category, ctx)) {
        fail(entry.missingMessage ?? `${ctx.name} に ${entry.declaration.attr} 宣言が見つかりません`);
        entry.validate?.(null, {...ctx, html:stripHtmlComments(html), fail, first:false});
      }
      continue;
    }
    for (const [index, declaration] of declarations.entries()) {
      let descriptor = null;
      try {
        descriptor = declaration.parse();
        if (!isRecord(descriptor)) { fail(`${entry.declaration.attr} は JSON object である必要があります`); descriptor = null; }
      } catch (error) { fail(`${entry.declaration.attr} の JSON を読めません: ${messageOf(error)}`); }
      const messages = entry.validate?.(descriptor, {...ctx, html:stripHtmlComments(html), fail, first:index === 0});
      if (Array.isArray(messages)) errors.push(...messages);
    }
  }
  return errors;
}
export function browserManifest() {
  const scriptOwners = new Map();
  return { registry: "/__akari/runtimes/registry.js", runtimes: runtimes.map(entry => ({
    id:entry.id, selector:`script[type="application/json"][${entry.declaration.attr}]`,
    browserGlobal:entry.browserGlobal, options:entry.browserOptions,
    fragmentBaseAttribute:entry.fragmentBaseAttribute,
    scripts:entry.scripts.map(script => {
      const url = `/${basename(script.path)}`;
      const owner = `${entry.id}:${script.path}`;
      if (scriptOwners.has(url)) {
        throw new Error(`Runtime script URL collision at ${url}: ${scriptOwners.get(url)} and ${owner}`);
      }
      scriptOwners.set(url, owner);
      return {url, when:script.when};
    }),
  })) };
}
export function extractRuntimeAssetReferences(html, htmlPath = "fragment.html", label = "overlay") {
  return runtimes.flatMap(entry => readDeclarations(html, entry).flatMap(declaration => {
    let descriptor;
    try { descriptor = declaration.parse(); }
    catch (error) { throw new RenderInputError(`${label} has invalid ${entry.declaration.attr} JSON: ${messageOf(error)}`); }
    return entry.assetReferences?.(descriptor, {html, htmlPath, label}) ?? [];
  }));
}

function threeReferences(descriptor, overlayLabel = "overlay") {
 const references = [];
    if (!isRecord(descriptor)) {
      throw new RenderInputError(`${overlayLabel} 3D model must be a relative path`);
    }
    // texts[] があれば model は任意（contract-2026-08-12-3d-text-rail.md §3.1。
    // rasterize.mjs と three-runtime.js は既にこの緩和を持っていたが、入力収集側の本関数だけが
    // model を無条件必須のままで、texts だけのシーンが render-cut を通らなかった。2026-08-14 修正）
    const hasTexts = Array.isArray(descriptor.texts) && descriptor.texts.length > 0;
    if (descriptor.model !== undefined) {
      if (!isRelativeReference(descriptor.model)) {
        throw new RenderInputError(`${overlayLabel} 3D model must be a relative path`);
      }
      references.push({ role: "model", path: descriptor.model });
    } else if (!hasTexts) {
      throw new RenderInputError(`${overlayLabel} 3D model must be a relative path`);
    }
    // texts[].font も実ファイル依存なので入力として数える（rasterize は data URI へ焼き込む）。
    // 収集しないと、フォントを差し替えても入力ハッシュが変わらず再レンダーが走らない
    if (hasTexts) {
      descriptor.texts.forEach((text, index) => {
        if (!isRecord(text) || text.font === undefined) return;
        if (!isRelativeReference(text.font)) {
          throw new RenderInputError(
            `${overlayLabel} texts.${text.id ?? index}.font must be a relative path`,
          );
        }
        references.push({ role: `text-font:${text.id ?? index}`, path: text.font });
      });
    }
    if (descriptor.environment?.map !== undefined) {
      if (!isRelativeReference(descriptor.environment.map)) {
        throw new RenderInputError(`${overlayLabel} environment.map must be a relative path`);
      }
      references.push({ role: "environment", path: descriptor.environment.map });
    }
    if (descriptor.materialOverrides !== undefined) {
      if (!isRecord(descriptor.materialOverrides)) throw new RenderInputError(`${overlayLabel} materialOverrides must be an object`);
      for (const [name, override] of Object.entries(descriptor.materialOverrides)) {
        if (!isRecord(override) || !isRelativeReference(override.texture)) {
          throw new RenderInputError(`${overlayLabel} materialOverrides.${name}.texture must be a relative path`);
        }
        references.push({ role: `texture:${name}`, path: override.texture });
      }
    }
 return references;
}
function glassReferences(descriptor, htmlPath = "fragment.html", overlayLabel = "overlay") {
 const references = [];
    if (!isRecord(descriptor)) throw new RenderInputError(`${overlayLabel} glass scene must be a JSON object`);
    if (descriptor.backdrop === undefined) return references;
    if (!isRelativeReference(descriptor.backdrop) || descriptor.backdrop.includes("\\")) {
      throw new RenderInputError(`${overlayLabel} glass backdrop must be a relative path`);
    }
    references.push({ role: "glass-backdrop", path: join(dirname(htmlPath), descriptor.backdrop) });
 return references;
}
export function extractThreeSceneAssetReferences(html, overlayLabel = "overlay") {
 const entry = runtimes.find(entry => entry.id === "three");
 return readDeclarations(html, entry).flatMap(d => {
 let descriptor; try { descriptor = d.parse(); } catch(error) { throw new RenderInputError(`${overlayLabel} has invalid ${entry.declaration.attr} JSON: ${messageOf(error)}`); }
 return entry.assetReferences(descriptor, {label:overlayLabel});
 });
}
export function extractGlassSceneAssetReferences(html, htmlPath = "fragment.html", overlayLabel = "overlay") {
 const entry = runtimes.find(entry => entry.id === "glass");
 return readDeclarations(html, entry).flatMap(d => {
 let descriptor; try { descriptor = d.parse(); } catch(error) { throw new RenderInputError(`${overlayLabel} has invalid ${entry.declaration.attr} JSON: ${messageOf(error)}`); }
 return entry.assetReferences(descriptor, {htmlPath,label:overlayLabel});
 });
}
const DEFAULT_THREE_FONT_PATH = resolve(
  SOURCE_DIRECTORY,
  "test-harness/fonts/ZenKakuGothicNew-Black.ttf",
);
let defaultThreeFontDataUri;
function resolveDefaultThreeFontDataUri() {
  defaultThreeFontDataUri ??=
    `data:font/ttf;base64,${readFileSync(DEFAULT_THREE_FONT_PATH).toString("base64")}`;
  return defaultThreeFontDataUri;
}
const TEXTURE_MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jfif", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  // 動画テクスチャ。原本ではなく編集用 720p プロキシを差すこと（skills/overlay-authoring/3d.md）
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);
// 動画テクスチャの上限。「原本を黙って通さない」（skills/overlay-authoring/3d.md）を実際に効かせる。
// 解像度ではなくバイト数で見るのは、シート生成が同期・純関数で ffprobe を呼ばないため
// （呼ぶと単体テストが使う極小のダミー動画も読めなくなる）。24MB は 720p / H.264 / CRF 23 なら
// 数分ぶんに相当し、実運用のプロキシは通るが 4K マスターは通らない目安。
// 埋め込みは base64（約 1.37 倍）になり、プレビューは毎 tick これをシークする
const MAX_VIDEO_TEXTURE_BYTES = 24 * 1024 * 1024;
// texts[].font の埋め込み用 MIME。troika は XMLHttpRequest(responseType:"arraybuffer") で読んで
// 自前パーサへ渡すだけなので実行上は無関係だが、data URI の型として正しい値を残す
const FONT_MIME_TYPES = new Map([
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
]);

function embedGlassBackdrop(overlay, projectRoot, resolveDeclaredProjectInput) {
  const references = extractGlassSceneAssetReferences(overlay.html, overlay.htmlPath, overlay.id);
  let index = 0;
  return overlay.html.replace(
    new RegExp("<!--[\\s\\S]*?-->|" + declarationPattern(runtimes.find(entry => entry.id === "glass")).source, "giu"),
    (match, opening, json, closing) => {
      if (!opening) return match; // Preserve commented declarations byte for byte.
      const descriptor = JSON.parse(json);
      if (descriptor.backdrop !== undefined) {
        const reference = references[index++];
        const binding = resolveDeclaredProjectInput(projectRoot, reference.path, `overlay:${overlay.id}:glass-backdrop`);
        const mime = textureMimeType(reference.path);
        if (!mime.startsWith("image/")) throw new TypeError("glass backdrop must be a still image");
        descriptor.backdrop = `data:${mime};base64,${readFileSync(binding).toString("base64")}`;
      }
      return opening + JSON.stringify(descriptor).replace(/</gu, "\\u003c") + closing;
    },
  );
}

function embedThreeModels(html, projectRoot, overlayId, overlayVars) {
  if (!/data-akari-3d-scene/u.test(stripHtmlComments(html))) return html;
  let declarationCount = 0;
  const embedded = html.replace(
    declarationPattern(runtimes.find(entry => entry.id === "three")),
    (_match, openingTag, jsonText, closingTag) => {
      declarationCount += 1;
      let descriptor;
      try {
        descriptor = JSON.parse(jsonText);
      } catch (error) {
        throw new Error(
          `3D overlay ${overlayId} has invalid data-akari-3d-scene JSON: ${error.message}`,
        );
      }
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
        throw new TypeError(`3D overlay ${overlayId} scene declaration must be a JSON object`);
      }
      // texts[] があれば model は任意（three-runtime.js readDescriptor と同じ緩和。
      // contract-2026-08-12-3d-text-rail.md §3.1）
      const hasTexts = Array.isArray(descriptor.texts) && descriptor.texts.length > 0;
      if (descriptor.model !== undefined
        && (typeof descriptor.model !== "string" || descriptor.model.length === 0)) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      if (descriptor.model === undefined && !hasTexts) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      if (typeof descriptor.model === "string"
        && (descriptor.model.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(descriptor.model))) {
        throw new TypeError(`3D overlay ${overlayId} scene model must be a relative path`);
      }
      const embeddedDescriptor = { ...descriptor };
      if (typeof descriptor.model === "string") {
        const modelPath = resolve(projectRoot, descriptor.model);
        const model = readFileSync(modelPath);
        embeddedDescriptor.model = `data:model/gltf-binary;base64,${model.toString("base64")}`;
      }
      if (hasTexts) {
        embeddedDescriptor.texts = descriptor.texts.map((textDescriptor) => {
          const font = textDescriptor.font;
          if (font === undefined) {
            return { ...textDescriptor, font: resolveDefaultThreeFontDataUri() };
          }
          if (typeof font !== "string"
            || font.length === 0
            || font.startsWith("/")
            || /^[a-z][a-z\d+.-]*:/i.test(font)) {
            throw new TypeError(
              `3D overlay ${overlayId} texts.${textDescriptor.id}.font must be a relative path`,
            );
          }
          const extension = extname(font).toLowerCase();
          const mimeType = FONT_MIME_TYPES.get(extension);
          if (!mimeType) {
            throw new TypeError(
              `3D overlay ${overlayId} texts.${textDescriptor.id}.font has an unsupported type: ${extension || "none"}`,
            );
          }
          const fontFile = readFileSync(resolve(projectRoot, font));
          return {
            ...textDescriptor,
            font: `data:${mimeType};base64,${fontFile.toString("base64")}`,
          };
        });
      }
      if (descriptor.environment?.map !== undefined) {
        const map = descriptor.environment.map;
        if (typeof map !== "string"
          || map.length === 0
          || map.startsWith("/")
          || /^[a-z][a-z\d+.-]*:/i.test(map)) {
          throw new TypeError(`3D overlay ${overlayId} environment.map must be a relative path`);
        }
        const mimeType = textureMimeType(map);
        if (!mimeType.startsWith("image/")) {
          throw new TypeError(
            `3D overlay ${overlayId} environment.map must be an equirectangular image: ${map}`,
          );
        }
        const image = readFileSync(resolve(projectRoot, map));
        embeddedDescriptor.environment = {
          ...descriptor.environment,
          map: `data:${mimeType};base64,${image.toString("base64")}`,
        };
      }
      if (descriptor.materialOverrides !== undefined) {
        if (!descriptor.materialOverrides
          || typeof descriptor.materialOverrides !== "object"
          || Array.isArray(descriptor.materialOverrides)) {
          throw new TypeError(`3D overlay ${overlayId} materialOverrides must be an object`);
        }
        embeddedDescriptor.materialOverrides = Object.fromEntries(
          Object.entries(descriptor.materialOverrides).map(([materialName, override]) => {
            if (!materialName
              || !override
              || typeof override !== "object"
              || Array.isArray(override)
              || Object.keys(override).some(
                (key) => key !== "texture" && key !== "textureVar" && key !== "brightness"
              )
              || typeof override.texture !== "string"
              || override.texture.length === 0) {
              throw new TypeError(
                `3D overlay ${overlayId} materialOverrides.${materialName}.texture must be a relative path`,
              );
            }
            if (override.textureVar !== undefined
              && (typeof override.textureVar !== "string"
                || !/^--[A-Za-z_][A-Za-z0-9_-]*$/u.test(override.textureVar))) {
              throw new TypeError(
                `3D overlay ${overlayId} materialOverrides.${materialName}.textureVar must be a CSS custom property name`,
              );
            }
            const variableTexture = override.textureVar === undefined
              ? undefined
              : overlayVars[override.textureVar];
            let texturePath = typeof variableTexture === "string" && variableTexture.length > 0
              ? variableTexture
              : override.texture;
            const textureVariableMatch = /^var\(\s*(--[\w-]+)\s*\)$/u.exec(texturePath);
            if (textureVariableMatch) {
              const resolvedTexture = overlayVars[textureVariableMatch[1]];
              if (typeof resolvedTexture !== "string" || resolvedTexture.length === 0) {
                throw new TypeError(
                  `3D overlay ${overlayId} materialOverrides.${materialName}.texture must be a relative path`,
                );
              }
              texturePath = resolvedTexture;
            }
            if (texturePath.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(texturePath)) {
              throw new TypeError(
                `3D overlay ${overlayId} materialOverrides.${materialName}.texture must be a relative path`,
              );
            }
            const texture = readFileSync(resolve(projectRoot, texturePath));
            const mimeType = textureMimeType(texturePath);
            if (mimeType.startsWith("video/") && texture.length > MAX_VIDEO_TEXTURE_BYTES) {
              throw new Error(
                `3D overlay ${overlayId} materialOverrides.${materialName}.texture is too large `
                  + `(${Math.round(texture.length / 1024 / 1024)}MiB > ${MAX_VIDEO_TEXTURE_BYTES / 1024 / 1024}MiB): `
                  + `${texturePath}\n`
                  + "  Give the 720p editing proxy, not the master. The sheet embeds this as base64\n"
                  + "  (~1.37x), and live preview seeks it on every tick.\n"
                  + `  ffmpeg -i <master> -vf scale=-2:720 -c:v libx264 -crf 23 -preset medium `
                  + "-pix_fmt yuv420p -an <proxy>.mp4",
              );
            }
            return [materialName, {
              ...override,
              texture: `data:${mimeType};base64,${texture.toString("base64")}`,
              textureVar: undefined,
            }];
          }),
        );
      }
      return `${openingTag}${escapeScriptJson(JSON.stringify(embeddedDescriptor))}${closingTag}`;
    },
  );
  if (declarationCount === 0) {
    throw new Error(
      `3D overlay ${overlayId} must declare <script type="application/json" data-akari-3d-scene>`,
    );
  }
  return embedded;
}

function textureMimeType(path) {
  const extension = extname(path).toLowerCase();
  const mimeType = TEXTURE_MIME_TYPES.get(extension);
  if (!mimeType) throw new TypeError(`Unsupported material override texture type: ${extension || "none"}`);
  return mimeType;
}

