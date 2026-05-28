import type { Vec2 } from './types';

/** 点击与首点距离小于该值（逻辑坐标 px）时视为闭合 */
export const POLYGON_CLOSE_THRESHOLD = 18;

export function vecDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 改边数：点击落在多边形边线上（含与顶点重合的端点）的容差，逻辑 px */
export const POLYGON_BOUNDARY_HIT_THRESHOLD = 10;

/** 点 p 到闭合多边形任一边的距离是否 ≤ maxDist（在边线上视为命中） */
export function isPointOnPolygonBoundary(
  p: Vec2,
  ring: Vec2[],
  maxDist: number = POLYGON_BOUNDARY_HIT_THRESHOLD,
): boolean {
  const norm = normalizeClosedPolygon(ring);
  const n = norm.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const a = norm[i];
    const b = norm[(i + 1) % n];
    if (vecDistance(p, projectPointOnSegment(p, a, b)) <= maxDist) return true;
  }
  return false;
}

/** 点 p 在线段 ab 上的最近点（含端点） */
export function projectPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * abx, y: a.y + t * aby };
}

// ---------------------------------------------------------------------------
// 边线插入 API（仅供 geometry.test.ts；产品 UI 改边数用外侧 applyDraftPoint，不在边线上追加点）
// ---------------------------------------------------------------------------

/**
 * 在闭合多边形上查找距 p 最近的边（用于「边上加点」）。
 * 距已有顶点过近时不算命中边，避免与删点冲突。
 * @internal 仅供单元测试，map-region-editor UI 不调用。
 */
export function findEdgeForPointInsert(
  ring: Vec2[],
  p: Vec2,
  maxDist: number,
  vertexExcludeDist: number,
): { edgeIndex: number; point: Vec2 } | null {
  const norm = normalizeClosedPolygon(ring);
  const n = norm.length;
  if (n < 3) return null;

  let best: { edgeIndex: number; point: Vec2; dist: number } | null = null;
  for (let i = 0; i < n; i++) {
    if (vecDistance(p, norm[i]) <= vertexExcludeDist) continue;
    const a = norm[i];
    const b = norm[(i + 1) % n];
    const point = projectPointOnSegment(p, a, b);
    const dist = vecDistance(p, point);
    if (dist <= maxDist && (!best || dist < best.dist)) {
      best = { edgeIndex: i, point, dist };
    }
  }
  return best ? { edgeIndex: best.edgeIndex, point: best.point } : null;
}

/** 在边 `edgeIndex` → `edgeIndex+1` 之间插入顶点。@internal 仅供单元测试。 */
export function insertVertexOnEdge(ring: Vec2[], edgeIndex: number, p: Vec2): Vec2[] {
  const norm = normalizeClosedPolygon(ring);
  const at = edgeIndex + 1;
  return [...norm.slice(0, at), { x: p.x, y: p.y }, ...norm.slice(at)];
}

/** 删除一个顶点；至少保留 3 个顶点 */
export function removePolygonVertex(ring: Vec2[], vertexIndex: number): Vec2[] | null {
  const norm = normalizeClosedPolygon(ring);
  if (norm.length <= 3) return null;
  if (vertexIndex < 0 || vertexIndex >= norm.length) return null;
  return norm.filter((_, i) => i !== vertexIndex);
}

export type PolygonEditResult = { polygon: Vec2[] } | { error: string };

/** 在边上插入顶点并校验简单多边形。@internal 仅供单元测试。 */
export function tryInsertVertexOnEdge(
  ring: Vec2[],
  p: Vec2,
  maxDist: number,
  vertexExcludeDist: number,
): PolygonEditResult {
  const hit = findEdgeForPointInsert(ring, p, maxDist, vertexExcludeDist);
  if (!hit) {
    return { error: '请点击热区边线以添加顶点' };
  }
  const next = insertVertexOnEdge(ring, hit.edgeIndex, hit.point);
  if (polygonHasSelfIntersection(next)) {
    return { error: '边不能交叉：无法在此位置添加顶点' };
  }
  return { polygon: next };
}

/** 删除顶点并校验 */
export function tryRemovePolygonVertex(ring: Vec2[], vertexIndex: number): PolygonEditResult {
  const next = removePolygonVertex(ring, vertexIndex);
  if (!next) {
    return { error: '至少保留 3 个顶点' };
  }
  if (polygonHasSelfIntersection(next)) {
    return { error: '边不能交叉：无法删除该顶点' };
  }
  return { polygon: next };
}

/** 去掉与首点重复的末点；保存与命中检测均按闭合环处理 */
export function normalizeClosedPolygon(points: Vec2[]): Vec2[] {
  if (points.length < 3) return [...points];
  const ring = [...points];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (vecDistance(first, last) < 1) {
    ring.pop();
  }
  return ring.length >= 3 ? ring : [...points];
}

