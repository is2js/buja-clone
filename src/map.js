import { createMetricScale } from './map-metrics.js';
const RATIO = 1.3;
const PK = Math.cos(36.5 * Math.PI / 180), SCALE = 1200, MX = 100.1684389, MY = -38.6136915;
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toXY = (lon, lat) => [(lon * PK - MX) * SCALE, (-lat - MY) * SCALE];
const toLL = (x, y) => [(x / SCALE + MX) / PK, -(y / SCALE + MY)];
export const viewRatio = view => Number.isFinite(view?.ratio) && view.ratio > 0 ? view.ratio : RATIO;
export const viewPixelWidth = view => Number.isFinite(view?.pixelWidth) && view.pixelWidth > 0 ? view.pixelWidth : 440;
const scaleWidth = view => view.w * 440 / viewPixelWidth(view);
const viewport = dimensions => ({
  ratio: Number.isFinite(dimensions?.width) && dimensions.width > 0 && Number.isFinite(dimensions?.height) && dimensions.height > 0 ? dimensions.height / dimensions.width : viewRatio(dimensions),
  pixelWidth: Number.isFinite(dimensions?.width) && dimensions.width > 0 ? dimensions.width : viewPixelWidth(dimensions),
});
export function fitMapBounds([x, y, w, h], padding = .08, dimensions) {
  const {ratio,pixelWidth}=viewport(dimensions), width=Math.max(w,h/ratio)*(1+padding*2);
  return {x:x+w/2-width/2,y:y+h/2-width*ratio/2,w:width,ratio,pixelWidth};
}
/** Resize without changing the geographic centre or map units per screen pixel. */
export function resizeMapView(view, dimensions) {
  if (!view || !(view.w > 0)) return view;
  const {ratio,pixelWidth}=viewport(dimensions), w=view.w*pixelWidth/viewPixelWidth(view);
  return {...view,x:view.x+view.w/2-w/2,y:view.y+view.w*viewRatio(view)/2-w*ratio/2,w,ratio,pixelWidth};
}
/** Keep the map point under a normalized screen anchor in place while zooming. */
export function zoomMapView(view,factor,anchor={x:.5,y:.5}) {
  if (!view || !(view.w > 0) || !Number.isFinite(factor) || factor <= 0) return view;
  const ratio=viewRatio(view), pixelWidth=viewPixelWidth(view), multiplier=pixelWidth/440;
  const w=Math.max(1.5*multiplier,Math.min(7500*multiplier,view.w*factor));
  return {...view,x:view.x+(view.w-w)*anchor.x,y:view.y+(view.w-w)*ratio*anchor.y,w,ratio,pixelWidth};
}
// Expose the shared projection and viewport helpers to 3D and walking overlays.
export const mapProjection = {toXY,toLL,ratio:RATIO,viewRatio,viewPixelWidth};
export function selectedMapRegion(data, dongCode, districtCode) {
  const code=dongCode || districtCode;
  return code ? data?.legalByCode?.[code] || data?.regions?.[code] || null : null;
}
export const hasMapSelectionScore = region => Number.isFinite(region?.score) && Boolean(region?.scoreInfo);
export function mapRegionActionLabel(region) {
  return region ? `${region.name} ${hasMapSelectionScore(region) ? '부분 점수·정보 보기' : '정보 보기'}` : '';
}
// The published boundaries use absolute M, relative l and z commands.
// Compute bounds when the map's SVG element is not available for getBBox().
function pathBounds(path) {
  const tokens = path?.match(/[MLZmlz]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi);
  if (!tokens) return null;
  let i = 0, command = '', x = 0, y = 0, startX = 0, startY = 0;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  while (i < tokens.length) {
    if (/^[MLZmlz]$/.test(tokens[i])) {
      command = tokens[i++];
      if (command === 'z' || command === 'Z') { x = startX; y = startY; command = ''; continue; }
    }
    if (!command || i + 1 >= tokens.length || /^[MLZmlz]$/.test(tokens[i]) || /^[MLZmlz]$/.test(tokens[i + 1])) return null;
    const a = Number(tokens[i++]), b = Number(tokens[i++]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    x = command === 'm' || command === 'l' ? x + a : a;
    y = command === 'm' || command === 'l' ? y + b : b;
    if (command === 'M' || command === 'm') { startX = x; startY = y; command = command === 'M' ? 'L' : 'l'; }
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return Number.isFinite(left) && right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}
export function tileMarkup(view, provider = 'osm') {
  if (scaleWidth(view) > 160) return '';
  // EPSG:3857 raster tiles are mapped into the boundary dataset's local projection.
  // Limit requests to tiles visible in the current view; never prefetch or bulk-download.
  const z = Math.max(7, Math.min(17, Math.ceil(Math.log2(360 * PK * SCALE * viewPixelWidth(view) / (256 * view.w)) - .25)));
  const n = 2 ** z;
  const tx = lon => Math.floor((lon + 180) / 360 * n);
  const ty = lat => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const lonAt = x => x / n * 360 - 180;
  const latAt = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const [west, north] = toLL(view.x, view.y);
  const [east, south] = toLL(view.x + view.w, view.y + view.w * viewRatio(view));
  const minX = Math.max(0, tx(west)), maxX = Math.min(n - 1, tx(east));
  const minY = Math.max(0, ty(north)), maxY = Math.min(n - 1, ty(south));
  let out = '';
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
    const [left, top] = toXY(lonAt(x), latAt(y));
    const [right, bottom] = toXY(lonAt(x + 1), latAt(y + 1));
    const osm = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const base = import.meta.env?.BASE_URL || '/';
    const primary = provider === 'vworld' ? `${base}api/vworld/tiles/${z}/${x}/${y}.png` : osm;
    const fallback = provider === 'vworld' ? ` data-vworld-fallback="${osm}"` : '';
    out += `<image href="${primary}"${fallback} x="${left}" y="${top}" width="${right-left+.1}" height="${bottom-top+.1}" preserveAspectRatio="none"/>`;
  }
  return out;
}
function routeMarkup(data, geo, view) {
  const inView = p => p[0] >= view.x && p[0] <= view.x + view.w && p[1] >= view.y && p[1] <= view.y + view.w * viewRatio(view);
  const routes = data.routes || [], lines = [], markers = [], labels = [];
  for (const route of routes) {
    const stations = new Map((route.stations || []).map(st => [st.id, st]));
    const xy = st => Array.isArray(st?.coordinate) && st.coordinate.length === 2 && st.coordinate.every(Number.isFinite) ? toXY(st.coordinate[0], st.coordinate[1]) : null;
    const color = esc(route.color || '#687b95');
    for (const seg of route.segments || []) {
      const a = xy(stations.get(seg.from)), b = xy(stations.get(seg.to));
      if (!a || !b) continue;
      lines.push(`<path class="map-route${seg.status === '운행' ? '' : ' is-planned'}" stroke="${color}" d="M${a.join(',')}L${b.join(',')}"><title>${esc(route.name)} · ${esc(seg.status)} · 역 사이 직선 개략도</title></path>`);
    }
    for (const st of stations.values()) {
      const point = xy(st); if (!point || !inView(point)) continue;
      const radius = view.w / viewPixelWidth(view) * 4.5;
      const title = `${route.name} ${st.name} · ${st.status} · 역 위치는 상세 출처 확인`;
      markers.push(`<g class="map-station-hit" data-gtx-route="${esc(route.id)}" data-gtx-station="${esc(st.id)}" tabindex="0" role="button" aria-label="${esc(title)}"><circle class="map-station" cx="${point[0]}" cy="${point[1]}" r="${radius}" stroke="${color}"/><circle cx="${point[0]}" cy="${point[1]}" r="${radius * 2.5}" fill="transparent"/><title>${esc(title)}</title></g>`);
      if (scaleWidth(view) <= 800) labels.push(`<text class="map-station-label" x="${point[0]}" y="${point[1] - radius * 1.9}" font-size="${view.w / viewPixelWidth(view) * 10}" fill="${color}">${esc(st.name)}</text>`);
    }
  }
  return lines.join('') + labels.join('') + markers.join('');
}
// At neighborhood zoom, small text labels replace the large numbered circles.
// Close locations still share a selectable group and separate as the user zooms.
export function apartmentsMarkup(apartments, area, view) {
  if (!view || !(view.w > 0) || scaleWidth(view) > 160) return {markup:'', groups:{}};
  const buckets = new Map(), groups = {};
  const cellX = view.w * 105 / viewPixelWidth(view), cellY = view.w * 32 / viewPixelWidth(view);
  for (const apt of apartments || []) {
    if (!apt || apt.area !== area || !Array.isArray(apt.coordinate) || apt.coordinate.length !== 2 || !apt.coordinate.every(Number.isFinite)) continue;
    if (!apt.sample && apt.locationVerified !== true) continue;
    const point = toXY(apt.coordinate[0], apt.coordinate[1]);
    if (point[0] < view.x || point[0] > view.x + view.w || point[1] < view.y || point[1] > view.y + view.w * viewRatio(view)) continue;
    const key = `${Math.floor((point[0] - view.x) / cellX)}:${Math.floor((point[1] - view.y) / cellY)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ apt, point });
  }
  const markers = [], occupied = [];
  let index = 0;
  for (const entries of buckets.values()) {
    const x = entries.reduce((sum, e) => sum + e.point[0], 0) / entries.length;
    const y = entries.reduce((sum, e) => sum + e.point[1], 0) / entries.length;
    const isSample = entries.some(e => e.apt.sample), first = entries[0].apt;
    const name = String(first.name || '이름 미상');
    const visible = `${[...name].slice(0,11).join('')}${[...name].length > 11 ? '…' : ''}${entries.length > 1 ? ' 외' : ''}${isSample ? ' (예시)' : ''}`;
    const font = view.w / viewPixelWidth(view) * 10, width = Math.max(font * 4, Math.min(cellX * .9, font * ([...visible].length * .95 + 1.5)));
    const rect = {left:x-width/2, right:x+width/2, top:y-font*1.05, bottom:y+font*.65};
    // Avoid labels from neighboring cells colliding. The omitted group becomes
    // individually reachable by zooming in; its source record remains intact.
    if (occupied.some(q => rect.left < q.right && rect.right > q.left && rect.top < q.bottom && rect.bottom > q.top)) continue;
    occupied.push(rect);
    const groupId = String(index++); groups[groupId] = entries.map(e => e.apt);
    const title = entries.length === 1 ? `${name}${isSample ? ' · 가상 예시' : ''}` : `${name} 외 공동주택 자료 ${entries.length-1}건${isSample ? ' · 가상 예시' : ''}`;
    markers.push(`<g class="map-apartment-hit" data-apartment-group="${groupId}" tabindex="0" role="button" aria-label="${esc(title)}"><rect class="map-apartment-hitbox" x="${rect.left}" y="${rect.top}" width="${rect.right-rect.left}" height="${rect.bottom-rect.top}"/><text class="map-apartment-label${isSample ? ' is-sample' : ''}" x="${x}" y="${y}" font-size="${font}">${esc(visible)}</text><title>${esc(title)}</title></g>`);
  }
  return { markup:markers.join(''), groups };
}
// Deliberately illustrative contour overlays, never actual measured slopes.
function sampleTerrainMarkup(data, area, view) {
  const hills = (data.sampleTerrain?.hills || []).filter(h => h.sample === true && h.area === area && Array.isArray(h.center) && h.center.length === 2 && h.center.every(Number.isFinite) && Number.isFinite(h.radiusMeters) && h.radiusMeters > 0);
  const markup = hills.map(h => {
    const [x,y] = toXY(...h.center), r = h.radiusMeters / 111000 * SCALE;
    if (x + r < view.x || x - r > view.x + view.w || y + r < view.y || y - r > view.y + view.w * viewRatio(view)) return '';
    return `<g class="map-sample-terrain" aria-hidden="true">${[1,.72,.43].map(f => `<ellipse cx="${x}" cy="${y}" rx="${r*f}" ry="${r*f*.68}"/>`).join('')}</g>`;
  }).join('');
  return {markup, count:hills.length};
}
function labelsMarkup(geo, data, area, view, legal) {
  const inView = c => c && c[0] >= view.x && c[0] <= view.x + view.w && c[1] >= view.y && c[1] <= view.y + view.w * viewRatio(view);
  const font = view.w / viewPixelWidth(view) * (440 / 34), out = [];
  if (scaleWidth(view) <= 230) {
    const entries = legal ? (data.legalRegions || []).filter(r => r.area === area && r.bbox).map(r => ({ n:r.name, c:[r.bbox[0]+r.bbox[2]/2, r.bbox[1]+r.bbox[3]/2], score:r.score })) : Object.entries(geo.dong).filter(([,d]) => geo.gu[d.g]?.s === area).map(([code,d]) => ({...d, score:data.regions?.[code]?.score}));
    const f = font * .75, used = new Set();
    for (const d of entries.filter(d => inView(d.c)).sort((a,b) => (b.score ?? 0) - (a.score ?? 0))) {
      const col = Math.floor((d.c[0]-view.x)/(f*4)), row = Math.floor((d.c[1]-view.y)/(f*1.6));
      if ([col-1,col,col+1].some(x => used.has(`${x}:${row}`))) continue;
      used.add(`${col}:${row}`);
      out.push(`<text class="map-label" x="${d.c[0]}" y="${d.c[1]}" font-size="${f}">${esc(d.n)}</text>`);
    }
  } else if (scaleWidth(view) <= 800) {
    for (const [code,g] of Object.entries(geo.gu)) if (g.s === area && inView(g.c)) {
      const name = (data.regions?.[code]?.name || g.n).replace(/^(.+?시)\s*/, '').replace(/(시|군|구)$/, '');
      out.push(`<text class="map-label" x="${g.c[0]}" y="${g.c[1]}" font-size="${font}">${esc(name || g.n)}</text>`);
    }
  } else {
    const cities = new Map();
    for (const [code,g] of Object.entries(geo.gu)) if (g.s === area && g.c) {
      const name = (data.regions?.[code]?.name || g.n).split(' ')[0].replace(/(시|군)$/, '');
      if (!cities.has(name)) cities.set(name, []); cities.get(name).push(g.c);
    }
    for (const [name,points] of cities) {
      const x = points.reduce((sum,p) => sum+p[0],0)/points.length, y = points.reduce((sum,p) => sum+p[1],0)/points.length;
      if (inView([x,y])) out.push(`<text class="map-label" x="${x}" y="${y}" font-size="${font*.9}">${esc(name)}</text>`);
    }
  }
  return out.join('');
}

// Spread into an Alpine component. data.geo is the shared boundary JSON.
export function createMapController() {
  return {
    mapMarkup: '', mapLegend: {lo:'',hi:'',swatches:[],note:''}, mapView: null, mapRenderedArea: null, mapGtx: true, mapTileVisible: false,
    mapBaseProvider: 'osm', mapBaseError: '',
    mapDrag: null, mapPointers: {}, mapDidDrag: false, selectedGtx: null,
    mapApartments: true, mapSampleApartments: false, mapApartmentGroups: {}, selectedApartment: null, selectedApartmentGroup: null,
    mapTerrain: false, mapTerrainAvailable: 0,
    fitMapBounds(box,padding=.08) { return fitMapBounds(box,padding,this.mapDimensions || this.mapView); },
    renderMap() {
      const data = this.data, geo = data?.geo;
      if (!geo || !geo.sido[this.area]) { this.mapMarkup = '<div class="map-loading">지도를 불러오는 중입니다.</div>'; return; }
      if (!this.mapView || this.mapRenderedArea !== this.area) {
        this.mapView = this.fitMapBounds(geo.sido[this.area].b, .04);
        this.mapRenderedArea = this.area;
      }
      const dimensions = viewport(this.mapDimensions || this.mapView);
      if (viewRatio(this.mapView) !== dimensions.ratio || viewPixelWidth(this.mapView) !== dimensions.pixelWidth || !this.mapView.ratio || !this.mapView.pixelWidth) this.mapView = resizeMapView(this.mapView,this.mapDimensions || this.mapView);
      const view = this.mapView, area = this.area;
      const regions = data.regions || data.byCode || {};
      this.mapTileVisible = scaleWidth(view) <= 160;
      const context = Object.entries(geo.gu).filter(([, g]) => g.s !== area).map(([, g]) => `<path class="map-context" data-sido="${esc(g.s)}" d="${g.d}"/>`).join('');
      const legal = this.boundaryMode === 'legal';
      const scale = createMetricScale({ metric:this.metric, regions:legal ? data.legalRegions : regions, area, kind:legal ? 'legal' : 'dong' });
      this.mapLegend = {lo:scale.lo, hi:scale.hi, swatches:scale.swatches, note:scale.note};
      const active = legal
        ? (data.legalRegions || []).filter(d => d.area === area && d.path).map(d => `<path class="map-dong${this.selectedGu && d.guCode === this.selectedGu ? ' in-focus' : ''}" data-code="${esc(d.code)}" fill="${scale.color(d)}" fill-rule="evenodd" d="${d.path}"><title>${esc(d.name)} (법정동)</title></path>`).join('')
        : Object.entries(geo.dong).filter(([, d]) => geo.gu[d.g]?.s === area).map(([code, d]) => `<path class="map-dong${this.selectedGu && d.g === this.selectedGu ? ' in-focus' : ''}" data-code="${esc(code)}" fill="${scale.color(regions[code])}" d="${d.d}"><title>${esc(d.n)}</title></path>`).join('');
      const gu = Object.entries(geo.gu).filter(([, g]) => g.s === area).map(([code, g]) => `<path class="map-gu${this.selectedGu === code ? ' is-focus' : ''}" d="${g.d}"/>`).join('');
      const tiles = tileMarkup(view, this.mapBaseProvider);
      const routes = this.mapGtx ? routeMarkup(data, geo, view) : '';
      const labels = labelsMarkup(geo, data, area, view, legal);
      const apartments = apartmentsMarkup([...(this.mapApartments && this.mapDataMode !== 'sample' ? (data.actualApartments || []) : []), ...(this.mapSampleApartments && this.mapDataMode === 'sample' ? (data.apartments || []) : [])], area, view);
      const terrain = this.mapTerrain && this.mapDataMode === 'sample' ? sampleTerrainMarkup(data, area, view) : {markup:'', count:0};
      this.mapTerrainAvailable = terrain.count;
      this.mapApartmentGroups = apartments.groups;
      const attribution = this.mapBaseProvider === 'vworld' ? '© 국토교통부 브이월드 · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap 기여자</a>' : '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap 기여자</a>';
      this.mapMarkup = `<svg class="region-map${tiles ? ' has-tiles' : ''}" viewBox="${view.x} ${view.y} ${view.w} ${view.w * viewRatio(view)}" role="group" aria-label="${esc(geo.sido[area].n)} ${legal ? '법정동' : '행정동'} 지도"><rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.w * viewRatio(view)}" fill="#edf1f5"/><g class="map-tiles" aria-hidden="true">${tiles}</g><g aria-hidden="true">${context}</g><g aria-hidden="true">${active}</g><g aria-hidden="true">${gu}</g><g>${terrain.markup}</g><g aria-hidden="true">${labels}</g><g>${routes}</g><g>${apartments.markup}</g></svg>${tiles ? `<div class="map-attribution">${attribution}</div>` : ''}`;
    },
    onMapImageError(event) {
      const image = event?.target;
      const fallback = image?.dataset?.vworldFallback;
      if (!fallback) return;
      delete image.dataset.vworldFallback;
      image.setAttribute('href', fallback);
      this.mapBaseError = '일부 브이월드 배경을 불러오지 못해 OpenStreetMap으로 대체했습니다.';
    },
    resetMap() { this.query = ''; this.mapView = null; this.selectedGu = ''; this.selectedCity = ''; this.selectedDong = ''; this.renderMap(); },
    zoomMap(factor) {
      if (!this.mapView) return;
      this.mapView = zoomMapView(this.mapView,factor);
      this.renderMap();
    },
    zoomIn() { this.zoomMap(.65); },
    zoomOut() { this.zoomMap(1.55); },
    focusGuGroup(codes) {
      const boxes = codes.map(code => this.data?.geo?.gu?.[code]?.b).filter(Boolean);
      if (!boxes.length) return;
      const left = Math.min(...boxes.map(b => b[0])), top = Math.min(...boxes.map(b => b[1]));
      const right = Math.max(...boxes.map(b => b[0] + b[2])), bottom = Math.max(...boxes.map(b => b[1] + b[3]));
      this.selectedGu = ''; this.selectedDong = ''; this.mapView = this.fitMapBounds([left, top, right - left, bottom - top], .16);
      this.mapRenderedArea = this.area; this.renderMap();
    },
    focusGu(code) {
      const box = this.data?.geo?.gu?.[code]?.b;
      if (!box) return;
      this.selectedGu = code; this.selectedDong = ''; this.selectedCity = this.area === '41' ? code.slice(0, 4) : ''; this.mapView = this.fitMapBounds(box, .16); this.mapRenderedArea = this.area; this.renderMap();
    },
    focusDong(code) {
      if (code?.startsWith('legal:')) {
        const region = this.data?.legalByCode?.[code];
        if (!region) return;
        this.selectedGu = region.guCode; this.selectedDong = code;
        this.selectedCity = this.area === '41' ? region.guCode.slice(0, 4) : '';
        if (!region.bbox || !region.path) {
          const parent = this.data.geo.gu[region.guCode];
          if (parent?.b) this.mapView = this.fitMapBounds(parent.b, .16);
          this.legalWarning = `${region.name} 법정동 경계는 확보되지 않아 상위 지역만 표시합니다.`;
        } else {
          this.mapView = this.fitMapBounds(region.bbox, .16);
          this.legalWarning = '';
        }
        this.mapRenderedArea = this.area; this.renderMap(); return;
      }
      const dong = this.data?.geo?.dong?.[code];
      if (!dong) return;
      // The source stores only SVG paths and centres, so measure the rendered path
      // to keep every part of even large or multi-polygon regions in view.
      const path = this.$refs?.mapSurface?.querySelector(`.map-dong[data-code="${code}"]`);
      let box = null;
      try {
        const bounds = path?.getBBox();
        if (bounds && bounds.width > 0 && bounds.height > 0) box = [bounds.x, bounds.y, bounds.width, bounds.height];
      } catch { /* Parse the stored boundary if the SVG is not laid out yet. */ }
      if (!box) box = pathBounds(dong.d);
      if (!box) return;
      this.selectedGu = dong.g;
      this.selectedCity = this.area === '41' ? dong.g.slice(0, 4) : '';
      this.selectedDong = code;
      this.mapView = this.fitMapBounds(box, .16);
      this.mapRenderedArea = this.area;
      this.renderMap();
    },
    selectMapRegion(region) {
      if (!region) return;
      const focus=()=>{
        this.query='';
        this.clearCategoryDetails?.();
        this.selectedGtx=null;
        if (region.kind==='legal') this.boundaryMode='legal';
        else if (region.kind==='dong') this.boundaryMode='admin';
        // Map selection changes the viewport only. Details are an explicit action.
        if (region.kind==='dong' || region.kind==='legal') this.focusDong(region.code);
        else if (region.kind==='gu') this.focusGu(region.code);
      };
      if (region.area!==this.area) {this.area=region.area;this.$nextTick(focus);}
      else focus();
    },
    toggleTerrain() { this.mapTerrain = !this.mapTerrain; this.renderMap(); },
    toggleApartments() { this.mapApartments = !this.mapApartments; if (!this.mapApartments) { this.selectedApartment = null; this.selectedApartmentGroup = null; } this.renderMap(); },
    toggleSampleApartments() { this.mapSampleApartments = !this.mapSampleApartments; if (!this.mapSampleApartments) { this.selectedApartment = null; this.selectedApartmentGroup = null; } this.renderMap(); },
    toggleGtx() { this.mapGtx = !this.mapGtx; if (!this.mapGtx) this.selectedGtx = null; this.renderMap(); },
    onMapClick(event) {
      if (this.mapDidDrag) { this.mapDidDrag = false; return; }
      const apartment = event.target.closest('[data-apartment-group]');
      if (apartment) {
        const items = this.mapApartmentGroups[apartment.dataset.apartmentGroup] || [];
        if (items.length === 1) {
          this.selectedGtx = null; this.selectedApartmentGroup = null; this.selectedApartment = items[0];
        } else if (items.length > 1) {
          // Exact coordinate duplicates cannot be separated by zooming.
          if (items.every(item => item.coordinate[0] === items[0].coordinate[0] && item.coordinate[1] === items[0].coordinate[1])) { this.selectedApartmentGroup = items; return; }
          // Zoom clusters into their center; at maximum zoom offer the list instead.
          const points = items.map(item => toXY(item.coordinate[0], item.coordinate[1]));
          const minimum = 1.5 * viewPixelWidth(this.mapView) / 440, width = Math.max(minimum, this.mapView.w * .35);
          if (this.mapView.w <= minimum || width === this.mapView.w) { this.selectedApartmentGroup = items; return; }
          const x = points.reduce((sum,p) => sum+p[0],0) / points.length, y = points.reduce((sum,p) => sum+p[1],0) / points.length;
          this.mapView = {...this.mapView,x:x-width/2,y:y-width*viewRatio(this.mapView)/2,w:width};
          this.renderMap();
        }
        return;
      }
      const station = event.target.closest('[data-gtx-station]');
      if (station) {
        const route = this.data.routes.find(r => r.id === station.dataset.gtxRoute);
        const item = route?.stations.find(s => s.id === station.dataset.gtxStation);
        if (route && item) this.selectedGtx = {route, station:item};
        return;
      }
      const el = event.target.closest('[data-code], [data-sido]');
      if (!el) return;
      this.query = '';
      if (el.dataset.code) {
        const region = this.data.regions?.[el.dataset.code] || this.data.legalByCode?.[el.dataset.code];
        if (region) this.selectMapRegion(region);
      } else if (el.dataset.sido && this.data.geo.sido[el.dataset.sido]) {
        this.area = el.dataset.sido; this.selectedGu = ''; this.mapView = null; this.renderMap();
      }
    },
    onMapPointerDown(event) {
      if (!this.mapView || (event.button !== undefined && event.button !== 0)) return;
      if (!Object.keys(this.mapPointers).length) this.mapDidDrag = false;
      this.mapPointers[event.pointerId ?? 0] = {x:event.clientX,y:event.clientY};
      this.beginMapGesture(event.currentTarget);
      if (Object.keys(this.mapPointers).length > 1) {
        this.mapDidDrag = true;
        for (const id of Object.keys(this.mapPointers)) event.currentTarget.setPointerCapture?.(Number(id));
        event.preventDefault?.();
      }
    },
    beginMapGesture(target) {
      const points=Object.entries(this.mapPointers).slice(0,2).map(([id,point])=>({id,...point}));
      if (!points.length || !this.mapView) {this.mapDrag=null;return;}
      const rect=target.getBoundingClientRect();
      this.mapDrag = {points,view:{...this.mapView},rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}};
    },
    onMapPointerMove(event) {
      const id=event.pointerId ?? 0;
      if (!this.mapPointers[id] || !this.mapDrag || !this.mapView) return;
      this.mapPointers[id]={x:event.clientX,y:event.clientY};
      const {points,view,rect}=this.mapDrag;
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      const current=points.map(p=>this.mapPointers[p.id]);
      if(current.some(p=>!p)) return;
      const centre=ps=>({x:ps.reduce((n,p)=>n+p.x,0)/ps.length,y:ps.reduce((n,p)=>n+p.y,0)/ps.length});
      const start=centre(points),now=centre(current), dx=now.x-start.x,dy=now.y-start.y;
      if (points.length === 1 && Math.hypot(dx,dy)<4 && !this.mapDidDrag) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      this.mapDidDrag = true;
      event.preventDefault?.();
      let next={...view};
      if(points.length===2) {
        const distance=ps=>Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y);
        const before=distance(points),after=distance(current);
        if(before>0 && after>0) next=zoomMapView(view,before/after,{x:(start.x-rect.left)/rect.width,y:(start.y-rect.top)/rect.height});
      }
      this.mapView={...next,x:next.x-dx*next.w/rect.width,y:next.y-dy*next.w*viewRatio(next)/rect.height};
      this.renderMap();
    },
    onMapPointerUp(event) {
      if (!event) {this.mapPointers={};this.mapDrag=null;return;}
      const id=event.pointerId ?? 0;
      if (!this.mapPointers[id]) return;
      delete this.mapPointers[id];
      this.beginMapGesture(event.currentTarget);
      if(event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    onMapPointerCancel(event) {
      if(!event) {this.mapPointers={};this.mapDrag=null;this.mapDidDrag=true;return;}
      if(!this.mapPointers[event.pointerId ?? 0]) return;
      this.mapDidDrag=true;
      this.onMapPointerUp(event);
    },
    onMapWheel(event) {
      event.preventDefault();
      if(!this.mapView || !Number.isFinite(event.deltaY) || event.deltaY===0) return;
      const rect=event.currentTarget.getBoundingClientRect();
      if(!(rect.width>0) || !(rect.height>0)) return;
      const anchor={x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
      this.mapView=zoomMapView(this.mapView,event.deltaY<0?.8:1.25,anchor);
      this.renderMap();
    },
  };
}
