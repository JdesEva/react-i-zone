# react-i-zone

React **多边形热区编辑**组件（背景图 + 画点闭合 / 改边数 / 撤销）。

**作者：** jdeseva

## 范围

| 包含 | 不包含（由宿主应用实现） |
|------|-------------------------|
| 多边形画点、闭合 | 业务字段解析/序列化 |
| 改边数（外侧加点、删顶点） | Modal / Drawer 外壳 |
| 拖顶点、拖区域 | 后端接口对接逻辑 |
| 重叠与自交校验 | 表单与业务侧栏 |
| 撤销栈 | 持久化存储逻辑 |

## 安装

```bash
npm install react-i-zone
```

Peer：`react`、`react-dom`、`antd`、`@ant-design/icons`（≥5 / ≥18）

## 使用

```tsx
import { MapRegionEditor, type PolygonRegion } from 'react-i-zone';

const [regions, setRegions] = useState<PolygonRegion[]>([]);

<MapRegionEditor
  mapImageUrl="https://example.com/map.png"
  mapWidth={1334}
  mapHeight={750}
  regions={regions}
  onChange={setRegions}
  selectedRegionId={selectedId}
  onSelectedRegionIdChange={setSelectedId}
/>
```

### 类型

```ts
interface PolygonRegion {
  id: string;
  polygon: Vec2[]; // 有序顶点环，≥3，隐式闭合
  name?: string;
}
```

### `MapRegionEditorProps`

```ts
interface MapRegionEditorProps {
  mapImageUrl: string;
  mapWidth?: number; // default: 1334
  mapHeight?: number; // default: 750
  regions: PolygonRegion[];
  onChange: (regions: PolygonRegion[]) => void;
  selectedRegionId?: string | null;
  onSelectedRegionIdChange?: (id: string | null) => void;
  className?: string;
}
```

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mapImageUrl` | `string` | - | 编辑背景图 URL |
| `mapWidth` | `number` | `1334` | 画布逻辑宽度 |
| `mapHeight` | `number` | `750` | 画布逻辑高度 |
| `regions` | `PolygonRegion[]` | - | 受控热区数据 |
| `onChange` | `(regions: PolygonRegion[]) => void` | - | 热区变更回调（绘制完成、改边数、拖拽结束等） |
| `selectedRegionId` | `string \| null` | `undefined` | 当前选中的热区 id（可选受控） |
| `onSelectedRegionIdChange` | `(id: string \| null) => void` | - | 选中热区变化回调 |
| `className` | `string` | - | 根节点 className |

> 说明：拖拽过程中只做本地预览，不会持续触发 `onChange`；鼠标抬起后统一提交一次。

### 几何工具（可选）

`validateSimplePolygon`、`applyDraftPoint`、`isRegionPlacementInvalid` 等见包导出。

## 开发预览

```bash
npm install
npm run dev    # http://localhost:5175
npm run build
npm test
```

## License

MIT © jdeseva
