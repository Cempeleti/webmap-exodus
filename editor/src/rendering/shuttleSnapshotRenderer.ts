import type { TileGrid } from '../types';
import type { ImportedEntity } from '../import/mapImporter';
import type { DecalInstance } from '../import/decalParser';
import type { IPrototypeRegistry } from '../loaders/registryTypes';
import { Camera } from './camera';
import { renderGrid, hasPendingTileLoads } from './gridRenderer';
import { renderDecals, hasPendingDecalLoads } from './decalRenderer';
import { renderEntities, hasPendingEntityLoads, DEFAULT_LAYER_VISIBILITY } from './entityRenderer';
import { rebuildSpatialIndex } from './spatialIndex';

const TILE_SIZE = 32;

export interface ShuttleSnapshotResult {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  entityCount: number;
}

export interface ShuttleSnapshotOptions {
  padding?: number;
  backgroundColor?: string | null; // e.g. '#080c16' or null for transparent
  maxDimension?: number;
  waitForAssets?: boolean;
  assetTimeoutMs?: number;
}

function renderAllLayers(
  ctx: CanvasRenderingContext2D,
  grid: TileGrid,
  entities: ImportedEntity[],
  decals: DecalInstance[],
  camera: Camera,
  canvasW: number,
  canvasH: number,
  registry: IPrototypeRegistry | null,
): void {
  renderGrid(ctx, grid, camera, canvasW, canvasH, registry);
  renderDecals(ctx, decals, camera, canvasW, canvasH, registry);
  renderEntities(
    ctx,
    entities,
    camera,
    canvasW,
    canvasH,
    registry,
    grid,
    true,
    DEFAULT_LAYER_VISIBILITY,
  );
}

/**
 * Wait until all tile, decal, and entity sprite/RSI fetches triggered by rendering settle.
 */
async function settleSnapshotAssets(
  ctx: CanvasRenderingContext2D,
  grid: TileGrid,
  entities: ImportedEntity[],
  decals: DecalInstance[],
  camera: Camera,
  canvasW: number,
  canvasH: number,
  registry: IPrototypeRegistry | null,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stablePasses = 0;

  while (Date.now() < deadline && stablePasses < 2) {
    renderAllLayers(ctx, grid, entities, decals, camera, canvasW, canvasH, registry);
    const pending = hasPendingTileLoads() || hasPendingDecalLoads() || hasPendingEntityLoads();
    if (!pending) {
      stablePasses++;
      if (stablePasses >= 2) break;
    } else {
      stablePasses = 0;
    }
    await new Promise((r) => setTimeout(r, 35));
  }
}

/**
 * Render the entire shuttle grid and entities to an offscreen image.
 */
export async function renderShuttleSnapshot(
  grid: TileGrid,
  entities: ImportedEntity[],
  decals: DecalInstance[],
  registry: IPrototypeRegistry | null,
  options?: ShuttleSnapshotOptions,
): Promise<ShuttleSnapshotResult> {
  const padding = options?.padding ?? 1;
  const bgColor = options?.backgroundColor !== undefined ? options.backgroundColor : '#080c16';
  const maxDimension = options?.maxDimension ?? 4096;
  const waitForAssets = options?.waitForAssets ?? true;
  const assetTimeoutMs = options?.assetTimeoutMs ?? 8000;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Scan grid tiles (ignore Space)
  if (grid.width > 0 && grid.height > 0) {
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cell = grid.cells[row * grid.width + col];
        if (cell && cell.tileId && cell.tileId !== 'Space') {
          const wx = grid.offsetX + col;
          const wy = grid.offsetY + row;
          if (wx < minX) minX = wx;
          if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy;
          if (wy > maxY) maxY = wy;
        }
      }
    }
  }

  // Scan placed entities
  for (const entity of entities) {
    const ex = Math.floor(entity.position.x);
    const ey = Math.floor(entity.position.y);
    if (ex < minX) minX = ex;
    if (ex > maxX) maxX = ex;
    if (ey < minY) minY = ey;
    if (ey > maxY) maxY = ey;
  }

  // Scan decals
  for (const decal of decals) {
    const dx = Math.floor(decal.position.x);
    const dy = Math.floor(decal.position.y);
    if (dx < minX) minX = dx;
    if (dx > maxX) maxX = dx;
    if (dy < minY) minY = dy;
    if (dy > maxY) maxY = dy;
  }

  // If nothing is placed yet, use a default 10x10 area
  if (minX === Infinity) {
    minX = -5;
    maxX = 5;
    minY = -5;
    maxY = 5;
  }

  const tileWidth = maxX - minX + 1;
  const tileHeight = maxY - minY + 1;

  const paddedMinX = minX - padding;
  const paddedMaxX = maxX + padding;
  const paddedMinY = minY - padding;
  const paddedMaxY = maxY + padding;

  const totalTilesW = paddedMaxX - paddedMinX + 1;
  const totalTilesH = paddedMaxY - paddedMinY + 1;

  const rawW = Math.max(64, totalTilesW * TILE_SIZE);
  const rawH = Math.max(64, totalTilesH * TILE_SIZE);
  const maxSide = Math.max(rawW, rawH);
  const scale = maxDimension > 0 && maxSide > maxDimension ? maxDimension / maxSide : 1;

  const canvasW = Math.max(64, Math.round(rawW * scale));
  const canvasH = Math.max(64, Math.round(rawH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create 2D canvas context');

  ctx.imageSmoothingEnabled = scale < 1;

  // Ensure spatial index matches the entities we are rendering
  rebuildSpatialIndex(entities);

  // Setup camera centered on the bounds
  const camera = new Camera();
  camera.x = (paddedMinX + paddedMaxX + 1) / 2;
  camera.y = (paddedMinY + paddedMaxY + 1) / 2;
  camera.zoom = scale;

  if (waitForAssets) {
    await settleSnapshotAssets(
      ctx,
      grid,
      entities,
      decals,
      camera,
      canvasW,
      canvasH,
      registry,
      assetTimeoutMs,
    );
  }

  // Final crisp render pass
  renderAllLayers(ctx, grid, entities, decals, camera, canvasW, canvasH, registry);

  // Fill background behind everything (renderGrid clears the canvas before drawing tiles)
  if (bgColor) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();
  }

  const dataUrl = canvas.toDataURL('image/png');

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), 'image/png');
  });

  return {
    dataUrl,
    blob,
    width: canvasW,
    height: canvasH,
    tileWidth,
    tileHeight,
    entityCount: entities.length,
  };
}
