import Alpine from 'alpinejs';
import { loadData } from './data.js';
import { loadLegalData } from './legal.js';
import { applyPartialScores } from './scoring.js';
import { createMapController, mapProjection, selectedMapRegion as resolveSelectedMapRegion, hasMapSelectionScore, mapRegionActionLabel } from './map.js';
import { hasComparablePrice } from './map-metrics.js';
import { getApartmentIndex, findApartment } from './apartment-data.js';
import { createHillshadeController } from './terrain-data.js';
import { createWalkController } from './walk-ui.js';
import { createMapUIController } from './map-ui.js';
import { buildingFocusCamera } from './building-focus.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import './imjang.css';
import './building-ui.css';
import secondary from './secondary.html?raw';
import './style.css';
import './map.css';
import './secondary.css';

document.getElementById('secondary-root').innerHTML = secondary;

// Keep the WebGL instance outside Alpine's reactive proxies.
let scene3d = null, sceneModule = null, sceneRevision = 0, hillshade = null, terrainTimer = null;

Alpine.data('bujaApp', () => ({
  ...createMapController(),
  ...createWalkController(),
  ...createMapUIController(),
  hasComparablePrice,
  tab: 'map', area: '11', metric: 'score', boundaryMode: 'legal', legalWarning: '', selectedCity: '', selectedGu: '', selectedDong: '', query: '', selectedRegion: null,
  mapDisplay: '2d', mapDataMode: 'real', mapViewError: '', terrainError: '', sceneTerrainNotice: '', sceneAreaNotice: '', hasSeen3d: false, vworldAvailable: false, mapBuildings: true, buildingStatus: {status:'zoom', message:'건물을 보려면 지도를 확대하세요.'},
  loading: true, error: '', vworldExpiryNotice: '', officialApartmentResults: [], apartmentSearchError: '', apartmentSearchLoading: false,
  sceneCamera:{bearing:0,pitch:60},
  data: { areas: [], regionList: [], regions: {}, routes: [] },
  async init() {
    try {
      this.data = await loadData();
      try {
        const legal = await loadLegalData();
        const real = this.data.real?.byRegion || {};
        for (const region of legal.regions) {
          const stats = real[region.code] || {};
          Object.assign(region, stats);
          region.series = stats.history || stats.series || [];
          region.commercial = this.data.real?.commercialByRegion?.[region.code] || null;
          const b = this.data.real?.businessesByRegion?.[region.code];
          region.businesses = b ? { ...b, source: this.data.real?.sources?.businesses?.source, asOf: this.data.real?.sources?.businesses?.asOf } : null;
          region.businessCoverage = this.data.real?.businessCoverageByGu?.[region.guCode] || null;
        }
        this.data.legalRegions = legal.regions;
        this.data.legalByCode = legal.byCode;
        this.data.legalSource = legal.source;
      } catch (error) {
        console.error('법정동 자료:', error);
        this.data.legalRegions = []; this.data.legalByCode = {};
        this.legalWarning = '법정동 목록을 불러오지 못했습니다.';
      }
      // 경계 데이터에는 수원시장안구처럼 공백이 없으므로 표시 이름만 정리합니다.
      for (const region of this.data.regionList) {
        if (region.area !== '41') continue;
        if (region.kind === 'gu') {
          region.name = region.name.replace(/^(.+?시)\s*(.+구)$/, '$1 $2');
          region.guName = region.name; region.full = region.name; region.fullName = region.name;
        } else {
          region.guName = region.guName.replace(/^(.+?시)\s*(.+구)$/, '$1 $2');
          region.full = `${region.guName} ${region.name}`; region.fullName = region.full;
        }
      }
      this.data.scoreDiagnostics = applyPartialScores([...this.data.regionList, ...(this.data.legalRegions || [])]);
      if (!this.data.geo.sido[this.area]) this.area = this.data.areas[0]?.code || '';
      this.renderMap();
      this.detectVWorld();
      this.$watch('area', () => { this.clearWalk(); this.clearCategoryDetails(); this.sceneAreaNotice = ''; this.mapViewError = ''; this.selectedGtx = null; this.selectedCity = ''; this.selectedGu = ''; this.selectedDong = ''; this.query = ''; this.mapView = null; this.renderMap(); if (this.mapDisplay === '3d') this.mount3d(); });
      this.$watch('query', value => this.searchApartments(value));
      this.$watch('mapView', () => { this.sync3dCamera(); this.scheduleTerrain(); });
      this.$watch('metric', () => this.refresh3dLayers());
      this.$watch('boundaryMode', () => this.refresh3dLayers());
      this.$watch('mapGtx', () => this.refresh3dLayers());
      this.$watch('data.actualApartments', value => { if (scene3d?.setApartments) scene3d.setApartments(value || []); this.renderMap(); });
      this.$watch('mapApartments', () => this.refresh3dLayers());
      this.$watch('mapSampleApartments', () => this.refresh3dLayers());
      this.$watch('mapTerrain', () => { this.refresh3dLayers(); this.scheduleTerrain(); });
      this.$watch('mapBuildings', () => this.refresh3dLayers());
      this.$watch('selectedCity', () => this.$nextTick(() => this.revealSelectedTab('cityTabs')));
      this.$watch('selectedGu', () => this.$nextTick(() => { this.revealSelectedTab('gyeonggiTabs'); this.revealSelectedTab('districtTabs'); }));
      this.$watch('selectedDong', () => this.$nextTick(() => this.revealSelectedTab('dongTabs')));
      this.$watch('tab', value => { if (value !== 'map' && this.mapExpanded) this.toggleMapExpanded(); });
    } catch (error) {
      console.error(error);
      this.error = '데이터를 불러오지 못했어요. 개발 서버 또는 정적 서버에서 다시 실행해 주세요.';
    } finally { this.loading = false; await this.$nextTick(); this.setupMapUI(); }
  },
  destroy() { this.destroyMapUI(); sceneRevision++; scene3d?.destroy(); scene3d=null; hillshade?.clear(); clearTimeout(terrainTimer); },
  async detectVWorld() {
    if (!import.meta.env.DEV) return;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/vworld/status`, {cache:'no-store',headers:{Accept:'application/json'}});
      if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return;
      const status = await response.json();
      if (status.enabled && status.expiry?.state === 'expiring') this.vworldExpiryNotice = `브이월드 개발키 만료 예정: ${status.expiry.expiresOn} (${status.expiry.daysRemaining}일 남음). 갱신 여부를 확인하세요.`;
      if (status.enabled && status.expiry?.state === 'expired') this.vworldExpiryNotice = `브이월드 개발키의 기록된 만료일 ${status.expiry.expiresOn}이 지났습니다. 발급 상태를 확인하세요.`;
      if (status.enabled && status.expiry?.state === 'invalid') this.vworldExpiryNotice = '브이월드 개발키 만료일 설정을 확인하세요.';
      this.vworldAvailable = status.enabled === true && status.wfs === true;
      scene3d?.setVWorldEnabled?.(this.vworldAvailable);
      if (status.enabled === true && status.wmts === true) {
        this.mapBaseProvider = 'vworld'; this.mapBaseError = ''; this.renderMap();
        scene3d?.setBaseMapProvider?.('vworld');
      }
    } catch { /* Static hosting and failed local configuration continue with OSM. */ }
  },
  async setMapDisplay(mode) {
    if (mode === '2d') {
      if (scene3d && sceneModule) {
        const view=scene3d.getView(), {width,height}=this.mapDimensions;
        this.sceneCamera={bearing:view.bearing,pitch:view.pitch};
        this.mapView=sceneModule.cameraToSvgView(view.center,view.zoom,width,height);
      }
      sceneRevision++; scene3d?.destroy(); scene3d = null; this.mapDisplay = '2d'; this.mapViewError = ''; this.renderMap(); this.scheduleTerrain(); return;
    }
    if (mode !== '3d' || this.mapDisplay === '3d') return;
    this.mapViewError = '';
    if (!this.hasSeen3d) { if (this.mapDataMode === 'sample') this.mapSampleApartments = true; else this.mapApartments = true; this.mapTerrain = true; this.hasSeen3d = true; this.renderMap(); }
    this.mapDisplay = '3d'; this.scheduleTerrain();
    await this.mount3d();
  },
  async mount3d() {
    const revision = ++sceneRevision;
    this.buildingStatus={status:'loading',message:'3D 지도를 준비하고 있어요.'};
    this.sceneTerrainNotice = '';
    this.sceneAreaNotice = '';
    scene3d?.destroy(); scene3d = null;
    await this.$nextTick();
    try {
      sceneModule ||= await import('./scene3d.js');
      if (revision !== sceneRevision || this.mapDisplay !== '3d') return;
      const {width,height}=this.mapDimensions;
      const camera = sceneModule.svgViewToCamera(this.mapView, width, height);
      const features = sceneModule.buildSceneFeatures({data:this.data, area:this.area, boundaryMode:this.boundaryMode, metric:this.metric, mapGtx:true});
      const area = this.area;
      let initializing = true;
      const created = await sceneModule.createSample3D({container:this.$refs.scene3d, area, ...camera, ...this.sceneCamera,
        geo:this.data.geo, apartments:this.data.apartments, actualApartments:this.data.actualApartments || [], terrainMode:this.mapDataMode, baseMapProvider:this.mapBaseProvider, vworldEnabled:this.vworldAvailable, terrainHills:this.data.sampleTerrain?.hills || [], ...features,
        isPicking: () => this.walkActive && !!this.walkPicking, onMapPoint: point => queueMicrotask(() => this.setWalkPoint(point)),
        onApartmentGroupSelect: items => { this.selectedApartmentGroup = items; },
        onBuildingsStatus: status => { if (revision === sceneRevision) this.buildingStatus = status; },
        onBaseMapStatus: status => { if (revision === sceneRevision && status.provider === 'osm') { this.mapBaseProvider = 'osm'; this.mapBaseError = status.message || ''; this.renderMap(); } },
        onTerrainStatus: message => { if (revision === sceneRevision) this.sceneTerrainNotice = message || ''; },
        onViewChange: view => {
          if (initializing || revision !== sceneRevision || this.area !== area) return;
          this.sceneCamera={bearing:view.bearing,pitch:view.pitch};
          this.updateSceneAreaNotice(view.viewportArea);
          const size=this.mapDimensions;
          const mapView = sceneModule.cameraToSvgView(view.center, view.zoom, size.width, size.height);
          if (mapView) { this.mapView = mapView; this.mapRenderedArea = this.area; this.renderMap(); }
        },
        onApartmentSelect: id => { const item = [...(this.data.actualApartments || []), ...(this.data.apartments || [])].find(a => a.id === id); if (item) { this.selectedRegion = null; this.selectedApartment = item; } },
        onRegionSelect: code => { const region = this.data.regions?.[code] || this.data.legalByCode?.[code]; if (region) this.selectMapRegion(region); },
        onError: error => { if (revision === sceneRevision) { const message = error.message || '알 수 없는 오류'; this.setMapDisplay('2d'); this.mapViewError = `3D 표시 오류로 2D 지도로 돌아왔습니다: ${message}`; } }
      });
      if (revision !== sceneRevision || this.mapDisplay !== '3d') { created.destroy(); return; }
      scene3d = created; initializing = false; created.setVWorldEnabled?.(this.vworldAvailable); created.setBaseMapProvider?.(this.mapBaseProvider); this.sync3dCamera(); this.updateSceneAreaNotice(created.getView().viewportArea); this.refresh3dLayers(); this.syncWalkRoute3d();
    } catch (error) {
      if (revision !== sceneRevision) return;
      scene3d?.destroy(); scene3d = null; this.mapDisplay = '2d';
      this.mapViewError = error.message || '3D 지도를 사용할 수 없어 2D 지도로 돌아왔습니다.';
      this.renderMap(); this.scheduleTerrain();
    }
  },
  updateSceneAreaNotice(viewportArea) {
    const target=this.data.geo?.sido?.[viewportArea]?.n;
    this.sceneAreaNotice = target && viewportArea !== this.area ? `지도 중심은 ${target}입니다. 점수와 공동주택 이름은 선택한 ${this.areaName} 기준입니다. 해당 시도 탭을 선택하면 지역 정보가 바뀝니다.` : '';
  },
  sync3dCamera() {
    if (this.mapDisplay !== '3d' || !scene3d || !sceneModule || !this.mapView) return;
    const {width,height}=this.mapDimensions;
    const camera = sceneModule.svgViewToCamera(this.mapView, width, height), current = scene3d.getView();
    if (!camera || current.area !== this.area) return;
    if (Math.abs(current.center[0]-camera.center[0]) > 0.000001 || Math.abs(current.center[1]-camera.center[1]) > 0.000001 || Math.abs(current.zoom-camera.zoom) > 0.0001) scene3d.setView(camera);
  },
  resizeScene() { scene3d?.resize(); },
  sceneZoomIn() { scene3d?.zoomBy(1); },
  sceneZoomOut() { scene3d?.zoomBy(-1); },
  showCurrentBuildings() {
    if (!scene3d || this.mapDisplay !== '3d') return;
    const camera=buildingFocusCamera(scene3d.getView(),this.buildingStatus?.status === 'zoom');
    this.mapBuildings=true;
    if (camera) scene3d.setView(camera);
  },
  resetSceneView(mode) { if (mode === 'north') scene3d?.resetNorth(); else scene3d?.resetOrientation(); },
  resetSceneNorth() { scene3d?.resetNorth(); },
  focusSelectedMap() {
    if (this.selectedDong) this.focusDong(this.selectedDong);
    else if (this.selectedGu) this.focusGu(this.selectedGu);
    else if (this.currentCity) this.focusGuGroup(this.currentCity.districts.map(region=>region.code));
    else this.resetMap();
  },
  refresh3dLayers() {
    if (this.mapDisplay !== '3d' || !scene3d || !sceneModule) return;
    const features = sceneModule.buildSceneFeatures({data:this.data, area:this.area, boundaryMode:this.boundaryMode, metric:this.metric, mapGtx:true});
    scene3d.setView(features);
    scene3d.setLayers({apartments:this.mapApartments, sampleApartments:this.mapSampleApartments, terrain:this.mapTerrain, gtx:this.mapGtx, buildings:this.mapBuildings});
  },
  toggleCurrentApartments() { if (this.mapDataMode === 'sample') this.toggleSampleApartments(); else this.toggleApartments(); },
  changeMapDataMode() {
    if (this.mapDataMode === 'sample') { this.clearWalk(); this.walkActive = false; }
    this.mapViewError = ''; this.terrainError = '';
    this.mapSampleApartments = this.mapDataMode === 'sample'; this.mapApartments = this.mapDataMode === 'real';
    this.selectedApartment = null; this.selectedApartmentGroup = null; this.renderMap();
    this.scheduleTerrain(); if (this.mapDisplay === '3d') this.mount3d();
  },
  scheduleTerrain() {
    clearTimeout(terrainTimer);
    if (this.mapDisplay !== '2d' || !this.mapTerrain || this.mapDataMode !== 'real') { hillshade?.clear(); this.terrainError = ''; return; }
    terrainTimer = setTimeout(() => this.$nextTick(() => {
      if (this.mapDisplay !== '2d' || !this.mapTerrain || this.mapDataMode !== 'real') return;
      hillshade ||= createHillshadeController({canvas:this.$refs.terrainCanvas,onStatus:status => { this.terrainError = status === 'error' ? '고도 지형을 불러오지 못했습니다. 기본 지도는 계속 사용할 수 있습니다.' : ''; }});
      hillshade.render(this.mapView);
    }), 90);
  },
  syncWalkRoute3d() { if (scene3d?.setRoute) scene3d.setRoute(this.walkResult?.coordinates || []); },
  async showRealBuildingArea(place = 'seoul') {
    // Both entries are examples of actual OSM coverage, not complete city data.
    const places = {
      seoul: { area:'11', center:[126.9145,37.5675], city:'', district:'' },
      seongnam: { area:'41', center:[127.127,37.4065], city:'4113', district:'41135' },
      busan: { area:'26', center:[129.174,35.171], city:'', district:'26350' },
    };
    const target = places[place];
    if (!target) return;
    if (this.mapDisplay === '3d') await this.setMapDisplay('2d');
    if (this.mapDataMode !== 'real') { this.mapDataMode = 'real'; this.changeMapDataMode(); }
    if (this.area !== target.area) { this.area = target.area; await this.$nextTick(); }
    this.query = ''; this.selectedRegion = null; this.selectedApartment = null; this.selectedApartmentGroup = null;
    this.selectedGu = target.district; this.selectedDong = ''; this.selectedCity = target.city;
    const {width,height}=this.mapDimensions, ratio=height/width, w=6*width/440;
    const [x,y] = mapProjection.toXY(...target.center);
    this.mapView = {x:x-w/2,y:y-w*ratio/2,w,ratio,pixelWidth:width}; this.mapRenderedArea = this.area;
    this.mapBuildings = true; this.renderMap(); await this.setMapDisplay('3d');
  },
  showSampleArea() {
    const sample = this.data.apartments?.find(item => item.sample && item.area === this.area && item.coordinate);
    if (!sample) { this.mapViewError = '이 지역에는 가상 단지·지형 예시가 없습니다.'; return; }
    this.mapViewError = ''; this.mapSampleApartments = true; this.mapTerrain = true;
    this.selectedGu = ''; this.selectedDong = ''; this.selectedCity = '';
    const [lon,lat] = sample.coordinate, pk = Math.cos(36.5 * Math.PI / 180);
    const x = (lon * pk - 100.1684389) * 1200, y = (-lat + 38.6136915) * 1200;
    const {width,height}=this.mapDimensions, ratio=height/width, w=4.5*width/440;
    this.mapView = {x:x-w/2,y:y-w*ratio/2,w,ratio,pixelWidth:width}; this.mapRenderedArea = this.area; this.renderMap();
  },
  get isPublicPreview() { return this.data.real?.sources?.transactions?.status === 'withheld'; },
  get freshness() {
    if (this.isPublicPreview) return '시세·부분 점수는 공개용 자료 준비 중 · 지도·3D 공개 시연';
    const snapshot = ['11', '41'].includes(this.area) ? this.data.real?.sources?.transactions : this.data.real?.sources?.otherTransactions;
    const date = snapshot?.asOf;
    if (!/^\d{4}-\d{2}$/.test(date || '')) return '실거래 스냅샷을 불러오지 못했습니다.';
    const [year, month] = date.split('-').map(Number), now = new Date();
    const age = now.getFullYear() * 12 + now.getMonth() + 1 - (year * 12 + month);
    return `계약 ${date} 기준 · 수동 갱신${age > 2 ? ' · 자료가 오래되었으니 갱신하세요' : ''}`;
  },
  get legalBasis() {
    const checked = this.data.legalSource?.codesCheckedAt;
    let date = '확인일 미상';
    if (checked && !Number.isNaN(Date.parse(checked))) date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date(checked));
    const all = (this.data.legalRegions || []).filter(r => r.area === this.area);
    const missing = all.filter(r => !r.geometryAvailable).length;
    return `법정동 코드 확인 ${date} · 경계 2023-07-29${missing ? ` · 경계 미확보 ${missing}곳` : ''}`;
  },
  get areaName() { return this.data.areas.find(a => a.code === this.area)?.name || ''; },
  get areaDongs() { return this.data.regionList.filter(r => r.area === this.area && r.kind === 'dong'); },
  get gyeonggiDistricts() {
    return this.data.regionList.filter(r => r.area === this.area && r.kind === 'gu').sort((a, b) => a.code.localeCompare(b.code));
  },
  get focusDongs() { return (this.boundaryMode === 'legal' ? (this.data.legalRegions || []).filter(r => r.area === this.area) : this.areaDongs).filter(r => r.guCode === this.selectedGu); },
  get mapSelectedRegion() { return resolveSelectedMapRegion(this.data,this.selectedDong,this.selectedGu); },
  get mapSelectionHasScore() { return hasMapSelectionScore(this.mapSelectedRegion); },
  get mapSelectionActionLabel() { return mapRegionActionLabel(this.mapSelectedRegion); },
  get mapSelectionWeights() { return (this.mapSelectedRegion?.scoreInfo?.parts || []).map(part=>`${part.label} ${(part.effectiveWeight*100).toFixed(1)}%`).join(' · '); },
  get gyeonggiCities() {
    const groups = new Map();
    for (const region of this.data.regionList) {
      if (region.area !== '41' || region.kind !== 'gu') continue;
      const code = region.code.slice(0, 4);
      const name = region.name.match(/^(.+?시)\s*.+구$/)?.[1] || region.name;
      if (!groups.has(code)) groups.set(code, { code, name, districts: [] });
      groups.get(code).districts.push(region);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  },
  get currentCity() { return this.gyeonggiCities.find(city => city.code === this.selectedCity); },
  get summaryCards() {
    const regions = (this.data.legalRegions || []).filter(region => region.area === this.area);
    const top = (key, pool = regions) => pool.filter(item => item[key] != null).reduce((best, item) => !best || Number(item[key]) > Number(best[key]) ? item : best, null);
    const cohorts = new Map();
    for (const item of regions) if (item.scoreInfo) { const key = JSON.stringify([item.scoreInfo.source, item.scoreInfo.asOf, item.scoreInfo.period, item.scoreInfo.comparisonScope || 'sido']); cohorts.set(key, (cohorts.get(key) || 0) + 1); }
    const cohort = [...cohorts].sort((a,b) => b[1] - a[1])[0]?.[0];
    const score = top('score', regions.filter(item => item.scoreInfo && JSON.stringify([item.scoreInfo.source, item.scoreInfo.asOf, item.scoreInfo.period, item.scoreInfo.comparisonScope || 'sido']) === cohort)), growth = top('yoy'), transactions = top('transactions');
    return [
      { label: '법정동 부분 점수 최고', region: score, value: score ? `${score.score}점 · ${score.scoreInfo?.comparisonScope === 'national' ? '전국 비교' : '시도 비교'}` : '근거 부족' },
      { label: '아파트 1년 상승 1위', region: growth, value: growth ? `${growth.yoy > 0 ? '+' : ''}${growth.yoy}%` : '데이터 없음', up: true },
      { label: '최근 3개월 거래 최다', region: transactions, value: transactions ? `아파트 ${transactions.transactions}건` : '데이터 없음' },
    ];
  },
  get visibleRegions() {
    const term = this.query.trim();
    if (term) return [...this.data.regionList, ...(this.data.legalRegions || [])].filter(r => r.full.replace(/\s+/g, '').includes(term.replace(/\s+/g, ''))).slice(0, 40);
    return this.selectedGu ? this.focusDongs : this.data.regionList.filter(r => r.area === this.area && r.kind === 'gu');
  },
  get searchExtras() {
    const term = this.query.trim();
    if (!term) return [];
    const buildings = [...(this.mapDataMode === 'sample' ? (this.data.apartments || []).filter(b => `${b.name} ${b.address || ''}`.includes(term)).map(b => ({ key: b.id, label: b.name, type: '가상 단지', apartment: b })) : []), ...this.officialApartmentResults.map(b => ({key:b.id, label:`${b.name} · ${b.address}`, type:b.coordinate ? '공식 단지 · 대표 위치' : '공식 단지 · 위치 미확인', apartment:b}))];
    const stations = this.data.routes.flatMap(r => r.stations.filter(s => `${r.name} ${s.name}역`.includes(term) && s.regionCode).map(s => ({ key: `${r.id}-${s.name}`, label: `${r.name} ${s.name}${s.name.endsWith('역') ? '' : '역'}`, type: 'GTX', regionCode: s.regionCode })));
    return [...buildings, ...stations].slice(0, 20);
  },
  async searchApartments(value) {
    const term = String(value || '').trim();
    if (term.length < 2) { this.officialApartmentResults = []; this.apartmentSearchError = ''; return; }
    this.apartmentSearchLoading = true; this.apartmentSearchError = '';
    try {
      const index = await getApartmentIndex();
      if (this.query.trim() !== term) return;
      const key = term.replace(/\s+/g, '');
      this.officialApartmentResults = index.items.filter(item => `${item.name} ${item.address}`.replace(/\s+/g, '').includes(key)).slice(0, 20);
    } catch (error) {
      if (this.query.trim() === term) this.apartmentSearchError = '공식 단지 검색 자료를 불러오지 못했습니다.';
    } finally { if (this.query.trim() === term) this.apartmentSearchLoading = false; }
  },
  async openSearchExtra(item) {
    if (item.regionCode) { this.selectRegion(this.data.regions[item.regionCode]); return; }
    if (!item.apartment) return;
    try {
      const apartment = item.apartment.sample ? item.apartment : await findApartment(item.apartment);
      this.selectedRegion = null; this.selectedApartment = apartment; this.selectedApartmentGroup = null;
    } catch (error) { this.apartmentSearchError = error.message || '단지 상세 자료를 불러오지 못했습니다.'; }
  },
  revealSelectedTab(ref) {
    const row = this.$refs[ref];
    const active = row?.querySelector('[aria-selected="true"]');
    if (!row || !active || !row.clientWidth) return;
    const bounds = row.getBoundingClientRect(), button = active.getBoundingClientRect();
    if (button.left < bounds.left) row.scrollLeft += button.left - bounds.left - 14;
    else if (button.right > bounds.right) row.scrollLeft += button.right - bounds.right + 14;
  },
  setArea(code) { if (this.area !== code) this.area = code; },
  setBoundaryMode(mode) {
    this.boundaryMode = mode; this.selectedDong = ''; this.clearCategoryDetails();
    if (this.selectedGu) this.focusGu(this.selectedGu); else this.renderMap();
  },
  clearFocus() { this.resetMap(); },
  clearCategoryDetails() { this.selectedRegion = null; this.selectedApartment = null; this.selectedApartmentGroup = null; this.legalWarning = ''; },
  resetCategoryMap() { this.clearCategoryDetails(); this.resetMap(); },
  selectCity(city) {
    if (!city) return;
    this.query = ''; this.clearCategoryDetails();
    if (this.selectedCity === city.code) { this.resetMap(); return; }
    this.selectedCity = city.code;
    if (city.districts.length === 1) this.focusGu(city.districts[0].code);
    else this.focusGuGroup(city.districts.map(region => region.code));
  },
  backToCityList() { this.resetMap(); },
  backToDistrictList() {
    const city=this.currentCity;
    if (!city) return;
    this.query = ''; this.clearCategoryDetails();
    this.focusGuGroup(city.districts.map(region => region.code));
  },
  selectRegionTab(region) {
    if (!region) return;
    this.query = '';
    this.clearCategoryDetails();
    if (region.kind === 'dong' || region.kind === 'legal') {
      // Selecting the active dong again returns to its district without opening details.
      if (this.selectedDong === region.code) this.focusGu(region.guCode);
      else this.focusDong(region.code);
    } else if (this.selectedGu === region.code) {
      // A multi-district city returns to the city; other areas return to the province.
      if (this.area === '41' && this.currentCity?.districts.length > 1) this.backToDistrictList();
      else this.resetMap();
    } else this.focusGu(region.code);
  },
  selectRegion(region) {
    if (!region) return;
    this.query = '';
    const apply = () => {
      if (region.kind === 'legal') this.boundaryMode = 'legal';
      else if (region.kind === 'dong') this.boundaryMode = 'admin';
      this.focusGu(region.kind === 'gu' ? region.code : region.guCode);
      if (region.kind === 'dong' || region.kind === 'legal') { this.focusDong(region.code); this.openRegion(region.code); }
    };
    if (region.area !== this.area) { this.area = region.area; this.$nextTick(apply); }
    else apply();
  },
  openRegion(code) { const region = this.data.regions[code] || this.data.legalByCode?.[code]; if (code && region) { this.selectedApartment = null; this.selectedRegion = region; } },
  closeRegion() { this.selectedRegion = null; },
  closeDetail() { this.selectedRegion = null; this.selectedApartment = null; this.selectedGtx = null; },
  openSampleBuilding() {
    const region = this.areaDongs[0];
    if (!region) return;
    this.openRegion(region.code);
    this.$nextTick(() => window.dispatchEvent(new CustomEvent('open-building', { detail: region.buildings[0] })));
  },
  switchTab(tab) { this.tab = tab; window.scrollTo({ top: 0, behavior: 'auto' }); },
}));

window.Alpine = Alpine;
Alpine.start();

