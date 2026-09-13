const EPSILON = 1e-9;
const EDGE_TYPES = new Set(["move", "portal", "cut"]);
const TRANSITIONS = new Set(["none", "dive", "mist", "occluder", "fade", "push"]);
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function checkWorldMap(map, options = { strict: false }) {
  const errors = [];
  const warnings = [];
  const error = (code, message) => errors.push({ code, message });
  const warning = (code, message) => warnings.push({ code, message });
  const worlds = array(map?.worlds, "worlds", "C1", error);
  const zones = array(map?.zones, "zones", "C2", error);
  const stops = array(map?.cameraStops, "cameraStops", "C2", error);
  const edges = array(map?.edges, "edges", "C3", error);
  const retained = array(map?.retainedNodes, "retainedNodes", "C5", error);

  if (worlds.length < 1) error("C1", "worlds は 1 件以上必要です");
  const worldIds = new Set();
  for (const world of worlds) {
    if (worldIds.has(world?.id)) error("C1", `world id が重複しています: ${world?.id}`);
    worldIds.add(world?.id);
  }
  for (const world of worlds) {
    const count = zones.filter((zone) => zone?.world === world?.id).length;
    if (count < 2) error("C1", `world ${world?.id} を参照する zone は 2 件以上必要です`);
  }
  for (const zone of zones) if (!worldIds.has(zone?.world)) error("C1", `zone ${zone?.id} が未定義の world を参照しています`);

  const zoneIds = ids(zones, "zone", "C2", error);
  const stopIds = ids(stops, "cameraStop", "C2", error);
  if (!sameSet(zoneIds, stopIds)) error("C2", "zones と cameraStops の id 集合が一致しません");
  for (const stop of stops) if (!worldIds.has(stop?.world)) error("C2", `cameraStop ${stop?.id} が未定義の world を参照しています`);
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    if (!finite(stop?.at) || !finite(stop?.leave) || !(stop.at < stop.leave)) error("C2", `cameraStop ${stop?.id} は at < leave の有限数である必要があります`);
    if (index > 0) {
      const previous = stops[index - 1];
      if (!(previous.at <= stop.at)) error("C2", "cameraStops は at の昇順である必要があります");
      if (!(previous.leave <= stop.at)) error("C2", `cameraStop ${previous.id} と ${stop.id} の窓が重なっています`);
    }
  }

  if (edges.length !== Math.max(0, stops.length - 1)) error("C3", "edges の本数は cameraStops - 1 である必要があります");
  const stopById = new Map(stops.map((stop) => [stop?.id, stop]));
  edges.forEach((edge, index) => {
    const from = stopById.get(edge?.from);
    const to = stopById.get(edge?.to);
    if (!from || !to) error("C3", `edge ${edge?.id} の from / to が停留所を参照していません`);
    const expectedFrom = stops[index];
    const expectedTo = stops[index + 1];
    if (!expectedFrom || !expectedTo || edge?.from !== expectedFrom.id || edge?.to !== expectedTo.id || !near(edge?.t0, expectedFrom.leave) || !near(edge?.t1, expectedTo.at)) {
      error("C3", `edge ${edge?.id} が cameraStops の順序または時刻と一致しません`);
    }

    if (!EDGE_TYPES.has(edge?.type)) error("C4", `edge ${edge?.id} の type が未定義です`);
    if (edge?.type !== "move") {
      if (typeof edge?.via !== "string" || edge.via.length === 0) error("C4", `edge ${edge?.id} の via がありません`);
      if (!edge?.transition || typeof edge.transition !== "object") error("C4", `edge ${edge?.id} の transition がありません`);
      if (!finite(edge?.switchTime) || !(edge.t0 < edge.switchTime && edge.switchTime < edge.t1)) error("C4", `edge ${edge?.id} の switchTime は t0 と t1 の間である必要があります`);
    }

    if (from && to && from.world !== to.world) {
      if (!Array.isArray(edge?.carry) || edge.carry.length === 0) error("C5", `世界をまたぐ edge ${edge?.id} には carry が必要です`);
      else for (const item of edge.carry) if (!retained.includes(item)) error("C5", `edge ${edge?.id} の carry は retainedNodes の部分集合である必要があります: ${item}`);
    }

    const transitionKind = edge?.transition?.kind;
    if (!TRANSITIONS.has(transitionKind)) error("C6", `edge ${edge?.id} の transition.kind が未定義です`);
    if (map?.kind === "spatial" && transitionKind === "push") error("C6", `spatial の edge ${edge?.id} では push を使えません`);

    if (edge?.type === "cut") {
      const cover = edge?.transition?.cover;
      if (cover === null) {
        const report = { code: "C7", message: `cut edge ${edge?.id} の cover が未測定です` };
        (options?.strict ? errors : warnings).push(report);
      } else if (!finite(cover) || cover < 0 || cover > 0.4) {
        error("C7", `cut edge ${edge?.id} の cover は 0 以上 0.4 以下の有限数である必要があります`);
      }
    }

    // C8: portal の cover には時間閾値を課さない。
    if (from && to && from.world === to.world && edge?.type !== "move") error("C10", `同じ world 内の edge ${edge?.id} は move である必要があります`);
  });

  for (const world of worlds) {
    if (world?.palette) for (const [key, value] of Object.entries(world.palette)) if (!COLOR.test(value)) error("C9", `world ${world.id} の palette.${key} は 6 桁 hex である必要があります`);
    if (map?.kind === "flat") {
      const bounds = world?.flat?.bounds;
      if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(finite) || !(bounds[2] > 0) || !(bounds[3] > 0)) error("C9", `world ${world?.id} の flat.bounds は有限な [x,y,w,h] で w,h が正である必要があります`);
    } else if (world?.spatial?.floor) {
      const size = world.spatial.floor.size;
      if (!Array.isArray(size) || size.length !== 2 || !size.every(finite) || !size.every((value) => value > 0)) error("C9", `world ${world?.id} の floor.size は有限な正の 2 要素である必要があります`);
    }
  }

  if (worlds.length >= 2 && !edges.some((edge) => edge?.type === "portal")) warning("R1", "world が 2 件以上ある場合は portal を 1 本以上置くことを推奨します");
  return { errors, warnings };
}

function array(value, label, code, error) {
  if (Array.isArray(value)) return value;
  error(code, `${label} は配列である必要があります`);
  return [];
}

function ids(values, label, code, error) {
  const result = new Set();
  for (const value of values) {
    if (result.has(value?.id)) error(code, `${label} id が重複しています: ${value?.id}`);
    result.add(value?.id);
  }
  return result;
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= EPSILON;
const sameSet = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));
