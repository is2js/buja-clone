import * as maplibregl from 'maplibre-gl';
import { createMetricScale } from './map-metrics.js';
import { TERRARIUM_URL, sampleElevations } from './terrain-data.js';
import { loadBuildingManifest, visibleBuildingTiles, loadBuildingTile } from './building-data.js';
import { loadVWorldBuildings, mergeBuildingSources, planVWorldBuildingTiles } from './vworld-buildings.js';
import { createBuildingCard, planBuildingLabels, withBuildingIds } from './building-ui.js';

// Shared with the SVG map's local equirectangular projection.
const PK = Math.cos(36.5 * Math.PI / 180), SCALE = 1200, MX = 100.1684389, MY = -38.6136915, RATIO = 1.3;
const toLL = (x, y) => [(x / SCALE + MX) / PK, -(y / SCALE + MY)];
const toXY = (lon, lat) => [(lon * PK - MX) * SCALE, (-lat - MY) * SCALE];
const collection = features => ({ type:'FeatureCollection', features });
const empty = () => collection([]);
const validCoordinate = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85;

/** Group equal source coordinates and keep the most prominent non-overlapping names. */
export function planApartmentLabels(apartments, {area, bounds, width, height, project, zoom}) {
  if (zoom < 14 || typeof project !== 'function' || !bounds) return [];
  const grouped = new Map();
  for (const apt of apartments || []) {
    if (!apt || apt.sample || apt.locationVerified !== true || apt.area !== area || !validCoordinate(apt.coordinate) || !bounds.contains(apt.coordinate)) continue;
    const key = apt.coordinate.join(',');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(apt);
  }
  const candidates = [];
  for (const group of grouped.values()) {
    group.sort((a,b) => String(a.id).localeCompare(String(b.id)));
    const pt = project(group[0].coordinate);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || pt.x < -60 || pt.y < -20 || pt.x > width+60 || pt.y > height+20) continue;
    const title = `${group[0].name || '공동주택'}${group.length > 1 ? ' 외' : ''}`;
    // Approximate screen space avoids overdraw without altering source coordinates.
    const w = Math.min(142, Math.max(42, title.length * 10 + 8)), h = 19;
    candidates.push({group, point:group[0].coordinate, pt, title, box:[pt.x-w/2-4, pt.y-h/2-3, pt.x+w/2+4, pt.y+h/2+3], priority:Math.max(...group.map(a => Number(a.households) || 0))});
  }
  candidates.sort((a,b) => b.priority-a.priority || a.title.localeCompare(b.title) || String(a.group[0].id).localeCompare(String(b.group[0].id)));
  const accepted=[];
  for (const candidate of candidates) {
    if (accepted.length >= 100) break;
    const [x1,y1,x2,y2]=candidate.box;
    if (accepted.some(({box:[a,b,c,d]}) => x1<c && x2>a && y1<d && y2>b)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

/** Convert the existing SVG view into a MapLibre camera, preserving center and approximate scale. */
export function svgViewToCamera(view, width = 440, height) {
  if (!view || !(view.w > 0)) return null;
  const ratio = Number.isFinite(view.ratio) && view.ratio > 0 ? view.ratio : Number.isFinite(height) && height > 0 ? height / width : RATIO;
  const center = toLL(view.x + view.w / 2, view.y + view.w * ratio / 2);
  const zoom = Math.max(1, Math.min(20, Math.log2(360 * PK * SCALE * (width || 440) / (512 * view.w))));
  return {center, zoom};
}
/** Convert MapLibre camera back to the SVG's center/scale. */
export function cameraToSvgView(center, zoom, width = 440, height = width * RATIO) {
  if (!validCoordinate(center) || !Number.isFinite(zoom)) return null;
  const ratio = Number.isFinite(height) && height > 0 ? height / width : RATIO;
  const w = 360 * PK * SCALE * (width || 440) / (512 * 2 ** zoom);
  const [x,y] = toXY(...center);
  return {x:x-w/2, y:y-w*ratio/2, w, ratio, pixelWidth:width};
}

// Existing administrative polygons use absolute M and relative l; legal ones M/L/Z.
function pathRings(path) {
  const tokens = path?.match(/[MLZmlz]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || [];
  const rings = []; let ring = [], command = '', x=0, y=0, sx=0, sy=0, i=0;
  const flush = () => { if (ring.length >= 3) { if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push([...ring[0]]); rings.push(ring); } ring=[]; };
  while (i < tokens.length) {
    if (/^[MLZmlz]$/.test(tokens[i])) {
      command=tokens[i++];
      if (command === 'Z' || command === 'z') { x=sx; y=sy; flush(); command=''; continue; }
      if ((command === 'M' || command === 'm') && ring.length) flush();
    }
    if (!command || i+1>=tokens.length || /^[MLZmlz]$/.test(tokens[i]) || /^[MLZmlz]$/.test(tokens[i+1])) break;
    const a=Number(tokens[i++]), b=Number(tokens[i++]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) break;
    x=command === 'm' || command === 'l' ? x+a : a; y=command === 'm' || command === 'l' ? y+b : b;
    if (command === 'M' || command === 'm') { sx=x; sy=y; command=command === 'M' ? 'L' : 'l'; }
    ring.push([x,y]);
  }
  flush(); return rings;
}
function inside(point, ring) {
  let result=false;
  for (let i=0,j=ring.length-1; i<ring.length; j=i++) {
    const [x,y]=ring[i], [a,b]=ring[j];
    if ((y>point[1]) !== (b>point[1]) && point[0] < (a-x)*(point[1]-y)/(b-y)+x) result=!result;
  }
  return result;
}
const ringArea = ring => Math.abs(ring.reduce((sum,p,i) => { const q=ring[(i+1)%ring.length]; return sum+p[0]*q[1]-q[0]*p[1]; },0)/2);
const provinceRingCache=new WeakMap();
/** Return a province only when the point falls within a known district polygon. */
export function provinceAtCoordinate(geo,coordinate) {
  if (!geo?.gu || !validCoordinate(coordinate)) return null;
  const [x,y]=toXY(...coordinate); let cache=provinceRingCache.get(geo);
  if (!cache) {cache=new Map(); provinceRingCache.set(geo,cache);}
  const areas=new Set();
  for (const [code, district] of Object.entries(geo.gu)) {
    const b=district.b;
    if(!Array.isArray(b) || b.length!==4 || !b.every(Number.isFinite) || x<b[0] || y<b[1] || x>b[0]+b[2] || y>b[1]+b[3] || !district.s) continue;
    if(!cache.has(code)) cache.set(code,pathRings(district.d));
    if(cache.get(code).reduce((n,ring)=>n+Number(inside([x,y],ring)),0)%2===1) areas.add(district.s);
  }
  return areas.size===1 ? [...areas][0] : null;
}
/** Reconstruct holes and multipolygons by containment before inverse projection. */
export function svgPathToGeometry(path) {
  const rings=pathRings(path).map(ring => ({ring,area:ringArea(ring),parent:null,depth:0})).filter(r => r.area > 0).sort((a,b) => b.area-a.area);
  for (let i=0;i<rings.length;i++) {
    let parent=null;
    for (let j=0;j<i;j++) if (inside(rings[i].ring[0],rings[j].ring) && (!parent || rings[j].area < parent.area)) parent=rings[j];
    rings[i].parent=parent; rings[i].depth=parent ? parent.depth+1 : 0;
  }
  const polys=new Map();
  for (const r of rings) if (r.depth%2===0) polys.set(r,[r.ring.map(([x,y]) => toLL(x,y))]);
  for (const r of rings) if (r.depth%2===1 && polys.has(r.parent)) polys.get(r.parent).push(r.ring.map(([x,y]) => toLL(x,y)));
  const coordinates=[...polys.values()]; return coordinates.length ? {type:'MultiPolygon',coordinates} : null;
}
/** Generate current province's region colors and only verifiable GTX segments. */
export function buildSceneFeatures({data,area,boundaryMode='legal',metric='score',mapGtx=true}) {
  const geo=data?.geo;
  if (!geo) return {regionFeatures:empty(),gtxFeatures:empty()};
  const legal=boundaryMode==='legal';
  const scale=createMetricScale({metric,regions:legal ? data.legalRegions : data.regions,area,kind:legal?'legal':'dong'});
  const input=legal ? (data.legalRegions || []).filter(r=>r.area===area && r.path).map(r=>[r.code,r.path,r])
    : Object.entries(geo.dong || {}).filter(([,d])=>geo.gu[d.g]?.s===area).map(([code,d])=>[code,d.d,data.regions?.[code]]);
  const regionFeatures=collection(input.flatMap(([code,path,region])=>{
    const geometry=svgPathToGeometry(path); return geometry ? [{type:'Feature',properties:{code, name:region?.name || '', fill:scale.color(region)},geometry}] : [];
  }));
  const features=[];
  if (mapGtx) for (const route of data.routes || []) {
    const stations=new Map((route.stations || []).map(s=>[s.id,s]));
    for (const seg of route.segments || []) {
      const a=stations.get(seg.from)?.coordinate,b=stations.get(seg.to)?.coordinate;
      if (validCoordinate(a) && validCoordinate(b)) features.push({type:'Feature',properties:{kind:'line',color:route.color,status:seg.status},geometry:{type:'LineString',coordinates:[a,b]}});
    }
    for (const station of stations.values()) if (validCoordinate(station.coordinate)) features.push({type:'Feature',properties:{kind:'station',color:route.color,name:station.name,route:route.name,status:station.status || '미상',notice:station.coordinateNotice || '역 사이 직선 개략도'},geometry:{type:'Point',coordinates:station.coordinate}});
  }
  return {regionFeatures,gtxFeatures:collection(features)};
}
function sampleFeatures(apartments,area) {
  const buildings=[],points=[];
  for (const apt of apartments || []) {
    if (apt.sample !== true || apt.area !== area || !validCoordinate(apt.coordinate)) continue;
    const [lon,lat]=apt.coordinate;
    points.push({type:'Feature',properties:{id:apt.id,name:apt.name},geometry:{type:'Point',coordinates:[lon,lat]}});
    const lonScale=111320*Math.cos(lat*Math.PI/180), latScale=111320;
    for (const building of apt.buildings || []) {
      const [x,y]=building.offsetMeters || [],w=Number(building.widthMeters),d=Number(building.depthMeters),h=Number(building.heightMeters);
      if (![x,y,w,d,h].every(Number.isFinite) || w<=0 || d<=0 || h<=0 || h>500 || building.heightKind!=='floor-estimate') continue;
      const l=lon+(x-w/2)/lonScale,r=lon+(x+w/2)/lonScale,b=lat+(y-d/2)/latScale,t=lat+(y+d/2)/latScale;
      buildings.push({type:'Feature',properties:{id:apt.id,name:building.name,height:h},geometry:{type:'Polygon',coordinates:[[[l,b],[r,b],[r,t],[l,t],[l,b]]]}});
    }
  }
  return {buildings:collection(buildings),points:collection(points)};
}

let protocolCount=0;
function addSyntheticDem(hills) {
  const scheme=`buja-sample-dem-${++protocolCount}`;
  maplibregl.addProtocol(scheme, async (request,abortController)=>{
    const match=request.url.match(/\/(\d+)\/(\d+)\/(\d+)(?:\.png)?$/);
    if (!match) throw new Error('가상 지형 타일 주소가 올바르지 않습니다.');
    const [,zs,xs,ys]=match, z=Number(zs), tx=Number(xs), ty=Number(ys), n=2**z, size=256;
    const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
    const ctx=canvas.getContext('2d'); if (!ctx) throw new Error('가상 지형 생성에 실패했습니다.');
    const image=ctx.createImageData(size,size), lons=new Float64Array(size), lats=new Float64Array(size);
    for (let x=0;x<size;x++) lons[x]=((tx+(x+.5)/size)/n)*360-180;
    for (let y=0;y<size;y++) lats[y]=Math.atan(Math.sinh(Math.PI*(1-2*(ty+(y+.5)/size)/n)))*180/Math.PI;
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      let height=0;
      for (const hill of hills) {
        const dx=(lons[x]-hill.center[0])*111320*Math.cos(hill.center[1]*Math.PI/180), dy=(lats[y]-hill.center[1])*111320;
        const r=hill.radiusMeters/2; height+=hill.heightMeters*Math.exp(-(dx*dx+dy*dy)/(2*r*r));
      }
      const value=32768+height, i=(y*size+x)*4;
      image.data[i]=Math.floor(value/256); image.data[i+1]=Math.floor(value)%256; image.data[i+2]=Math.floor((value-Math.floor(value))*256); image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('가상 지형 인코딩 실패')),'image/png'));
    if (abortController?.signal?.aborted) throw new DOMException('Aborted','AbortError');
    return {data:await blob.arrayBuffer()};
  });
  return scheme;
}

