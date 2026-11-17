import type { ShuttleSnapshotResult } from '../rendering/shuttleSnapshotRenderer';
import type { EditorState } from '../state/editorState';
import { exportMap } from '../export/mapExporter';

export interface UserGalleryItem {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  baseShuttleId?: string;
  tileWidth: number;
  tileHeight: number;
  entityCount: number;
  size: 'micro' | 'small' | 'medium' | 'large';
  hullClass: string;
  image: string;
  yamlContent?: string;
  shareUrl?: string;
  shareExpiresAt?: string;
}

export interface CommunitySubmissionItem {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  tileWidth: number;
  tileHeight: number;
  entityCount: number;
  size: 'micro' | 'small' | 'medium' | 'large';
  hullClass: string;
  image: string;
  tags: string[];
  yamlContent?: string;
  yamlUrl?: string;
  shareUrl?: string;
  shareExpiresAt?: string;
  likes?: number;
  isUserSubmission?: boolean;
}

const STORAGE_KEY = 'webmap_user_gallery';
const COMMUNITY_STORAGE_KEY = 'webmap_community_submissions';
const DELETE_TOKENS_STORAGE_KEY = 'webmap_community_delete_tokens';
const LIKES_STORAGE_KEY = 'webmap_community_likes';
const IDB_NAME = 'webmap_exodus_gallery';
const IDB_VERSION = 1;
const IDB_STORE = 'user_shuttles';

function openGalleryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

async function idbPutUserShuttle(item: UserGalleryItem): Promise<void> {
  const db = await openGalleryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function estimateSizeCategory(
  tileWidth: number,
  tileHeight: number,
): 'micro' | 'small' | 'medium' | 'large' {
  const tileArea = tileWidth * tileHeight;
  if (tileArea < 100) return 'micro';
  if (tileArea < 350) return 'small';
  if (tileArea < 750) return 'medium';
  return 'large';
}

export function getUserGallery(): UserGalleryItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to read user gallery from localStorage:', e);
    return [];
  }
}

function buildGridYaml(state: EditorState, shuttleName: string): string {
  return exportMap(
    {
      meta: state.meta,
      tilemap: state.tilemap ?? {},
      grid: state.grid,
      entities: state.entities,
      containedEntities: state.containedEntities,
      gridUid: state.gridUid,
      mapUid: state.mapUid,
      maps: state.maps,
      grids: state.gridUidList,
      gridDataList: state.grids,
      structuralEntityData: state.structuralEntityData,
      entityRawComponents: state.entityRawComponents,
      entityRawPreamble: state.entityRawPreamble,
      chunkKeyOrder: state.chunkKeyOrder,
      lineEnding: state.lineEnding,
      hasDocumentTerminator: state.hasDocumentTerminator,
      entityOrder: state.entityOrder,
    },
    state.decalsDirty,
    { exportAsGrid: true, shuttleName },
  );
}

