import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button, ConfigProvider, Input, Space, Typography, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MapRegionEditor, type PolygonRegion } from '../src/index';
import demoRegions from './demo-regions.json';

const { Paragraph, Text } = Typography;

const DEFAULT_MAP_URL = 'https://picsum.photos/seed/map-region-editor/1334/750';

function App() {
  const [mapUrl, setMapUrl] = useState(DEFAULT_MAP_URL);
  const [regions, setRegions] = useState<PolygonRegion[]>(demoRegions as PolygonRegion[]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ padding: 24 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          MapRegionEditor — 多边形热区
        </Typography.Title>
        <Paragraph type="secondary">
          仅预览热区绘制/改边数；物料与保存逻辑由宿主应用提供。
        </Paragraph>
        <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 960 }}>
          <Space.Compact style={{ width: '100%' }}>
            <Button disabled>底图</Button>
            <Input value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} />
          </Space.Compact>
          <Space>
            <Text type="secondary">
              {regions.length} 个热区
              {selectedId ? ` · 选中 ${selectedId.slice(0, 8)}…` : ''}
            </Text>
            <Button
              onClick={() => {
                message.info('宿主应用在此处理 onChange 结果');
                console.log('[dev] regions', regions);
              }}
            >
              打印 regions
            </Button>
          </Space>
          <div style={{ height: 560, border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <MapRegionEditor
              mapImageUrl={mapUrl}
              regions={regions}
              onChange={setRegions}
              selectedRegionId={selectedId}
              onSelectedRegionIdChange={setSelectedId}
            />
          </div>
        </Space>
      </div>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
