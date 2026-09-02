import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCreatorRoot } from "../../creator-root/src/index.mjs";
import { validateWordBook } from "../../schemas/bin/validate-word-book.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtinPath = path.resolve(moduleDirectory, "../../../presets/word-book/builtin.json");
const writeQueues = new Map();

export function normalizeKey(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase().replace(/\s/gu, "");
}

export async function loadWordBookFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, book: null };
    return { ok: false, error: { code: "parse", message: messageOf(error) } };
  }
  let book;
  try {
    book = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: { code: "parse", message: messageOf(error) } };
  }
  const validation = validateWordBook(book);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: validation.tooNew ? "too-new" : "schema",
        message: validation.errors.join("; "),
      },
    };
  }
  return { ok: true, book };
}

export function layerPathFor({ scope, projectRoot, creatorRoot }) {
  if (scope === "builtin") return builtinPath;
  if (scope === "project") return projectRoot ? path.join(path.resolve(projectRoot), ".akari", "memory", "word-book.json") : null;
  const rootDir = typeof creatorRoot === "string" ? creatorRoot : creatorRoot?.rootDir;
  if (!rootDir) return null;
  if (scope === "workspace") return path.join(path.resolve(rootDir), ".akari", "memory", "word-book.json");
  if (scope === "channel") {
    const channel = channelForProject(projectRoot, rootDir);
    return channel ? path.join(path.resolve(rootDir), "channels", channel, ".akari", "memory", "word-book.json") : null;
  }
  return null;
}

export async function resolveWordBook({ projectRoot, env = process.env, extraPath } = {}) {
  const resolvedProject = projectRoot ? path.resolve(projectRoot) : null;
  let creatorRoot = null;
  if (resolvedProject) {
    try {
      const resolved = await resolveCreatorRoot({ cwd: resolvedProject, env });
      if (resolved?.manifest && !resolved.error) creatorRoot = resolved;
    } catch {
      creatorRoot = null;
    }
  }

  const definitions = wordBookLayerDefinitions({ resolvedProject, creatorRoot, env, extraPath });

  const layers = [];
  const books = [];
  for (const definition of definitions) {
    const loaded = await loadWordBookFile(definition.path);
    if (!loaded.ok) {
      layers.push({ ...definition, exists: true, error: loaded.error });
      continue;
    }
    const exists = loaded.book !== null;
    layers.push({ ...definition, exists });
    if (exists) books.push({ scope: definition.scope, book: loaded.book });
  }

  return resolvedWordBookResult(layers, books);
}

export function resolveWordBookSync({ projectRoot, env = process.env, extraPath } = {}) {
  const resolvedProject = projectRoot ? path.resolve(projectRoot) : null;
  const creatorRoot = resolvedProject ? resolveCreatorRootSync(resolvedProject, env) : null;
  const definitions = wordBookLayerDefinitions({ resolvedProject, creatorRoot, env, extraPath });
  const layers = [];
  const books = [];
  for (const definition of definitions) {
    const loaded = loadWordBookFileSync(definition.path);
    if (!loaded.ok) {
      layers.push({ ...definition, exists: true, error: loaded.error });
      continue;
    }
    const exists = loaded.book !== null;
    layers.push({ ...definition, exists });
    if (exists) books.push({ scope: definition.scope, book: loaded.book });
  }
  return resolvedWordBookResult(layers, books);
}

export function protectedTermsFrom(entries) {
  return [...new Set((Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.protect_break === true && typeof entry.surface === "string")
    .map((entry) => entry.surface))];
}

