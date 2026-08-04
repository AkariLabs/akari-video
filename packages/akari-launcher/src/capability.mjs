import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverCheckoutCapabilitySources, isCheckoutRepoRoot, loadVendoredCapabilitySources } from "./capability-sources.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKOUT_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const MISS_VERDICT = "NO_TEXT_MATCH_REQUIRES_REVIEW";

export function buildCapabilityCatalog(options = {}) {
  const topology = resolveCapabilityTopology(options);
  const sources = topology.paths.map((path) => {
    const absolutePath = join(topology.contentRoot, path);
    const bytes = readFileSync(absolutePath);
    return {
      path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      text: bytes.toString("utf8"),
    };
  });
  const sourceManifest = sources.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }));
  return {
    version: 1,
    topology: topology.kind,
    sources,
    source_set_sha256: sha256(canonicalJson(sourceManifest)),
  };
}

export function queryCapability(catalog, query, { maximum = 20 } = {}) {
  if (typeof query !== "string" || query.trim() === "") throw new Error("capability query must not be empty");
  const tokens = tokenize(query);
  const candidates = [];
  for (const source of catalog.sources) {
    for (const section of sectionsForSource(source)) {
      const pathText = normalize(source.path);
      const headingText = normalize(section.heading);
      const bodyText = normalize(section.body);
      if (!tokens.every((token) => pathText.includes(token) || headingText.includes(token) || bodyText.includes(token))) continue;
      const score = tokens.reduce((total, token) => total
        + (pathText.includes(token) ? 12 : 0)
        + (headingText.includes(token) ? 8 : 0)
        + (bodyText.includes(token) ? 3 : 0), 0);
      candidates.push({
        path: source.path,
        heading: section.heading,
        score,
        snippet: snippet(section.body || section.heading),
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score
    || left.path.localeCompare(right.path, "en")
    || left.heading.localeCompare(right.heading, "en")
    || left.snippet.localeCompare(right.snippet, "en"));
  return {
    version: 1,
    query,
    source_set_sha256: catalog.source_set_sha256,
    source_count: catalog.sources.length,
    matches: candidates.slice(0, maximum),
  };
}

export async function recordCapabilityMiss(projectInput, catalog, result) {
  if (result.matches.length !== 0) throw new Error("absence receipt may be recorded only for a zero-hit query");
  const projectRoot = realpathSync(resolve(projectInput));
  const connections = join(projectRoot, ".akari", "connections.json");
  if (!lstatSync(connections).isFile()) throw new Error("absence receipt requires an AKARI project");
  const akariDirectory = realpathSync(join(projectRoot, ".akari"));
  if (!isWithin(projectRoot, akariDirectory) || !lstatSync(join(projectRoot, ".akari")).isDirectory()) {
    throw new Error(".akari is not a contained project directory");
  }
  const reportsDirectory = await ensureContainedDirectory(projectRoot, join(akariDirectory, "reports"));
  const absenceDirectory = await ensureContainedDirectory(projectRoot, join(reportsDirectory, "absence"));
  const receipt = {
    version: 1,
    query: result.query,
    source_set_sha256: catalog.source_set_sha256,
    sources: catalog.sources.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    matches: [],
    verdict: MISS_VERDICT,
    approved_to_build: false,
  };
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  const digest = sha256(bytes);
  const path = join(absenceDirectory, `${digest}.json`);
  try {
    await writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (await readFile(path, "utf8") !== bytes) throw new Error("absence receipt digest collision");
  }
  return { receipt, path: relative(projectRoot, path), sha256: digest };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveCapabilityTopology(options) {
  if (options.sourceRoot) {
    const root = realpathSync(resolve(options.sourceRoot));
    return {
      kind: "checkout",
      contentRoot: root,
      paths: discoverCheckoutCapabilitySources(root, { trackedFiles: options.trackedFiles }),
    };
  }
  if (isCheckoutRepoRoot(CHECKOUT_ROOT)) {
    return { kind: "checkout", contentRoot: CHECKOUT_ROOT, paths: discoverCheckoutCapabilitySources(CHECKOUT_ROOT) };
  }
  return { kind: "vendor", contentRoot: join(PACKAGE_ROOT, "vendor"), paths: loadVendoredCapabilitySources(PACKAGE_ROOT) };
}

function sectionsForSource(source) {
  if (source.path.endsWith("package.json")) {
    try {
      const manifest = JSON.parse(source.text);
      const body = JSON.stringify({ name: manifest.name, description: manifest.description, bin: manifest.bin });
      return [{ heading: manifest.name ?? source.path, body }];
    } catch {
      return [{ heading: source.path, body: source.text }];
    }
  }
  if (!source.path.endsWith(".md")) return [{ heading: source.path, body: source.text }];
  const sections = [];
  let heading = source.path;
  let lines = [];
  for (const line of source.text.split(/\r?\n/u)) {
    const match = line.match(/^#{1,6}\s+(.+)$/u);
    if (match) {
      if (lines.some((value) => value.trim() !== "")) sections.push({ heading, body: lines.join("\n") });
      heading = match[1].trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (lines.some((value) => value.trim() !== "") || sections.length === 0) sections.push({ heading, body: lines.join("\n") });
  return sections;
}

function tokenize(value) {
  const tokens = normalize(value).split(/\s+/u).filter(Boolean);
  return [...new Set(tokens)];
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function snippet(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, 240);
}

async function ensureContainedDirectory(root, path) {
  await mkdir(path, { recursive: true });
  const actual = realpathSync(path);
  if (!isWithin(root, actual) || !lstatSync(path).isDirectory()) throw new Error("absence receipt directory escapes the project");
  return actual;
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
