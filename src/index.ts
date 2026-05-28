export { MapRegionEditor, type MapRegionEditorProps } from './MapRegionEditor';

export type { PolygonRegion, Vec2 } from './types';
export { MAP_LOGICAL_HEIGHT, MAP_LOGICAL_WIDTH } from './types';

export {
  applyDraftPoint,
  applyVertexMove,
  canClosePolygonAt,
  clampToMap,
  isPointOnPolygonBoundary,
  isRegionPlacementInvalid,
  normalizeClosedPolygon,
  pointInPolygon,
  polygonHasSelfIntersection,
  polygonOverlapsAny,
  polygonToPoints,
  POLYGON_CLOSE_THRESHOLD,
  segmentsIntersect,
  translatePolygonClamped,
  tryRemovePolygonVertex,
  validateFinishPolygon,
  validateSimplePolygon,
  vecDistance,
} from './geometry';
