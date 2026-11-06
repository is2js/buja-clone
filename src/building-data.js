// Lazy-load only OSM building tiles intersecting the 3D viewport.
// Tile geometry belongs to its centroid's tile, so include one tile of margin.
const base = import.meta.env?.BASE_URL || '/';
let manifestPromise;
const tileCache = new Map();
const MAX_CACHED_TILES = 48;
export async function loadBuildingManifest() {
  if (!manifestPromise) manifestPromise = fetch(`${base}data/buildings/manifest.json`).then(async response => {
    if (!response.ok) throw new Error('건물 자료 목록을 불러오지 못했습니다.');
    const manifest = await response.json();
    if (!Array.isArray(manifest.tiles) || !(manifest.tileSize > 0)) throw new Error('건물 자료 목록 형식이 올바르지 않습니다.');
    return manifest;
  }).catch(error => { manifestPromise = null; throw error; });
  return manifestPromise;
}
export function visibleBuildingTiles(manifest, bounds) {
  if (!manifest || !Array.isArray(manifest.tiles) || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return [];
  const margin = Number(manifest.tileSize) || 0;
  const [w,s,e,n] = bounds;
  return manifest.tiles.filter(tile => Array.isArray(tile.bounds) && tile.bounds.length === 4 && tile.bounds.every(Number.isFinite) &&
    tile.bounds[2] >= w-margin && tile.bounds[0] <= e+margin && tile.bounds[3] >= s-margin && tile.bounds[1] <= n+margin);
}
export async function loadBuildingTile(tile) {
  if (!tile || typeof tile.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(tile.id)) throw new Error('건물 타일 ID가 올바르지 않습니다.');
  if (tile.tileSet != null && (typeof tile.tileSet !== 'string' || !/^buildings-[a-zA-Z0-9_-]+$/.test(tile.tileSet))) throw new Error('건물 타일 버전이 올바르지 않습니다.');
  const cacheKey = `${tile.tileSet || 'legacy'}:${tile.id}`;
  const path = tile.tileSet ? `versions/${tile.tileSet}/tiles` : 'tiles';
  if (!tileCache.has(cacheKey)) {
    const promise = fetch(`${base}data/buildings/${path}/${tile.id}.json`).then(async response => {
      if (!response.ok) throw new Error('건물 타일을 불러오지 못했습니다.');
      const data = await response.json();
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('건물 타일 형식이 올바르지 않습니다.');
      return data.features.filter(feature => feature?.type === 'Feature' && ['Polygon','MultiPolygon'].includes(feature.geometry?.type) &&
        Number.isFinite(feature.properties?.height) && feature.properties.height > 0 && feature.properties.height <= 1000 &&
        ['height','levels'].includes(feature.properties.heightSource));
    }).catch(error => { tileCache.delete(cacheKey); throw error; });
    tileCache.set(cacheKey,promise);
    if (tileCache.size > MAX_CACHED_TILES) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(cacheKey);
}
