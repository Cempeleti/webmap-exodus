import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateSizeCategory,
  getUserGallery,
  saveSnapshotToGallery,
} from '../galleryService';
import type { ShuttleSnapshotResult } from '../../rendering/shuttleSnapshotRenderer';
import type { EditorState } from '../../state/editorState';
import { createEmptyGridData } from '../../state/gridData';

describe('galleryService', () => {
  const storageMap = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };

  beforeEach(() => {
    storageMap.clear();
    globalThis.localStorage = localStorageMock as any;
    if (typeof window === 'undefined') {
      (globalThis as any).window = {
        localStorage: localStorageMock,
        dispatchEvent: () => true,
      };
    }
  });

  it('estimateSizeCategory accurately categorizes grid area', () => {
    expect(estimateSizeCategory(5, 5)).toBe('micro'); // 25
    expect(estimateSizeCategory(10, 15)).toBe('small'); // 150
    expect(estimateSizeCategory(20, 20)).toBe('medium'); // 400
    expect(estimateSizeCategory(35, 30)).toBe('large'); // 1050
  });

  it('getUserGallery returns empty array initially', () => {
    expect(getUserGallery()).toEqual([]);
  });

  it('saveSnapshotToGallery stores shuttle in localStorage and returns gallery item', () => {
    const mockSnapshot: ShuttleSnapshotResult = {
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,123',
      width: 640,
      height: 480,
      tileWidth: 20,
      tileHeight: 15,
      entityCount: 12,
    };

    const emptyGrid = createEmptyGridData(1, 'Sparrow');
    const mockState: EditorState = {
      grids: [emptyGrid],
      activeGridIndex: 0,
      grid: emptyGrid.grid,
      entities: emptyGrid.entities,
      containedEntities: emptyGrid.containedEntities,
      gridUid: 1,
      mapUid: 0,
      maps: {},
      gridUidList: [1],
      structuralEntityData: new Map(),
      entityRawComponents: new Map(),
      entityRawPreamble: new Map(),
      chunkKeyOrder: new Map(),
      lineEnding: '\n',
      hasDocumentTerminator: false,
      entityOrder: [],
      meta: { format: 7, name: 'Sparrow' },
      tilemap: {},
      decalsDirty: false,
    } as any;

    const saved = saveSnapshotToGallery(
      mockSnapshot,
      mockState,
      'Sparrow',
      'https://localhost:5173/shuttle?share=abc',
      '2026-11-17T00:00:00Z',
    );

    expect(saved.id).toMatch(/^ug_/);
    expect(saved.name).toBe('Sparrow');
    expect(saved.tileWidth).toBe(20);
    expect(saved.tileHeight).toBe(15);
    expect(saved.size).toBe('small');
    expect(saved.image).toBe('data:image/png;base64,123');
    expect(saved.yamlContent).toContain('Sparrow');

    const gallery = getUserGallery();
    expect(gallery).toHaveLength(1);
    expect(gallery[0].id).toBe(saved.id);
    expect(gallery[0].name).toBe('Sparrow');
  });
});