export function buildMatcher(entries) {
  const candidates = [];
  for (const [priority, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    if (entry?.kind !== "term" && entry?.kind !== "notation") continue;
    const literals = entry.kind === "term"
      ? [entry.surface, ...(entry.variants ?? [])]
      : [...(entry.variants ?? [])];
    const local = new Set();
    for (const literal of literals) {
      const key = normalizeKey(literal);
      if (!key || local.has(`${entry.kind}:${key}`)) continue;
      local.add(`${entry.kind}:${key}`);
      candidates.push({
        key,
        literal,
        surface: entry.surface,
        kind: entry.kind,
        scope: entry.scope,
        priority,
        replace: entry.kind === "term",
      });
    }
  }
  const byKey = new Map();
  for (const candidate of candidates) {
    const list = byKey.get(candidate.key) ?? [];
    list.push(candidate);
    byKey.set(candidate.key, list);
  }
  return { candidates, byKey };
}

export function applyWordBook(records, matcher, { mode = "transcript", locale } = {}) {
  if (mode !== "transcript" && mode !== "captions") throw new Error(`未対応の単語帳 mode です: ${mode}`);
  const stats = {
    replaced: 0,
    skipped_text_mismatch: 0,
    skipped_fragment_boundary: 0,
    skipped_edited: 0,
    by_surface: {},
  };
  const output = (Array.isArray(records) ? records : []).map((source) => {
    const record = cloneRecord(source);
    const tokens = tokensForRecord(record, locale ?? record.display_policy?.locale ?? "ja");
    const plans = findPlans(tokens, matcher, true);
    const actionable = plans.filter((plan) => !isAlreadyCanonical(plan));
    if (actionable.length === 0) return record;
    if (mode === "captions" && record.edited === true) {
      stats.skipped_edited += 1;
      return record;
    }

    const located = locatePlans(record.text, actionable);
    const valid = [];
    for (const item of located) {
      if (!item.location) stats.skipped_text_mismatch += 1;
      else valid.push({ ...item.plan, textLocation: item.location });
    }
    if (valid.length === 0) return record;

    if (mode === "captions" && Array.isArray(record.display_fragments)) {
      const fragmentLocations = locatePlans(record.display_fragments.join(""), valid);
      const boundaries = fragmentBoundaries(record.display_fragments);
      if (fragmentLocations.some(({ location }) => location && boundaries.some((boundary) => location.start < boundary && boundary < location.end))) {
        stats.skipped_fragment_boundary += 1;
        return record;
      }
    }

    record.text = replaceLocations(record.text, valid.map((plan) => ({ ...plan.textLocation, surface: plan.candidate.surface })));
    if (Array.isArray(record.words)) record.words = collapseWords(record.words, valid);
    if (mode === "captions" && typeof record.display_text === "string") {
      record.display_text = replaceTextByPlans(record.display_text, valid);
    }
    if (mode === "captions" && Array.isArray(record.display_fragments)) {
      record.display_fragments = replaceFragments(record.display_fragments, valid);
    }
    for (const plan of valid) {
      stats.replaced += 1;
      stats.by_surface[plan.candidate.surface] = (stats.by_surface[plan.candidate.surface] ?? 0) + 1;
    }
    return record;
  });
  return { records: output, stats };
}

export function scanRecord(record, matcher, options = {}) {
  const tokens = tokensForRecord(record, options.locale ?? record?.display_policy?.locale ?? "ja");
  return findPlans(tokens, matcher, false).map((plan) => ({
    surface: plan.candidate.surface,
    kind: plan.candidate.kind,
    matched: plan.tokens.map((token) => token.text).join(""),
    index: plan.tokens[0]?.index ?? plan.start,
  }));
}

export async function writeWordBookFile(filePath, book) {
  const resolved = path.resolve(filePath);
  return enqueueWrite(resolved, () => writeWordBookFileUnlocked(resolved, book));
}

export async function addEntry(filePath, entry) {
  const resolved = path.resolve(filePath);
  return enqueueWrite(resolved, async () => {
    const loaded = await loadWordBookFile(resolved);
    if (!loaded.ok) throw new Error(`単語帳を更新できません: ${loaded.error.message}`);
    const book = loaded.book ?? { version: 0, entries: [] };
    const nextEntry = { ...entry, added_at: entry.added_at ?? new Date().toISOString() };
    const key = normalizeKey(nextEntry.surface);
    const index = book.entries.findIndex((item) => normalizeKey(item.surface) === key);
    const replaced = index !== -1;
    const entries = [...book.entries];
    if (replaced) entries[index] = nextEntry;
    else entries.push(nextEntry);
    const next = { ...book, entries };
    await writeWordBookFileUnlocked(resolved, next);
    return { book: next, replaced };
  });
}

function channelForProject(projectRoot, creatorRoot) {
  if (!projectRoot || !creatorRoot) return null;
  const relative = path.relative(path.resolve(creatorRoot), path.resolve(projectRoot));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  return parts.length === 4 && parts[0] === "channels" && parts[2] === "videos" && parts[1] && parts[3]
    ? parts[1]
    : null;
}

function wordBookLayerDefinitions({ resolvedProject, creatorRoot, env, extraPath }) {
  const definitions = [];
  const resolvedExtra = extraPath ?? env.AKARI_WORD_BOOK;
  if (resolvedExtra) definitions.push({ scope: "extra", path: path.resolve(resolvedProject ?? process.cwd(), resolvedExtra) });
  if (resolvedProject) {
    definitions.push({ scope: "project", path: layerPathFor({ scope: "project", projectRoot: resolvedProject, creatorRoot }) });
    const channelPath = layerPathFor({ scope: "channel", projectRoot: resolvedProject, creatorRoot });
    if (channelPath) definitions.push({ scope: "channel", path: channelPath });
    const workspacePath = layerPathFor({ scope: "workspace", projectRoot: resolvedProject, creatorRoot });
    if (workspacePath) definitions.push({ scope: "workspace", path: workspacePath });
  }
  definitions.push({ scope: "builtin", path: builtinPath });
  return definitions;
}

function resolvedWordBookResult(layers, books) {
  const seen = new Set();
  const entries = [];
  const sources = {};
  for (const layer of books) {
    for (const entry of layer.book.entries) {
      const key = normalizeKey(entry.surface);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...entry, scope: layer.scope });
      sources[entry.surface] = layer.scope;
    }
  }
  return { entries, layers, sources, conflicts: collectLayerConflicts(books) };
}

