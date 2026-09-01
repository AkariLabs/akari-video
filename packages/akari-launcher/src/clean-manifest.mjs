import { lstat as fsLstat, readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';

const RECENT_GUARD_MS = 60 * 60 * 1000;

export const CLEAN_MANIFEST = Object.freeze([
  manifest('.akari/render-tmp/*', 'disposable', '書き出しの一時作業領域', 'render-cut'),
  manifest('.akari/cache/**', 'disposable', '原本から再生成できるキャッシュ', 'AKARI Video'),
  manifest('.akari/diffs/*', 'disposable', '「変更を見る」で再生成できる差分', 'AKARI Video'),
  manifest('exports/*.gpu-video.mp4', 'disposable', 'GPU 書き出しの映像中間ファイル', 'render-cut'),
  manifest('exports/*.osr-video.mp4', 'disposable', 'OSR 書き出しの映像中間ファイル', 'render-cut'),
  manifest('exports/run.json', 'disposable', '書き出し子プロセスの一時記録', 'render-cut'),
  manifest('.akari/work/tmp/**', 'disposable', '明示された使い捨て作業領域', '実行したスキル'),
  manifest('.akari/work/** (with .akari-disposable)', 'disposable', '使い捨て目印がある作業領域', '実行したスキル'),

  manifest('edit.json', 'keep', '編集内容の正本', null),
  manifest('captions.json', 'keep', '字幕データ', null),
  manifest('review.json', 'keep', 'レビュー注釈', null),
  manifest('plan.json', 'keep', '承認済みの計画', null),
  manifest('motion/**', 'keep', '再生成できないキーフレーム曲線', null),
  manifest('assets/**', 'keep', '素材の原本', null),
  manifest('planning/**', 'keep', '企画・計画文書', null),
  manifest('exports/*.mp4', 'keep', '納品用の書き出し', null),
  manifest('exports/nle/**', 'keep', 'NLE 用の書き出し', null),
  manifest('.akari/reports/**', 'keep', '検証と人間確認の証跡', null),
  manifest('.akari/sidecars/**', 'keep', '素材分析などの高価なサイドカー', null),
  manifest('.akari/*.json', 'keep', 'プロジェクト状態の契約ファイル', null),
  manifest('.akari/backup/**', 'keep', '移行前の退避', null),
  manifest('.akari/events/**', 'keep', '節目の記録', null),
  manifest('.akari/work/keep/**', 'keep', '作り直せない作業成果', null),
  manifest('.akari/work/** (with .akari-keep)', 'keep', '保持目印がある作業領域', null),
  manifest('.akari/work/**/.akari-disposable', 'keep', '作業領域の分類目印', null),
  manifest('.akari/work/**/.akari-keep', 'keep', '作業領域の分類目印', null),
  manifest('.claude/**', 'keep', 'プロジェクトのエージェント設定', null),
  manifest('.opencode/**', 'keep', 'プロジェクトのエージェント設定', null),
  manifest('AGENTS.md', 'keep', 'プロジェクトのエージェント向け案内', null),
  manifest('CLAUDE.md', 'keep', 'プロジェクトのエージェント向け案内', null),
  manifest('akari.sh', 'keep', 'プロジェクトの起動スクリプト', null),
  manifest('.gitignore', 'keep', 'プロジェクトの除外設定', null),

  manifest('.akari/work/**', 'undecided', '使い捨てと正本の区別がない作業領域', null),
  manifest('<recent-disposable>', 'undecided', '実行中の可能性', null),
  manifest('<symbolic-link>', 'undecided', 'シンボリックリンク（参照先は調べません）', null),
  manifest('<unknown-top-level>', 'undecided', '宣言表に分類がありません', null),
]);

const RULES = new Map(CLEAN_MANIFEST.map((entry) => [entry.pattern, entry]));

function manifest(pattern, className, reason, regeneratedBy) {
  return Object.freeze({ pattern, class: className, reason, regenerated_by: regeneratedBy });
}

function rule(pattern) {
  const entry = RULES.get(pattern);
  if (!entry) throw new Error(`clean manifest rule is missing: ${pattern}`);
  return entry;
}

/**
 * Project contents are grouped at boundaries that can be removed independently. The returned
 * paths never contain absolute machine paths and every list is sorted with a platform-neutral
 * code-point comparison.
 */
export async function classifyProject(root, options = {}) {
  const projectRoot = path.resolve(root);
  const io = {
    lstat: options.lstat ?? fsLstat,
    readdir: options.readdir ?? fsReaddir,
    readFile: options.readFile ?? fsReadFile,
  };
  const nowValue = typeof options.now === 'function' ? options.now() : (options.now ?? Date.now());
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a Date or a finite timestamp');

  const rootNode = await scanNode(projectRoot, '', io);
  if (rootNode.kind !== 'directory') throw new Error(`project root is not a directory: ${projectRoot}`);

  const buckets = { disposable: [], keep: [], undecided: [] };
  const context = { projectRoot, io, nowMs, buckets };
  for (const child of rootNode.children) await classifyTopLevel(child, context);

  for (const className of ['disposable', 'keep', 'undecided']) {
    buckets[className].sort((left, right) => comparePath(left.path, right.path));
  }

  return {
    disposable: buckets.disposable,
    keep: buckets.keep,
    undecided: buckets.undecided,
    totals: {
      disposable: totalOf(buckets.disposable),
      keep: totalOf(buckets.keep),
      undecided: totalOf(buckets.undecided),
    },
  };
}

async function classifyTopLevel(node, context) {
  if (node.kind === 'symlink') return addSymlink(node, context);

  const exactKeep = new Map([
    ['edit.json', 'edit.json'],
    ['captions.json', 'captions.json'],
    ['review.json', 'review.json'],
    ['plan.json', 'plan.json'],
    ['AGENTS.md', 'AGENTS.md'],
    ['CLAUDE.md', 'CLAUDE.md'],
    ['akari.sh', 'akari.sh'],
    ['.gitignore', '.gitignore'],
  ]);
  if (exactKeep.has(node.rel)) return addKnownKeep(node, rule(exactKeep.get(node.rel)), context);

  if (node.rel === 'motion' && node.kind === 'directory') return addKnownKeep(node, rule('motion/**'), context);
  if (node.rel === 'planning' && node.kind === 'directory') return addKnownKeep(node, rule('planning/**'), context);
  if (node.rel === '.claude' && node.kind === 'directory') return addKnownKeep(node, rule('.claude/**'), context);
  if (node.rel === '.opencode' && node.kind === 'directory') return addKnownKeep(node, rule('.opencode/**'), context);
  if (node.rel === 'assets' && node.kind === 'directory') return classifyAssets(node, context);
  if (node.rel === 'exports' && node.kind === 'directory') return classifyExports(node, context);
  if (node.rel === '.akari' && node.kind === 'directory') return classifyAkari(node, context);

  addEntry(node, rule('<unknown-top-level>'), context);
}

async function classifyAssets(assets, context) {
  if (assets.children.length === 0) return addEntry(assets, rule('assets/**'), context);
  for (const child of assets.children) {
    if (child.kind === 'symlink') addSymlink(child, context);
    else if (child.name === 'generated' && child.kind === 'directory') await classifyGeneratedAssets(child, context);
    else addKnownKeep(child, rule('assets/**'), context);
  }
}

async function classifyGeneratedAssets(directory, context) {
  if (directory.children.length === 0) {
    addEntry(directory, rule('assets/**'), context);
    return;
  }

  const consumed = new Set();
  const childrenByName = new Map(directory.children.map((child) => [child.name, child]));
  for (const child of directory.children) {
    if (consumed.has(child.name)) continue;
    if (child.kind === 'symlink') {
      addSymlink(child, context);
      continue;
    }
    if (child.kind === 'directory') {
      await classifyGeneratedAssets(child, context);
      continue;
    }
    if (child.name.endsWith('.meta.json')) {
      addEntry(child, rule('assets/**'), context);
      continue;
    }

    const sidecar = childrenByName.get(`${child.name}.meta.json`);
    let provenance;
    let stats = statsOf(child);
    if (sidecar?.kind === 'file') {
      consumed.add(sidecar.name);
      stats = combineStats(child, sidecar);
      provenance = await readProvenance(sidecar.abs, context);
    }
    addEntry(child, rule('assets/**'), context, { stats, provenance });
  }
}

function classifyExports(exportsNode, context) {
  for (const child of exportsNode.children) {
    if (child.kind === 'symlink') {
      addSymlink(child, context);
    } else if (child.name === 'nle' && child.kind === 'directory') {
      addKnownKeep(child, rule('exports/nle/**'), context);
    } else if (child.kind === 'file' && child.name.endsWith('.gpu-video.mp4')) {
      addDisposable(child, rule('exports/*.gpu-video.mp4'), context);
    } else if (child.kind === 'file' && child.name.endsWith('.osr-video.mp4')) {
      addDisposable(child, rule('exports/*.osr-video.mp4'), context);
    } else if (child.kind === 'file' && child.name === 'run.json') {
      addDisposable(child, rule('exports/run.json'), context);
    } else if (child.kind === 'file' && child.name.endsWith('.mp4')) {
      addEntry(child, rule('exports/*.mp4'), context);
    } else {
      addEntry(child, rule('<unknown-top-level>'), context);
    }
  }
}

async function classifyAkari(akari, context) {
  const keepDirectories = new Map([
    ['reports', '.akari/reports/**'],
    ['sidecars', '.akari/sidecars/**'],
    ['backup', '.akari/backup/**'],
    ['events', '.akari/events/**'],
  ]);

  for (const child of akari.children) {
    if (child.kind === 'symlink') {
      addSymlink(child, context);
    } else if (child.name === 'render-tmp' && child.kind === 'directory') {
      for (const candidate of child.children) addDisposable(candidate, rule('.akari/render-tmp/*'), context);
    } else if (child.name === 'cache' && child.kind === 'directory') {
      for (const candidate of child.children) addDisposable(candidate, rule('.akari/cache/**'), context);
    } else if (child.name === 'diffs' && child.kind === 'directory') {
      for (const candidate of child.children) addDisposable(candidate, rule('.akari/diffs/*'), context);
    } else if (child.name === 'work' && child.kind === 'directory') {
      await classifyWork(child, context);
    } else if (keepDirectories.has(child.name) && child.kind === 'directory') {
      addKnownKeep(child, rule(keepDirectories.get(child.name)), context);
    } else if (child.kind === 'file' && child.name.endsWith('.json')) {
      addEntry(child, rule('.akari/*.json'), context);
    } else {
      addEntry(child, rule('<unknown-top-level>'), context);
    }
  }
}

async function classifyWork(work, context) {
  for (const child of work.children) {
    if (child.kind === 'symlink') {
      addSymlink(child, context);
    } else if (child.name === 'tmp' && child.kind === 'directory') {
      await classifyWorkNode(child, 'disposable', rule('.akari/work/tmp/**'), context);
    } else if (child.name === 'keep' && child.kind === 'directory') {
      addKnownKeep(child, rule('.akari/work/keep/**'), context);
    } else {
      await classifyWorkNode(child, 'undecided', rule('.akari/work/**'), context);
    }
  }
}

async function classifyWorkNode(node, inheritedClass, inheritedRule, context) {
  if (node.kind === 'symlink') return addSymlink(node, context);
  if (node.kind !== 'directory') {
    if (isMarker(node.name)) return addEntry(node, markerRule(node.name), context);
    if (inheritedClass === 'disposable') return addDisposable(node, inheritedRule, context);
    return addEntry(node, inheritedRule, context);
  }

  const ownKeep = node.directKeepMarker;
  const ownDisposable = node.directDisposableMarker;
  if (inheritedClass === 'keep' || ownKeep) {
    addKnownKeep(node, ownKeep ? rule('.akari/work/** (with .akari-keep)') : inheritedRule, context);
    return;
  }

  const effectiveClass = ownDisposable ? 'disposable' : inheritedClass;
  const effectiveRule = ownDisposable ? rule('.akari/work/** (with .akari-disposable)') : inheritedRule;
  const hasNestedKeep = node.children.some((child) => child.kind === 'directory' && child.subtreeKeepMarker);
  const mustSplit = hasNestedKeep || node.hasSymlink;

  if (effectiveClass === 'disposable' && !mustSplit) {
    addDisposable(node, effectiveRule, context);
    return;
  }
  const hasNestedClassification = node.children.some((child) => (
    child.kind === 'directory' && (child.subtreeKeepMarker || child.subtreeDisposableMarker)
  ));
  if (effectiveClass === 'undecided' && !hasNestedClassification && !node.hasSymlink) {
    addEntry(node, effectiveRule, context);
    return;
  }
  if (node.children.length === 0) {
    addEntry(node, effectiveRule, context);
    return;
  }

  for (const child of node.children) {
    if (isMarker(child.name) && child.kind === 'file') {
      addEntry(child, markerRule(child.name), context);
    } else {
      await classifyWorkNode(child, effectiveClass, effectiveRule, context);
    }
  }
}

function addKnownKeep(node, keepRule, context) {
  if (node.kind === 'symlink') return addSymlink(node, context);
  if (node.kind !== 'directory' || !node.hasSymlink) {
    addEntry(node, keepRule, context);
    return;
  }
  if (node.children.length === 0) addEntry(node, keepRule, context);
  for (const child of node.children) addKnownKeep(child, keepRule, context);
}

function addDisposable(node, disposableRule, context) {
  if (node.kind === 'symlink') return addSymlink(node, context);
  if (node.hasSymlink) {
    addEntry(node, rule('<symbolic-link>'), context, { heldReason: 'シンボリックリンクを含むため' });
    return;
  }
  addEntry(node, disposableRule, context, { guardRecent: true });
}

function addSymlink(node, context) {
  addEntry(node, rule('<symbolic-link>'), context);
}

function addEntry(node, manifestRule, context, options = {}) {
  const stats = options.stats ?? statsOf(node);
  let className = manifestRule.class;
  let reason = manifestRule.reason;
  let heldReason = options.heldReason;
  if (options.guardRecent && stats.latestMtimeMs >= context.nowMs - RECENT_GUARD_MS) {
    className = 'undecided';
    heldReason = '実行中の可能性';
    reason = rule('<recent-disposable>').reason;
  }

  const entry = {
    path: portablePath(node.rel),
    class: className,
    reason,
    files: stats.files,
    bytes: stats.bytes,
  };
  if (heldReason) entry.held_reason = heldReason;
  if (options.provenance) entry.provenance = options.provenance;
  context.buckets[className].push(entry);
}

async function readProvenance(sidecarPath, context) {
  try {
    const value = JSON.parse(await context.io.readFile(sidecarPath, 'utf8'));
    const provenance = value?.provenance;
    if (!provenance || typeof provenance.origin !== 'string' || typeof provenance.generator !== 'string') return undefined;
    const origin = portablePath(provenance.origin);
    const originPath = path.resolve(context.projectRoot, provenance.origin);
    let originExists = false;
    if (isInside(context.projectRoot, originPath)) {
      try {
        const stat = await context.io.lstat(originPath);
        originExists = stat.isFile();
      } catch {
        originExists = false;
      }
    }
    return {
      origin,
      generator: provenance.generator,
      ...(Array.isArray(provenance.inputs) ? { inputs: provenance.inputs.map(portablePath) } : {}),
      ...(typeof provenance.created_at === 'string' ? { created_at: provenance.created_at } : {}),
      origin_exists: originExists,
    };
  } catch {
    return undefined;
  }
}

async function scanNode(absolutePath, relativePath, io) {
  const stat = await io.lstat(absolutePath);
  const base = {
    name: relativePath ? path.basename(absolutePath) : '',
    abs: absolutePath,
    rel: portablePath(relativePath),
    files: 0,
    bytes: 0,
    latestMtimeMs: stat.mtimeMs,
    hasSymlink: false,
    directKeepMarker: false,
    directDisposableMarker: false,
    subtreeKeepMarker: false,
    subtreeDisposableMarker: false,
  };
  if (stat.isSymbolicLink()) {
    return { ...base, kind: 'symlink', files: 1, bytes: stat.size, hasSymlink: true, children: [] };
  }
  if (!stat.isDirectory()) {
    return { ...base, kind: 'file', files: 1, bytes: stat.size, children: [] };
  }

  const names = await io.readdir(absolutePath);
  names.sort(comparePath);
  const children = [];
  for (const name of names) {
    children.push(await scanNode(path.join(absolutePath, name), relativePath ? path.join(relativePath, name) : name, io));
  }
  const directKeepMarker = children.some((child) => child.name === '.akari-keep' && child.kind === 'file');
  const directDisposableMarker = children.some((child) => child.name === '.akari-disposable' && child.kind === 'file');
  return {
    ...base,
    kind: 'directory',
    children,
    files: children.reduce((sum, child) => sum + child.files, 0),
    bytes: children.reduce((sum, child) => sum + child.bytes, 0),
    latestMtimeMs: Math.max(stat.mtimeMs, ...children.map((child) => child.latestMtimeMs)),
    hasSymlink: children.some((child) => child.hasSymlink),
    directKeepMarker,
    directDisposableMarker,
    subtreeKeepMarker: directKeepMarker || children.some((child) => child.subtreeKeepMarker),
    subtreeDisposableMarker: directDisposableMarker || children.some((child) => child.subtreeDisposableMarker),
  };
}

function statsOf(node) {
  return { files: node.files, bytes: node.bytes, latestMtimeMs: node.latestMtimeMs };
}

function combineStats(...nodes) {
  return {
    files: nodes.reduce((sum, node) => sum + node.files, 0),
    bytes: nodes.reduce((sum, node) => sum + node.bytes, 0),
    latestMtimeMs: Math.max(...nodes.map((node) => node.latestMtimeMs)),
  };
}

function totalOf(entries) {
  return {
    files: entries.reduce((sum, entry) => sum + entry.files, 0),
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

function markerRule(name) {
  return rule(name === '.akari-keep'
    ? '.akari/work/**/.akari-keep'
    : '.akari/work/**/.akari-disposable');
}

function isMarker(name) {
  return name === '.akari-keep' || name === '.akari-disposable';
}

function portablePath(value) {
  return String(value).split(path.sep).join('/');
}

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
