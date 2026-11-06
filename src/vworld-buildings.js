// Browser-only client for the localhost Vite proxy. The proxy owns the key;
// no upstream URL or credential is ever sent to this module.
const STEP = .005, SCALE = 200, MAX_TILES = 25, CONCURRENCY = 4;
// WFS caps each response; split dense tiles instead of silently losing buildings.
const MAX_DEPTH = 2, MAX_REQUESTS = 150, CACHE_TTL_MS = 120000, MAX_CACHED_TILES = 100;
const tileCache = new Map();
const empty = () => ({ type:'FeatureCollection', features:[], metadata:{ source:'브이월드 도로명주소건물', truncated:false, failedTiles:0, missingHeight:0, received:0, totalTiles:0 } });

export function planVWorldBuildingTiles(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return [];
  const [w,s,e,n]=bounds;
  if (w < 124 || e > 132 || s < 32 || n > 39 || e <= w || n <= s) return [];
  const x0=Math.floor(w*SCALE), x1=Math.ceil(e*SCALE)-1, y0=Math.floor(s*SCALE), y1=Math.ceil(n*SCALE)-1;
  if ((x1-x0+1)*(y1-y0+1)>MAX_TILES) return [];
  const result=[];
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) {
    const west=+(x*STEP).toFixed(6), south=+(y*STEP).toFixed(6);
    result.push({west,south,east:+((x+1)*STEP).toFixed(6),north:+((y+1)*STEP).toFixed(6)});
  }
  return result;
}

export async function vworldBuildingsAvailable({fetcher=globalThis.fetch, hostname=globalThis.location?.hostname}={}) {
  if (!['127.0.0.1','localhost','::1','[::1]'].includes(hostname) || typeof fetcher !== 'function') return false;
  try {
    const response=await fetcher('/api/vworld/status',{cache:'no-store'});
    if (!response.ok || !(response.headers?.get('content-type') || '').includes('json')) return false;
    const status=await response.json(); return status?.enabled===true && status?.wfs===true;
  } catch { return false; }
}

export async function loadVWorldBuildings(bounds,{fetcher=globalThis.fetch,signal}={}) {
  const tiles=planVWorldBuildingTiles(bounds), result=empty();
  result.metadata.totalTiles=tiles.length;
  if (!tiles.length || typeof fetcher !== 'function') { result.metadata.outOfRange=true; return result; }
  const useCache=fetcher===globalThis.fetch, seen=new Set(); let pending=tiles.map(tile=>({tile,depth:0})), requested=tiles.length;
  function collect(data, includeMetadata=true) {
    if (includeMetadata) {
      result.metadata.truncated ||= data.metadata?.truncated===true;
      result.metadata.missingHeight += Math.max(0,Number(data.metadata?.missingHeight)||0);
      result.metadata.received += Math.max(0,Number(data.metadata?.received)||0);
    }
    for(const f of data.features) {
      const id=f?.properties?.id, height=f?.properties?.height, source=f?.properties?.heightSource;
      const known=source==='levels' && Number.isFinite(height) && height>0 && height<=600;
      const unknown=source==='unknown' && height===null;
      if (f?.type!=='Feature' || !['Polygon','MultiPolygon'].includes(f.geometry?.type) || typeof id!=='string' || !id || (!known && !unknown) || f.properties.source!=='vworld' || seen.has(id)) continue;
      seen.add(id); result.features.push(f);
    }
  }
  async function readTile(tile) {
    const params=new URLSearchParams(Object.entries(tile).map(([k,v])=>[k,String(v)])), cacheKey=params.toString();
    const cached=useCache && tileCache.get(cacheKey);
    if (cached && Date.now()-cached.at<CACHE_TTL_MS) { tileCache.delete(cacheKey); tileCache.set(cacheKey,cached); return cached.data; }
    if (cached) tileCache.delete(cacheKey);
    try {
      const response=await fetcher(`/api/vworld/buildings?${params}`,{cache:'no-store',signal});
      if (!response.ok || !(response.headers?.get('content-type') || '').includes('json')) throw new Error('invalid response');
      const data=await response.json();
      if (data?.type!=='FeatureCollection' || !Array.isArray(data.features)) throw new Error('invalid collection');
      if (useCache && !signal?.aborted && data.metadata?.truncated!==true) {
        tileCache.set(cacheKey,{at:Date.now(),data});
        while (tileCache.size>MAX_CACHED_TILES) tileCache.delete(tileCache.keys().next().value);
      }
      return data;
    } catch { return null; }
  }
  while (pending.length && !signal?.aborted) {
    const batch=pending; pending=[]; const parts=Array(batch.length); let next=0;
    async function worker() {
      while (next<batch.length && !signal?.aborted) { const i=next++; parts[i]=await readTile(batch[i].tile); }
    }
    await Promise.all(Array.from({length:Math.min(CONCURRENCY,batch.length)},()=>worker()));
    if (signal?.aborted) { result.metadata.aborted=true; return result; }
    for (let i=0;i<batch.length;i++) {
      const data=parts[i], {tile,depth}=batch[i];
      if (!data) { result.metadata.failedTiles++; continue; }
      if (data.metadata?.truncated && depth<MAX_DEPTH && requested+4<=MAX_REQUESTS) {
        // Keep the partial parent if later child requests fail; IDs deduplicate it.
        collect(data,false);
        const midX=+((tile.west+tile.east)/2).toFixed(6), midY=+((tile.south+tile.north)/2).toFixed(6);
        for (const [west,east] of [[tile.west,midX],[midX,tile.east]]) for (const [south,north] of [[tile.south,midY],[midY,tile.north]]) pending.push({tile:{west,south,east,north},depth:depth+1});
        requested+=4;
      } else collect(data);
    }
  }
  result.metadata.missingHeight=result.features.filter(f=>f.properties.heightSource==='unknown').length;
  return result;
}

