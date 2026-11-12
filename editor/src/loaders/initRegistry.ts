import { discoverPrototypes } from './prototypeDiscovery';
import { resolveTiles, resolveEntities, resolveDecals } from './prototypeResolver';
import { PrototypeRegistry } from './prototypeRegistry';
import type { ResourceProvider } from './resourceProvider';
import { HttpResourceProvider } from './resourceProvider';
import type { ResolvedTile, ResolvedEntity, DecalPrototypeInfo } from './registryTypes';

export interface PrebakedRegistryBundle {
  forkName?: string;
  tiles: Record<string, ResolvedTile>;
  entities: Record<string, ResolvedEntity>;
  decals: Record<string, DecalPrototypeInfo>;
}

/**
 * Fast synchronous initialization of PrototypeRegistry from a prebaked JSON bundle.
 */
export function initRegistryFromBundle(bundle: PrebakedRegistryBundle): PrototypeRegistry {
  const tiles = new Map(Object.entries(bundle.tiles));
  const entities = new Map(Object.entries(bundle.entities));
  const decals = new Map(Object.entries(bundle.decals ?? {}));
  return new PrototypeRegistry(tiles, entities, decals);
}

/**
 * Initialize the prototype registry by discovering and parsing all game prototypes.
 * Call once on app startup.
 *
 * Accepts either a ResourceProvider instance or a base URL string (backward compat).
 */
export async function initRegistry(
  providerOrBaseUrl: ResourceProvider | string = '',
  onProgress?: (message: string) => void,
): Promise<PrototypeRegistry> {
  const provider: ResourceProvider = typeof providerOrBaseUrl === 'string'
    ? new HttpResourceProvider(providerOrBaseUrl)
    : providerOrBaseUrl;

  onProgress?.('Discovering prototypes...');
  const { tiles: rawTiles, entities: rawEntities, decals: rawDecals } = await discoverPrototypes(
    provider,
    (loaded, total) => onProgress?.(`Loading prototypes: ${loaded}/${total} files`),
  );

  onProgress?.(`Resolving ${rawTiles.length} tiles, ${rawEntities.length} entities, ${rawDecals.length} decals...`);
  const tiles = resolveTiles(rawTiles);
  const entities = resolveEntities(rawEntities);
  const decals = resolveDecals(rawDecals);

  onProgress?.(`Registry ready: ${tiles.size} tiles, ${entities.size} entities, ${decals.size} decals`);
  return new PrototypeRegistry(tiles, entities, decals);
}