export function canClosePolygonAt(
  point: Vec2,
  polygon: Vec2[],
  threshold = POLYGON_CLOSE_THRESHOLD,
): boolean {
  return polygon.length >= 3 && vecDistance(point, polygon[0]) <= threshold;
}

export function pointInPolygon(x: number, y: number, polygon: Vec2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  return (
    Math.min(ax, bx) <= px &&
    px <= Math.max(ax, bx) &&
    Math.min(ay, by) <= py &&
    py <= Math.max(ay, by)
  );
}

export function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const o1 = orient(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y);
  const o2 = orient(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y);
  const o3 = orient(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y);
  const o4 = orient(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y);

  if (o1 === 0 && onSegment(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y)) return true;
  if (o2 === 0 && onSegment(b2.x, b2.y, a1.x, a1.y, a2.x, a2.y)) return true;
  if (o3 === 0 && onSegment(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y)) return true;
  if (o4 === 0 && onSegment(a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) return true;

  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/** 闭合多边形中两条边是否共用顶点（含首尾相邻） */
function areAdjacentEdges(n: number, edgeI: number, edgeJ: number): boolean {
  if (edgeI === edgeJ) return true;
  if ((edgeI + 1) % n === edgeJ) return true;
  if ((edgeJ + 1) % n === edgeI) return true;
  return false;
}

/**
 * 简单多边形：顶点按边界顺序连接，任意两条非邻边不相交。
 * （与 mapPick 一致：存顶点环，隐式闭合；不能按任意顺序连点。）
 */
export function polygonHasSelfIntersection(polygon: Vec2[]): boolean {
  const ring = normalizeClosedPolygon(polygon);
  const n = ring.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (areAdjacentEdges(n, i, j)) continue;
      const b1 = ring[j];
      const b2 = ring[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** 校验是否为可保存的简单多边形；失败返回提示文案 */
export function validateSimplePolygon(polygon: Vec2[]): string | null {
  const ring = normalizeClosedPolygon(polygon);
  if (ring.length < 3) return '至少绘制 3 个顶点';
  if (polygonHasSelfIntersection(ring)) {
    return '边不能交叉：请沿区域边界依次点击顶点（顺时针或逆时针绕行一圈）';
  }
  return null;
}

/** 点击「完成」时校验（未满 3 点用进度提示，不用加点时的同一套文案） */
export function validateFinishPolygon(polygon: Vec2[]): string | null {
  const ring = normalizeClosedPolygon(polygon);
  if (ring.length < 3) {
    if (ring.length === 0) return '请在地图上点击顶点';
    return `当前 ${ring.length} 个顶点，完成热区至少需要 3 个`;
  }
  if (polygonHasSelfIntersection(ring)) {
    return '边不能交叉：请沿区域边界依次点击顶点（顺时针或逆时针绕行一圈）';
  }
  return null;
}

/** 在开放顶点链中找出距 p 最近的两颗顶点（索引） */
export function twoClosestVertexIndices(
  points: Vec2[],
  p: Vec2,
  exclude?: number,
): [number, number] {
  const ranked: { index: number; dist: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    if (exclude !== undefined && i === exclude) continue;
    ranked.push({ index: i, dist: vecDistance(points[i], p) });
  }
  ranked.sort((a, b) => a.dist - b.dist);
  if (ranked.length === 0) return [0, 0];
  if (ranked.length === 1) return [ranked[0].index, ranked[0].index];
  return [ranked[0].index, ranked[1].index];
}

/** 将 p 插入开放链中 i、j 之间（按链上从 lo 到 hi 的路径） */
export function insertPointBetweenVertices(chain: Vec2[], p: Vec2, i: number, j: number): Vec2[] {
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  if (hi === lo + 1) {
    return [...chain.slice(0, hi), p, ...chain.slice(hi)];
  }
  return [...chain.slice(0, lo + 1), p, ...chain.slice(lo + 1, hi + 1), ...chain.slice(hi + 1)];
}

/** 新点与已有链中最近两点之间插入，并更新连线顺序 */
export function insertPointBetweenNearest(chain: Vec2[], p: Vec2): Vec2[] {
  if (chain.length < 2) return [...chain, p];
  const [i, j] = twoClosestVertexIndices(chain, p);
  return insertPointBetweenVertices(chain, p, i, j);
}

export type ApplyDraftPointResult = { points: Vec2[]; fixed: boolean } | { error: string };

/**
 * 绘制中追加顶点：先按点击顺序接在末尾；若闭合后非邻边相交，
 * 则改为插入到距新点最近的两颗已有顶点之间。
 */
export function applyDraftPoint(ring: Vec2[], next: Vec2): ApplyDraftPointResult {
  const appended = [...ring, next];
  const normAppend = normalizeClosedPolygon(appended);
  if (normAppend.length < 3) {
    return { points: appended, fixed: false };
  }
  if (!polygonHasSelfIntersection(normAppend)) {
    return { points: appended, fixed: false };
  }

  const fixed = insertPointBetweenNearest(ring, next);
  const normFixed = normalizeClosedPolygon(fixed);
  if (normFixed.length >= 3 && !polygonHasSelfIntersection(normFixed)) {
    return { points: fixed, fixed: true };
  }

  return {
    error: '边不能交叉：请沿区域边界依次点击顶点（顺时针或逆时针绕行一圈）',
  };
}

/** 闭合多边形仍自交时，将最后一个顶点按「最近两点插入」规则重排 */
export function tryFixSimplePolygon(points: Vec2[]): Vec2[] | null {
  const ring = normalizeClosedPolygon(points);
  if (ring.length < 3) return null;
  if (!polygonHasSelfIntersection(ring)) return [...points];

  const last = ring[ring.length - 1];
  const chain = ring.slice(0, -1);
  if (chain.length < 2) return null;

  const fixed = insertPointBetweenNearest(chain, last);
  const norm = normalizeClosedPolygon(fixed);
  if (norm.length >= 3 && !polygonHasSelfIntersection(norm)) return fixed;
  return null;
}

export type ApplyVertexMoveResult = { points: Vec2[]; rewired: boolean };

/**
 * 拖动单个顶点后保持简单多边形：先原位替换；若自交则按最近两点重排该顶点。
 */
export function applyVertexMove(
  ring: Vec2[],
  vertexIndex: number,
  newPos: Vec2,
): ApplyVertexMoveResult | null {
  const moved = ring.map((p, i) => (i === vertexIndex ? newPos : { ...p }));
  const norm = normalizeClosedPolygon(moved);
  if (norm.length < 3) return { points: moved, rewired: false };
  if (!polygonHasSelfIntersection(norm)) return { points: moved, rewired: false };

  const others = ring.filter((_, i) => i !== vertexIndex);
  if (others.length < 2) return null;

  const [i, j] = twoClosestVertexIndices(others, newPos);
  const reordered = insertPointBetweenVertices(others, newPos, i, j);
  const norm2 = normalizeClosedPolygon(reordered);
  if (norm2.length >= 3 && !polygonHasSelfIntersection(norm2)) {
    return { points: reordered, rewired: true };
  }
  return null;
}

/** @deprecated 请使用 {@link applyDraftPoint} */
export function validateSimplePolygonAfterAdd(ring: Vec2[], next: Vec2): string | null {
  const result = applyDraftPoint(ring, next);
  return 'error' in result ? result.error : null;
}

/** 两多边形是否有面积重叠（含边相交、顶点落入对方内部） */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;

  for (const p of a) {
    if (pointInPolygon(p.x, p.y, b)) return true;
  }
  for (const p of b) {
    if (pointInPolygon(p.x, p.y, a)) return true;
  }

  const na = a.length;
  const nb = b.length;
  for (let i = 0; i < na; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % na];
    for (let j = 0; j < nb; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % nb];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

export function polygonOverlapsAny(candidate: Vec2[], others: Vec2[][]): boolean {
  return others.some((poly) => polygonsOverlap(candidate, poly));
}

/** 拖动顶点 / 整体移动后是否违反简单多边形或与其它热区重叠 */
export function isRegionPlacementInvalid(
  polygon: Vec2[],
  regionId: string,
  all: ReadonlyArray<{ id: string; polygon: Vec2[] }>,
): boolean {
  const ring = normalizeClosedPolygon(polygon);
  if (ring.length >= 4 && polygonHasSelfIntersection(ring)) return true;
  const others = all.filter((r) => r.id !== regionId).map((r) => r.polygon);
  return polygonOverlapsAny(ring, others);
}

/** 平移多边形，并将位移限制在地图边界内（保持形状不变） */
export function translatePolygonClamped(
  polygon: Vec2[],
  dx: number,
  dy: number,
  mapWidth: number,
  mapHeight: number,
): Vec2[] {
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;

  for (const p of polygon) {
    minDx = Math.max(minDx, -p.x);
    maxDx = Math.min(maxDx, mapWidth - p.x);
    minDy = Math.max(minDy, -p.y);
    maxDy = Math.min(maxDy, mapHeight - p.y);
  }

  const tx = Math.min(maxDx, Math.max(minDx, dx));
  const ty = Math.min(maxDy, Math.max(minDy, dy));

  return polygon.map((p) => ({ x: p.x + tx, y: p.y + ty }));
}

export function clampToMap(x: number, y: number, width: number, height: number): Vec2 {
  return {
    x: Math.min(width, Math.max(0, x)),
    y: Math.min(height, Math.max(0, y)),
  };
}

export function polygonToPoints(polygon: Vec2[]): string {
  return polygon.map((p) => `${p.x},${p.y}`).join(' ');
}
