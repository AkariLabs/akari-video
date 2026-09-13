const APPROACH_ZOOM = 2;
const APPROACH_CLOSE = 0.25;

export function createCamera(map) {
  const stops = [...map.cameraStops].sort((a, b) => a.at - b.at);
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const edgeByFrom = new Map(map.edges.map((edge) => [edge.from, edge]));
  const zoneById = new Map(map.zones.map((zone) => [zone.id, zone]));
  const flat = map.kind === "flat";

  return (t) => {
    if (t <= stops[0].at) return stopValue(stops[0], flat);
    if (t >= stops[stops.length - 1].leave) return stopValue(stops[stops.length - 1], flat);
    const resting = stops.find((stop) => stop.at <= t && t <= stop.leave);
    if (resting) return stopValue(resting, flat);
    const edge = stops.map((stop) => edgeByFrom.get(stop.id)).find((item) => item && item.t0 <= t && t <= item.t1);
    if (!edge) {
      const nearest = stops.reduce((best, stop) => Math.abs(t - stop.at) < Math.abs(t - best.at) ? stop : best, stops[0]);
      return stopValue(nearest, flat);
    }
    const from = stopById.get(edge.from);
    const to = stopById.get(edge.to);
    if (edge.type === "move") {
      const u = eased(edge, ratio(t, edge.t0, edge.t1));
      return flat
        ? flatValue(from.world, vector(from.c, to.c, u), "move", edge.id)
        : spatialValue(from.world, vector(from.eye, to.eye, u), vector(from.target, to.target, u), "move", edge.id);
    }
    const middle = edge.switchTime > edge.t0 && edge.switchTime < edge.t1 ? edge.switchTime : (edge.t0 + edge.t1) / 2;
    const approaching = t < middle;
    const u = eased(edge, approaching ? ratio(t, edge.t0, middle) : ratio(t, middle, edge.t1));
    if (flat) {
      const zone = zoneById.get(edge.via);
      const via = zone?.c ?? [(from.c[0] + to.c[0]) / 2, (from.c[1] + to.c[1]) / 2];
      const viaCamera = [via[0], via[1], Math.max(from.c[2], to.c[2]) * APPROACH_ZOOM];
      return approaching
        ? flatValue(from.world, vector(from.c, viaCamera, u), "approach", edge.id)
        : flatValue(to.world, vector(viaCamera, to.c, u), "escape", edge.id);
    }
    const zone = zoneById.get(edge.via);
    const via = zone?.c ?? vector(from.target, to.target, 0.5);
    const closeFrom = via.map((value, index) => value + (from.eye[index] - value) * APPROACH_CLOSE);
    const closeTo = via.map((value, index) => value + (to.eye[index] - value) * APPROACH_CLOSE);
    return approaching
      ? spatialValue(from.world, vector(from.eye, closeFrom, u), vector(from.target, via, u), "approach", edge.id)
      : spatialValue(to.world, vector(closeTo, to.eye, u), vector(via, to.target, u), "escape", edge.id);
  };
}

function stopValue(stop, flat) {
  return flat
    ? { world: stop.world, x: stop.c[0], y: stop.c[1], scale: stop.c[2], phase: "stop", stop: stop.id }
    : { world: stop.world, eye: [...stop.eye], target: [...stop.target], phase: "stop", stop: stop.id };
}

function flatValue(world, c, phase, edge) {
  return { world, x: c[0], y: c[1], scale: c[2], phase, edge };
}

function spatialValue(world, eye, target, phase, edge) {
  return { world, eye: [...eye], target: [...target], phase, edge };
}

function vector(a, b, u) {
  return a.map((value, index) => value + (b[index] - value) * u);
}

function ratio(value, start, end) {
  if (end === start) return 1;
  return Math.max(0, Math.min(1, (value - start) / (end - start)));
}

function eased(edge, u) {
  if (edge.easing === "linear") return u;
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
