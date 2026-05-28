/** 逻辑坐标（原点左上，x 向右，y 向下） */
export type Vec2 = {
  x: number;
  y: number;
};

/**
 * 多边形热区（npm 包仅负责几何编辑，业务字段由宿主应用维护）。
 */
export interface PolygonRegion {
  id: string;
  polygon: Vec2[];
  /** 可选展示名 */
  name?: string;
}

export const MAP_LOGICAL_WIDTH = 1334;
export const MAP_LOGICAL_HEIGHT = 750;
