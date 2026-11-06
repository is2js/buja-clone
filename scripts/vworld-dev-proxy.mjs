import { loadEnv } from 'vite';
import * as tls from 'node:tls';

const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
const PATH_PREFIX = '/api/vworld/';
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const MAX_BUILDINGS_BYTES = 12 * 1024 * 1024;
const MAX_FEATURES = 500;
const MAX_CONCURRENT = 12;
const REQUEST_TIMEOUT_MS = 12000;

// The provider's displayed date is treated as valid through that date in Korea.
export function vworldExpiryStatus(expiresOn, now = new Date()) {
  if (!expiresOn) return {state:'unknown', expiresOn:null, daysRemaining:null};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return {state:'invalid', expiresOn:null, daysRemaining:null};
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  if (!Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0,10) !== expiresOn) return {state:'invalid', expiresOn:null, daysRemaining:null};
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
  const daysRemaining = Math.round((expiry.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
  return {state:daysRemaining < 0 ? 'expired' : daysRemaining <= 30 ? 'expiring' : 'valid', expiresOn, daysRemaining};
}

export function isAllowedLocalRequest(req) {
  const address = String(req.socket?.remoteAddress || '').toLowerCase();
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const expectedOrigin = `http://${host}`;
  const origin = req.headers.origin;
  if (origin && origin !== expectedOrigin) return false;
  const referer = req.headers.referer;
  if (referer) {
    try { if (new URL(referer).origin !== expectedOrigin) return false; }
    catch { return false; }
  }
  return true;
}

export function parseTilePath(pathname) {
  const match = /^\/api\/vworld\/tiles\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.png$/.exec(pathname);
  if (!match) return null;
  const [z,x,y] = match.slice(1).map(Number);
  if (z < 6 || z > 19 || x >= 2**z || y >= 2**z) return null;
  // Limit requests to an envelope containing South Korea and nearby coast.
  const lon = tileX => tileX / 2**z * 360 - 180;
  const lat = tileY => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / 2**z))) * 180 / Math.PI;
  if (lon(x + 1) < 124 || lon(x) > 132 || lat(y) < 32 || lat(y + 1) > 39) return null;
  return {z,x,y};
}

async function readLimited(response, maxBytes) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('response too large');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  let count = 0; const parts = [];
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > maxBytes) { await reader.cancel(); throw new Error('response too large'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, count);
}

export function parseBounds(searchParams) {
  const names = ['west','south','east','north'];
  const values = names.map(name => searchParams.get(name));
  if (values.some(value => value == null || value.trim() === '' || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const [west,south,east,north] = values.map(Number);
  if (![west,south,east,north].every(Number.isFinite) || west < 124 || east > 132 || south < 32 || north > 39 || east <= west || north <= south) return null;
  if (east-west > .02 || north-south > .02 || (east-west)*(north-south) > .0004) return null;
  return {west,south,east,north};
}

function normalizeBuildings(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('invalid feature collection');
  const result = [];
  let missingHeight=0, invalidGeometry=0, missingId=0;
  function geometryValid(geometry) {
    if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!polygons.length || polygons.length > 200) return false;
    let points=0;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length || polygon.length > 100) return false;
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) return false;
        points+=ring.length; if (points > 20000) return false;
        for (const point of ring) {
          if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 124 || point[0] > 132 || point[1] < 32 || point[1] > 39) return false;
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return false;
      }
    }
    return true;
  }
  for (const feature of data.features.slice(0, MAX_FEATURES)) {
    const geometry=feature?.geometry, p=feature?.properties;
    if (!geometryValid(geometry) || !p) {invalidGeometry++; continue;}
    const levels=Number(p.gro_flo_co);
    const id = p.pk || p.bd_mgt_sn || feature.id;
    if (id == null || String(id).length > 160) {missingId++; continue;}
    const name = typeof p.buld_nm === 'string' ? p.buld_nm.slice(0,120) : '';
    const hasLevels=Number.isFinite(levels) && levels > 0 && levels <= 200;
    if (!hasLevels) missingHeight++;
    // Discard every other provider field, including any accidentally echoed URL.
    result.push({type:'Feature',geometry:{type:geometry.type,coordinates:geometry.coordinates},properties:{id:String(id),name,levels:hasLevels?levels:null,height:hasLevels?levels*3:null,heightSource:hasLevels?'levels':'unknown',source:'vworld'}});
  }
  const total = Number(data.totalFeatures ?? data.numberMatched);
  return {type:'FeatureCollection',features:result,metadata:{source:'브이월드 도로명주소건물',heightNote:'지상층수 × 3m 추정',received:data.features.length,matched:Number.isFinite(total) ? total : null,missingHeight,invalidGeometry,missingId,truncated:Number.isFinite(total) ? total > data.features.length : data.features.length >= MAX_FEATURES}};
}

