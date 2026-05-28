import { describe, expect, it } from 'vitest';
import {
  applyDraftPoint,
  applyVertexMove,
  insertPointBetweenNearest,
  insertPointBetweenVertices,
  insertVertexOnEdge,
  isPointOnPolygonBoundary,
  polygonHasSelfIntersection,
  tryInsertVertexOnEdge,
  tryRemovePolygonVertex,
  twoClosestVertexIndices,
} from './geometry';
import type { Vec2 } from './types';

describe('insertPointBetweenVertices', () => {
  const chain: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const p: Vec2 = { x: 50, y: 10 };

  it('inserts between adjacent indices', () => {
    const out = insertPointBetweenVertices(chain, p, 0, 1);
    expect(out).toHaveLength(5);
    expect(out[1]).toEqual(p);
  });

  it('inserts between non-adjacent indices along chain', () => {
    const out = insertPointBetweenVertices(chain, p, 0, 2);
    expect(out.map((v) => v.x)).toEqual([0, 50, 100, 100, 0]);
  });
});

describe('twoClosestVertexIndices', () => {
  it('picks two nearest vertices', () => {
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 200 },
    ];
    const [i, j] = twoClosestVertexIndices(pts, { x: 95, y: 5 });
    expect(new Set([i, j])).toEqual(new Set([0, 1]));
  });
});

describe('applyDraftPoint', () => {
  it('appends when no intersection', () => {
    const ring: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const next = { x: 0, y: 100 };
    const r = applyDraftPoint(ring, next);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.fixed).toBe(false);
    expect(r.points).toHaveLength(4);
  });

  it('rewires when append would cross', () => {
    const ring: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const next = { x: 100, y: 100 };
    expect(polygonHasSelfIntersection([...ring, next])).toBe(true);
    const r = applyDraftPoint(ring, next);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.fixed).toBe(true);
    expect(polygonHasSelfIntersection(r.points)).toBe(false);
  });
});

describe('insertPointBetweenNearest', () => {
  it('places point between geometrically nearest corners', () => {
    const chain: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const p = { x: 10, y: 10 };
    const out = insertPointBetweenNearest(chain, p);
    expect(out[0]).toEqual(chain[0]);
    expect(out[1]).toEqual(p);
  });
});

describe('isPointOnPolygonBoundary', () => {
  const square: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('detects point on edge', () => {
    expect(isPointOnPolygonBoundary({ x: 50, y: 0 }, square, 2)).toBe(true);
  });

  it('detects point outside edge', () => {
    expect(isPointOnPolygonBoundary({ x: 50, y: 50 }, square, 2)).toBe(false);
  });
});

/** 边线插入 API 仅在此文件覆盖；UI 改边数走 applyDraftPoint 外侧加点。 */
describe('tryInsertVertexOnEdge / tryRemovePolygonVertex', () => {
  const square: Vec2[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('inserts vertex on edge', () => {
    const r = tryInsertVertexOnEdge(square, { x: 50, y: 0 }, 8, 5);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polygon).toHaveLength(5);
    expect(polygonHasSelfIntersection(r.polygon)).toBe(false);
  });

  it('removes vertex when more than 3', () => {
    const pent = insertVertexOnEdge(square, 0, { x: 50, y: 0 });
    const r = tryRemovePolygonVertex(pent, 1);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.polygon).toHaveLength(4);
  });

  it('rejects removing below 3 vertices', () => {
    const triangle: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const r = tryRemovePolygonVertex(triangle, 0);
    expect('error' in r).toBe(true);
  });
});

describe('applyVertexMove', () => {
  it('keeps order when move stays simple', () => {
    const ring: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = applyVertexMove(ring, 2, { x: 80, y: 120 });
    expect(result?.rewired).toBe(false);
    expect(polygonHasSelfIntersection(result!.points)).toBe(false);
  });
});
