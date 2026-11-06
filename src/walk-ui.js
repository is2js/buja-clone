import { mapProjection } from './map.js';
import { sampleElevations } from './terrain-data.js';
import { isWalkingCoverage, enrichWalkingRoute } from './walking.js';
import { calculateWalkingPath, cancelWalkingPath } from './walking-worker-client.js';

export function createWalkController() {
  return {
    walkActive:false, walkPicking:null, walkStart:null, walkEnd:null, walkResult:null, walkError:'', walkBusy:false, walkRevision:0,
    toggleWalk() { if (!this.walkActive && this.mapDataMode === 'sample') { this.mapDataMode = 'real'; this.changeMapDataMode(); } this.walkActive = !this.walkActive; if (!this.walkActive) this.walkPicking = null; },
    beginWalkPick(which) { this.walkActive = true; this.walkPicking = which; this.walkError = ''; },
    clearWalk() { this.walkRevision++; cancelWalkingPath(); this.walkStart = null; this.walkEnd = null; this.walkResult = null; this.walkError = ''; this.walkPicking = null; this.walkBusy = false; this.syncWalkRoute3d?.(); },
    focusApartment(apartment) {
      if (!apartment?.locationVerified || !Array.isArray(apartment.coordinate)) return;
      const focus = () => {
        const [x,y] = mapProjection.toXY(...apartment.coordinate), pixelWidth=this.mapDimensions?.width || mapProjection.viewPixelWidth(this.mapView), ratio=this.mapDimensions?.height / this.mapDimensions?.width || mapProjection.viewRatio(this.mapView), w=18*pixelWidth/440;
        this.selectedGu = ''; this.selectedDong = ''; this.selectedCity = '';
        this.mapView = {x:x-w/2,y:y-w*ratio/2,w,ratio,pixelWidth}; this.mapRenderedArea = this.area;
        this.mapApartments = true; this.renderMap();
      };
      this.closeDetail();
      if (apartment.area !== this.area) { this.area = apartment.area; this.$nextTick(focus); } else focus();
    },
    setWalkStartFromApartment(apartment) {
      if (apartment?.sample || !apartment?.locationVerified || !Array.isArray(apartment.coordinate)) return;
      const setStart=()=>{ this.walkRevision++; cancelWalkingPath(); this.walkStart = [...apartment.coordinate]; this.walkEnd = null; this.walkResult = null; this.walkActive = true; this.walkPicking = 'end'; this.walkError = ''; this.walkBusy = false; this.syncWalkRoute3d?.(); };
      const changesArea=apartment.area !== this.area; this.focusApartment(apartment);
      if (changesArea) this.$nextTick(setStart); else setStart();
    },
    setWalkPoint(point) {
      if (!this.walkPicking || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return;
      this.walkRevision++; cancelWalkingPath(); this.walkBusy = false;
      if (this.walkPicking === 'start') this.walkStart = point; else this.walkEnd = point;
      this.walkPicking = null; this.walkResult = null; this.walkError = ''; this.syncWalkRoute3d?.();
    },
    onWalkMapClick(event) {
      if (!this.walkActive || !this.walkPicking || this.mapDidDrag) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      if (!this.mapView || !rect.width || !rect.height) return;
      const x = this.mapView.x + (event.clientX - rect.left) / rect.width * this.mapView.w;
      const y = this.mapView.y + (event.clientY - rect.top) / rect.height * this.mapView.w * mapProjection.viewRatio(this.mapView);
      this.setWalkPoint(mapProjection.toLL(x,y));
    },
    async calculateWalk() {
      if (!this.walkStart || !this.walkEnd || this.walkBusy) return;
      const start = [...this.walkStart], end = [...this.walkEnd];
      if (!isWalkingCoverage(start) || !isWalkingCoverage(end)) { this.walkError = '현재 보행망은 서울·하남 주변 시범 범위에서만 제공됩니다.'; this.walkResult = null; this.syncWalkRoute3d?.(); return; }
      const revision=++this.walkRevision;
      this.walkBusy = true; this.walkError = ''; this.walkResult = null; this.syncWalkRoute3d?.();
      try {
        const path = await calculateWalkingPath(start,end);
        if (revision !== this.walkRevision) return;
        const result = path?.status === 'elevation_unavailable' ? await enrichWalkingRoute(path,sampleElevations) : path;
        if (revision !== this.walkRevision) return;
        if (result.status !== 'ok' && result.status !== 'elevation_unavailable') { this.walkError = result.message || '연결된 보행 경로와 고도를 확인할 수 없습니다.'; return; }
        this.walkResult = {...result, coordinates:result.geometry};
        if (result.status === 'elevation_unavailable') this.walkError = result.message;
        this.syncWalkRoute3d?.();
      } catch (error) { if (revision === this.walkRevision) this.walkError = error.message || '보행 경로 자료를 불러오지 못했습니다.'; }
      finally { if (revision === this.walkRevision) this.walkBusy = false; }
    },
    walkViewBox() { const v=this.mapView; return v ? `${v.x} ${v.y} ${v.w} ${v.w * mapProjection.viewRatio(v)}` : '0 0 1 1'; },
    walkLinePoints() { return (this.walkResult?.coordinates || []).map(p => mapProjection.toXY(...p).join(',')).join(' '); },
    walkStartXY() { return this.walkStart ? mapProjection.toXY(...this.walkStart) : [0,0]; },
    walkEndXY() { return this.walkEnd ? mapProjection.toXY(...this.walkEnd) : [0,0]; },
    walkMarkerRadius() { return (this.mapView?.w || 1) / mapProjection.viewPixelWidth(this.mapView) * 6; },
    walkPointsLabel() { const fmt = p => p ? `${p[1].toFixed(5)}, ${p[0].toFixed(5)}` : '미선택'; return `출발 ${fmt(this.walkStart)} · 도착 ${fmt(this.walkEnd)}`; },
    walkDistanceLabel() { const n = this.walkResult?.distanceMeters; return n == null ? '데이터 없음' : n >= 1000 ? `${(n/1000).toFixed(2)} km` : `${Math.round(n)} m`; },
    walkElevationLabel() { const p=this.walkResult?.profile || []; const valid=p.filter(x => Number.isFinite(x.elevation)); if(valid.length<2) return '데이터 없음'; const n=valid.at(-1).elevation-valid[0].elevation; return `${n >= 0 ? '+' : ''}${n.toFixed(1)} m`; },
    walkSlopeLabel() { const p=this.walkResult?.profile || []; const valid=p.filter(x => Number.isFinite(x.elevation)); const d=this.walkResult?.distanceMeters; if(valid.length<2 || !d) return '데이터 없음'; return `${((valid.at(-1).elevation-valid[0].elevation)/d*100).toFixed(1)}%`; },
    walkSnapLabel() { const r=this.walkResult; return r ? `보행망 연결 거리: 출발 ${r.startSnapMeters.toFixed(1)}m · 도착 ${r.endSnapMeters.toFixed(1)}m` : ''; },
    walkProfilePoints() { const rows=(this.walkResult?.profile || []).filter(p => Number.isFinite(p.elevation)); if(rows.length<2) return ''; const lo=Math.min(...rows.map(x=>x.elevation)), hi=Math.max(...rows.map(x=>x.elevation)); const max=rows.at(-1).distanceMeters || 1; return rows.map(row => `${10+280*row.distanceMeters/max},${70-60*(row.elevation-lo)/(hi-lo || 1)}`).join(' '); },
  };
}
