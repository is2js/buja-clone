import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSceneFeatures} from '../src/scene3d.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const snapshot=read('gtx-public.json'),references=read('gtx-coordinates.json').coordinates;
const routes=snapshot.routes.map(route=>({...route,stations:route.stations.map(station=>({...station,...(!station.coordinate && references[station.id] ? references[station.id] : {})}))}));

test('GTX coverage distinguishes mapped reference points from an unverified actual route',()=>{
  assert.deepEqual(routes.map(route=>route.stations.filter(station=>Array.isArray(station.coordinate)).length),[7,13,14,0,0,0]);
  assert.deepEqual(routes[0].coverage.missingCoordinates,['운정중앙','킨텍스','창릉','동탄']);
  assert.deepEqual(routes[1].coverage.missingCoordinates,['왕숙']);
  for(const route of routes) {
    assert.equal(route.coverage.routeGeometryVerified,false);
    assert.equal(new Set(route.stations.map(station=>station.id)).size,route.stations.length);
    for(const segment of route.segments) {
      assert.ok(route.stations.some(station=>station.id===segment.from));
      assert.ok(route.stations.some(station=>station.id===segment.to));
    }
  }
});

test('new existing-station references retain station-line identities and licensed source hashes',()=>{
  const additions=Object.values(references).filter(item=>item.coordinateSource?.url==='https://www.data.go.kr/data/15013205/standard.do');
  assert.equal(additions.length,14);
  for(const item of additions) {
    assert.equal(item.coordinateKind,'existing-transfer-reference');
    assert.match(item.sourceStationCode,/^\d+$/);
    assert.ok(item.sourceLineCode);
    assert.match(item.coordinateSource.sha256,/^[a-f0-9]{64}$/);
    assert.equal(item.coordinateSource.asOf,'2025-04-08');
    assert.ok(item.coordinateSource.downloadUrl.startsWith('https://openapi.kric.go.kr/'));
    assert.ok(item.coordinate.every(Number.isFinite));
    assert.ok(item.coordinate[0]>124 && item.coordinate[0]<132 && item.coordinate[1]>32 && item.coordinate[1]<39);
  }
});

test('B construction and C planned construction remain separate from operation',()=>{
  const b=routes.find(route=>route.id==='B'),c=routes.find(route=>route.id==='C');
  assert.ok(b.segments.every(segment=>segment.status==='공사 중' && segment.source.asOf==='2026-09'));
  assert.ok(c.status.includes('착공 예정'));
  assert.ok(c.segments.every(segment=>segment.status!=='운행'));
  for(const route of routes.filter(route=>['D','E','F'].includes(route.id))) assert.equal(route.segments.length,0);
});

test('A operating schematic uses a sourced Daegok-Yeonsinnae interval without inventing Changneung',()=>{
  const a=routes.find(route=>route.id==='A');
  assert.ok(a.segments.filter(segment=>segment.from==='A-서울역' || segment.from==='A-삼성').every(segment=>segment.status==='미상'));
  const connection=a.segments.find(segment=>segment.from==='A-대곡' && segment.to==='A-연신내');
  assert.equal(connection.status,'운행');
  assert.ok(connection.source.url.startsWith('https://cppr.koti.re.kr/'));
  assert.equal(a.stations.find(station=>station.id==='A-창릉').coordinate,null);
  const features=buildSceneFeatures({data:{geo:{gu:{},dong:{}},regions:{},routes:[a]},area:'11'}).gtxFeatures.features;
  assert.ok(!features.some(feature=>feature.properties.kind==='station' && feature.properties.name==='창릉'));
  assert.ok(features.some(feature=>feature.geometry.type==='LineString' && feature.properties.status==='운행'));
});
