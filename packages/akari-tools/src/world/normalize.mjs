const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export function normalizeWorldMap(json) {
  if (json?.schemaVersion === 3) return { map: copy(json), notes: [] };

  const source = json && typeof json === "object" ? json : {};
  const notes = [];
  const sourceStops = Array.isArray(source.cameraStops) ? source.cameraStops : [];
  const sourceZones = Array.isArray(source.zones) ? source.zones : [];
  const kind = source.kind ?? (sourceStops.some((stop) => stop?.eye || stop?.target) ? "spatial" : "flat");
  if (!source.kind) notes.push(`kind を ${kind} と推定した`);

  const wrapped = !Array.isArray(source.worlds) || source.worlds.length === 0;
  let worlds;
  if (wrapped) {
    notes.push("worlds が無いので 1 世界に包んだ");
    if (kind === "spatial") {
      worlds = [{ id: "world", label: "world", spatial: { c: [0, 0, 0] } }];
      notes.push("世界の c は原点を既定にした");
    } else {
      const points = sourceZones.map((zone) => zone?.c).filter((c) => Array.isArray(c) && c.length >= 2);
      const xs = points.map((c) => c[0]);
      const ys = points.map((c) => c[1]);
      const minX = points.length ? Math.min(...xs) : 0;
      const minY = points.length ? Math.min(...ys) : 0;
      const maxX = points.length ? Math.max(...xs) : 1;
      const maxY = points.length ? Math.max(...ys) : 1;
      worlds = [{ id: "world", label: "world", flat: { bounds: [minX, minY, maxX - minX || 1, maxY - minY || 1], pattern: "none" } }];
      notes.push("世界の bounds を zone 座標から導出した");
    }
  } else {
    worlds = source.worlds.map((world) => normalizeWorld(world, kind, notes));
  }

  let droppedZoneKeys = false;
  const zones = sourceZones.map((zone) => {
    if (Object.keys(zone).some((key) => !["id", "label", "world", "c"].includes(key))) droppedZoneKeys = true;
    return { id: zone.id, label: zone.label ?? zone.id, world: zone.world ?? worlds[0]?.id, c: copy(zone.c) };
  });
  if (droppedZoneKeys) notes.push("zone の v3 に無いキーを除いた");

  const cameraStops = sourceStops.map((stop, index) => {
    const id = stop.id ?? sourceZones[index]?.id;
    if (!stop.id) notes.push(`cameraStop[${index}] の id を同じ位置の zone から補った`);
    const result = { id, world: stop.world ?? worlds[0]?.id, at: stop.at, leave: stop.leave };
    if (stop.label !== undefined) result.label = stop.label;
    if (kind === "flat") result.c = copy(stop.c);
    else {
      result.eye = copy(stop.eye);
      result.target = copy(stop.target);
    }
    return result;
  });

  let edges;
  if (!Array.isArray(source.edges) || source.edges.length === 0) {
    edges = cameraStops.slice(0, -1).map((from, index) => {
      const to = cameraStops[index + 1];
      return { id: `${from.id}-${to.id}`, from: from.id, to: to.id, type: "move", t0: from.leave, t1: to.at, transition: { kind: "none", cover: 0 } };
    });
    if (edges.length) notes.push("edges が無いため C3 から move 辺を導出した");
  } else {
    let droppedEdgeKeys = false;
    const stopById = new Map(cameraStops.map((stop) => [stop.id, stop]));
    edges = source.edges.map((edge) => {
      if (Object.keys(edge).some((key) => !["id", "from", "to", "type", "t0", "t1", "switchTime", "transition", "via", "carry", "easing"].includes(key))) droppedEdgeKeys = true;
      const type = edge.type ?? "move";
      const t0 = edge.t0 ?? stopById.get(edge.from)?.leave;
      const t1 = edge.t1 ?? stopById.get(edge.to)?.at;
      const result = {
        id: edge.id ?? `${edge.from}-${edge.to}`,
        from: edge.from,
        to: edge.to,
        type,
        t0,
        t1,
        transition: copy(edge.transition) ?? (type === "move" ? { kind: "none", cover: 0 } : { kind: type === "portal" ? "dive" : "mist", cover: null }),
      };
      if (type !== "move") result.switchTime = edge.switchTime ?? (t0 + t1) / 2;
      for (const key of ["via", "carry", "easing"]) if (edge[key] !== undefined) result[key] = copy(edge[key]);
      return result;
    });
    if (droppedEdgeKeys) notes.push("edge の v3 に無いキーを除いた");
  }

  const map = {
    schemaVersion: 3,
    kind,
    worlds,
    zones,
    cameraStops,
    edges,
    retainedNodes: copy(source.retainedNodes) ?? [],
  };
  if (source.inventory !== undefined) map.inventory = copy(source.inventory);
  const topExtras = Object.keys(source).filter((key) => !["schemaVersion", "kind", "worlds", "zones", "cameraStops", "edges", "retainedNodes", "inventory"].includes(key));
  if (topExtras.length) notes.push("トップレベルの v3 に無いキーを除いた");
  return { map, notes };
}

function normalizeWorld(world, kind, notes) {
  const result = { id: world.id, label: world.label ?? world.id };
  if (world.palette) {
    result.palette = kind === "spatial"
      ? { background: world.palette.floor, dots: world.palette.dots, accent: world.palette.paper, ...(world.palette.haze === undefined ? {} : { haze: world.palette.haze }) }
      : copy(world.palette);
    if (kind === "spatial") notes.push(`world ${world.id} の palette キーを v3 へ写した`);
  }
  if (kind === "flat") {
    result.flat = { bounds: copy(world.bounds), pattern: world.pattern ?? "none" };
    if (world.far !== undefined) result.flat.far = copy(world.far);
    if (Object.keys(world).some((key) => !["id", "label", "palette", "bounds", "pattern", "far"].includes(key))) notes.push(`world ${world.id} の v3 に無いキーを除いた`);
  } else {
    result.spatial = { c: copy(world.c) ?? [0, 0, 0] };
    if (world.c === undefined) notes.push(`world ${world.id} の c は原点を既定にした`);
    for (const key of ["floor", "background", "haze"]) if (world[key] !== undefined) result.spatial[key] = copy(world[key]);
    if (Object.keys(world).some((key) => !["id", "label", "palette", "c", "floor", "background", "haze"].includes(key))) notes.push(`world ${world.id} の v3 に無いキーを除いた`);
  }
  return result;
}
