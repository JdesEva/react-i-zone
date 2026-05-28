# react-i-zone

React polygon zone editor / hotspot editor component.  
Use it for image hotspot annotation, polygon area selection, and interactive polygon vertex editing.

`react-i-zone` focuses on geometry editing only: draw polygon, move vertex, move region, validate overlap/self-intersection, and undo.

[English](./README.md) | [简体中文](./README.zh-CN.md)

## Demo

![react-i-zone demo](https://raw.githubusercontent.com/jdeseva/react-i-zone/main/assets/demo-kit-small.gif)

## Install

```bash
npm install react-i-zone
```

Peer dependencies: `react`, `react-dom`, `antd`, `@ant-design/icons` (React 18+, AntD 5+).

## 30-Second Usage

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

## Features

- Polygon drawing and close-to-first-point completion
- Vertex drag and whole-region drag
- Add/remove polygon vertices in edit mode
- Self-intersection validation and overlap validation
- Undo stack for polygon edge editing
- Controlled component API (`regions` + `onChange`)

## Scope

| Included | Not Included |
|------|-------------------------|
| Polygon draw / close / edit | Business payload schema |
| Vertex add/remove | Modal / Drawer shell |
| Vertex/region drag | Backend API integration |
| Geometry validation | Form/sidebar business logic |
| Undo stack | Persistence/storage workflow |

## Types

```ts
interface PolygonRegion {
  id: string;
  polygon: Vec2[]; // ordered polygon ring, >= 3 points, implicitly closed
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

| Prop | Type | Default | Description |
|------|------|--------|------|
| `mapImageUrl` | `string` | - | Background image URL |
| `mapWidth` | `number` | `1334` | Logical canvas width |
| `mapHeight` | `number` | `750` | Logical canvas height |
| `regions` | `PolygonRegion[]` | - | Controlled region list |
| `onChange` | `(regions: PolygonRegion[]) => void` | - | Triggered on draw complete, vertex/region drag end, and edge edits |
| `selectedRegionId` | `string \| null` | `undefined` | Controlled selected region id |
| `onSelectedRegionIdChange` | `(id: string \| null) => void` | - | Triggered when selection changes |
| `className` | `string` | - | Root className |

Note: while dragging, the component updates local preview first and emits `onChange` on mouse up.

## Geometry Utilities (Optional)

Includes helpers like:
- `validateSimplePolygon`
- `applyDraftPoint`
- `applyVertexMove`
- `isRegionPlacementInvalid`
- `normalizeClosedPolygon`

## FAQ

### Is this a full map business editor?

No. `react-i-zone` is a reusable polygon geometry editor component.
Business data mapping, API serialization, and side panel forms should stay in the host app.

### Does it support controlled mode?

Yes. The editor is designed for controlled usage with `regions` and `onChange`.

### Can I use it for image annotation?

Yes. Typical use cases: image hotspot tagging, polygon annotation, interactive region selection.

### I got `Cannot read properties of null (reading 'useRef')` in dev

This is usually caused by duplicate React instances when linking local packages.
In Vite host apps, add:

```ts
resolve: {
  dedupe: ['react', 'react-dom'],
  alias: {
    react: path.resolve(__dirname, './node_modules/react'),
    'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
  },
}
```

## Dev

```bash
npm install
npm run dev    # http://localhost:5175
npm run build
npm run test
npm run pack:check
```

## Release

Uses [Conventional Commits](https://www.conventionalcommits.org/) + `standard-version`:

```bash
npm run release          # bump version + CHANGELOG + git tag (by commit types)
npm run release:patch    # force patch
npm run release:minor    # force minor
npm run release:major    # force major
npm run build && npm publish
```

## License

MIT © jdeseva
