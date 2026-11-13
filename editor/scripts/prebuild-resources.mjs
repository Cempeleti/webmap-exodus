#!/usr/bin/env node
/**
 * Pre-bake SS14 resources for static deployment.
 *
 * This script:
 * 1. Scans Resources/Prototypes/ for YAML files and generates manifest JSONs
 * 2. Copies required Resources into public/resources/ for static serving
 *
 * Usage: node scripts/prebuild-resources.mjs [--textures=minimal|full|none] [--fork-name=Name]
 *   --textures=minimal  (default) Tiles + Structures + Markers + all fork content
 *   --textures=full     All textures (~150 MB)
 *   --textures=none     Prototypes only, no textures (~8 MB)
 *   --fork-name=Name    Label shown for the built-in resources in the UI. If omitted,
 *                       it is auto-detected from a single fork directory under
 *                       Prototypes/ (e.g. _MyFork -> "MyFork"), else "Built-in".
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Parse args
const textureMode = process.argv.find(a => a.startsWith('--textures='))?.split('=')[1] ?? 'minimal';
const forkNameArg = process.argv.find(a => a.startsWith('--fork-name='))?.split('=')[1];
const resourcesDirArg = process.argv.find(a => a.startsWith('--resources-dir='))?.split('=')[1];

const defaultResourcesPath =
  (resourcesDirArg && path.resolve(resourcesDirArg)) ||
  (process.env.MONOLITH_RESOURCES && path.resolve(process.env.MONOLITH_RESOURCES)) ||
  (fs.existsSync('D:/eexouds/a/Monolith/Resources') ? 'D:/eexouds/a/Monolith/Resources' : null) ||
  (fs.existsSync(path.resolve(projectRoot, '../../monolith/Resources')) ? path.resolve(projectRoot, '../../monolith/Resources') : null) ||
  path.resolve(projectRoot, '../../Resources');

const resourcesRoot = defaultResourcesPath;
const publicResources = path.join(projectRoot, 'public/resources');

const TEXTURE_SETS = {
  none: [],
  // Base SS14 texture directories. Fork-specific texture directories (under any
  // discovered _Fork prefix) are appended automatically below.
  minimal: ['Tiles', 'Structures', 'Markers', 'Decals'],
  full: null, // copy entire Textures dir
};

// ---- Helpers ----

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

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  Warning: ${src} does not exist, skipping`);
    return 0;
  }
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

// ---- Main ----

console.log(`Pre-baking SS14 resources (textures: ${textureMode})`);
console.log(`  Source: ${resourcesRoot}`);
console.log(`  Target: ${publicResources}`);
console.log();

// Clean target
if (fs.existsSync(publicResources)) {
  fs.rmSync(publicResources, { recursive: true });
}
fs.mkdirSync(publicResources, { recursive: true });

// Step 1: Generate prototype manifests
console.log('Step 1: Generating prototype manifests...');

const tileDir = path.join(resourcesRoot, 'Prototypes/Tiles');
const entityDir = path.join(resourcesRoot, 'Prototypes/Entities');
const catalogDir = path.join(resourcesRoot, 'Prototypes/Catalog');
const decalDir = path.join(resourcesRoot, 'Prototypes/Decals');

const tileFiles = walkDir(tileDir, '.yml').map(f =>
  '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')
);
const entityFiles = walkDir(entityDir, '.yml').map(f =>
  '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')
);
const catalogFiles = walkDir(catalogDir, '.yml').map(f =>
  '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')
);
const decalFiles = walkDir(decalDir, '.yml').map(f =>
  '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')
);

// Also scan fork Entities, Tiles/Turf, Catalog and Decals directories (any leading-underscore fork dir)
const forkCatalogFiles = [];
const forkDecalFiles = [];
const forkEntityFiles = [];
const forkTileFiles = [];
const forkPrefixes = [];
const prototypesDir = path.join(resourcesRoot, 'Prototypes');
for (const entry of fs.readdirSync(prototypesDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('_')) {
    forkPrefixes.push(entry.name);

    // Fork Entities
    const forkEntities = path.join(prototypesDir, entry.name, 'Entities');
    forkEntityFiles.push(...walkDir(forkEntities, '.yml').map(f => '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')));

    // Fork Tiles & Turf
    const forkTiles = path.join(prototypesDir, entry.name, 'Tiles');
    const forkTurf = path.join(prototypesDir, entry.name, 'Turf');
    forkTileFiles.push(...walkDir(forkTiles, '.yml').map(f => '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')));
    forkTileFiles.push(...walkDir(forkTurf, '.yml').map(f => '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')));

    // Fork Catalog & Catalogs
    const forkCatalog = path.join(prototypesDir, entry.name, 'Catalog');
    const forkCatalogs = path.join(prototypesDir, entry.name, 'Catalogs');
    forkCatalogFiles.push(...walkDir(forkCatalog, '.yml').map(f => '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')));
    forkCatalogFiles.push(...walkDir(forkCatalogs, '.yml').map(f => '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')));

    // Fork Decals
    const forkDecals = path.join(prototypesDir, entry.name, 'Decals');
    forkDecalFiles.push(...walkDir(forkDecals, '.yml').map(f => '/' + path.relative(resourcesRoot, f).replace(/\\/g, '/')));
  }
}

const manifestDir = path.join(publicResources, '_manifests');
fs.mkdirSync(manifestDir, { recursive: true });
const allTileFiles = [...tileFiles, ...forkTileFiles];
const allEntityFiles = [...entityFiles, ...forkEntityFiles];
const allCatalogFiles = [...catalogFiles, ...forkCatalogFiles];
const allDecalFiles = [...decalFiles, ...forkDecalFiles];

fs.writeFileSync(path.join(manifestDir, 'tiles.json'), JSON.stringify(allTileFiles));
fs.writeFileSync(path.join(manifestDir, 'entities.json'), JSON.stringify(allEntityFiles));
fs.writeFileSync(path.join(manifestDir, 'catalog.json'), JSON.stringify(allCatalogFiles));
fs.writeFileSync(path.join(manifestDir, 'decals.json'), JSON.stringify(allDecalFiles));

// Determine the built-in fork name shown in the UI.
const builtInForkName = forkNameArg ?? (forkPrefixes.includes('_Mono') ? 'Monolith' : (forkPrefixes.length === 1 ? forkPrefixes[0].replace(/^_/, '') : 'Monolith'));
fs.writeFileSync(path.join(manifestDir, 'fork.json'), JSON.stringify({ name: builtInForkName }));
console.log(`  Built-in fork name: ${builtInForkName}`);
console.log(`  Tile prototypes: ${allTileFiles.length} files (${tileFiles.length} base + ${forkTileFiles.length} fork)`);
console.log(`  Entity prototypes: ${allEntityFiles.length} files (${entityFiles.length} base + ${forkEntityFiles.length} fork)`);
console.log(`  Catalog prototypes: ${allCatalogFiles.length} files (${catalogFiles.length} base + ${forkCatalogFiles.length} fork)`);
console.log(`  Decal prototypes: ${allDecalFiles.length} files (${decalFiles.length} base + ${forkDecalFiles.length} fork)`);

// Step 2: Copy prototype YAML files
console.log('\nStep 2: Copying prototype files...');

let protoCount = 0;
for (const relPath of [...allTileFiles, ...allEntityFiles, ...allCatalogFiles, ...allDecalFiles]) {
  const src = path.join(resourcesRoot, relPath);
  const dest = path.join(publicResources, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  protoCount++;
}
console.log(`  Copied ${protoCount} prototype files`);

// Step 3: Copy textures
console.log(`\nStep 3: Copying textures (mode: ${textureMode})...`);

const textureSrc = path.join(resourcesRoot, 'Textures');
const textureDest = path.join(publicResources, 'Textures');

if (textureMode === 'full') {
  const count = copyDirRecursive(textureSrc, textureDest);
  console.log(`  Copied ${count} texture files`);
} else if (textureMode !== 'none') {
  const dirs = [...(TEXTURE_SETS[textureMode] ?? TEXTURE_SETS.minimal)];
  // Copy every texture directory owned by a fork. Fork prototypes can reference
  // assets outside the base set, such as _Mono/Objects/ShuttleWeapons.
  for (const fork of forkPrefixes) {
    const forkTextureDir = path.join(textureSrc, fork);
    if (fs.existsSync(forkTextureDir)) {
      dirs.push(fork);
    }
  }
  let totalCount = 0;
  for (const subdir of dirs) {
    const src = path.join(textureSrc, subdir);
    const dest = path.join(textureDest, subdir);
    const count = copyDirRecursive(src, dest);
    console.log(`  ${subdir}: ${count} files`);
    totalCount += count;
  }
  console.log(`  Total: ${totalCount} texture files`);
}

// Summary
const totalSize = dirSize(publicResources);
console.log(`\nDone! Total size: ${formatSize(totalSize)}`);
console.log(`Output: ${publicResources}`);
