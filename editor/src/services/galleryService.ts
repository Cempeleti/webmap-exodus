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

const STORAGE_KEY = 'webmap_user_gallery';

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

export function saveSnapshotToGallery(
  snapshot: ShuttleSnapshotResult,
  state: EditorState,
  shuttleName: string,
  shareUrl?: string,
  shareExpiresAt?: string,
): UserGalleryItem {
  const cleanName = (shuttleName || 'Пользовательский шаттл').trim();
  const sizeCategory = estimateSizeCategory(snapshot.tileWidth, snapshot.tileHeight);

  const yaml = exportMap(
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
    { exportAsGrid: true, shuttleName: cleanName },
  );

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
    window.dispatchEvent(
      new CustomEvent('webmap:gallery_updated', {
        detail: { count: gallery.length, item },
      }),
    );
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.dispatchEvent(
        new CustomEvent('webmap:gallery_updated', {
          detail: { count: gallery.length, item },
        }),
      );
    }
  } catch (e) {
    console.error('Failed to save to gallery localStorage:', e);
  }

  return item;
}
