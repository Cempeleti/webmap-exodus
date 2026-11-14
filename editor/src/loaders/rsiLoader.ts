import type { CardinalDirection } from '../types';
import type { SpriteInfo } from './registryTypes';
import { getActiveProvider } from './resourceProvider';

// ---- Types ----

export interface RsiState {
  name: string;
  directions: number;
  frameCount: number;
  yOffset: number; // row offset in the PNG sprite sheet
}

export interface RsiMeta {
  size: { x: number; y: number };
  states: Map<string, RsiState>;
}

export interface RsiRawMeta {
  version: number;
  size: { x: number; y: number };
  states: { name: string; directions?: number; delays?: number[][] }[];
  [key: string]: unknown;
}

/** Result of loadSprite, everything needed to drawImage a single frame. */
export interface SpriteDrawInfo {
  image: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// ---- Pure functions (unit-tested) ----

/**
 * Normalizes an RSI path by removing leading slashes, Windows backslashes,
 * and redundant 'Textures/' prefixes so it reliably maps to the texture root.
 */
export function normalizeRsiPath(rsiPath: string): string {
  if (!rsiPath) return '';
  return rsiPath
    .trim()
    .replace(/^[/\\\\]?Textures[/\\\\]/i, '')
    .replace(/^[/\\\\]+/, '')
    .replace(/\\/g, '/');
}

/**
 * Parse a raw meta.json object into indexed state data.
 * Each state has directions (default 1), frameCount (from delays[0].length or 1),
 * and yOffset (cumulative row offset, each state occupies `directions` rows
 * vertically in the sprite sheet).
 */
export function parseRsiMeta(raw: RsiRawMeta): RsiMeta {
  const states = new Map<string, RsiState>();
  let currentYOffset = 0;

  for (const rawState of raw.states) {
    const directions = rawState.directions ?? 1;
    const frameCount =
      rawState.delays && rawState.delays.length > 0
        ? rawState.delays[0].length
        : 1;

    states.set(rawState.name, {
      name: rawState.name,
      directions,
      frameCount,
      yOffset: currentYOffset,
    });

    currentYOffset += directions;
  }

  return {
    size: { x: raw.size.x, y: raw.size.y },
    states,
  };
}

/**
 * Map a cardinal direction to an RSI row offset within a state.
 * SS14 RSI direction order: South=0, North=1, East=2, West=3.
 * Returns 0 for single-direction sprites.
 */
export function getDirectionOffset(
  direction: CardinalDirection,
  numDirections: number,
): number {
  if (numDirections <= 1) return 0;

  const dirMap: Record<CardinalDirection, number> = {
    south: 0,
    north: 1,
    east: 2,
    west: 3,
  };
  return dirMap[direction];
}

// ---- Caches ----

const metaCache = new Map<string, Promise<RsiMeta>>();
const imageCache = new Map<string, Promise<HTMLImageElement>>();

// ---- Async loaders (browser-only, not unit-tested) ----

/**
 * Fetch and parse meta.json for an RSI directory. Results are cached.
 * Uses the active ResourceProvider to resolve the URL.
 * @param rsiPath - Relative path like "Structures/Power/apc.rsi" or "/Textures/..."
 */
export async function loadRsiMeta(
  rsiPath: string,
): Promise<RsiMeta> {
  const cleanPath = normalizeRsiPath(rsiPath);
  const key = cleanPath;

  if (!metaCache.has(key)) {
    const provider = getActiveProvider();
    const texPath = `/Textures/${cleanPath}`;
    const promise = provider.readText(`${texPath}/meta.json`)
      .then((text) => JSON.parse(text.replace(/^\uFEFF/, '')) as RsiRawMeta)
      .then(parseRsiMeta);
    metaCache.set(key, promise);
  }

  return metaCache.get(key)!;
}

/**
 * Load an HTMLImageElement from a URL. Results are cached.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  if (!imageCache.has(url)) {
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
    imageCache.set(url, promise);
  }

  return imageCache.get(url)!;
}

/**
 * Load the PNG sprite sheet for a specific RSI state.
 * Uses the active ResourceProvider to resolve the URL.
 * @param rsiPath - Relative path like "Structures/Power/apc.rsi"
 * @param stateName - State name like "base"
 */
export async function loadRsiStateImage(
  rsiPath: string,
  stateName: string,
): Promise<HTMLImageElement> {
  const cleanPath = normalizeRsiPath(rsiPath);
  const provider = getActiveProvider();
  const texPath = `/Textures/${cleanPath}`;
  const url = provider.getImageUrl(`${texPath}/${stateName}.png`);
  return loadImage(url);
}

/**
 * Get everything needed to draw a specific sprite frame.
 * Returns null if the state is not found in the RSI meta.
 * Uses the active ResourceProvider to resolve URLs.
 *
 * @param spriteInfo - Sprite info from the prototype registry
 * @param direction - Cardinal direction to render
 * @param frame - Animation frame index (0-based)
 * @param stateOverride - Optional state name to use instead of spriteInfo.baseState
 */
export async function loadSprite(
  spriteInfo: SpriteInfo,
  direction: CardinalDirection,
  frame: number,
  stateOverride?: string,
): Promise<SpriteDrawInfo | null> {
  if (!spriteInfo) return null;

  // Determine effective RSI path (fallback to layer sprite if root rsiPath is empty)
  let rsiPath = normalizeRsiPath(spriteInfo.rsiPath);
  if (!rsiPath && spriteInfo.layers && spriteInfo.layers.length > 0) {
    const lWithSprite = spriteInfo.layers.find((l) => l.sprite);
    if (lWithSprite?.sprite) {
      rsiPath = normalizeRsiPath(lWithSprite.sprite);
    }
  }
  if (!rsiPath) return null;

  let meta: RsiMeta;
  try {
    meta = await loadRsiMeta(rsiPath);
  } catch {
    return null;
  }

  // 1. Determine requested state name
  const requestedState = stateOverride ?? spriteInfo.baseState;
  let state = requestedState ? meta.states.get(requestedState) : undefined;

  // 2. Fallbacks if state is not found
  if (!state && spriteInfo.baseState && spriteInfo.baseState !== requestedState) {
    state = meta.states.get(spriteInfo.baseState);
  }

  // 3. Fallback: check any layer state that exists in this RSI
  if (!state && spriteInfo.layers && spriteInfo.layers.length > 0) {
    for (const l of spriteInfo.layers) {
      if (l.state && meta.states.has(l.state)) {
        state = meta.states.get(l.state);
        break;
      }
    }
  }

  // 4. Fallback: standard state names in SS14 / Monolith
  if (!state) {
    state = meta.states.get('space_artillery') ||
            meta.states.get('icon') ||
            meta.states.get('base') ||
            meta.states.get('default') ||
            meta.states.get('0') ||
            meta.states.get('state0') ||
            meta.states.get('idle');
  }

  // 5. Fallback: partial / prefix match
  if (!state && requestedState) {
    for (const [sName, sObj] of meta.states.entries()) {
      if (sName.startsWith(requestedState) || sName.includes(requestedState) || requestedState.includes(sName)) {
        state = sObj;
        break;
      }
    }
  }

  // 6. Fallback: first available state in the RSI
  if (!state && meta.states.size > 0) {
    state = meta.states.values().next().value;
  }

  if (!state) return null;

  let image: HTMLImageElement;
  try {
    image = await loadRsiStateImage(
      rsiPath,
      state.name,
    );
  } catch {
    return null;
  }

  const dirOffset = getDirectionOffset(direction, state.directions);

  // RSI PNGs lay out cells (direction × frame) left-to-right, top-to-bottom,
  // wrapping at the image width. For example, a 4-direction 32×32 state produces
  // a 64×64 PNG (2×2 grid), not a 32×128 column.
  const cellIndex = dirOffset * state.frameCount + frame;
  const columnsPerRow = Math.max(1, Math.floor(image.width / meta.size.x));
  const sx = (cellIndex % columnsPerRow) * meta.size.x;
  const sy = Math.floor(cellIndex / columnsPerRow) * meta.size.y;

  return {
    image,
    sx,
    sy,
    sw: meta.size.x,
    sh: meta.size.y,
  };
}

/** Clear all caches. */
export function clearRsiCache(): void {
  metaCache.clear();
  imageCache.clear();
}
