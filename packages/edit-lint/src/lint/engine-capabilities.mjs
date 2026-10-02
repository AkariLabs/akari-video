import { addFinding, isRecord } from "./shared.mjs";

export function validateEngineCapabilities(rawEdit, internalEdit, engine, table, findings) {
  const internalItems = new Map();
  const visitInternal = (item) => {
    internalItems.set(String(item.id), item);
    for (const child of item.children ?? []) visitInternal(child);
  };
  for (const track of internalEdit.tracks) {
    for (const item of track.items) visitInternal(item);
  }
  const rowsByPath = new Map();
  for (const row of table.fields) {
    if (!isRecord(row) || typeof row.path !== "string") continue;
    const rows = rowsByPath.get(row.path) ?? [];
    rows.push(row);
    rowsByPath.set(row.path, rows);
  }

  const visitItems = (items, trackIndex, parentPath, lane) => {
    for (const [itemIndex, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const actualPath = `${parentPath}[${itemIndex}]`;
      const internalItem = internalItems.get(String(item.id));
      const appliesTo = engineAppliesTo(item, internalItem, lane);
      // GPU consumes selector-only caption points through animatorParamsAt, even
      // though the general caption keyframe container is marked ignored.
      const captionAnimatorPoints = appliesTo === "captions"
        && Array.isArray(item.animator) && item.animator.length > 0
        && Array.isArray(item.keyframes) && item.keyframes.every(point =>
          isRecord(point) && Object.keys(point).every(key => ["t", "animator", "easing"].includes(key)));
      for (const key of Object.keys(item)) {
        checkEngineField({
          canonicalPath: `tracks[].items[].${key}`,
          actualPath: `${actualPath}.${key}`,
          consumedByGpu: captionAnimatorPoints && key === "keyframes",
          appliesTo,
          engine,
          table,
          rowsByPath,
          findings,
        });
      }
      if (isRecord(item.source)) {
        for (const key of Object.keys(item.source)) {
          checkEngineField({
            canonicalPath: `tracks[].items[].source.${key}`,
            actualPath: `${actualPath}.source.${key}`,
            appliesTo,
            engine,
            table,
            rowsByPath,
            findings,
          });
        }
      }
      if (Array.isArray(item.keyframes)) {
        for (const [keyframeIndex, keyframe] of item.keyframes.entries()) {
          if (!isRecord(keyframe)) continue;
          for (const key of Object.keys(keyframe)) {
            checkEngineField({
              canonicalPath: `tracks[].items[].keyframes[].${key}`,
              actualPath: `${actualPath}.keyframes[${keyframeIndex}].${key}`,
              consumedByGpu: captionAnimatorPoints && ["t", "easing"].includes(key),
              appliesTo,
              engine,
              table,
              rowsByPath,
              findings,
            });
          }
        }
      }
      if (Array.isArray(item.items)) {
        visitItems(item.items, trackIndex, `${actualPath}.items`, lane);
      }
    }
  };

  for (const [trackIndex, track] of rawEdit.tracks.entries()) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    visitItems(track.items, trackIndex, `tracks[${trackIndex}].items`, track.lane);
  }
}

function engineAppliesTo(item, internalItem, lane) {
  if (lane === "audio") return "audio";
  switch (item.source?.kind) {
    case "media":
      return internalItem?.legacy?.collection === "layers" ? "layers" : "cuts";
    case "html": return "overlays";
    case "telop": return "baked";
    case "filter": return "layers";
    case "captions":
    case "caption": return "captions";
    case "group": return "group";
    default: return String(internalItem?.legacy?.collection ?? "group");
  }
}

function checkEngineField({
  canonicalPath,
  actualPath,
  consumedByGpu = false,
  appliesTo,
  engine,
  table,
  rowsByPath,
  findings,
}) {
  const row = (rowsByPath.get(canonicalPath) ?? []).find((candidate) =>
    Array.isArray(candidate.applies_to) && candidate.applies_to.includes(appliesTo));
  const engines = engine === "auto" ? table.engines.filter((value) => value === "gpu" || value === "osr") : [engine];
  if (!row) {
    addEngineFinding(findings, {
      check: "engine.capability-unknown",
      severity: "warning",
      engines,
      auto: engine === "auto",
      body: `${canonicalPath} は対応表 packages/schemas/engine-capabilities.json に無いフィールドです（表の更新漏れ）`,
      actualPath,
    });
    return;
  }
  const actionable = engines.flatMap((engineName) => {
    if (engineName === "gpu" && consumedByGpu) return [];
    const status = row[engineName];
    if (status === "ignored") {
      return [{
        engine: engineName,
        check: "engine.unsupported-field",
        severity: "error",
        body: `${canonicalPath} を消費しません（${actualPath}・描画には反映されません）${row.hint ? `。hint: ${row.hint}` : ""}`,
      }];
    }
    if (status === "partial") {
      return [{
        engine: engineName,
        check: "engine.partial-field",
        severity: "warning",
        body: `${canonicalPath} は近似です（${row.note ?? "一部の宣言だけが反映されます"}）`,
      }];
    }
    return [];
  });
  if (actionable.length === 0) return;
  const first = actionable[0];
  if (engine === "auto" && actionable.length === engines.length
    && actionable.every((entry) => entry.check === first.check
      && entry.severity === first.severity && entry.body === first.body)) {
    addFinding(findings, {
      check: first.check,
      severity: first.severity,
      message: `gpu/osr: ${first.body}`,
      path: `edit.json#${actualPath}`,
    });
    return;
  }
  for (const entry of actionable) {
    addFinding(findings, {
      check: entry.check,
      severity: entry.severity,
      message: engine === "auto" ? `${entry.engine}: ${entry.body}` : `${entry.engine} 経路は ${entry.body}`,
      path: `edit.json#${actualPath}`,
    });
  }
}

function addEngineFinding(findings, { check, severity, engines, auto, body, actualPath }) {
  if (auto && engines.length === 2) {
    addFinding(findings, { check, severity, message: `gpu/osr: ${body}`, path: `edit.json#${actualPath}` });
    return;
  }
  for (const engine of engines) {
    addFinding(findings, {
      check,
      severity,
      message: auto ? `${engine}: ${body}` : `${engine} 経路では ${body}`,
      path: `edit.json#${actualPath}`,
    });
  }
}
