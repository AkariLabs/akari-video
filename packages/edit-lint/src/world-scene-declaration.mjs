import { lintText } from './i18n.mjs';

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
  if (!isRecord(value)) return lintText('lint-messages.worldScene.shape.objectRequired');
  const allowed = new Set(["schemaVersion", "kind", "frame", "worlds", "zones", "cameraStops", "edges", "retainedNodes", "render"]);
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) return lintText('lint-messages.worldScene.shape.unknownKey', { key: unknown });
  if (value.schemaVersion !== 1) return lintText('lint-messages.worldScene.shape.schemaVersion');
  if (value.kind !== "flat") return lintText('lint-messages.worldScene.shape.flatKind');
  if (!isRecord(value.frame) || !finite(value.frame.width) || value.frame.width <= 0 || !finite(value.frame.height) || value.frame.height <= 0) return lintText('lint-messages.worldScene.shape.frame');
  for (const name of ["worlds", "zones", "cameraStops", "edges", "retainedNodes"]) if (!Array.isArray(value[name])) return lintText('lint-messages.worldScene.shape.array', { name });
  if (!value.worlds.every(world => isRecord(world) && nonEmptyString(world.id) && isRecord(world.palette) && isRecord(world.flat) && Array.isArray(world.flat.bounds) && world.flat.bounds.length === 4 && world.flat.bounds.every(finite) && ["dots", "grid", "none"].includes(world.flat.pattern))) return lintText('lint-messages.worldScene.shape.worlds');
  if (!value.zones.every(zone => isRecord(zone) && nonEmptyString(zone.id) && nonEmptyString(zone.world) && Array.isArray(zone.c) && zone.c.length === 2 && zone.c.every(finite))) return lintText('lint-messages.worldScene.shape.zones');
  if (!value.cameraStops.every(stop => isRecord(stop) && nonEmptyString(stop.id) && nonEmptyString(stop.world) && finite(stop.at) && finite(stop.leave) && Array.isArray(stop.c) && stop.c.length === 3 && stop.c.every(finite))) return lintText('lint-messages.worldScene.shape.cameraStops');
  if (!value.edges.every(edge => isRecord(edge) && nonEmptyString(edge.id) && nonEmptyString(edge.from) && nonEmptyString(edge.to) && nonEmptyString(edge.type) && finite(edge.t0) && finite(edge.t1) && isRecord(edge.transition) && nonEmptyString(edge.transition.kind) && finite(edge.transition.cover) && (edge.switchTime === undefined || finite(edge.switchTime)))) return lintText('lint-messages.worldScene.shape.edges');
  if (value.render !== undefined && (!isRecord(value.render) || ["dotStep", "margin", "hazeAlpha"].some(name => value.render[name] !== undefined && !finite(value.render[name])))) return lintText('lint-messages.worldScene.shape.render');
  return null;
}

export function validateWorldSceneDeclaration(html, worldMapText, path) {
  const pattern = /<script\b(?=[^>]*\btype\s*=\s*(?:"application\/json"|'application\/json'))(?=[^>]*\sdata-akari-world-scene(?=\s|=|\/?>))[^>]*>([\s\S]*?)<\/script\s*>/giu;
  const declarations = [...html.matchAll(pattern)];
  if (!declarations.length) return [];
  if (declarations.length !== 1) return [finding(path, lintText('lint-messages.worldScene.declaration.single'))];
  let descriptor;
  try { descriptor = JSON.parse(declarations[0][1]); }
  catch (error) { return [finding(path, lintText('lint-messages.worldScene.declaration.invalidJson', { message: error.message }))]; }
  const shapeError = validateShape(descriptor);
  if (shapeError) return [finding(path, shapeError)];
  if (worldMapText === null) return [];
  let worldMap;
  try { worldMap = JSON.parse(worldMapText); }
  catch (error) { return [finding(path, lintText('lint-messages.worldScene.worldMap.invalidJson', { message: error.message }))]; }
  for (const name of ["worlds", "zones", "cameraStops", "edges"]) {
    if (!sameIds(descriptor[name], worldMap?.[name])) return [finding(path, lintText('lint-messages.worldScene.worldMap.idMismatch', { name }))];
  }
  if (!sameTimes(descriptor.cameraStops, worldMap.cameraStops, ["at", "leave"])) return [finding(path, lintText('lint-messages.worldScene.worldMap.cameraTimes'))];
  if (!sameTimes(descriptor.edges, worldMap.edges, ["t0", "t1", "switchTime"])) return [finding(path, lintText('lint-messages.worldScene.worldMap.edgeTimes'))];
  const transitionTimesMatch = descriptor.edges.every(edge => worldMap.edges.find(item => item.id === edge.id)?.transition?.cover === edge.transition.cover);
  return transitionTimesMatch ? [] : [finding(path, lintText('lint-messages.worldScene.worldMap.coverMismatch'))];
}
