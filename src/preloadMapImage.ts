/** 已完成预加载的 URL（同步判断，避免打开弹窗时先闪白） */
const loadedUrls = new Set<string>();

/** 同源时 blob 展示地址，二次打开可走内存 */
const blobUrlBySource = new Map<string, string>();

const inflight = new Map<string, Promise<string>>();

function rememberLoaded(sourceUrl: string, displayUrl: string): string {
  loadedUrls.add(sourceUrl);
  blobUrlBySource.set(sourceUrl, displayUrl);
  return displayUrl;
}

/** 与当前页面是否跨域（跨域不能用 fetch 读图，会触发 CORS） */
function isCrossOriginUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function loadViaImageElement(source: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(rememberLoaded(source, source));
    img.onerror = () => reject(new Error('map image load failed'));
    img.src = source;
  });
}

async function loadViaFetchBlob(source: string): Promise<string> {
  const res = await fetch(source, { credentials: 'include', cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`fetch ${res.status}`);
  }
  const blob = await res.blob();
  return rememberLoaded(source, URL.createObjectURL(blob));
}

export function isMapImageLoaded(url: string): boolean {
  return loadedUrls.has(url.trim());
}

/** 优先返回已缓存的 blob URL，否则返回原地址 */
export function getMapImageDisplaySrc(url: string): string {
  const u = url.trim();
  if (!u) return u;
  return blobUrlBySource.get(u) ?? u;
}

/**
 * 预加载地图背景图。
 * - 同源：fetch → blob（可缓存）
 * - 跨域（如 CDN 127.0.0.1:7001）：仅用 Image，避免 CORS；展示仍用原 URL
 */
export function preloadMapImage(url: string): Promise<string> {
  const source = url.trim();
  if (!source) return Promise.resolve('');

  const cachedDisplay = blobUrlBySource.get(source);
  if (cachedDisplay && loadedUrls.has(source)) {
    return Promise.resolve(cachedDisplay);
  }

  const pending = inflight.get(source);
  if (pending) return pending;

  const task = (async (): Promise<string> => {
    if (isCrossOriginUrl(source)) {
      return loadViaImageElement(source);
    }
    try {
      return await loadViaFetchBlob(source);
    } catch {
      return loadViaImageElement(source);
    }
  })()
    .catch((err) => {
      loadedUrls.delete(source);
      blobUrlBySource.delete(source);
      throw err;
    })
    .finally(() => {
      inflight.delete(source);
    });

  inflight.set(source, task);
  return task;
}
