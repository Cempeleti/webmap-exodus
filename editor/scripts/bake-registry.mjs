#!/usr/bin/env node
/**
 * Bake SS14 Monolith/Exodus prototypes into a single fast-loading JSON registry.
 * This eliminates the need for the browser to fetch thousands of individual YAML files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// SS14 Schema
const MULTI_TYPE_MAPPING = new yaml.Type('!type:', {
  kind: 'mapping',
  multi: true,
  represent(data) { return data; },
  construct(data, type) {
    if (data !== null && typeof data === 'object') {
      data._ss14Tag = type;
    }
    return data;
  },
});

const MULTI_TYPE_SCALAR = new yaml.Type('!type:', {
  kind: 'scalar',
  multi: true,
  represent(data) { return String(data); },
  construct(data, type) {
    return { _ss14Tag: type, value: data };
  },
});

const MULTI_TYPE_SEQUENCE = new yaml.Type('!type:', {
  kind: 'sequence',
  multi: true,
  represent(data) { return data; },
  construct(data, type) {
    return { _ss14Tag: type, items: data };
  },
});

const SS14_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  MULTI_TYPE_MAPPING,
  MULTI_TYPE_SCALAR,
  MULTI_TYPE_SEQUENCE,
]);

// Parse args
const resourcesDirArg = process.argv.find(a => a.startsWith('--resources-dir='))?.split('=')[1];
const defaultResourcesPath =
  (resourcesDirArg && path.resolve(resourcesDirArg)) ||
  (process.env.MONOLITH_RESOURCES && path.resolve(process.env.MONOLITH_RESOURCES)) ||
  (fs.existsSync('D:/eexouds/a/Monolith/Resources') ? 'D:/eexouds/a/Monolith/Resources' : null) ||
  (fs.existsSync(path.resolve(projectRoot, '../../monolith/Resources')) ? path.resolve(projectRoot, '../../monolith/Resources') : null) ||
  path.resolve(projectRoot, '../../Resources');

const resourcesRoot = defaultResourcesPath;
if (!fs.existsSync(resourcesRoot)) {
  console.error(`Resources root not found: ${resourcesRoot}`);
  process.exit(1);
}

function walkDir(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function deriveCategory(filePath) {
  const entityMatch = filePath.match(/\/Prototypes\/(?:_[^/]+\/)?Entities\/(.+)\//);
  if (entityMatch) return entityMatch[1].split('/').join('/');
  const catalogMatch = filePath.match(/\/Prototypes\/(?:_[^/]+\/)?Catalog\/(.+)\//);
  if (catalogMatch) return 'Catalog/' + catalogMatch[1].split('/').join('/');
  return 'Other';
}

function parsePrototypeYaml(yamlContent, filePath) {
  const docs = yaml.loadAll(yamlContent, undefined, { schema: SS14_SCHEMA });
  const tiles = [];
  const entities = [];
  const decals = [];

  for (const doc of docs) {
    if (!Array.isArray(doc)) continue;
    for (const entry of doc) {
      if (!entry || typeof entry !== 'object' || !('type' in entry) || !('id' in entry)) continue;
      if (entry.type === 'tile') {
        tiles.push(entry);
      } else if (entry.type === 'entity') {
        entities.push(entry);
      } else if (entry.type === 'decal') {
        decals.push(entry);
      }
    }
  }

  return { tiles, entities, decals, sourceCategory: deriveCategory(filePath) };
}

function inferSmoothBase(iconSmoothComp, baseState) {
  if (!iconSmoothComp) return undefined;
  const explicitBase = iconSmoothComp.base;
  if (explicitBase) return explicitBase;
  if (baseState && iconSmoothComp.key) {
    const match = baseState.match(/^([a-zA-Z_]+)\d+$/);
    if (match) return match[1];
  }
  return undefined;
}

function inferSmoothMode(iconSmoothComp) {
  if (!iconSmoothComp) return undefined;
  const mode = iconSmoothComp.mode;
  if (mode === 'CardinalFlags') return 'CardinalFlags';
  if (mode === 'Diagonal') return 'Diagonal';
  if (!iconSmoothComp.base && !mode) return 'CardinalFlags';
  return 'Corners';
}

function extractSpriteInfo(components) {
  const spriteComp = components.find(c => c.type === 'Sprite');
  if (!spriteComp) return null;

  const rawLayers = spriteComp.layers ?? [];
  const layers = rawLayers.map(l => ({
    state: l.state ?? '',
    sprite: l.sprite,
    map: l.map,
    visible: l.visible,
    shader: l.shader,
    color: l.color,
    scale: l.scale,
  }));

  const iconSmoothComp = components.find(c => c.type === 'IconSmooth');
  const baseState = spriteComp.state ?? (layers[0]?.state ?? '');

  return {
    rsiPath: spriteComp.sprite ?? '',
    baseState,
    drawDepth: spriteComp.drawdepth ?? spriteComp.drawDepth,
    noRot: spriteComp.noRot,
    color: spriteComp.color,
    iconSmoothKey: iconSmoothComp?.key,
    iconSmoothBase: inferSmoothBase(iconSmoothComp, baseState),
    iconSmoothMode: inferSmoothMode(iconSmoothComp),
    layers,
  };
}

function mergeComponents(chain) {
  const merged = new Map();
  for (const proto of chain) {
    for (const comp of proto.components ?? []) {
      const existing = merged.get(comp.type);
      if (existing) {
        merged.set(comp.type, { ...existing, ...comp });
      } else {
        merged.set(comp.type, comp);
      }
    }
  }
  return Array.from(merged.values());
}

function resolveEntities(entries) {
  const protoById = new Map();
  for (const entry of entries) {
    protoById.set(entry.proto.id, entry);
  }

  const chainCache = new Map();

  function buildChain(id, visited = new Set()) {
    if (chainCache.has(id)) return chainCache.get(id);
    if (visited.has(id)) return [];
    const entry = protoById.get(id);
    if (!entry) return [];

    visited.add(id);
    const proto = entry.proto;
    const parentIds = proto.parent
      ? Array.isArray(proto.parent) ? proto.parent : [proto.parent]
      : [];

    const ancestorChain = [];
    for (const parentId of parentIds) {
      const parentChain = buildChain(parentId, new Set(visited));
      for (const ancestor of parentChain) {
        if (!ancestorChain.some(a => a.id === ancestor.id)) {
          ancestorChain.push(ancestor);
        }
      }
    }

    const chain = [...ancestorChain, proto];
    chainCache.set(id, chain);
    return chain;
  }

  const result = new Map();
  for (const entry of entries) {
    const proto = entry.proto;
    if (proto.abstract) continue;

    const chain = buildChain(proto.id);
    const components = mergeComponents(chain);

    result.set(proto.id, {
      id: proto.id,
      name: String(proto.name ?? proto.id),
      description: String(proto.description ?? ''),
      suffix: String(proto.suffix ?? ''),
      abstract: false,
      categories: proto.categories ?? [],
      placement: proto.placement ?? {},
      components,
      spriteInfo: extractSpriteInfo(components),
      sourceCategory: entry.category,
    });
  }

  return result;
}

function resolveTiles(rawTiles) {
  const result = new Map();
  for (const raw of rawTiles) {
    result.set(raw.id, {
      id: raw.id,
      name: String(raw.name ?? raw.id),
      sprite: raw.sprite ?? null,
      variants: raw.variants ?? 1,
      isSubfloor: raw.isSubfloor ?? true,
      isSpace: raw.isSpace ?? false,
      baseTurf: raw.baseTurf ?? null,
    });
  }
  return result;
}

function resolveDecals(rawDecals) {
  const protoById = new Map();
  for (const raw of rawDecals) {
    protoById.set(raw.id, raw);
  }

  function buildChain(id, visited = new Set()) {
    if (visited.has(id)) return [];
    const proto = protoById.get(id);
    if (!proto) return [];
    visited.add(id);
    const parentIds = proto.parent
      ? Array.isArray(proto.parent) ? proto.parent : [proto.parent]
      : [];

    const ancestors = [];
    for (const parentId of parentIds) {
      const parentChain = buildChain(parentId, new Set(visited));
      for (const ancestor of parentChain) {
        if (!ancestors.some(a => a.id === ancestor.id)) {
          ancestors.push(ancestor);
        }
      }
    }
    return [...ancestors, proto];
  }

  const result = new Map();
  for (const raw of rawDecals) {
    if (raw.abstract) continue;
    const chain = buildChain(raw.id);
    let rsiPath = '';
    let state = '';
    let tags = [];
    let snapCardinals = false;
    let defaultCustomColor = false;

    for (const proto of chain) {
      if (proto.sprite?.sprite) rsiPath = proto.sprite.sprite;
      if (proto.sprite?.state) state = proto.sprite.state;
      if (proto.tags) tags = proto.tags;
      if (proto.snapCardinals !== undefined) snapCardinals = proto.snapCardinals;
      if (proto.defaultCustomColor !== undefined) defaultCustomColor = proto.defaultCustomColor;
    }

    if (!rsiPath && !state) continue;

    result.set(raw.id, {
      id: raw.id,
      rsiPath,
      state,
      tags,
      snapCardinals,
      defaultCustomColor,
    });
  }
  return result;
}

console.log(`Baking Monolith/Exodus prototypes from: ${resourcesRoot}`);
const t0 = Date.now();

const prototypesDir = path.join(resourcesRoot, 'Prototypes');
const yamlFiles = walkDir(prototypesDir, '.yml');
console.log(`  Found ${yamlFiles.length} prototype YAML files`);

const rawTiles = [];
const rawEntities = [];
const rawDecals = [];

for (const f of yamlFiles) {
  try {
    const content = fs.readFileSync(f, 'utf8');
    const relPath = '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/');
    const parsed = parsePrototypeYaml(content, relPath);
    rawTiles.push(...parsed.tiles);
    for (const ent of parsed.entities) {
      rawEntities.push({ proto: ent, category: parsed.sourceCategory });
    }
    rawDecals.push(...parsed.decals);
  } catch (err) {
    // Ignore invalid files
  }
}

const tilesMap = resolveTiles(rawTiles);
const entitiesMap = resolveEntities(rawEntities);
const decalsMap = resolveDecals(rawDecals);

// Filter components to reduce size while retaining everything the editor needs
const RELEVANT_COMPS = new Set([
  'Sprite', 'IconSmooth', 'Occluder', 'DeviceList', 'DeviceLinkSource', 'DeviceLinkSink',
  'ContainerContainer', 'EntityTableContainerFill', 'Battery', 'AtmosPipeColor',
  'SurveillanceCamera', 'MetaData', 'Physics', 'Fixtures', 'Shuttle'
]);

for (const ent of entitiesMap.values()) {
  if (ent.components) {
    ent.components = ent.components.filter(c => RELEVANT_COMPS.has(c.type));
  }
}

const bundle = {
  forkName: 'Monolith (Exodus)',
  timestamp: Date.now(),
  tiles: Object.fromEntries(tilesMap),
  entities: Object.fromEntries(entitiesMap),
  decals: Object.fromEntries(decalsMap),
};

const jsonStr = JSON.stringify(bundle);
console.log(`  Resolved in ${Date.now() - t0}ms: ${tilesMap.size} tiles, ${entitiesMap.size} entities, ${decalsMap.size} decals`);
console.log(`  Bundle size: ${(jsonStr.length / (1024 * 1024)).toFixed(2)} MB`);

// Write to static/editor/resources and editor/public/resources
const targets = [
  path.resolve(projectRoot, '../static/editor/resources/monolith-registry.json'),
  path.resolve(projectRoot, 'public/resources/monolith-registry.json'),
];

for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, jsonStr, 'utf8');
  console.log(`  Wrote ${target}`);
}

console.log('Prototype baking completed successfully!');