/**
 * 3D terrain, score/GTX overlays, and separately sourced actual or sample buildings.
 * The caller owns the container, captions and fallback to SVG. Data remains JSON-backed.
 */
export async function createSample3D({container,area,center,zoom,bearing=0,pitch=60,geo,apartments=[],actualApartments=[],terrainHills=[],terrainMode='real',baseMapProvider='osm',vworldEnabled=false,regionFeatures=empty(),gtxFeatures=empty(),onViewChange,onApartmentSelect,onApartmentGroupSelect,onRegionSelect,onError,isPicking,onMapPoint,onBuildingsStatus,onBaseMapStatus,onTerrainStatus}) {
  const { default: workerUrl } = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url');
  maplibregl.setWorkerUrl(workerUrl);
  if (!container || !validCoordinate(center) || !Number.isFinite(zoom)) throw new Error('3D 지도 초기 위치가 없습니다.');
  const hills=terrainHills.filter(h=>h.sample===true && h.area===area && validCoordinate(h.center) && h.radiusMeters>0 && h.heightMeters>0);
  if (terrainMode === 'sample' && !hills.length) throw new Error('이 지역에는 가상 3D 지형 샘플이 없습니다. 2D 지도를 이용하세요.');
  let terrainAvailable = terrainMode !== 'real' || (await sampleElevations([center]))[0] != null;
  onTerrainStatus?.(terrainAvailable ? '' : '고도 타일을 불러오지 못해 평면 지형으로 3D 건물을 표시합니다.');
  const probe=document.createElement('canvas');
  if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('이 브라우저는 3D 지도를 지원하지 않습니다. 2D 지도를 이용하세요.');
  const scheme=terrainMode==='sample' ? addSyntheticDem(hills) : null, sample=sampleFeatures(terrainMode==='sample' ? apartments : [],area);
  let realApartments=actualApartments, showReal=true, showSample=true, showBuildings=true, buildingRevision=0, vworldAbort=null;
  let useVWorldBuildings = terrainMode==='real' && vworldEnabled;
  let baseProvider = baseMapProvider === 'vworld' && terrainMode === 'real' ? 'vworld' : 'osm';
  const realMarkers=[], buildingNameMarkers=[];
  let actualFeatures=[], apartmentLabelPlan=[], clearBuildingInteraction=()=>{}, rebuildBuildingMarkers=()=>{}, escapeBuildingHandler;
  let map, canvas, contextLostHandler, cleaned=false, currentArea=area, initialVworldFailed=false;
  const sampleMarkers=[];
  const destroy=()=>{ if(cleaned)return; cleaned=true; vworldAbort?.abort(); clearBuildingInteraction(); if (escapeBuildingHandler) document.removeEventListener('keydown',escapeBuildingHandler); if (canvas && contextLostHandler) canvas.removeEventListener('webglcontextlost',contextLostHandler); for (const item of sampleMarkers) item.marker.remove(); for (const marker of [...realMarkers,...buildingNameMarkers]) marker.remove(); map?.remove(); if (scheme) maplibregl.removeProtocol(scheme); };
  try {
    map=new maplibregl.Map({container,center,zoom,pitch,bearing,minZoom:1,maxZoom:20,attributionControl:false,dragRotate:true,locale:{'NavigationControl.ZoomIn':'지도 확대','NavigationControl.ZoomOut':'지도 축소','NavigationControl.ResetBearing':'드래그해 지도 회전, 클릭해 북쪽으로 되돌리기','Popup.Close':'닫기'},style:{version:8,sources:{
      'sample-terrain':{type:'raster-dem',encoding:'terrarium',tiles:[scheme ? `${scheme}://tile/{z}/{x}/{y}.png` : TERRARIUM_URL],tileSize:256,maxzoom:15},
      'osm-base':{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap 기여자</a>'},
      'vworld-base':{type:'raster',tiles:[`${import.meta.env?.BASE_URL || '/'}api/vworld/tiles/{z}/{x}/{y}.png`],tileSize:256,maxzoom:19,attribution:'© 국토교통부 브이월드'},
      regions:{type:'geojson',data:regionFeatures}, gtx:{type:'geojson',data:gtxFeatures}, buildings:{type:'geojson',data:sample.buildings}, 'actual-buildings':{type:'geojson',data:empty()}, apartments:{type:'geojson',data:sample.points}, route:{type:'geojson',data:empty()}
    },layers:[
      {id:'background',type:'background',paint:{'background-color':'#e6edf0'}},
      {id:'osm-base',type:'raster',source:'osm-base',layout:{visibility:terrainMode==='real' && baseProvider==='osm'?'visible':'none'}},
      {id:'vworld-base',type:'raster',source:'vworld-base',minzoom:6,layout:{visibility:baseProvider==='vworld'?'visible':'none'}},
      {id:'terrain-shade',type:'hillshade',source:'sample-terrain',layout:{visibility:terrainAvailable?'visible':'none'},paint:{'hillshade-exaggeration':.4}},
      {id:'regions',type:'fill',source:'regions',paint:{'fill-color':['coalesce',['get','fill'],'#dce4ed'],'fill-opacity':['interpolate',['linear'],['zoom'],10,.45,13,.32,15,.16,17,.11]}},
      {id:'region-lines',type:'line',source:'regions',paint:{'line-color':'#ffffff','line-width':1,'line-opacity':['interpolate',['linear'],['zoom'],10,.75,14,.4,17,.2]}},
      {id:'gtx-lines',type:'line',source:'gtx',filter:['all',['==',['get','kind'],'line'],['==',['get','status'],'운행']],paint:{'line-color':['coalesce',['get','color'],'#8a4fb0'],'line-width':3}},
      {id:'gtx-planned',type:'line',source:'gtx',filter:['all',['==',['get','kind'],'line'],['!=',['get','status'],'운행']],paint:{'line-color':['coalesce',['get','color'],'#8a4fb0'],'line-width':3,'line-dasharray':[2,2]}},
      {id:'gtx-stations',type:'circle',source:'gtx',filter:['==',['get','kind'],'station'],paint:{'circle-color':'#fff','circle-radius':4,'circle-stroke-width':2,'circle-stroke-color':['coalesce',['get','color'],'#8a4fb0']}},
      {id:'walk-route',type:'line',source:'route',paint:{'line-color':'#176ccb','line-width':5,'line-opacity':.9}},
      {id:'sample-buildings',type:'fill-extrusion',source:'buildings',minzoom:12,paint:{'fill-extrusion-color':'#6583ab','fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':.95}},
      {id:'actual-footprints',type:'fill',source:'actual-buildings',minzoom:14,filter:['==',['get','heightSource'],'unknown'],paint:{'fill-color':['case',['boolean',['feature-state','selected'],false],'#4486c8',['boolean',['feature-state','hover'],false],'#76a7d5','#a3b2bd'],'fill-opacity':.65,'fill-outline-color':'#7794ad'}},
      {id:'actual-buildings',type:'fill-extrusion',source:'actual-buildings',minzoom:14,filter:['>', ['coalesce',['get','height'],0],0],paint:{'fill-extrusion-color':['case',['boolean',['feature-state','selected'],false],'#4486c8',['boolean',['feature-state','hover'],false],'#81add5',['==',['get','heightSource'],'levels'],'#c4d0da','#e1d4c1'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['coalesce',['get','minHeight'],0],'fill-extrusion-opacity':.96}}
    ],...(terrainAvailable?{terrain:{source:'sample-terrain',exaggeration:1}}:{})}});
    map.addControl(new maplibregl.NavigationControl({showCompass:true,visualizePitch:true}), 'top-right');
    if (terrainMode==='real') map.addControl(new maplibregl.AttributionControl({compact:true}), 'bottom-right');
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{map.off('error',initError);reject(new Error('3D 지도를 불러오지 못했습니다.'));},12000);
      const initError=e=>{if (e.sourceId==='sample-terrain') {terrainAvailable=false; onTerrainStatus?.('고도 타일을 불러오지 못해 평면 지형으로 3D 건물을 표시합니다.'); return;} if (e.sourceId==='vworld-base' || String(e.error?.url || e.error?.message || '').includes('/api/vworld/tiles/')) {initialVworldFailed=true;return;} if (e.sourceId==='osm-base') return; if (!map.isStyleLoaded()) {clearTimeout(timeout);map.off('error',initError);reject(e.error || new Error('3D 지도 초기화 오류'));}};
      map.once('load',()=>{clearTimeout(timeout);map.off('error',initError);resolve();});
      map.on('error',initError);
    });
    if (!terrainAvailable) { map.setTerrain(null); map.setLayoutProperty('terrain-shade','visibility','none'); }
    if (initialVworldFailed && baseProvider === 'vworld') {
      baseProvider = 'osm';
      map.setLayoutProperty('vworld-base','visibility','none');
      map.setLayoutProperty('osm-base','visibility',terrainMode==='real'?'visible':'none');
      onBaseMapStatus?.({provider:'osm', message:'브이월드 배경을 불러오지 못해 OpenStreetMap으로 대체했습니다.'});
    }
    canvas=map.getCanvas();
    contextLostHandler=event=>{ event.preventDefault(); onError?.(new Error('3D 화면을 유지할 수 없어 2D 지도로 돌아갑니다.')); };
    canvas.addEventListener('webglcontextlost',contextLostHandler);
    // DOM markers remain clickable on terrain even when fill-extrusion hit tests
    // are projected incorrectly by a WebGL driver or MapLibre's terrain renderer.
    function addSampleMarker(point, id, label, building) {
      const element=document.createElement('button');
      element.type='button'; element.className=building ? 'scene-building-target' : 'scene-apartment-marker';
      element.setAttribute('aria-label',label); element.title=label;
      Object.assign(element.style,{padding:'0',cursor:'pointer',boxSizing:'border-box',pointerEvents:'auto'});
      if (building) Object.assign(element.style,{background:'transparent',border:'0',zIndex:'2'});
      else Object.assign(element.style,{width:'28px',height:'28px',border:'0',borderRadius:'50%',background:'transparent',zIndex:'3'});
      if (!building) {
        const dot=document.createElement('span');
        Object.assign(dot.style,{display:'block',width:'13px',height:'13px',margin:'auto',background:'#d27d38',border:'2px solid white',borderRadius:'50%',boxShadow:'0 1px 4px #0006'});
        element.appendChild(dot);
      }
      element.addEventListener('pointerdown',event=>event.stopPropagation());
      element.addEventListener('click',event=>{event.stopPropagation();if (isPicking?.()) onMapPoint?.(point); else onApartmentSelect?.(id);});
      const marker=new maplibregl.Marker({element,anchor:building?'bottom':'center'}).setLngLat(point).addTo(map);
      sampleMarkers.push({marker,element,point,building});
    }
    for (const f of sample.buildings.features) {
      const ring=f.geometry.coordinates[0];
      addSampleMarker([(ring[0][0]+ring[2][0])/2,(ring[0][1]+ring[2][1])/2], f.properties.id, `${f.properties.name} · 가상 단지`, f);
    }
    for (const f of sample.points.features) addSampleMarker(f.geometry.coordinates,f.properties.id,`${f.properties.name} · 가상 단지`,null);
    function sizeBuildingTargets() {
      const zoom=map.getZoom();
      for(const item of sampleMarkers) if(item.building) {
        const ring=item.building.geometry.coordinates[0], lat=item.point[1];
        const ppm=(512*2**zoom)/(40075016.686*Math.cos(lat*Math.PI/180));
        const width=Math.abs(ring[1][0]-ring[0][0])*111320*Math.cos(lat*Math.PI/180), depth=Math.abs(ring[2][1]-ring[1][1])*111320;
        item.element.style.width=`${Math.max(24,Math.min(160,(width+depth)*ppm))}px`;
        item.element.style.height=`${Math.max(24,Math.min(160,(item.building.properties.height+depth)*ppm))}px`;
        item.element.style.visibility=zoom>=12?'visible':'hidden';
      }
    }
    map.on('zoom',sizeBuildingTargets); sizeBuildingTargets();
    function rebuildRealMarkers() {
      for (const marker of realMarkers) marker.remove(); realMarkers.length=0;
      apartmentLabelPlan=[];
      if (terrainMode!=='real' || !showReal) { rebuildBuildingMarkers(); return; }
      const box=container.getBoundingClientRect();
      const labels=planApartmentLabels(realApartments,{area:currentArea,bounds:map.getBounds(),width:box.width,height:box.height,project:coord=>map.project(coord),zoom:map.getZoom()});
      apartmentLabelPlan=labels;
      for (const {group,point,title} of labels) {
        const el=document.createElement('button'); el.type='button'; el.className='scene-real-apartment-label';
        el.setAttribute('aria-label',group.length===1 ? `${group[0].name} · 공개 공동주택 대표 좌표` : `${group[0].name} 외 · 같은 대표 좌표 ${group.length}건`);
        el.title=group.length===1 ? group[0].name : '같은 좌표의 공동주택 목록 보기';
        Object.assign(el.style,{padding:'2px 3px',border:'0',borderRadius:'3px',background:'rgba(255,255,255,.76)',color:'#24364b',fontWeight:'600',fontSize:'10px',lineHeight:'1.1',maxWidth:'142px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer',textShadow:'0 0 2px white'});
        el.textContent=title;
        el.addEventListener('pointerdown',e=>e.stopPropagation());
        el.addEventListener('click',e=>{e.stopPropagation(); clearBuildingInteraction(); if(isPicking?.()){if(group.length===1)onMapPoint?.(group[0].coordinate);else onApartmentGroupSelect?.(group);return;} if(group.length===1) onApartmentSelect?.(group[0].id); else onApartmentGroupSelect?.(group);});
        realMarkers.push(new maplibregl.Marker({element:el}).setLngLat(point).addTo(map));
      }
      rebuildBuildingMarkers();
    }
    rebuildRealMarkers();
    // Actual footprints and heights are separate from apartment representative points.
    // No missing building is invented; every async viewport result is revision-guarded.
    async function refreshActualBuildings() {
      const revision=++buildingRevision;
      clearBuildingInteraction();
      vworldAbort?.abort(); vworldAbort = null;
      const report=(status,message,count=0,extra={})=>onBuildingsStatus?.({status,message,count,...extra});
      const replace=features=>{ clearBuildingInteraction(); actualFeatures=withBuildingIds(features); map.getSource('actual-buildings')?.setData(collection(actualFeatures)); rebuildBuildingMarkers(); };
      const clear=()=>replace([]);
      if (terrainMode!=='real' || !showBuildings) { clear(); report('off',''); return; }
      if (map.getZoom()<14) { clear(); report('zoom','실제 건물은 지도를 더 확대하면 표시됩니다.'); return; }
      report('loading','실제 건물 자료를 불러오는 중입니다.');
      let osmReady=false;
      try {
        let manifest=null, manifestFailed=false;
        try { manifest=await loadBuildingManifest(); } catch { manifestFailed=true; }
        if (cleaned || revision!==buildingRevision) return;
        const b=map.getBounds();
        const tiles=manifest ? visibleBuildingTiles(manifest,[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]) : [];
        if (!tiles.length && !useVWorldBuildings) {clear();report(manifestFailed ? 'error' : 'empty',manifestFailed ? 'OSM 건물 자료를 불러오지 못했습니다.' : '이 범위에는 준비된 실제 건물 자료가 없습니다.');return;}
        const osmSkipped=tiles.length>64;
        if (osmSkipped && !useVWorldBuildings) {clear();report('zoom','실제 건물을 보려면 지도를 더 확대해 주세요.');return;}
        const loaded=await Promise.allSettled((osmSkipped ? [] : tiles).map(loadBuildingTile));
        if (cleaned || revision!==buildingRevision) return;
        const features=loaded.flatMap(result=>result.status==='fulfilled' ? result.value : []);
        replace(features); osmReady=true;
        const failed=manifestFailed || loaded.some(result=>result.status==='rejected');
        if (failed && !useVWorldBuildings) { report('error',features.length ? '일부 OSM 건물 자료를 불러오지 못했습니다.' : '건물 자료를 불러오지 못했습니다.',features.length); return; }
        if (!useVWorldBuildings) {
          if (!features.length) report('empty','이 범위에는 높이가 있는 공개 건물 자료가 없습니다.');
          else report('ready',`OSM 건물 ${features.length.toLocaleString()}건 · 확대 화면과 주변 타일`,features.length);
          return;
        }
        report('loading','화면 범위의 브이월드 건물을 조회 중입니다.',features.length);
        // Query the whole visible map when it fits the bounded tile budget. For
        // large or highly tilted views, shrink around the visible center and say
        // so rather than issuing an unbounded number of provider requests.
        let bounds=[Math.max(124,b.getWest()),Math.max(32,b.getSouth()),Math.min(132,b.getEast()),Math.min(39,b.getNorth())];
        let partialView=false;
        if (bounds[0]<bounds[2] && bounds[1]<bounds[3]) {
          const center=map.getCenter();
          const cx=Math.max(bounds[0],Math.min(bounds[2],center.lng)), cy=Math.max(bounds[1],Math.min(bounds[3],center.lat));
          for (let i=0;i<30 && !planVWorldBuildingTiles(bounds).length;i++) {
            const w=(bounds[2]-bounds[0])*.4, h=(bounds[3]-bounds[1])*.4;
            bounds=[Math.max(124,cx-w),Math.max(32,cy-h),Math.min(132,cx+w),Math.min(39,cy+h)]; partialView=true;
          }
        }
        const controller=new AbortController(); vworldAbort=controller;
        const official=await loadVWorldBuildings(bounds,{signal:controller.signal});
        if (cleaned || revision!==buildingRevision || controller.signal.aborted || official.metadata?.aborted) return;
        if (!official.features.length) {
          const unavailable=official.metadata?.outOfRange || official.metadata?.truncated || official.metadata?.failedTiles;
          report(unavailable ? 'error' : features.length ? 'ready' : 'empty',unavailable ? '브이월드 조회가 불완전해 OSM 자료를 유지합니다.' : features.length ? '이 화면에 브이월드 건물 자료가 없어 OSM을 표시합니다.' : '이 범위에는 확인된 건물 자료가 없습니다.',features.length); return;
        }
        const raised=official.features.filter(f=>Number.isFinite(f.properties?.height) && f.properties.height>0);
        const flat=official.features.length-raised.length;
        const merged=mergeBuildingSources(features,official.features);
        replace(merged.features);
        const incomplete=official.metadata?.truncated || official.metadata?.failedTiles || official.metadata?.outOfRange;
        report(failed || incomplete ? 'error' : 'ready',`브이월드 표시 ${merged.vworldCount.toLocaleString()}건 · 높이 미상 평면 ${flat.toLocaleString()}건 · OSM 표시 ${merged.osmCount.toLocaleString()}건${merged.matchedCount ? ` · 중복 후보 ${merged.matchedCount.toLocaleString()}건 비교` : ''}${partialView ? ' · 넓은 화면의 중심 부근만 조회' : ''}${incomplete ? ' · 일부 조회 실패 또는 결과 제한' : ''}${osmSkipped ? ' · OSM은 확대 시 표시' : failed ? ' · 일부 OSM 자료 로딩 실패' : ''}`,merged.features.length,{vworldCount:official.features.length,osmCount:merged.osmCount,missingHeight:flat});
      } catch(error) {
        if (cleaned || revision!==buildingRevision) return;
        if (!osmReady) clear(); report('error', osmReady ? '브이월드 건물 조회에 실패해 OSM 건물을 유지합니다.' : '건물 자료를 불러오지 못했습니다.');
      }
    }
    refreshActualBuildings();
    map.on('click', e=>{ if(isPicking?.()) onMapPoint?.([e.lngLat.lng,e.lngLat.lat]); });
    const getView=()=>{const c=map.getCenter(),center=[c.lng,c.lat];return {center,zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),area:currentArea,viewportArea:provinceAtCoordinate(geo,center)};};
    map.on('moveend',()=>{ rebuildRealMarkers(); refreshActualBuildings(); onViewChange?.(getView()); });
    map.on('click','gtx-stations',e=>{ if(isPicking?.()) return; const f=e.features?.[0]; if (!f) return; new maplibregl.Popup().setLngLat(f.geometry.coordinates).setText(`${f.properties.route} ${f.properties.name} · ${f.properties.status} · ${f.properties.notice}`).addTo(map); });
    map.on('click','sample-buildings',e=>{if(!isPicking?.())onApartmentSelect?.(e.features?.[0]?.properties?.id);});
    let hoveredBuildingId=null, selectedBuildingId=null, pinnedBuilding=null;
    const hoverBuilding = new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10,maxWidth:'250px',className:'scene-building-hover'});
    function state(id, value) {
      if (id != null && !cleaned && map.getSource('actual-buildings')) map.setFeatureState({source:'actual-buildings',id},value);
    }
    function clearHover() { state(hoveredBuildingId,{hover:false}); hoveredBuildingId=null; hoverBuilding.remove(); }
    function clearPinned() {
      const popup=pinnedBuilding; pinnedBuilding=null;
      state(selectedBuildingId,{selected:false}); selectedBuildingId=null;
      popup?.remove();
    }
    clearBuildingInteraction=()=>{clearHover(); clearPinned();};
    function pinBuilding(feature, point) {
      if (!feature || isPicking?.()) return;
      clearBuildingInteraction();
      selectedBuildingId=feature.id; state(selectedBuildingId,{selected:true});
      const popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,offset:12,maxWidth:'290px',className:'scene-building-pinned'});
      pinnedBuilding=popup;
      popup.setLngLat(point).setDOMContent(createBuildingCard(feature.properties,{expanded:true})).addTo(map);
      popup.on('close',()=>{ if(pinnedBuilding===popup) { pinnedBuilding=null; state(selectedBuildingId,{selected:false}); selectedBuildingId=null; } });
    }
    rebuildBuildingMarkers=()=>{
      for (const marker of buildingNameMarkers) marker.remove(); buildingNameMarkers.length=0;
      if (terrainMode!=='real' || !showBuildings) return;
      const box=container.getBoundingClientRect();
      const labels=planBuildingLabels(actualFeatures,{zoom:map.getZoom(),bounds:map.getBounds(),width:box.width,height:box.height,project:point=>map.project(point),obstacles:apartmentLabelPlan});
      for (const {feature,point,title} of labels) {
        const el=document.createElement('button'); el.type='button'; el.className='scene-general-building-label';
        el.textContent=title; el.setAttribute('aria-label',`${title} 건물 정보`);
        el.addEventListener('pointerdown',e=>e.stopPropagation());
        el.addEventListener('click',e=>{e.stopPropagation(); if(isPicking?.()) onMapPoint?.(point); else pinBuilding(feature,point);});
        el.addEventListener('focus',()=>state(feature.id,{hover:true}));
        el.addEventListener('blur',()=>state(feature.id,{hover:false}));
        buildingNameMarkers.push(new maplibregl.Marker({element:el}).setLngLat(point).addTo(map));
      }
    };
    // Only fine pointers get transient hover cards. Touch uses the same pinned
    // card, and MapLibre distinguishes a tap from a camera drag.
    const finePointer=()=>typeof matchMedia==='function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    for (const layer of ['actual-buildings','actual-footprints']) map.on('mousemove',layer,e=>{
      const feature=e.features?.[0];
      if (!finePointer() || isPicking?.() || !feature || pinnedBuilding) {clearHover(); return;}
      if (hoveredBuildingId!==feature.id) {clearHover(); hoveredBuildingId=feature.id; state(hoveredBuildingId,{hover:true}); hoverBuilding.setDOMContent(createBuildingCard(feature.properties));}
      hoverBuilding.setLngLat(e.lngLat).addTo(map);
    });
    for (const layer of ['actual-buildings','actual-footprints']) map.on('mouseleave',layer,clearHover);
    for (const layer of ['actual-buildings','actual-footprints']) map.on('click',layer,e=>pinBuilding(e.features?.[0],e.lngLat));
    map.on('click',e=>{
      if (isPicking?.() || !map.queryRenderedFeatures(e.point,{layers:['actual-buildings','actual-footprints']}).length) clearBuildingInteraction();
    });
    map.on('movestart',clearHover);
    escapeBuildingHandler=e=>{if(e.key==='Escape' && (pinnedBuilding || hoveredBuildingId!=null)) { clearBuildingInteraction(); e.preventDefault(); e.stopPropagation(); }};
    document.addEventListener('keydown',escapeBuildingHandler);
    rebuildBuildingMarkers();
    map.on('click','regions',e=>{if (isPicking?.()) return; if (!map.queryRenderedFeatures(e.point,{layers:['sample-buildings','actual-buildings','actual-footprints','gtx-stations']}).length) onRegionSelect?.(e.features?.[0]?.properties?.code);});
    for (const layer of ['sample-buildings','actual-buildings','actual-footprints','gtx-stations','regions']) {
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
    }
    map.on('error',e=>{
      if (e.sourceId==='osm-base') return;
      if (e.sourceId==='sample-terrain') { if (terrainAvailable) { terrainAvailable=false; map.setTerrain(null); map.setLayoutProperty('terrain-shade','visibility','none'); onTerrainStatus?.('고도 타일을 불러오지 못해 평면 지형으로 3D 건물을 표시합니다.'); } return; }
      if (e.sourceId==='vworld-base' || String(e.error?.url || e.error?.message || '').includes('/api/vworld/tiles/')) {
        if (baseProvider === 'vworld') {
          baseProvider = 'osm';
          map.setLayoutProperty('vworld-base','visibility','none');
          map.setLayoutProperty('osm-base','visibility',terrainMode==='real'?'visible':'none');
          onBaseMapStatus?.({provider:'osm', message:'브이월드 배경을 불러오지 못해 OpenStreetMap으로 대체했습니다.'});
        }
        return;
      }
      if (e.error?.name !== 'AbortError') onError?.(e.error || new Error('3D 지도 표시 오류'));
    });
    return {
      destroy,
      getView,
      resize() { map.resize(); },
      zoomBy(delta) { map.zoomTo(Math.max(1,Math.min(20,map.getZoom()+delta)),{duration:180}); },
      resetOrientation() { map.easeTo({bearing:0,pitch:60,duration:220}); },
      resetNorth() { map.easeTo({bearing:0,duration:220}); },
      setView({area:nextArea=currentArea,center:nextCenter,zoom:nextZoom,bearing:nextBearing,pitch:nextPitch,regionFeatures:nextRegions,gtxFeatures:nextGtx}={}) {
        if (nextArea!==currentArea) throw new Error('시도가 바뀌면 3D 샘플을 다시 열어야 합니다.');
        if(nextRegions) { clearBuildingInteraction(); map.getSource('regions').setData(nextRegions); }
        if(nextGtx) map.getSource('gtx').setData(nextGtx);
        if(validCoordinate(nextCenter) && Number.isFinite(nextZoom)) map.jumpTo({center:nextCenter,zoom:nextZoom,...(Number.isFinite(nextBearing)?{bearing:nextBearing}:{}),...(Number.isFinite(nextPitch)?{pitch:nextPitch}:{})});
      },
      setRoute(coordinates) {
        const points=Array.isArray(coordinates) ? coordinates.filter(validCoordinate) : [];
        map.getSource('route').setData(points.length>=2 ? collection([{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}}]) : empty());
      },
      setApartments(items) { realApartments=Array.isArray(items)?items:[]; rebuildRealMarkers(); },
      setVWorldEnabled(enabled) { const next=terrainMode==='real' && enabled===true; if (useVWorldBuildings!==next) { useVWorldBuildings=next; refreshActualBuildings(); } },
      setBaseMapProvider(provider) {
        baseProvider = provider === 'vworld' && terrainMode === 'real' ? 'vworld' : 'osm';
        map.setLayoutProperty('vworld-base','visibility',baseProvider==='vworld'?'visible':'none');
        map.setLayoutProperty('osm-base','visibility',terrainMode==='real' && baseProvider==='osm'?'visible':'none');
      },
      setLayers({apartments:showApartments=true,sampleApartments:showSampleApartments=false,terrain:showTerrain=true,gtx:showGtx=true,buildings:nextShowBuildings=true}={}) {
        showReal=showApartments;showSample=showSampleApartments;
        const sampleVisible=terrainMode==='sample' && showSample;
        map.setLayoutProperty('sample-buildings','visibility',sampleVisible?'visible':'none');
        if (showBuildings!==nextShowBuildings) { if (!nextShowBuildings) clearBuildingInteraction(); showBuildings=nextShowBuildings; for (const id of ['actual-buildings','actual-footprints']) map.setLayoutProperty(id,'visibility',showBuildings && terrainMode==='real'?'visible':'none'); refreshActualBuildings(); } 
        for(const item of sampleMarkers) item.element.style.display=sampleVisible?'':'none';
        rebuildRealMarkers();
        for(const id of ['gtx-lines','gtx-planned','gtx-stations']) map.setLayoutProperty(id,'visibility',showGtx?'visible':'none');
        map.setLayoutProperty('terrain-shade','visibility',showTerrain && terrainAvailable?'visible':'none');
        map.setTerrain(showTerrain && terrainAvailable?{source:'sample-terrain',exaggeration:1}:null);
      }
    };
  } catch(error) {destroy(); throw error;}
}
