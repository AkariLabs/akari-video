const CHECK = "overlays.world-scene-declaration";
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const nonEmptyString = value => typeof value === "string" && value.length > 0;

function finding(path, message) {
  return { severity: "error", check: CHECK, message, path };
}

function sameIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const ids = values => values.map(value => value?.id).sort();
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}

function sameTimes(left, right, fields) {
  if (!sameIds(left, right)) return false;
  const byId = new Map(right.map(value => [value.id, value]));
  return left.every(value => fields.every(field => {
    const expected = byId.get(value.id)?.[field];
    const actual = value[field];
    return actual === expected || (actual === undefined && expected === undefined);
  }));
}

function validateShape(value) {
  if (!isRecord(value)) return "宣言は JSON object である必要があります";
  const allowed = new Set(["schemaVersion", "kind", "frame", "worlds", "zones", "cameraStops", "edges", "retainedNodes", "render"]);
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) return `未知のキーです: ${unknown}`;
  if (value.schemaVersion !== 1) return "schemaVersion は 1 である必要があります";
  if (value.kind !== "flat") return "kind は flat である必要があります";
  if (!isRecord(value.frame) || !finite(value.frame.width) || value.frame.width <= 0 || !finite(value.frame.height) || value.frame.height <= 0) return "frame は正の width / height を持つ必要があります";
  for (const name of ["worlds", "zones", "cameraStops", "edges", "retainedNodes"]) if (!Array.isArray(value[name])) return `${name} は配列である必要があります`;
  if (!value.worlds.every(world => isRecord(world) && nonEmptyString(world.id) && isRecord(world.palette) && isRecord(world.flat) && Array.isArray(world.flat.bounds) && world.flat.bounds.length === 4 && world.flat.bounds.every(finite) && ["dots", "grid", "none"].includes(world.flat.pattern))) return "worlds の形が不正です";
  if (!value.zones.every(zone => isRecord(zone) && nonEmptyString(zone.id) && nonEmptyString(zone.world) && Array.isArray(zone.c) && zone.c.length === 2 && zone.c.every(finite))) return "zones の形が不正です";
  if (!value.cameraStops.every(stop => isRecord(stop) && nonEmptyString(stop.id) && nonEmptyString(stop.world) && finite(stop.at) && finite(stop.leave) && Array.isArray(stop.c) && stop.c.length === 3 && stop.c.every(finite))) return "cameraStops の形が不正です";
  if (!value.edges.every(edge => isRecord(edge) && nonEmptyString(edge.id) && nonEmptyString(edge.from) && nonEmptyString(edge.to) && nonEmptyString(edge.type) && finite(edge.t0) && finite(edge.t1) && isRecord(edge.transition) && nonEmptyString(edge.transition.kind) && finite(edge.transition.cover) && (edge.switchTime === undefined || finite(edge.switchTime)))) return "edges の形が不正です";
  if (value.render !== undefined && (!isRecord(value.render) || ["dotStep", "margin", "hazeAlpha"].some(name => value.render[name] !== undefined && !finite(value.render[name])))) return "render の形が不正です";
  return null;
}

export function validateWorldSceneDeclaration(html, worldMapText, path) {
  const pattern = /<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'))(?=[^>]*\sdata-akari-world-scene(?=\s|=|\/?>))[^>]*>([\s\S]*?)<\/script\s*>/giu;
  const declarations = [...html.matchAll(pattern)];
  if (!declarations.length) return [];
  if (declarations.length !== 1) return [finding(path, "data-akari-world-scene 宣言は 1 個である必要があります")];
  let descriptor;
  try { descriptor = JSON.parse(declarations[0][1]); }
  catch (error) { return [finding(path, `宣言 JSON を読めません: ${error.message}`)]; }
  const shapeError = validateShape(descriptor);
  if (shapeError) return [finding(path, shapeError)];
  if (worldMapText === null) return [];
  let worldMap;
  try { worldMap = JSON.parse(worldMapText); }
  catch (error) { return [finding(path, `planning/world-map.json を読めません: ${error.message}`)]; }
  for (const name of ["worlds", "zones", "cameraStops", "edges"]) {
    if (!sameIds(descriptor[name], worldMap?.[name])) return [finding(path, `planning/world-map.json と ${name} の id 集合が一致しません`)];
  }
  if (!sameTimes(descriptor.cameraStops, worldMap.cameraStops, ["at", "leave"])) return [finding(path, "planning/world-map.json と cameraStops の時刻が一致しません")];
  if (!sameTimes(descriptor.edges, worldMap.edges, ["t0", "t1", "switchTime"])) return [finding(path, "planning/world-map.json と edges の時刻が一致しません")];
  const transitionTimesMatch = descriptor.edges.every(edge => worldMap.edges.find(item => item.id === edge.id)?.transition?.cover === edge.transition.cover);
  return transitionTimesMatch ? [] : [finding(path, "planning/world-map.json と edges.transition.cover が一致しません")];
}
