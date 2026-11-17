import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  estimateSizeCategory,
  getUserGallery,
  saveSnapshotToGallery,
  publishSnapshotToCommunity,
  publishSnapshotToCommunityRemote,
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

  it('publishSnapshotToCommunity saves shuttle in community submissions with author and tags', () => {
    const mockSnapshot: ShuttleSnapshotResult = {
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,123',
      width: 640,
      height: 480,
      tileWidth: 25,
      tileHeight: 20,
      entityCount: 150,
    };

    const emptyGrid = createEmptyGridData(1, 'Falcon');
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
      meta: { format: 7, name: 'Falcon' },
      tilemap: {},
      decalsDirty: false,
    } as any;

    const published = publishSnapshotToCommunity(
      mockSnapshot,
      mockState,
      'Falcon Heavy',
      'Инженер Новиков',
      ['боевой', '#щиты'],
      'https://trystocare.com/xyz',
    );

    expect(published.id).toMatch(/^comm_user_/);
    expect(published.author).toBe('Инженер Новиков');
    expect(published.tags).toEqual(['#боевой', '#щиты']);
    expect(published.isUserSubmission).toBe(true);
    expect(published.likes).toBe(1);

    const storedRaw = storageMap.get('webmap_community_submissions');
    expect(storedRaw).toBeDefined();
    const parsed = JSON.parse(storedRaw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(published.id);
  });

  it('publishSnapshotToCommunityRemote posts to /api/gallery and stores deleteToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        deleteToken: 'secret-tok-123',
        item: {
          id: 'comm_remote_1',
          name: 'Remote Viper',
          author: 'Пилот',
          description: 'desc',
          createdAt: '2026-11-17T00:00:00Z',
          tileWidth: 20,
          tileHeight: 20,
          entityCount: 50,
          size: 'small',
          hullClass: 'shuttle',
          image: 'https://blob.vercel-storage.com/viper.png',
          yamlUrl: 'https://blob.vercel-storage.com/viper.yml',
          tags: ['#боевой'],
          likes: 1,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const mockSnapshot: ShuttleSnapshotResult = {
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,123',
      width: 640,
      height: 480,
      tileWidth: 20,
      tileHeight: 20,
      entityCount: 50,
    };
    const emptyGrid = createEmptyGridData(1, 'Remote Viper');
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
      meta: { format: 7, name: 'Remote Viper' },
      tilemap: {},
      decalsDirty: false,
    } as any;

    const item = await publishSnapshotToCommunityRemote(
      mockSnapshot,
      mockState,
      'Remote Viper',
      'Пилот',
      ['боевой'],
    );

    expect(item.id).toBe('comm_remote_1');
    expect(item.isUserSubmission).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    const savedTokens = JSON.parse(storageMap.get('webmap_community_delete_tokens')!);
    expect(savedTokens['comm_remote_1']).toBe('secret-tok-123');
    vi.unstubAllGlobals();
  });

  it('publishSnapshotToCommunityRemote throws server error message when backend fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Storage not configured' }),
      }),
    );

    const mockSnapshot: ShuttleSnapshotResult = {
      blob: new Blob(['png'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,123',
      width: 64,
      height: 64,
      tileWidth: 2,
      tileHeight: 2,
      entityCount: 1,
    };
    const emptyGrid = createEmptyGridData(1, 'Err');
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
      meta: { format: 7, name: 'Err' },
      tilemap: {},
      decalsDirty: false,
    } as any;

    await expect(
      publishSnapshotToCommunityRemote(mockSnapshot, mockState, 'Err', 'User'),
    ).rejects.toThrow('Storage not configured');
    vi.unstubAllGlobals();
  });
});