function collectLayerConflicts(books) {
  const owners = new Map();
  const conflicts = new Map();
  for (const layer of books) {
    for (const entry of layer.book.entries) {
      const surfaceKey = normalizeKey(entry.surface);
      for (const [literal, role] of [[entry.surface, "surface"], ...(entry.variants ?? []).map(value => [value, "variant"])]) {
        const variantKey = normalizeKey(literal);
        if (!variantKey) continue;
        const owner = owners.get(variantKey);
        const candidate = { surface: entry.surface, scope: layer.scope, surfaceKey, role };
        if (!owner) {
          owners.set(variantKey, candidate);
          continue;
        }
        if (owner.surfaceKey === surfaceKey || owner.scope === layer.scope) continue;
        if (owner.role !== "variant" && role !== "variant") continue;
        const conflict = conflicts.get(variantKey) ?? {
          variant_key: variantKey,
          winner: { surface: owner.surface, scope: owner.scope },
          shadowed: [],
        };
        if (!conflict.shadowed.some(item => item.surface === entry.surface && item.scope === layer.scope)) {
          conflict.shadowed.push({ surface: entry.surface, scope: layer.scope });
        }
        conflicts.set(variantKey, conflict);
      }
    }
  }
  return [...conflicts.values()];
}

function loadWordBookFileSync(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, book: null };
    return { ok: false, error: { code: "parse", message: messageOf(error) } };
  }
  let book;
  try {
    book = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: { code: "parse", message: messageOf(error) } };
  }
  const validation = validateWordBook(book);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: validation.tooNew ? "too-new" : "schema",
        message: validation.errors.join("; "),
      },
    };
  }
  return { ok: true, book };
}

function resolveCreatorRootSync(projectRoot, env) {
  if (env.AKARI_CREATOR_ROOT) {
    return validCreatorRoot(path.resolve(projectRoot, env.AKARI_CREATOR_ROOT));
  }
  let current = path.resolve(projectRoot);
  while (true) {
    if (existsSync(path.join(current, ".akari", "root.json"))) return validCreatorRoot(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const home = process.platform === "win32"
    ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : os.homedir())
    : env.HOME || os.homedir();
  const pointerPath = path.join(env.AKARI_HOME || path.join(home, ".akari"), "creator-root.json");
  try {
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
    return typeof pointer?.lastRoot === "string" && pointer.lastRoot && existsSync(pointer.lastRoot)
      ? validCreatorRoot(pointer.lastRoot)
      : null;
  } catch {
    return null;
  }
}

function validCreatorRoot(rootDir) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(rootDir, ".akari", "root.json"), "utf8"));
    return manifest?.schema === "creator-root/v1" ? { rootDir, manifest } : null;
  } catch {
    return null;
  }
}

function tokensForRecord(record, locale) {
  if (Array.isArray(record?.words) && record.words.length > 0) {
    return record.words.map((word, index) => ({ text: String(word.text ?? ""), index, word }));
  }
  if (typeof record?.text !== "string") return [];
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return [...segmenter.segment(record.text)]
    .filter((segment) => segment.isWordLike !== false && /\S/u.test(segment.segment))
    .map((segment) => ({ text: segment.segment, index: segment.index }));
}

