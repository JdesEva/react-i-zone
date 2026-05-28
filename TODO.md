# TODO 清单 — react-i-zone

## 阻塞性问题

（当前无）

## 待确认事项

- [ ] [低] `package.json` 中 `repository.url` 发布前改为真实 Git 地址

## 优化建议（非阻塞）

（当前无）

## 已实现（与 README / 内部约定对齐）

| 能力 | 说明 |
|------|------|
| 多边形绘制 / 闭合 | `POLYGON_CLOSE_THRESHOLD`、完成按钮 |
| 拖顶点 / 拖区域 | 5px 移动阈值；拖拽中 `patchRegionsLocal`，`mouseup` 时 `commitRegions`；`suppressPropSyncRef` 避免 `regions` prop 回灌打断 |
| 改边数 | 外侧加点、删顶点（≥3）、撤销栈（不与重叠复检） |
| 校验 | 简单多边形、热区互不重叠 |
| 导出范围 | 仅 `MapRegionEditor` + `PolygonRegion` + `geometry`；不含物料 / Modal / API 序列化 |