function dispatchGalleryEvent(eventName: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
  if (window.parent && window.parent !== window) {
    window.parent.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export function saveSnapshotToGallery(
  snapshot: ShuttleSnapshotResult,
  state: EditorState,
  shuttleName: string,
  shareUrl?: string,
  shareExpiresAt?: string,
): UserGalleryItem {
  const cleanName = (shuttleName || 'Пользовательский шаттл').trim();
  const sizeCategory = estimateSizeCategory(snapshot.tileWidth, snapshot.tileHeight);
  const yaml = buildGridYaml(state, cleanName);

  const gallery = getUserGallery();
  const now = new Date().toISOString();
  const id = `ug_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const item: UserGalleryItem = {
    id,
    name: cleanName,
    description: `Пользовательский шаттл (${snapshot.tileWidth}×${snapshot.tileHeight} тайлов, сущностей: ${snapshot.entityCount}).`,
    createdAt: now,
    updatedAt: now,
    tileWidth: snapshot.tileWidth,
    tileHeight: snapshot.tileHeight,
    entityCount: snapshot.entityCount,
    size: sizeCategory,
    hullClass: 'shuttle',
    image: snapshot.dataUrl,
    yamlContent: yaml,
    shareUrl: shareUrl || undefined,
    shareExpiresAt: shareExpiresAt || undefined,
  };

  gallery.unshift(item);
  if (gallery.length > 50) gallery.length = 50;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gallery));
    dispatchGalleryEvent('webmap:gallery_updated', { count: gallery.length, item });
  } catch (e) {
    console.warn('localStorage quota exceeded, relying on IndexedDB:', e);
  }

  return item;
}

/**
 * Saves snapshot reliably into IndexedDB (unlimited quota compared to 5MB localStorage)
 * with best-effort localStorage sync.
 */
export async function saveSnapshotToGalleryAsync(
  snapshot: ShuttleSnapshotResult,
  state: EditorState,
  shuttleName: string,
  shareUrl?: string,
  shareExpiresAt?: string,
): Promise<UserGalleryItem> {
  const item = saveSnapshotToGallery(snapshot, state, shuttleName, shareUrl, shareExpiresAt);
  try {
    await idbPutUserShuttle(item);
    dispatchGalleryEvent('webmap:gallery_updated', { item });
  } catch (e) {
    console.warn('IndexedDB write failed:', e);
  }
  return item;
}

async function optimizeImageDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length <= 1_200_000) {
    return dataUrl;
  }
  if (typeof document === 'undefined') return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const webp = canvas.toDataURL('image/webp', 0.92);
    return webp.startsWith('data:image/webp') && webp.length < dataUrl.length ? webp : dataUrl;
  } catch {
    return dataUrl;
  }
}

function getGalleryApiUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    // If served under /editor/index.html, ../api/gallery resolves to /api/gallery
    if (window.location.pathname.includes('/editor')) {
      return new URL('../api/gallery', window.location.href).href;
    }
    return new URL('/api/gallery', window.location.origin).href;
  }
  return '/api/gallery';
}

/**
 * Publishes shuttle snapshot to the shared public community gallery API (/api/gallery).
 */
export async function publishSnapshotToCommunityRemote(
  snapshot: ShuttleSnapshotResult,
  state: EditorState,
  shuttleName: string,
  authorName: string,
  tags: string[] = [],
  shareUrl?: string,
  shareExpiresAt?: string,
): Promise<CommunitySubmissionItem> {
  const cleanName = (shuttleName || 'Пользовательский шаттл').trim();
  const cleanAuthor = (authorName || 'Инженер Станции').trim();
  const sizeCategory = estimateSizeCategory(snapshot.tileWidth, snapshot.tileHeight);
  const cleanTags = tags
    .filter(Boolean)
    .map(t => (t.startsWith('#') ? t.trim() : `#${t.trim()}`));

  const yaml = buildGridYaml(state, cleanName);
  const optimizedImage = await optimizeImageDataUrl(snapshot.dataUrl);

  const res = await fetch(getGalleryApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: cleanName,
      author: cleanAuthor,
      description: `Пользовательский шаттл (${snapshot.tileWidth}×${snapshot.tileHeight} тайлов, сущностей: ${snapshot.entityCount}).`,
      tileWidth: snapshot.tileWidth,
      tileHeight: snapshot.tileHeight,
      entityCount: snapshot.entityCount,
      size: sizeCategory,
      hullClass: 'shuttle',
      image: optimizedImage,
      yamlContent: yaml,
      shareUrl: shareUrl || undefined,
      shareExpiresAt: shareExpiresAt || undefined,
      tags: cleanTags.length > 0 ? cleanTags : ['#пользовательский'],
    }),
  });

  if (!res.ok) {
    let errMsg = `Ошибка сервера: HTTP ${res.status}`;
    try {
      const errData = await res.json();
      if (errData?.error) errMsg = errData.error;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  const created: CommunitySubmissionItem = {
    ...data.item,
    tags: Array.isArray(data.item?.tags) ? data.item.tags : cleanTags,
    isUserSubmission: true,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (data.deleteToken) {
        const rawTokens = localStorage.getItem(DELETE_TOKENS_STORAGE_KEY);
        const tokens = rawTokens ? JSON.parse(rawTokens) : {};
        tokens[created.id] = data.deleteToken;
        localStorage.setItem(DELETE_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
      }
      const rawLikes = localStorage.getItem(LIKES_STORAGE_KEY);
      const likes: string[] = rawLikes ? JSON.parse(rawLikes) : [];
      if (!likes.includes(created.id)) {
        likes.push(created.id);
        localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(likes));
      }
    } catch {}
  }

  dispatchGalleryEvent('webmap:community_updated', { item: created });
  return created;
}

export function publishSnapshotToCommunity(
  snapshot: ShuttleSnapshotResult,
  state: EditorState,
  shuttleName: string,
  authorName: string,
  tags: string[] = [],
  shareUrl?: string,
  shareExpiresAt?: string,
): CommunitySubmissionItem {
  const cleanName = (shuttleName || 'Пользовательский шаттл').trim();
  const cleanAuthor = (authorName || 'Инженер Станции').trim();
  const sizeCategory = estimateSizeCategory(snapshot.tileWidth, snapshot.tileHeight);
  const cleanTags = tags
    .filter(Boolean)
    .map(t => (t.startsWith('#') ? t.trim() : `#${t.trim()}`));

  const yaml = buildGridYaml(state, cleanName);

  let submissions: CommunitySubmissionItem[] = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(COMMUNITY_STORAGE_KEY);
      if (raw) submissions = JSON.parse(raw);
    } catch {}
  }

  const now = new Date().toISOString();
  const id = `comm_user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const item: CommunitySubmissionItem = {
    id,
    name: cleanName,
    author: cleanAuthor,
    description: `Пользовательский шаттл (${snapshot.tileWidth}×${snapshot.tileHeight} тайлов, сущностей: ${snapshot.entityCount}).`,
    createdAt: now,
    updatedAt: now,
    tileWidth: snapshot.tileWidth,
    tileHeight: snapshot.tileHeight,
    entityCount: snapshot.entityCount,
    size: sizeCategory,
    hullClass: 'shuttle',
    image: snapshot.dataUrl,
    tags: cleanTags.length > 0 ? cleanTags : ['#пользовательский'],
    yamlContent: yaml,
    shareUrl: shareUrl || undefined,
    shareExpiresAt: shareExpiresAt || undefined,
    likes: 1,
    isUserSubmission: true,
  };

  submissions.unshift(item);
  if (submissions.length > 50) submissions.length = 50;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(submissions));
      dispatchGalleryEvent('webmap:community_updated', { count: submissions.length, item });
    } catch (e) {
      console.error('Failed to save community submission:', e);
    }
  }

  return item;
}
