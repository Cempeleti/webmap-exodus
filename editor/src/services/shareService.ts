import type { ShuttleSnapshotResult } from '../rendering/shuttleSnapshotRenderer';
import type { EditorState } from '../state/editorState';
import { exportMap } from '../export/mapExporter';

export interface ShuttleShareManifest {
  version: number;
  name: string;
  description: string;
  size: string;
  tileWidth: number;
  tileHeight: number;
  entityCount: number;
  hullClass: string;
  classes: string[];
  engines: string[];
  imageUrl: string;
  yamlUrl?: string;
  createdAt: string;
  expiresAt: string;
}

export interface ShuttleShareResult {
  shareUrl: string;
  imageUrl: string;
  yamlUrl?: string;
  manifestUrl: string;
  expiresAt: string;
}

/**
 * Uploads a file blob to sto.care (free, no auth, CORS-enabled, 72h temporary hosting).
 */
export async function uploadToStoCare(
  file: Blob,
  filename: string,
): Promise<{ url: string; expiresAt?: string }> {
  const formData = new FormData();
  formData.append('file', file, filename);

  const res = await fetch('https://ul.sto.care', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Ошибка сервиса загрузки: HTTP ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (!data?.url) {
    throw new Error('Сервер временного хранения не вернул ссылку на файл.');
  }

  return {
    url: String(data.url),
    expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
  };
}

/**
 * Creates a complete temporary share package for a shuttle render:
 * 1. Uploads the PNG render to sto.care.
 * 2. Exports and uploads the SS14 Grid YAML to sto.care.
 * 3. Uploads the JSON manifest to sto.care.
 * 4. Generates a webmap URL that can be shared with anyone.
 */
export async function createShuttleShareLink(
  snapshot: ShuttleSnapshotResult,
  state: EditorState,
  shuttleName: string,
): Promise<ShuttleShareResult> {
  const cleanName = (shuttleName || 'Пользовательский шаттл').trim();
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'shuttle';

  // Estimate size category
  let sizeCategory = 'small';
  const tileArea = snapshot.tileWidth * snapshot.tileHeight;
  if (tileArea < 100) sizeCategory = 'micro';
  else if (tileArea < 350) sizeCategory = 'small';
  else if (tileArea < 750) sizeCategory = 'medium';
  else sizeCategory = 'large';

  // 1. Upload PNG image
  const imageUpload = await uploadToStoCare(snapshot.blob, `${slug}-render.png`);
  const imageUrl = imageUpload.url;
  const expiresAt =
    imageUpload.expiresAt || new Date(Date.now() + 3 * 86400000).toISOString();

  // 2. Export and upload YAML map
  let yamlUrl: string | undefined;
  try {
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

    const yamlBlob = new Blob([yaml], { type: 'text/yaml' });
    const yamlUpload = await uploadToStoCare(yamlBlob, `${slug}.yml`);
    yamlUrl = yamlUpload.url;
  } catch (err) {
    console.warn('Failed to export/upload YAML for share link:', err);
  }

  // 3. Upload JSON manifest
  const manifest: ShuttleShareManifest = {
    version: 1,
    name: cleanName,
    description: `Пользовательский шаттл, созданный в редакторе карт. Размер: ${snapshot.tileWidth}×${snapshot.tileHeight} тайлов, сущностей: ${snapshot.entityCount}.`,
    size: sizeCategory,
    tileWidth: snapshot.tileWidth,
    tileHeight: snapshot.tileHeight,
    entityCount: snapshot.entityCount,
    hullClass: 'shuttle',
    classes: ['civilian'],
    engines: ['plasma'],
    imageUrl,
    yamlUrl,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  const jsonBlob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  });
  const manifestUpload = await uploadToStoCare(jsonBlob, `${slug}-manifest.json`);
  const manifestUrl = manifestUpload.url;

  // 4. Build shareable webmap URL
  // Resolve ../shuttle from the current location (e.g. /editor/index.html -> /shuttle)
  const currentHref =
    typeof window !== 'undefined' && window.location
      ? window.location.href
      : 'http://localhost:5173/editor/index.html';
  const baseShuttleUrl = new URL('../shuttle', currentHref).href;
  const url = new URL(baseShuttleUrl);
  url.searchParams.set('share', manifestUrl);
  url.searchParams.set('img', imageUrl);
  url.searchParams.set('name', cleanName);
  url.searchParams.set('w', String(snapshot.tileWidth));
  url.searchParams.set('h', String(snapshot.tileHeight));
  url.searchParams.set('e', String(snapshot.entityCount));
  url.searchParams.set('size', sizeCategory);
  if (yamlUrl) {
    url.searchParams.set('yaml', yamlUrl);
  }
  if (expiresAt) {
    url.searchParams.set('exp', expiresAt);
  }

  return {
    shareUrl: url.toString(),
    imageUrl,
    yamlUrl,
    manifestUrl,
    expiresAt,
  };
}