function findPlans(tokens, matcher, replaceOnly) {
  const plans = [];
  for (let start = 0; start < tokens.length;) {
    let best = null;
    let combined = "";
    for (let end = start; end < tokens.length; end += 1) {
      combined += tokens[end].text;
      const candidates = matcher?.byKey?.get(normalizeKey(combined)) ?? [];
      for (const candidate of candidates) {
        if (replaceOnly && !candidate.replace) continue;
        const proposal = { start, end, count: end - start + 1, candidate, tokens: tokens.slice(start, end + 1) };
        if (!best || comparePlans(proposal, best) < 0) best = proposal;
      }
    }
    if (best) {
      plans.push(best);
      start = best.end + 1;
    } else {
      start += 1;
    }
  }
  return plans;
}

function comparePlans(left, right) {
  return right.count - left.count
    || String(right.candidate.literal).length - String(left.candidate.literal).length
    || left.candidate.priority - right.candidate.priority;
}

function isAlreadyCanonical(plan) {
  return plan.count === 1 && plan.tokens[0].text === plan.candidate.surface;
}

function locatePlans(text, plans) {
  if (typeof text !== "string") return plans.map((plan) => ({ plan, location: null }));
  let cursor = 0;
  return plans.map((plan) => {
    const pattern = plan.tokens.map((token) => escapeRegExp(token.text)).join("\\s*");
    const match = new RegExp(pattern, "u").exec(text.slice(cursor));
    if (!match) return { plan, location: null };
    const start = cursor + match.index;
    const end = start + match[0].length;
    cursor = end;
    return { plan, location: { start, end } };
  });
}

function replaceTextByPlans(text, plans) {
  const replacements = locatePlans(text, plans)
    .filter((item) => item.location)
    .map(({ plan, location }) => ({ ...location, surface: plan.candidate.surface }));
  return replaceLocations(text, replacements);
}

function replaceLocations(text, replacements) {
  let output = text;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.surface}${output.slice(replacement.end)}`;
  }
  return output;
}

function collapseWords(words, plans) {
  const byStart = new Map(plans.map((plan) => [plan.start, plan]));
  const output = [];
  for (let index = 0; index < words.length;) {
    const plan = byStart.get(index);
    if (!plan) {
      output.push({ ...words[index] });
      index += 1;
      continue;
    }
    output.push({
      start: words[plan.start].start,
      end: words[plan.end].end,
      text: plan.candidate.surface,
    });
    index = plan.end + 1;
  }
  return output;
}

function fragmentBoundaries(fragments) {
  const boundaries = [];
  let length = 0;
  for (let index = 0; index < fragments.length - 1; index += 1) {
    length += fragments[index].length;
    boundaries.push(length);
  }
  return boundaries;
}

function replaceFragments(fragments, plans) {
  const joined = fragments.join("");
  const located = locatePlans(joined, plans).filter((item) => item.location);
  const starts = [0, ...fragmentBoundaries(fragments)];
  return fragments.map((fragment, fragmentIndex) => {
    const start = starts[fragmentIndex];
    const end = start + fragment.length;
    const replacements = located
      .filter(({ location }) => start <= location.start && location.end <= end)
      .map(({ plan, location }) => ({
        start: location.start - start,
        end: location.end - start,
        surface: plan.candidate.surface,
      }));
    return replaceLocations(fragment, replacements);
  });
}

function cloneRecord(record) {
  return {
    ...record,
    ...(Array.isArray(record?.words) ? { words: record.words.map((word) => ({ ...word })) } : {}),
    ...(Array.isArray(record?.display_fragments) ? { display_fragments: [...record.display_fragments] } : {}),
  };
}

async function writeWordBookFileUnlocked(filePath, book) {
  const validation = validateWordBook(book);
  if (!validation.valid) throw new Error(`単語帳の検証に失敗しました: ${validation.errors.join("; ")}`);
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(book, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function enqueueWrite(filePath, operation) {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const queued = current.catch(() => {});
  writeQueues.set(filePath, queued);
  return current.finally(() => {
    if (writeQueues.get(filePath) === queued) writeQueues.delete(filePath);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
