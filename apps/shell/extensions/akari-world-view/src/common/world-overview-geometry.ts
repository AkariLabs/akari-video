export const WORLD_OVERVIEW_GEOMETRY_SOURCE = `
function akariOverviewView(bounds, size, pad) {
  const minX = Math.min(...bounds.map(b => b[0]));
  const minY = Math.min(...bounds.map(b => b[1]));
  const maxX = Math.max(...bounds.map(b => b[0] + b[2]));
  const maxY = Math.max(...bounds.map(b => b[1] + b[3]));
  const scale = Math.min((size.width - pad * 2) / (maxX - minX), (size.height - pad * 2) / (maxY - minY));
  return { scale, ox: pad - minX * scale, oy: pad - minY * scale };
}
function akariCanvasPoint(canvasSize, rect, client) {
  return { x: (client.x - rect.left) * canvasSize.width / rect.width, y: (client.y - rect.top) * canvasSize.height / rect.height };
}
function akariWorldPoint(view, canvasPoint) {
  return { x: (canvasPoint.x - view.ox) / view.scale, y: (canvasPoint.y - view.oy) / view.scale };
}
function akariScreenPoint(view, worldPoint) {
  return { x: view.ox + worldPoint.x * view.scale, y: view.oy + worldPoint.y * view.scale };
}
function akariHitTestStop(stops, view, canvasPoint, radius) {
  let found = null, best = radius * radius;
  for (let index = 0; index < stops.length; index += 1) {
    const point = akariScreenPoint(view, { x: stops[index].c[0], y: stops[index].c[1] });
    const distance = (point.x - canvasPoint.x) ** 2 + (point.y - canvasPoint.y) ** 2;
    if (distance <= best) { best = distance; found = stops[index].id; }
  }
  return found;
}
`;
