import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Spin, Typography, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import {
  canClosePolygonAt,
  clampToMap,
  normalizeClosedPolygon,
  polygonOverlapsAny,
  polygonToPoints,
  pointInPolygon,
  isRegionPlacementInvalid,
  isPointOnPolygonBoundary,
  translatePolygonClamped,
  vecDistance,
  applyDraftPoint,
  applyVertexMove,
  tryFixSimplePolygon,
  tryRemovePolygonVertex,
  validateFinishPolygon,
  validateSimplePolygon,
} from './geometry';
import { v4 as uuidv4 } from 'uuid';
import { getMapImageDisplaySrc, isMapImageLoaded, preloadMapImage } from './preloadMapImage';
import type { PolygonRegion, Vec2 } from './types';
import { MAP_LOGICAL_HEIGHT, MAP_LOGICAL_WIDTH } from './types';
import styles from './index.module.scss';

const { Text } = Typography;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
const ZOOM_WHEEL_FACTOR = 1.12;
/** 单击选中与拖动的位移阈值（屏幕像素），避免点击时误触拖动 */
const REGION_DRAG_THRESHOLD_PX = 5;
/** 顶点可见圆点半径（屏幕 px） */
const VERTEX_HANDLE_SCREEN_PX = 7;
/** 顶点可点击热区半径（屏幕 px） */
const VERTEX_HIT_SCREEN_PX = 14;
function polygonCentroid(polygon: Vec2[]): Vec2 {
  if (!polygon.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of polygon) {
    x += p.x;
    y += p.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}

function clonePolygon(polygon: Vec2[]): Vec2[] {
  return polygon.map((p) => ({ x: p.x, y: p.y }));
}

function polygonsEqual(a: Vec2[], b: Vec2[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

/** 虚线多边形预览（开始绘制默认橙色 6 4；改边数传入热区色 8 4） */
const DraftPolygonPreview: React.FC<{
  points: Vec2[];
  invalid?: boolean;
  strokeColor?: string;
  strokeDasharray?: string;
  fillOpacity?: number;
}> = ({
  points,
  invalid = false,
  strokeColor: strokeColorProp,
  strokeDasharray = '6 4',
  fillOpacity = 0.12,
}) => {
  if (points.length < 2) return null;
  const stroke = invalid ? '#ff4d4f' : (strokeColorProp ?? '#fa541c');
  const pts = polygonToPoints(points);
  return (
    <>
      {points.length >= 3 && (
        <polygon
          className={styles.draftOverlay}
          points={pts}
          fill={stroke}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        className={styles.draftOverlay}
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={strokeDasharray}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
};

function vertexRadiusLogical(
  screenPx: number,
  mapWidth: number,
  drawW: number,
  zoom: number,
): number {
  if (drawW <= 0 || zoom <= 0) return 6;
  return (screenPx * mapWidth) / (drawW * zoom);
}

type CanvasFitLayout = {
  cw: number;
  ch: number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
};

function computeFitLayout(cw: number, ch: number, aspect: number): CanvasFitLayout {
  if (cw <= 0 || ch <= 0) {
    return { cw, ch, drawW: 0, drawH: 0, offsetX: 0, offsetY: 0 };
  }
  const containerAspect = cw / ch;
  let drawW: number;
  let drawH: number;
  let offsetX = 0;
  let offsetY = 0;
  if (containerAspect > aspect) {
    drawH = ch;
    drawW = ch * aspect;
    offsetX = (cw - drawW) / 2;
  } else {
    drawW = cw;
    drawH = cw / aspect;
    offsetY = (ch - drawH) / 2;
  }
  return { cw, ch, drawW, drawH, offsetX, offsetY };
}

type ViewPanState = {
  startClientX: number;
  startClientY: number;
  startPan: Vec2;
};

/**
 * MapRegionEditor 组件参数
 */
export interface MapRegionEditorProps {
  /** 编辑背景图 URL（建议可直接被浏览器加载） */
  mapImageUrl: string;
  /** 画布逻辑宽度，默认 `1334` */
  mapWidth?: number;
  /** 画布逻辑高度，默认 `750` */
  mapHeight?: number;
  /** 当前热区列表（受控） */
  regions: PolygonRegion[];
  /**
   * 热区变更回调（受控）
   * - 绘制完成、删点、改边数、拖拽结束等会触发
   * - 拖拽过程中仅做本地预览，松手后统一触发
   */
  onChange: (regions: PolygonRegion[]) => void;
  /** 当前选中的热区 id（可选，受控） */
  selectedRegionId?: string | null;
  /** 选中热区变化回调（点击热区/空白区域时触发） */
  onSelectedRegionIdChange?: (id: string | null) => void;
  /** 组件根节点 className */
  className?: string;
}

type RegionDrag =
  | {
      kind: 'draftVertex';
      vertexIndex: number;
      originPoints: Vec2[];
    }
  | {
      kind: 'regionPending';
      regionId: string;
      startClientX: number;
      startClientY: number;
      startPointer: Vec2;
      originPolygon: Vec2[];
    }
  | {
      kind: 'region';
      regionId: string;
      startPointer: Vec2;
      originPolygon: Vec2[];
    }
  | {
      kind: 'vertexPending';
      regionId: string;
      vertexIndex: number;
      startClientX: number;
      startClientY: number;
      originPolygon: Vec2[];
    }
  | {
      kind: 'vertex';
      regionId: string;
      vertexIndex: number;
      originPolygon: Vec2[];
    };

export const MapRegionEditor: React.FC<MapRegionEditorProps> = ({
  mapImageUrl,
  mapWidth = MAP_LOGICAL_WIDTH,
  mapHeight = MAP_LOGICAL_HEIGHT,
  regions: regionsProp,
  onChange,
  selectedRegionId,
  onSelectedRegionIdChange,
  className,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  /** 拖动草稿顶点后抑制画布 click，避免误加点 */
  const suppressCanvasClickRef = useRef(false);
  const [regions, setRegionsInner] = useState<PolygonRegion[]>(regionsProp);
  /** 拖拽/平移预览中不向宿主同步，避免 regionsProp 回灌打断交互 */
  const suppressPropSyncRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const notifyHostRegionsChange = useCallback((next: PolygonRegion[]) => {
    queueMicrotask(() => onChangeRef.current(next));
  }, []);

  const applyRegionsInner = useCallback(
    (
      updater: PolygonRegion[] | ((prev: PolygonRegion[]) => PolygonRegion[]),
      notifyHost: boolean,
    ) => {
      let hostPayload: PolygonRegion[] | undefined;
      setRegionsInner((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (notifyHost && next !== prev) hostPayload = next;
        return next;
      });
      if (hostPayload) notifyHostRegionsChange(hostPayload);
    },
    [notifyHostRegionsChange],
  );

  const setRegions = useCallback(
    (updater: PolygonRegion[] | ((prev: PolygonRegion[]) => PolygonRegion[])) => {
      applyRegionsInner(updater, true);
    },
    [applyRegionsInner],
  );

  const patchRegionsLocal = useCallback(
    (updater: PolygonRegion[] | ((prev: PolygonRegion[]) => PolygonRegion[])) => {
      applyRegionsInner(updater, false);
    },
    [applyRegionsInner],
  );

  const commitRegions = useCallback(
    (updater: PolygonRegion[] | ((prev: PolygonRegion[]) => PolygonRegion[])) => {
      applyRegionsInner(updater, true);
    },
    [applyRegionsInner],
  );
  const [draftPoints, setDraftPoints] = useState<Vec2[]>([]);
  const [drawing, setDrawing] = useState(false);
  /** 正在编辑边数（加减顶点）的热区 id */
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  /** 编辑边数模式下选中的顶点索引 */
  const [editVertexIndex, setEditVertexIndex] = useState<number | null>(null);
  /** 改边数可撤销步数（undo 栈长度 - 1） */
  const [edgeEditUndoDepth, setEdgeEditUndoDepth] = useState(0);
  const edgeEditUndoStackRef = useRef<Vec2[][]>([]);
  const [selectedId, setSelectedIdInner] = useState<string | null>(selectedRegionId ?? null);
  const setSelectedId = useCallback(
    (id: string | null) => {
      setSelectedIdInner(id);
      onSelectedRegionIdChange?.(id);
    },
    [onSelectedRegionIdChange],
  );

  useEffect(() => {
    if (selectedRegionId !== undefined) {
      setSelectedIdInner(selectedRegionId);
    }
  }, [selectedRegionId]);

  const [drag, setDrag] = useState<RegionDrag | null>(null);
  const [dragInvalid, setDragInvalid] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [viewPan, setViewPan] = useState<ViewPanState | null>(null);
  const [layout, setLayout] = useState<CanvasFitLayout>({
    cw: 0,
    ch: 0,
    drawW: 0,
    drawH: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [mapImageReady, setMapImageReady] = useState(false);
  const [displaySrc, setDisplaySrc] = useState('');

  const aspect = mapWidth / mapHeight;

  const remeasureCanvas = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setLayout(computeFitLayout(rect.width, rect.height, aspect));
    }
  }, [aspect]);

  const findRegionAt = useCallback((pt: Vec2, list: PolygonRegion[]): PolygonRegion | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (pointInPolygon(pt.x, pt.y, list[i].polygon)) return list[i];
    }
    return null;
  }, []);

  useEffect(() => {
    if (!mapImageUrl) {
      setMapImageReady(false);
      setDisplaySrc('');
      return;
    }

    let cancelled = false;

    if (isMapImageLoaded(mapImageUrl)) {
      setDisplaySrc(getMapImageDisplaySrc(mapImageUrl));
      setMapImageReady(true);
      return;
    }

    setMapImageReady(false);
    setDisplaySrc(mapImageUrl);

    void preloadMapImage(mapImageUrl)
      .then((src) => {
        if (!cancelled) {
          setDisplaySrc(src);
          setMapImageReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapImageReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapImageUrl]);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    remeasureCanvas();
    const ro = new ResizeObserver(() => remeasureCanvas());
    ro.observe(el);
    requestAnimationFrame(() => remeasureCanvas());
    return () => ro.disconnect();
  }, [remeasureCanvas]);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.id === selectedId) ?? null,
    [regions, selectedId],
  );

  const zoomAtClient = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = canvasRef.current;
      if (!el || layout.drawW <= 0) return;
      const rect = el.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const cx = (relX - layout.offsetX - pan.x) / zoom;
      const cy = (relY - layout.offsetY - pan.y) / zoom;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      setPan({
        x: relX - layout.offsetX - cx * nextZoom,
        y: relY - layout.offsetY - cy * nextZoom,
      });
      setZoom(nextZoom);
    },
    [layout, pan, zoom],
  );

  const zoomAtCanvasCenter = useCallback(
    (factor: number) => {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAtClient],
  );

  const resetCanvasView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const screenToLogical = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const el = canvasRef.current;
      if (!el || layout.drawW <= 0) return null;
      const rect = el.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const { drawW, drawH, offsetX, offsetY } = layout;
      const localX = relX - offsetX - pan.x;
      const localY = relY - offsetY - pan.y;
      if (localX < 0 || localY < 0 || localX > drawW * zoom || localY > drawH * zoom) {
        return null;
      }
      const lx = (localX / zoom / drawW) * mapWidth;
      const ly = (localY / zoom / drawH) * mapHeight;
      return clampToMap(lx, ly, mapWidth, mapHeight);
    },
    [layout, pan, zoom, mapWidth, mapHeight],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      zoomAtClient(e.clientX, e.clientY, factor);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAtClient]);

  const draftInvalid = useMemo(() => {
    if (draftPoints.length < 3) return false;
    return validateSimplePolygon(normalizeClosedPolygon(draftPoints)) != null;
  }, [draftPoints]);

  const edgeEditPreview = useMemo(() => {
    if (!editingRegionId) return null;
    const region = regions.find((r) => r.id === editingRegionId);
    return region?.polygon ?? null;
  }, [editingRegionId, regions]);

  const edgeEditPreviewInvalid = useMemo(() => {
    if (!edgeEditPreview || edgeEditPreview.length < 3) return false;
    if (
      dragInvalid &&
      drag &&
      'regionId' in drag &&
      drag.regionId === editingRegionId &&
      (drag.kind === 'vertex' || drag.kind === 'region')
    ) {
      return true;
    }
    return validateSimplePolygon(normalizeClosedPolygon(edgeEditPreview)) != null;
  }, [edgeEditPreview, dragInvalid, drag, editingRegionId]);

  const finishDraft = useCallback(() => {
    let pointsForFinish = draftPoints;
    let ring = normalizeClosedPolygon(pointsForFinish);
    let finishErr = validateFinishPolygon(ring);
    if (finishErr) {
      const fixed = tryFixSimplePolygon(pointsForFinish);
      if (fixed) {
        pointsForFinish = fixed;
        ring = normalizeClosedPolygon(fixed);
        finishErr = validateFinishPolygon(ring);
      }
    }
    if (finishErr) {
      message.warning(finishErr);
      return;
    }
    const others = regions.map((r) => r.polygon);
    if (polygonOverlapsAny(ring, others)) {
      message.error('热区不能与已有热区重叠');
      return;
    }
    const region: PolygonRegion = { id: uuidv4(), polygon: ring };
    setRegions((prev) => [...prev, region]);
    setSelectedId(region.id);
    setDraftPoints([]);
    setDrawing(false);
    message.success('热区已添加');
  }, [draftPoints, regions]);

  const vertexHitRadiusLogical = useCallback(
    (screenPx = VERTEX_HIT_SCREEN_PX) =>
      vertexRadiusLogical(screenPx, mapWidth, layout.drawW, zoom),
    [mapWidth, layout.drawW, zoom],
  );

  const findVertexIndexAt = useCallback(
    (pt: Vec2, polygon: Vec2[]): number | null => {
      const threshold = vertexHitRadiusLogical();
      for (let i = 0; i < polygon.length; i++) {
        if (vecDistance(polygon[i], pt) <= threshold) return i;
      }
      return null;
    },
    [vertexHitRadiusLogical],
  );

  const clearEdgeEditUndo = useCallback(() => {
    edgeEditUndoStackRef.current = [];
    setEdgeEditUndoDepth(0);
  }, []);

  useEffect(() => {
    if (suppressPropSyncRef.current || drag) return;
    setRegionsInner(regionsProp);
  }, [regionsProp, drag]);

  const resetEdgeEditUndo = useCallback((polygon: Vec2[]) => {
    edgeEditUndoStackRef.current = [clonePolygon(normalizeClosedPolygon(polygon))];
    setEdgeEditUndoDepth(0);
  }, []);

  const pushEdgeEditUndo = useCallback((polygon: Vec2[]) => {
    const ring = clonePolygon(normalizeClosedPolygon(polygon));
    const stack = edgeEditUndoStackRef.current;
    const last = stack[stack.length - 1];
    if (last && polygonsEqual(last, ring)) return;
    stack.push(ring);
    setEdgeEditUndoDepth(stack.length - 1);
  }, []);

  const commitRegionPolygon = useCallback(
    (regionId: string, polygon: Vec2[], options?: { pushEdgeEditUndo?: boolean }): boolean => {
      const ring = normalizeClosedPolygon(polygon);
      const err = validateSimplePolygon(ring);
      if (err) {
        message.warning(err);
        return false;
      }
      let rejected = false;
      setRegions((prev) => {
        if (isRegionPlacementInvalid(ring, regionId, prev)) {
          rejected = true;
          return prev;
        }
        return prev.map((r) => (r.id === regionId ? { ...r, polygon: ring } : r));
      });
      if (rejected) {
        message.warning('热区不能与已有热区重叠');
        return false;
      }
      if (options?.pushEdgeEditUndo) {
        pushEdgeEditUndo(ring);
      }
      return true;
    },
    [pushEdgeEditUndo],
  );

  /** 改边数撤销：直接恢复 undo 栈快照，不再做与其它热区的重叠检测（入栈时已校验过） */
  const restoreEdgeEditPolygon = useCallback((regionId: string, polygon: Vec2[]): boolean => {
    const ring = normalizeClosedPolygon(polygon);
    const err = validateSimplePolygon(ring);
    if (err) {
      message.warning(err);
      return false;
    }
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, polygon: clonePolygon(ring) } : r)),
    );
    return true;
  }, []);

  const undoEdgeEdit = useCallback(() => {
    const regionId = editingRegionId;
    if (!regionId) return;
    const stack = edgeEditUndoStackRef.current;
    if (stack.length <= 1) {
      message.info('没有可撤销的操作');
      return;
    }
    const undone = stack.pop()!;
    const prev = stack[stack.length - 1];
    setEdgeEditUndoDepth(stack.length - 1);
    if (restoreEdgeEditPolygon(regionId, prev)) {
      setEditVertexIndex(null);
    } else {
      stack.push(undone);
      setEdgeEditUndoDepth(stack.length - 1);
    }
  }, [editingRegionId, restoreEdgeEditPolygon]);

  /** 改边数：在多边形外侧点击，按绘制规则（顺序连边、非邻边不相交）并入顶点环 */
  const addVertexOutsideRegion = useCallback(
    (regionId: string, pt: Vec2) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;
      const boundaryThreshold = vertexHitRadiusLogical(10);

      if (isPointOnPolygonBoundary(pt, region.polygon, boundaryThreshold)) {
        message.info('边线上点击无效，请在热区外侧点击以添加顶点');
        return;
      }

      for (const r of regions) {
        if (r.id === regionId || r.polygon.length < 3) continue;
        if (isPointOnPolygonBoundary(pt, r.polygon, boundaryThreshold)) {
          message.warning('不能在其它热区边线上添加顶点（热区不能重叠）');
          return;
        }
        if (pointInPolygon(pt.x, pt.y, r.polygon)) {
          message.warning('不能在其它热区内添加顶点（热区不能重叠）');
          return;
        }
      }

      if (pointInPolygon(pt.x, pt.y, region.polygon)) {
        message.info('请在当前热区外侧点击以添加顶点');
        return;
      }
      const addResult = applyDraftPoint(region.polygon, pt);
      if ('error' in addResult) {
        message.warning(addResult.error);
        return;
      }
      if (addResult.fixed) {
        message.info('边将交叉，已按距该点最近的两顶点自动调整连线顺序');
      }
      if (commitRegionPolygon(regionId, addResult.points, { pushEdgeEditUndo: true })) {
        setEditVertexIndex(null);
      }
    },
    [regions, commitRegionPolygon, vertexHitRadiusLogical],
  );

  const removeRegionVertex = useCallback(
    (regionId: string, vertexIndex: number) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;
      if (normalizeClosedPolygon(region.polygon).length <= 3) {
        message.warning('至少保留 3 个顶点');
        return;
      }
      if (editingRegionId !== regionId) return;
      const result = tryRemovePolygonVertex(region.polygon, vertexIndex);
      if ('error' in result) {
        message.warning(result.error);
        return;
      }
      if (commitRegionPolygon(regionId, result.polygon, { pushEdgeEditUndo: true })) {
        setEditVertexIndex(null);
      }
    },
    [regions, commitRegionPolygon, editingRegionId],
  );

  const onCanvasClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pt = screenToLogical(e.clientX, e.clientY);
    if (!pt) return;

    const skipClickAfterDrag = suppressCanvasClickRef.current;
    suppressCanvasClickRef.current = false;

    if (editingRegionId) {
      if (skipClickAfterDrag) return;
      const region = regions.find((r) => r.id === editingRegionId);
      if (!region) return;
      const vi = findVertexIndexAt(pt, region.polygon);
      if (vi != null) {
        setEditVertexIndex(vi);
        return;
      }
      addVertexOutsideRegion(editingRegionId, pt);
      return;
    }

    if (skipClickAfterDrag) return;

    if (!drawing) return;

    if (canClosePolygonAt(pt, draftPoints)) {
      finishDraft();
      return;
    }
    const addResult = applyDraftPoint(draftPoints, pt);
    if ('error' in addResult) {
      message.warning(addResult.error);
      return;
    }
    if (addResult.fixed) {
      message.info('边将交叉，已按距该点最近的两顶点自动调整连线顺序');
    }
    setDraftPoints(addResult.points);
  };

  const beginDraftVertexDrag = (vertexIndex: number, e: React.MouseEvent) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    suppressCanvasClickRef.current = true;
    setDrag({
      kind: 'draftVertex',
      vertexIndex,
      originPoints: draftPoints.map((p) => ({ ...p })),
    });
  };

  const startVertexDrag = useCallback(
    (regionId: string, vertexIndex: number) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;
      setSelectedId(regionId);
        setDrag({
        kind: 'vertex',
        regionId,
        vertexIndex,
        originPolygon: region.polygon.map((p) => ({ ...p })),
      });
      setDragInvalid(false);
    },
    [regions],
  );

  const startVertexPending = useCallback(
    (regionId: string, vertexIndex: number, e: React.MouseEvent) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;
      setSelectedId(regionId);
        setDrag({
        kind: 'vertexPending',
        regionId,
        vertexIndex,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originPolygon: region.polygon.map((p) => ({ ...p })),
      });
      setDragInvalid(false);
    },
    [regions],
  );

  const beginVertexPointer = (regionId: string, vertexIndex: number, e: React.MouseEvent) => {
    if (drawing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    suppressCanvasClickRef.current = true;
    if (editingRegionId === regionId) {
      startVertexPending(regionId, vertexIndex, e);
    } else {
      startVertexDrag(regionId, vertexIndex);
    }
  };

  const exitEdgeEditMode = useCallback(() => {
    clearEdgeEditUndo();
    setEditingRegionId(null);
    setEditVertexIndex(null);
  }, [clearEdgeEditUndo]);

  const enterEdgeEditMode = useCallback(
    (regionId: string) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region) return;
      resetEdgeEditUndo(region.polygon);
      setEditingRegionId(regionId);
      setEditVertexIndex(null);
    },
    [regions, resetEdgeEditUndo],
  );

  const toggleEdgeEditMode = (regionId: string) => {
    if (editingRegionId === regionId) {
      exitEdgeEditMode();
    } else {
      enterEdgeEditMode(regionId);
    }
  };

  const beginViewPan = (e: React.MouseEvent) => {
    e.preventDefault();
    setViewPan({
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPan: { ...pan },
    });
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const canPanView = zoom > 1;

    if (e.button === 1) {
      if (!canPanView) return;
      beginViewPan(e);
      return;
    }

    if (e.button !== 0) return;

    const pt = screenToLogical(e.clientX, e.clientY);

    if (canPanView && !drawing && !editingRegionId) {
      const hit = pt ? findRegionAt(pt, regions) : null;
      if (!hit) {
        beginViewPan(e);
        return;
      }
    }

    if (drawing) return;
    if (!pt) return;

    const hit = findRegionAt(pt, regions);
    if (hit) {
      setSelectedId(hit.id);
        if (editingRegionId && editingRegionId !== hit.id) {
        exitEdgeEditMode();
      }
      const vi = findVertexIndexAt(pt, hit.polygon);
      if (vi != null) {
        e.preventDefault();
        beginVertexPointer(hit.id, vi, e);
        return;
      }
      setDrag({
        kind: 'regionPending',
        regionId: hit.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPointer: pt,
        originPolygon: hit.polygon.map((p) => ({ ...p })),
      });
      setDragInvalid(false);
      e.preventDefault();
      return;
    }
    if (editingRegionId) {
      e.preventDefault();
      return;
    }
    setSelectedId(null);
    setEditVertexIndex(null);
  };

  useEffect(() => {
    if (!viewPan) return;

    const onMove = (e: MouseEvent) => {
      setPan({
        x: viewPan.startPan.x + (e.clientX - viewPan.startClientX),
        y: viewPan.startPan.y + (e.clientY - viewPan.startClientY),
      });
    };

    const onUp = () => setViewPan(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [viewPan]);

  useEffect(() => {
    if (!drag) {
      suppressPropSyncRef.current = false;
      return;
    }
    suppressPropSyncRef.current = true;

    if (drag.kind === 'draftVertex') {
      const onMove = (e: MouseEvent) => {
        const pt = screenToLogical(e.clientX, e.clientY);
        if (!pt) return;
        const next = drag.originPoints.map((p, i) =>
          i === drag.vertexIndex ? clampToMap(pt.x, pt.y, mapWidth, mapHeight) : { ...p },
        );
        setDraftPoints(next);
      };

      const onUp = () => {
        setDraftPoints((current) => {
          const pt = current[drag.vertexIndex];
          const result = applyVertexMove(drag.originPoints, drag.vertexIndex, pt);
          if (!result) {
            message.warning('边不能交叉：请沿区域边界调整顶点');
            return drag.originPoints.map((p) => ({ ...p }));
          }
          const err = validateSimplePolygon(normalizeClosedPolygon(result.points));
          if (err) {
            message.warning(err);
            return drag.originPoints.map((p) => ({ ...p }));
          }
          if (result.rewired) {
            message.info('已按距该点最近的两顶点自动调整连线顺序');
          }
          return result.points;
        });
        setDrag(null);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }

    const revertPolygon = (prev: PolygonRegion[]) =>
      prev.map((r) =>
        r.id === drag.regionId ? { ...r, polygon: drag.originPolygon.map((p) => ({ ...p })) } : r,
      );

    const onMove = (e: MouseEvent) => {
      const pt = screenToLogical(e.clientX, e.clientY);
      if (!pt) return;

      if (drag.kind === 'regionPending') {
        const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
        if (dist < REGION_DRAG_THRESHOLD_PX) return;

        const dx = pt.x - drag.startPointer.x;
        const dy = pt.y - drag.startPointer.y;
        const moved = translatePolygonClamped(drag.originPolygon, dx, dy, mapWidth, mapHeight);
        setDrag({
          kind: 'region',
          regionId: drag.regionId,
          startPointer: drag.startPointer,
          originPolygon: drag.originPolygon,
        });
        let invalid = false;
        patchRegionsLocal((prev) => {
          invalid = isRegionPlacementInvalid(moved, drag.regionId, prev);
          return prev.map((r) => (r.id === drag.regionId ? { ...r, polygon: moved } : r));
        });
        setDragInvalid(invalid);
        return;
      }

      if (drag.kind === 'vertexPending') {
        const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
        if (dist < REGION_DRAG_THRESHOLD_PX) return;
        setDrag({
          kind: 'vertex',
          regionId: drag.regionId,
          vertexIndex: drag.vertexIndex,
          originPolygon: drag.originPolygon,
        });
        setDragInvalid(false);
        return;
      }

      if (drag.kind === 'vertex') {
        let invalid = false;
        patchRegionsLocal((prev) => {
          const region = prev.find((r) => r.id === drag.regionId);
          if (!region) return prev;
          const nextPolygon = region.polygon.map((p, i) =>
            i === drag.vertexIndex ? clampToMap(pt.x, pt.y, mapWidth, mapHeight) : { ...p },
          );
          invalid = isRegionPlacementInvalid(nextPolygon, drag.regionId, prev);
          return prev.map((r) => (r.id === drag.regionId ? { ...r, polygon: nextPolygon } : r));
        });
        setDragInvalid(invalid);
        return;
      }

      const dx = pt.x - drag.startPointer.x;
      const dy = pt.y - drag.startPointer.y;
      const moved = translatePolygonClamped(drag.originPolygon, dx, dy, mapWidth, mapHeight);

      let invalid = false;
      patchRegionsLocal((prev) => {
        invalid = isRegionPlacementInvalid(moved, drag.regionId, prev);
        return prev.map((r) => (r.id === drag.regionId ? { ...r, polygon: moved } : r));
      });
      setDragInvalid(invalid);
    };

    const onUp = () => {
      if (drag.kind === 'regionPending') {
        setDrag(null);
        setDragInvalid(false);
        return;
      }

      if (drag.kind === 'vertexPending') {
        setEditVertexIndex(drag.vertexIndex);
        setDrag(null);
        setDragInvalid(false);
        return;
      }

      let committedPolygon: Vec2[] | null = null;

      commitRegions((prev) => {
        const cur = prev.find((r) => r.id === drag.regionId);
        if (!cur) return prev;

        let polygon = cur.polygon;
        if (drag.kind === 'vertex') {
          const pt = cur.polygon[drag.vertexIndex];
          const moveResult = applyVertexMove(drag.originPolygon, drag.vertexIndex, pt);
          if (!moveResult) {
            message.warning('边不能交叉：请沿区域边界调整顶点');
            return revertPolygon(prev);
          }
          polygon = moveResult.points;
          if (moveResult.rewired) {
            message.info('已按距该点最近的两顶点自动调整连线顺序');
            if (isRegionPlacementInvalid(polygon, drag.regionId, prev)) {
              message.warning('热区不能与已有热区重叠');
              return revertPolygon(prev);
            }
            committedPolygon = polygon;
            return prev.map((r) => (r.id === drag.regionId ? { ...r, polygon } : r));
          }
        }

        const simpleErr = validateSimplePolygon(polygon);
        if (simpleErr) {
          message.warning(simpleErr);
          return revertPolygon(prev);
        }
        if (isRegionPlacementInvalid(polygon, drag.regionId, prev)) {
          message.warning('热区不能与已有热区重叠');
          return revertPolygon(prev);
        }
        committedPolygon = normalizeClosedPolygon(polygon);
        if (drag.kind === 'vertex' || drag.kind === 'region') {
          return prev.map((r) =>
            r.id === drag.regionId ? { ...r, polygon: committedPolygon! } : r,
          );
        }
        return prev;
      });

      if (
        committedPolygon &&
        editingRegionId === drag.regionId &&
        (drag.kind === 'vertex' || drag.kind === 'region')
      ) {
        pushEdgeEditUndo(committedPolygon);
      }

      setDrag(null);
      setDragInvalid(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [
    drag,
    mapWidth,
    mapHeight,
    screenToLogical,
    editingRegionId,
    pushEdgeEditUndo,
    patchRegionsLocal,
    commitRegions,
  ]);

  useEffect(() => {
    if (!drawing) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setDraftPoints([]);
        setDrawing(false);
      }
      if (ev.key === 'Enter' && draftPoints.length >= 3) finishDraft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, draftPoints.length, finishDraft]);

  useEffect(() => {
    if (!editingRegionId) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        exitEdgeEditMode();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && !ev.shiftKey) {
        const el = ev.target;
        if (
          el instanceof HTMLElement &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.isContentEditable ||
            el.closest('.ant-select'))
        ) {
          return;
        }
        ev.preventDefault();
        undoEdgeEdit();
        return;
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && editVertexIndex != null && !drawing) {
        const region = regions.find((r) => r.id === editingRegionId);
        if (!region || region.polygon.length <= 3) return;
        ev.preventDefault();
        removeRegionVertex(editingRegionId, editVertexIndex);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    editingRegionId,
    editVertexIndex,
    drawing,
    regions,
    removeRegionVertex,
    exitEdgeEditMode,
    undoEdgeEdit,
  ]);

  const regionColors = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2'];

  const vertexHandleR = vertexRadiusLogical(VERTEX_HANDLE_SCREEN_PX, mapWidth, layout.drawW, zoom);
  const vertexHitR = vertexHitRadiusLogical();
  return (
    <div className={`${styles.editorRoot} ${className ?? ""}`.trim()}>
      <div className={styles.editor}>
        <div className={styles.canvasWrap}>
          <Space wrap>
            {drawing ? (
              <>
                <Button
                  type="primary"
                  size="small"
                  disabled={draftPoints.length < 3}
                  onClick={finishDraft}
                >
                  完成多边形（{draftPoints.length} 点）
                </Button>
                <Button
                  size="small"
                  disabled={draftPoints.length === 0}
                  onClick={() => setDraftPoints((prev) => prev.slice(0, -1))}
                >
                  撤销上一点
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setDraftPoints([]);
                    setDrawing(false);
                  }}
                >
                  取消绘制
                </Button>
                <Text type={draftInvalid ? 'danger' : 'secondary'}>
                  {draftInvalid ? '当前连线交叉，请撤销或按边界顺序重画 · ' : ''}
                  {draftPoints.length >= 3 ? '点击起点闭合 · ' : ''}
                  拖动圆点可调整顶点 · Enter 完成 · Esc 取消
                </Text>
              </>
            ) : (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setDrawing(true);
                    setDraftPoints([]);
                    exitEdgeEditMode();
                                  }}
                >
                  开始绘制
                </Button>
                {selectedRegion && editingRegionId === selectedRegion.id && (
                  <>
                    <Button
                      size="small"
                      icon={<UndoOutlined />}
                      disabled={edgeEditUndoDepth === 0}
                      onClick={undoEdgeEdit}
                    >
                      撤销
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={editVertexIndex == null || selectedRegion.polygon.length <= 3}
                      onClick={() => {
                        if (editVertexIndex != null) {
                          removeRegionVertex(selectedRegion.id, editVertexIndex);
                        }
                      }}
                    >
                      删除顶点
                    </Button>
                    <Text type="secondary">
                      {selectedRegion.polygon.length} 顶点 · 先点选顶点再删（至少保留 3 个）·
                      外侧加点 · Ctrl+Z · Esc 退出
                    </Text>
                  </>
                )}
              </>
            )}
          </Space>

          <div
            ref={canvasRef}
            className={`${styles.canvas} ${
              viewPan || drag?.kind === 'draftVertex' || drag
                ? styles.dragging
                : drawing || editingRegionId
                  ? styles.edgeEditCursor
                  : zoom > 1
                    ? styles.panReady
                    : styles.panning
            }`}
            onClick={onCanvasClick}
            onMouseDown={onCanvasMouseDown}
                      >
            {mapImageUrl && !mapImageReady && (
              <div className={styles.canvasLoading}>
                <Spin size="large" />
                <Text type="secondary">地图加载中…</Text>
              </div>
            )}
            <div
              className={styles.canvasZoomBar}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Space size={4}>
                <Button
                  type="text"
                  size="small"
                  icon={<ZoomOutOutlined />}
                  aria-label="缩小"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    zoomAtCanvasCenter(1 / ZOOM_WHEEL_FACTOR);
                  }}
                />
                <Text className={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
                <Button
                  type="text"
                  size="small"
                  icon={<ZoomInOutlined />}
                  aria-label="放大"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    zoomAtCanvasCenter(ZOOM_WHEEL_FACTOR);
                  }}
                />
                <Button
                  type="link"
                  size="small"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    resetCanvasView();
                  }}
                >
                  适应
                </Button>
              </Space>
            </div>
            <div
              className={`${styles.canvasMapLayer} ${
                layout.drawW > 0 ? '' : styles.canvasMapLayerFit
              }`}
              style={
                layout.drawW > 0
                  ? {
                      left: layout.offsetX + pan.x,
                      top: layout.offsetY + pan.y,
                      width: layout.drawW,
                      height: layout.drawH,
                      transform: `scale(${zoom})`,
                    }
                  : { transform: `scale(${zoom})` }
              }
            >
              {displaySrc ? (
                <img
                  src={displaySrc}
                  alt="地图"
                  className={styles.bg}
                  draggable={false}
                  decoding="async"
                  loading="eager"
                  onLoad={() => setMapImageReady(true)}
                  onError={() => setMapImageReady(false)}
                />
              ) : null}
              <svg className={styles.svgLayer} viewBox={`0 0 ${mapWidth} ${mapHeight}`}>
                {regions.map((r, idx) => {
                  const active = r.id === selectedId;
                  const isDragging =
                    drag != null &&
                    'regionId' in drag &&
                    drag.regionId === r.id &&
                    (drag.kind === 'region' ||
                      drag.kind === 'regionPending' ||
                      drag.kind === 'vertex');
                  const isEditing = editingRegionId === r.id;
                  const invalidStroke = isDragging && dragInvalid;
                  const color = invalidStroke ? '#ff4d4f' : regionColors[idx % regionColors.length];
                  return (
                    <polygon
                      key={r.id}
                      className={
                        isEditing
                          ? styles.regionPolygonEditing
                          : active && !drawing
                            ? styles.regionPolygonSelected
                            : styles.regionPolygon
                      }
                      points={polygonToPoints(r.polygon)}
                      fill={color}
                      fillOpacity={isEditing ? 0.1 : 0.28}
                      stroke={color}
                      strokeWidth={isEditing ? 1 : active && !drawing ? 3 : 2}
                      strokeOpacity={isEditing ? 0.35 : 1}
                      vectorEffect="non-scaling-stroke"
                      style={{
                        cursor: drawing ? 'default' : active ? 'grab' : 'pointer',
                      }}
                    >
                      <title>
                        {r.id.slice(0, 8)}…
                        
                      </title>
                    </polygon>
                  );
                })}
                {selectedRegion &&
                  !drawing &&
                  (() => {
                    const region = selectedRegion;
                    const regionId = region.id;
                    const edgeEdit = editingRegionId === regionId;
                    const baseColor =
                      regionColors[
                        regions.findIndex((r) => r.id === regionId) % regionColors.length
                      ];
                    return (
                      <>
                        {region.polygon.map((p, i) => {
                          const vertexDragging =
                            drag?.kind === 'vertex' &&
                            drag.regionId === regionId &&
                            drag.vertexIndex === i;
                          const handleR = vertexDragging
                            ? vertexRadiusLogical(
                                VERTEX_HANDLE_SCREEN_PX + 1,
                                mapWidth,
                                layout.drawW,
                                zoom,
                              )
                            : vertexHandleR;
                          const vtxSelected =
                            edgeEdit &&
                            (editVertexIndex === i ||
                              (drag?.kind === 'vertexPending' &&
                                drag.regionId === regionId &&
                                drag.vertexIndex === i));
                          return (
                            <g key={`${regionId}-v-${i}`}>
                              <circle
                                className={styles.vertexHandleHit}
                                cx={p.x}
                                cy={p.y}
                                r={vertexHitR}
                                fill="transparent"
                                onMouseDown={(e) => beginVertexPointer(regionId, i, e)}
                              />
                              <circle
                                className={styles.vertexHandle}
                                cx={p.x}
                                cy={p.y}
                                r={vtxSelected ? handleR * 1.15 : handleR}
                                fill={vtxSelected ? '#ff4d4f' : '#fff'}
                                stroke={baseColor}
                                strokeWidth={2}
                                vectorEffect="non-scaling-stroke"
                                onMouseDown={(e) => beginVertexPointer(regionId, i, e)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                {drawing && <DraftPolygonPreview points={draftPoints} invalid={draftInvalid} />}
                {edgeEditPreview && editingRegionId && (
                  <DraftPolygonPreview
                    points={edgeEditPreview}
                    invalid={edgeEditPreviewInvalid}
                    strokeColor={
                      regionColors[
                        Math.max(
                          0,
                          regions.findIndex((r) => r.id === editingRegionId),
                        ) % regionColors.length
                      ]
                    }
                    strokeDasharray="8 4"
                    fillOpacity={0.18}
                  />
                )}
                {draftPoints.map((p, i) => {
                  const isFirst = i === 0;
                  const closable = drawing && draftPoints.length >= 3 && isFirst;
                  const vertexDragging = drag?.kind === 'draftVertex' && drag.vertexIndex === i;
                  const strokeColor =
                    draftInvalid && vertexDragging ? '#ff4d4f' : closable ? '#52c41a' : '#fa541c';
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={closable || vertexDragging ? 8 : 7}
                      fill={closable ? '#52c41a' : '#fff'}
                      stroke={strokeColor}
                      strokeWidth={2}
                      style={{ cursor: drag?.kind === 'draftVertex' ? 'grabbing' : 'grab' }}
                      onMouseDown={(e) => beginDraftVertexDrag(i, e)}
                    />
                  );
                })}
              </svg>
              {selectedRegion &&
                !drawing &&
                (() => {
                  const regionId = selectedRegion.id;
                  const edgeEdit = editingRegionId === regionId;
                  const c = polygonCentroid(selectedRegion.polygon);
                  return (
                    <button
                      type="button"
                      aria-label={edgeEdit ? '退出改边数' : '改边数'}
                      className={`${styles.regionEditIconBtn} ${edgeEdit ? styles.regionEditIconBtnActive : ''}`}
                      style={{
                        left: `${(c.x / mapWidth) * 100}%`,
                        top: `${(c.y / mapHeight) * 100}%`,
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleEdgeEditMode(regionId);
                      }}
                    >
                      <EditOutlined />
                    </button>
                  );
                })()}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
