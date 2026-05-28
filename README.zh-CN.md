# react-i-zone（中文文档）

`react-i-zone` 是一个 React 多边形热区编辑组件，用于图片热区标注、多边形区域选择、顶点拖拽编辑。

它只负责几何编辑能力，不包含业务侧字段、接口序列化、表单侧栏、弹窗壳等应用层逻辑。

## 演示

![react-i-zone 演示](https://raw.githubusercontent.com/JdesEva/react-i-zone/main/assets/demo-kit-small.gif)

## 安装

```bash
npm install react-i-zone
```

Peer 依赖：`react`、`react-dom`、`antd`、`@ant-design/icons`（React 18+、AntD 5+）。

## 快速使用

```tsx
import { useState } from 'react';
import { MapRegionEditor, type PolygonRegion } from 'react-i-zone';

export default function Demo() {
  const [regions, setRegions] = useState<PolygonRegion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <MapRegionEditor
      mapImageUrl="https://example.com/your-image.png"
      mapWidth={1334}
      mapHeight={750}
      regions={regions}
      onChange={setRegions}
      selectedRegionId={selectedId}
      onSelectedRegionIdChange={setSelectedId}
    />
  );
}
```

## 功能

- 多边形画点、闭合
- 顶点拖拽、整区拖拽
- 改边数（加点/删点）
- 简单多边形校验、重叠校验
- 改边数撤销栈
- 受控组件模型（`regions` + `onChange`）

## 核心类型

```ts
interface PolygonRegion {
  id: string;
  polygon: Vec2[]; // 有序顶点环，>=3，隐式闭合
  name?: string;
}
```

```ts
interface MapRegionEditorProps {
  mapImageUrl: string;
  mapWidth?: number; // 默认 1334
  mapHeight?: number; // 默认 750
  regions: PolygonRegion[];
  onChange: (regions: PolygonRegion[]) => void;
  selectedRegionId?: string | null;
  onSelectedRegionIdChange?: (id: string | null) => void;
  className?: string;
}
```

## 常见问题

### 这是完整地图业务编辑器吗？

不是。它是可复用的几何编辑组件，业务字段映射和 API 对接应由宿主应用负责。

### 本地联调时报 `Cannot read properties of null (reading 'useRef')` 怎么办？

通常是 React 被加载了两份。Vite 宿主建议配置 `dedupe` 和 `alias` 强制共用同一份 React：

```ts
resolve: {
  dedupe: ['react', 'react-dom'],
  alias: {
    react: path.resolve(__dirname, './node_modules/react'),
    'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
  },
}
```

## 开发

```bash
npm install
npm run dev
npm run build
npm run test
npm run pack:check
```

## 发版

使用 [Conventional Commits](https://www.conventionalcommits.org/) + `standard-version`：

```bash
npm run release          # 按提交类型自动升版本并更新 CHANGELOG、打 tag
npm run release:patch    # 指定 patch
npm run release:minor    # 指定 minor
npm run release:major    # 指定 major
npm run build && npm publish
```

