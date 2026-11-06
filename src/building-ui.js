// Building names and provider metadata remain separate. Never infer an apartment
// identity from a nearby point or render provider strings as HTML.
export function buildingDisplayInfo(properties = {}) {
  const name = typeof properties.name === 'string' ? properties.name.trim() : '';
  const descriptiveName = name && !/^[\d\s_.\-]+$/u.test(name);
  const height = Number(properties.height), levels = Number(properties.levels);
  const knownHeight = properties.heightSource !== 'unknown' && Number.isFinite(height) && height > 0;
  const estimated = properties.heightSource === 'levels';
  const heightText = knownHeight
    ? `${height.toFixed(1)}m · ${estimated ? '층수 × 3m 추정' : 'OSM 기재 높이'}`
    : '높이 정보 없음 · 평면 외곽';
  const levelText = Number.isInteger(levels) && levels > 0 ? `지상 ${levels}층` : '';
  const source = properties.source === 'vworld' ? '국토교통부 브이월드 도로명주소건물' : '© OpenStreetMap 기여자 · ODbL';
  const alternativeHeight = Number(properties.alternativeHeight);
  const alternative = properties.alternativeMatch
    ? `유사 외곽 후보: ${properties.alternativeSource === 'vworld' ? '브이월드' : 'OSM'} · ${properties.alternativeHeight != null && Number.isFinite(alternativeHeight) && alternativeHeight > 0 ? `${alternativeHeight.toFixed(1)}m` : '높이 미상'} · ${properties.alternativeHeightSource === 'levels' ? '층수 × 3m 추정' : properties.alternativeHeightSource === 'height' ? '기재 높이' : '높이 미상'}. 동일 건물 여부는 확인되지 않았습니다.`
    : '';
  return {title:descriptiveName ? name : '이름 미등록 건물', rawName:name && !descriptiveName ? name : '', meta:[levelText,heightText].filter(Boolean).join(' · '), source, alternative};
}

export function createBuildingCard(properties, {document:doc = globalThis.document, expanded = false} = {}) {
  const info = buildingDisplayInfo(properties);
  const card = doc.createElement('article'); card.className = 'building-info-card';
  const title = doc.createElement('strong'); title.className = 'building-info-title'; title.textContent = info.title; card.appendChild(title);
  const meta = doc.createElement('p'); meta.className = 'building-info-meta'; meta.textContent = info.meta; card.appendChild(meta);
  if (expanded) {
    card.classList.add('is-pinned');
    const details = doc.createElement('details'); details.className = 'building-info-details';
    const summary = doc.createElement('summary'); summary.textContent = '자료 정보'; details.appendChild(summary);
    const source = doc.createElement('p'); source.textContent = info.source; details.appendChild(source);
    if (info.rawName) { const rawName = doc.createElement('p'); rawName.textContent = `원천 이름 표기: ${info.rawName}`; details.appendChild(rawName); }
    if (info.alternative) { const alternative = doc.createElement('p'); alternative.textContent = info.alternative; details.appendChild(alternative); }
    card.appendChild(details);
  } else {
    const hint = doc.createElement('small'); hint.className = 'building-info-hint'; hint.textContent = '클릭하면 자료 정보를 볼 수 있어요'; card.appendChild(hint);
  }
  return card;
}

export function withBuildingIds(features) {
  return (features || []).filter(f => f?.properties?.id != null).map(f => ({...f, id:`${f.properties.source === 'vworld' ? 'vworld' : 'osm'}:${f.properties.id}`}));
}

function ringContains([x,y], ring) {
  let result = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if ((a[1]>y)!==(b[1]>y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) result=!result;
  }
  return result;
}
function footprintAnchor(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  let chosen = null;
  for (const polygon of polygons || []) {
    const ring = polygon?.[0]; if (!Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || !p.slice(0,2).every(Number.isFinite))) continue;
    // Translate before the centroid sum: tiny geographic footprints otherwise
    // lose precision when subtracting products around longitude 127/latitude 37.
    const [originX,originY]=ring[0];
    let twiceArea=0, x=0, y=0;
    for (let i=0;i<ring.length-1;i++) { const a=[ring[i][0]-originX,ring[i][1]-originY],b=[ring[i+1][0]-originX,ring[i+1][1]-originY],c=a[0]*b[1]-b[0]*a[1]; twiceArea+=c; x+=(a[0]+b[0])*c; y+=(a[1]+b[1])*c; }
    if (Math.abs(twiceArea)<1e-14) continue;
    const candidate=[originX+x/(3*twiceArea),originY+y/(3*twiceArea)];
    const point = ringContains(candidate,ring) && !polygon.slice(1).some(hole => ringContains(candidate,hole)) ? candidate : [...ring[0]];
    if (!chosen || Math.abs(twiceArea)>chosen.area) chosen={point,area:Math.abs(twiceArea)};
  }
  return chosen;
}
const overlaps = ([x1,y1,x2,y2],[a,b,c,d]) => x1<c && x2>a && y1<d && y2>b;

/** General building names are secondary to verified apartment point labels. */
export function planBuildingLabels(features, {zoom, bounds, width, height, project, obstacles=[]}) {
  if (zoom < 16 || !bounds || typeof project !== 'function') return [];
  const candidates=[];
  for (const feature of features || []) {
    const title=typeof feature?.properties?.name==='string' ? feature.properties.name.trim() : '';
    if (!title || /^[\d\s_.\-]+$/u.test(title)) continue;
    const anchor=footprintAnchor(feature.geometry);
    if (!anchor || !bounds.contains(anchor.point)) continue;
    const pt=project(anchor.point);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || pt.x<0 || pt.y<0 || pt.x>width || pt.y>height) continue;
    const w=Math.min(146,Math.max(42,[...title].length*9+10)), h=20;
    candidates.push({feature,title,point:anchor.point,box:[pt.x-w/2-4,pt.y-h/2-3,pt.x+w/2+4,pt.y+h/2+3],priority:anchor.area*Math.max(3,Number(feature.properties.height)||3)});
  }
  candidates.sort((a,b)=>b.priority-a.priority || a.title.localeCompare(b.title) || String(a.feature.id).localeCompare(String(b.feature.id)));
  const accepted=[], boxes=obstacles.map(row => row.box || row);
  const names=new Set();
  for (const candidate of candidates) {
    if (accepted.length>=40) break;
    if (names.has(candidate.title) || boxes.some(box=>overlaps(candidate.box,box))) continue;
    accepted.push(candidate); boxes.push(candidate.box); names.add(candidate.title);
  }
  return accepted;
}
