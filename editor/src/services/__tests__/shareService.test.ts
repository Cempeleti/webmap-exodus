import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadToStoCare, createShuttleShareLink } from '../shareService';
import type { ShuttleSnapshotResult } from '../../rendering/shuttleSnapshotRenderer';
import type { EditorState } from '../../state/editorState';
import { createEmptyGridData } from '../../state/gridData';

describe('shareService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uploadToStoCare sends file and parses url & expiresAt', async () => {
    const mockFile = new Blob(['hello'], { type: 'text/plain' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        url: 'https://trystocare.com/abc123xyz',
        expiresAt: '2026-11-17T18:00:00.000Z',
      }),
    } as any);

    const result = await uploadToStoCare(mockFile, 'test.txt');
    expect(result.url).toBe('https://trystocare.com/abc123xyz');
    expect(result.expiresAt).toBe('2026-11-17T18:00:00.000Z');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('uploadToStoCare throws on HTTP error', async () => {
    const mockFile = new Blob(['hello'], { type: 'text/plain' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any);

    await expect(uploadToStoCare(mockFile, 'test.txt')).rejects.toThrow(
      /HTTP 500/
    );
  });

  it('createShuttleShareLink uploads image and manifest and generates webmap share URL', async () => {
    const mockSnapshot: ShuttleSnapshotResult = {
      blob: new Blob(['png-bytes'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,123',
      width: 640,
      height: 480,
      tileWidth: 20,
      tileHeight: 15,
      entityCount: 42,
    };

    const emptyGrid = createEmptyGridData(1, 'Eagle One');

    const mockState = {
      meta: { format: 7, name: 'Test Map' },
      tilemap: { 0: 'Space', 1: 'FloorSteel' },
      grid: emptyGrid.grid,
      entities: [],
      containedEntities: new Map(),
      gridUid: '1',
      mapUid: '0',
      maps: [],
      gridUidList: ['1'],
      grids: [emptyGrid],
      structuralEntityData: new Map(),
      entityRawComponents: new Map(),
      entityRawPreamble: new Map(),
      chunkKeyOrder: new Map(),
      lineEnding: '\n',
      hasDocumentTerminator: false,
      entityOrder: [],
      decalsDirty: new Set(),
    } as unknown as EditorState;

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: `https://trystocare.com/file-${callCount}`,
          expiresAt: '2026-11-17T20:00:00.000Z',
        }),
      };
    });

    const shareResult = await createShuttleShareLink(
      mockSnapshot,
      mockState,
      'Eagle One'
    );

    expect(shareResult.imageUrl).toContain('https://trystocare.com/file-1');
    expect(shareResult.yamlUrl).toContain('https://trystocare.com/file-2');
    expect(shareResult.manifestUrl).toBeTruthy();
    expect(shareResult.shareUrl).toContain('/shuttle?');
    expect(shareResult.shareUrl).toContain('share=');
    expect(shareResult.shareUrl).toContain('img=');
    expect(shareResult.shareUrl).toContain('name=Eagle+One');
    expect(shareResult.shareUrl).toContain('w=20');
    expect(shareResult.shareUrl).toContain('h=15');
    expect(shareResult.shareUrl).toContain('e=42');
  });
});
