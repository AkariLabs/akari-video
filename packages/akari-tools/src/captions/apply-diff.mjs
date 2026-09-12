function keyedRows(rows) {
  const ordinals = new Map();
  return rows.map((row, index) => {
    const segment = row?.sourceRef?.segment;
    if (!Number.isInteger(segment)) {
      return { row, index, key: typeof row?.id === "string" ? `id:${row.id}` : `pos:${index}` };
    }
    const src = typeof row?.src === "string" ? row.src : "";
    const base = `${src}:${segment}`;
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    return { row, index, key: `seg:${base}#${ordinal}` };
  });
}

function differs(existing, next) {
  return existing?.text !== next?.text || existing?.start !== next?.start || existing?.end !== next?.end;
}

export function mergeCaptionsForApply(existing, next, { force = false } = {}) {
  const existingRows = keyedRows(Array.isArray(existing) ? existing : []);
  const nextRows = keyedRows(Array.isArray(next) ? next : []);
  const existingByKey = new Map();
  for (const entry of existingRows) if (!existingByKey.has(entry.key)) existingByKey.set(entry.key, entry);

  const matched = new Set();
  const output = [];
  const counts = { added: 0, changed: 0, protected: 0, removed: 0 };
  for (const entry of nextRows) {
    const previous = existingByKey.get(entry.key);
    if (previous) matched.add(previous.index);
    if (previous?.row?.edited === true && !force) {
      output.push({ row: previous.row, kind: "protected", order: output.length });
      counts.protected += 1;
    } else {
      const kind = previous ? (differs(previous.row, entry.row) ? "changed" : undefined) : "added";
      if (kind) counts[kind] += 1;
      output.push({ row: entry.row, kind, order: output.length });
    }
  }
  for (const entry of existingRows) {
    if (matched.has(entry.index)) continue;
    if (entry.row?.edited === true && !force) {
      output.push({ row: entry.row, kind: "protected", order: output.length });
      counts.protected += 1;
    } else {
      counts.removed += 1;
    }
  }

  output.sort((a, b) => {
    const startA = Number.isFinite(a.row?.start) ? a.row.start : 0;
    const startB = Number.isFinite(b.row?.start) ? b.row.start : 0;
    return startA - startB || a.order - b.order;
  });

  const protectedIds = new Set(output.filter(item => item.kind === "protected" && typeof item.row?.id === "string").map(item => item.row.id));
  const used = new Set();
  let candidate = 1;
  const nextId = () => {
    let id;
    do id = `c-${String(candidate++).padStart(4, "0")}`;
    while (used.has(id) || protectedIds.has(id));
    return id;
  };
  for (const item of output) {
    if (item.kind === "protected") {
      if (typeof item.row?.id === "string") used.add(item.row.id);
      continue;
    }
    if (typeof item.row?.id !== "string" || used.has(item.row.id) || protectedIds.has(item.row.id)) {
      item.row = { ...item.row, id: nextId() };
    }
    used.add(item.row.id);
  }

  const ids = { added: [], changed: [], protected: [], removed: [] };
  for (const item of output) {
    if (item.kind && typeof item.row?.id === "string") ids[item.kind].push(item.row.id);
  }
  for (const entry of existingRows) {
    if (!matched.has(entry.index) && !(entry.row?.edited === true && !force) && typeof entry.row?.id === "string") {
      ids.removed.push(entry.row.id);
    }
  }
  return {
    captions: output.map(item => item.row),
    summary: { ...counts, total: output.length, ids }
  };
}