export function createVWorldMiddleware({key = '', expiresOn = '', upstreamFetch = fetch} = {}) {
  let concurrent = 0;
  return async function vworldMiddleware(req, res, next) {
    let requestUrl; try { requestUrl = new URL(req.url || '', 'http://localhost'); } catch { return next(); }
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith(PATH_PREFIX)) return next();
    const finish = (status, body, type = 'application/json; charset=utf-8') => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(body);
    };
    if (!isAllowedLocalRequest(req)) return finish(403, JSON.stringify({error:'로컬 지도에서만 이용할 수 있습니다.'}));
    if (req.method !== 'GET') return finish(405, JSON.stringify({error:'지원하지 않는 요청입니다.'}));
    if (pathname === '/api/vworld/status') return finish(200, JSON.stringify({enabled: Boolean(key), wmts: Boolean(key), wfs: Boolean(key), expiry: vworldExpiryStatus(expiresOn)}));
    const isBuildings = pathname === '/api/vworld/buildings';
    const bounds = isBuildings ? parseBounds(requestUrl.searchParams) : null;
    const tile = !isBuildings ? parseTilePath(pathname) : null;
    if (isBuildings && !bounds) return finish(400, JSON.stringify({error:'조회 범위를 확인해 주세요.'}));
    if (!isBuildings && !tile) return finish(404, JSON.stringify({error:'지원하지 않는 지도 요청입니다.'}));
    if (!key) return finish(503, JSON.stringify({error:'브이월드 로컬 설정이 없습니다.'}));
    if (concurrent >= MAX_CONCURRENT) return finish(429, JSON.stringify({error:'요청이 많아 잠시 후 다시 시도합니다.'}));
    concurrent++;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const onClientClose = () => { if (!res.writableEnded) ctrl.abort(); };
    res.once('close', onClientClose);
    try {
      let url;
      if (isBuildings) {
        url = new URL('https://api.vworld.kr/req/wfs');
        const query = {service:'WFS', version:'1.1.0', request:'GetFeature', typeName:'lt_c_spbd', outputFormat:'application/json', srsName:'EPSG:4326', bbox:`${bounds.south},${bounds.west},${bounds.north},${bounds.east},EPSG:4326`, maxFeatures:String(MAX_FEATURES), domain:`http://${req.headers.host}/`, key};
        for (const [name,value] of Object.entries(query)) url.searchParams.set(name,value);
      } else url = `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/Base/${tile.z}/${tile.y}/${tile.x}.png`;
      const response = await upstreamFetch(url, {signal:ctrl.signal, redirect:'error', headers:{referer:`http://${req.headers.host}/`, origin:`http://${req.headers.host}`}});
      if (!response.ok) throw new Error('upstream request failed');
      if (isBuildings) {
        if (!(response.headers.get('content-type') || '').toLowerCase().includes('json')) throw new Error('invalid response type');
        const bytes = await readLimited(response, MAX_BUILDINGS_BYTES);
        const data = normalizeBuildings(JSON.parse(bytes.toString('utf8')));
        const body = JSON.stringify(data); if (body.includes(key)) throw new Error('invalid response');
        return finish(200, body);
      }
      if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('image/png')) throw new Error('invalid upstream response');
      const bytes = await readLimited(response, MAX_TILE_BYTES);
      if (bytes.length < PNG.length || !bytes.subarray(0, PNG.length).equals(PNG)) throw new Error('invalid image');
      return finish(200, bytes, 'image/png');
    } catch {
      if (res.destroyed) return;
      return finish(502, JSON.stringify({error:isBuildings ? '브이월드 건물 자료를 불러오지 못했습니다.' : '브이월드 배경지도를 불러오지 못했습니다.'}));
    } finally { clearTimeout(timer); res.off('close', onClientClose); concurrent--; }
  };
}

// configureServer is intentionally absent in preview/build: the secret is never bundled.
export function vworldDevProxy() {
  return {
    name:'local-vworld-proxy',
    apply:'serve',
    configureServer(server) {
      // Add operating-system trust roots without disabling TLS verification.
      if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
        try { tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]); } catch {}
      }
      const values = loadEnv(server.config.mode, server.config.envDir || server.config.root, '');
      const key = values.VWORLD_API_KEY || '', expiresOn = values.VWORLD_KEY_EXPIRES_ON || '';
      if (key) {
        const expiry = vworldExpiryStatus(expiresOn);
        if (expiry.state === 'expiring') console.warn(`브이월드 개발키 만료 예정: ${expiry.expiresOn} (한국 시간 기준 ${expiry.daysRemaining}일). 갱신 여부를 확인하세요.`);
        if (expiry.state === 'expired') console.warn(`브이월드 개발키의 기록된 만료일 ${expiry.expiresOn}이 지났습니다. 발급 상태를 확인하고 갱신하세요.`);
        if (expiry.state === 'invalid') console.warn('브이월드 개발키 만료일 형식을 확인하세요 (YYYY-MM-DD).');
      }
      server.middlewares.use(createVWorldMiddleware({key, expiresOn}));
    },
  };
}