// Conservative visual decluttering only. This is not an authoritative ID join.
// Require mutual polygon-center inclusion, similar footprint area and very high
// bounding-box overlap before concealing an OSM outline behind a VWorld outline.
function geometryShape(geom) {
  const polys=geom?.type==='Polygon'?[geom.coordinates]:geom?.type==='MultiPolygon'?geom.coordinates:null;
  if (!Array.isArray(polys) || !polys.length) return null;
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity,area=0;
  for(const poly of polys) {
    if (!Array.isArray(poly) || !poly.length) return null;
    for(let j=0;j<poly.length;j++) {
      const ring=poly[j]; if(!Array.isArray(ring)||ring.length<4 || !Array.isArray(ring[0]) || !Number.isFinite(ring[0][0]) || !Number.isFinite(ring[0][1])) return null; const [ox,oy]=ring[0]; let a=0;
      for(let i=0;i<ring.length;i++) {
        const p=ring[i],q=ring[(i+1)%ring.length];
        if(!Array.isArray(p)||!Array.isArray(q)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||!Number.isFinite(q[0])||!Number.isFinite(q[1]))return null;
        west=Math.min(west,p[0]);east=Math.max(east,p[0]);south=Math.min(south,p[1]);north=Math.max(north,p[1]);
        a += (p[0]-ox)*(q[1]-oy)-(q[0]-ox)*(p[1]-oy);
      }
      area += (j===0?1:-1)*Math.abs(a)/2;
    }
  }
  if (!(area>0 && east>west && north>south) || east-west>.02 || north-south>.02) return null;
  return {polys,west,south,east,north,area,center:[(west+east)/2,(south+north)/2]};
}
function inRing(point,ring) {
  let inside=false;const [x,y]=point;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
function inShape(point,shape) {
  return shape.polys.some(poly=>inRing(point,poly[0]) && !poly.slice(1).some(hole=>inRing(point,hole)));
}
function nearSameFootprint(a,b) {
  const aw=a.east-a.west,ah=a.north-a.south,bw=b.east-b.west,bh=b.north-b.south;
  const iw=Math.max(0,Math.min(a.east,b.east)-Math.max(a.west,b.west));
  const ih=Math.max(0,Math.min(a.north,b.north)-Math.max(a.south,b.south));
  const intersection=iw*ih, union=aw*ah+bw*bh-intersection;
  const ratio=a.area/b.area;
  return union>0 && intersection/union>=.72 && ratio>=.72 && ratio<=1/.72 && inShape(a.center,b) && inShape(b.center,a);
}
export function filterOsmBuildingOverlap(osmFeatures,vworldFeatures) {
  const originals=Array.isArray(osmFeatures)?osmFeatures:[], candidates=Array.isArray(vworldFeatures)?vworldFeatures:[];
  const grid=new Map(),scale=1000;
  for(const f of candidates) {
    // An outline without a verified height must not hide an extrudable OSM building.
    if (f?.properties?.source==='vworld' && f.properties.heightSource==='unknown') continue;
    const shape=geometryShape(f?.geometry); if(!shape)continue;
    for(let x=Math.floor(shape.west*scale);x<=Math.floor(shape.east*scale);x++)
      for(let y=Math.floor(shape.south*scale);y<=Math.floor(shape.north*scale);y++) {
        const key=`${x},${y}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(shape);
      }
  }
  let suppressedCount=0;
  const features=originals.filter(f=>{
    const shape=geometryShape(f?.geometry);if(!shape)return true;
    const key=`${Math.floor(shape.center[0]*scale)},${Math.floor(shape.center[1]*scale)}`;
    if ((grid.get(key)||[]).some(other=>nearSameFootprint(shape,other))) {suppressedCount++;return false;}
    return true;
  });
  return {features,suppressedCount};
}

/**
 * Visual overlap resolution is not an identity match. Preserve both providers'
 * attributes and footprint on the visible feature when exactly one strong
 * overlap is found in each direction; otherwise leave both features untouched.
 * An OSM stated height is preferred over a floor-based estimate, but is not
 * claimed to be a surveyed height.
 */
export function mergeBuildingSources(osmFeatures, vworldFeatures) {
  const osm=Array.isArray(osmFeatures)?osmFeatures:[], official=Array.isArray(vworldFeatures)?vworldFeatures:[];
  const grid=new Map(), scale=1000, candidates=[];
  for (let i=0;i<official.length;i++) {
    const f=official[i];
    if (f?.properties?.heightSource!=='levels' || !Number.isFinite(f.properties.height) || f.properties.height<=0) continue;
    const shape=geometryShape(f.geometry); if (!shape) continue;
    candidates[i]=shape;
    for(let x=Math.floor(shape.west*scale);x<=Math.floor(shape.east*scale);x++)
      for(let y=Math.floor(shape.south*scale);y<=Math.floor(shape.north*scale);y++) {
        const key=`${x},${y}`; if(!grid.has(key)) grid.set(key,[]); grid.get(key).push(i);
      }
  }
  const matches=new Map(), inverse=new Map();
  for(let i=0;i<osm.length;i++) {
    const shape=geometryShape(osm[i]?.geometry); if (!shape) continue;
    const indices=(grid.get(`${Math.floor(shape.center[0]*scale)},${Math.floor(shape.center[1]*scale)}`)||[]).filter(j=>nearSameFootprint(shape,candidates[j]));
    for (const j of indices) { if(!inverse.has(j)) inverse.set(j,[]); inverse.get(j).push(i); }
    if(indices.length===1) matches.set(i,indices[0]);
  }
  const omitOsm=new Set(),omitOfficial=new Set(),updates=new Map();
  const withAlternative=(winner,other)=>({...winner,properties:{...winner.properties,
    alternativeMatch:'도형이 비슷한 후보이며 동일 건물 확인 전',
    alternativeSource:other.properties?.source || '', alternativeId:String(other.properties?.id || ''),
    alternativeName:other.properties?.name || '', alternativeHeight:other.properties?.height ?? null,
    alternativeHeightSource:other.properties?.heightSource || '', alternativeLevels:other.properties?.levels ?? null,
    alternativeGeometry:JSON.stringify(other.geometry)}});
  for(const [i,j] of matches) {
    if(inverse.get(j).length!==1) continue;
    if(osm[i]?.properties?.heightSource==='height' && Number.isFinite(osm[i].properties.height) && osm[i].properties.height>0) {
      omitOfficial.add(j); updates.set(osm[i],withAlternative(osm[i],official[j]));
    } else {
      omitOsm.add(i); updates.set(official[j],withAlternative(official[j],osm[i]));
    }
  }
  return {features:[...osm.filter((_,i)=>!omitOsm.has(i)).map(f=>updates.get(f)||f),...official.filter((_,i)=>!omitOfficial.has(i)).map(f=>updates.get(f)||f)],
    osmCount:osm.length-omitOsm.size, vworldCount:official.length-omitOfficial.size, matchedCount:omitOsm.size+omitOfficial.size, osmHeightPreferred:omitOfficial.size};
}
