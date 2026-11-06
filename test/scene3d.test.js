import test from 'node:test';
import assert from 'node:assert/strict';
import {svgPathToGeometry, svgViewToCamera, cameraToSvgView, buildSceneFeatures,provinceAtCoordinate} from '../src/scene3d.js';

test('SVG absolute and relative rings preserve polygon holes and separate islands', () => {
  const path='M0,0l10,0l0,10l-10,0z M2,2L4,2L4,4L2,4Z M20,20l2,0l0,2l-2,0z';
  const g=svgPathToGeometry(path);
  assert.equal(g.type,'MultiPolygon');
  assert.deepEqual(g.coordinates.map(p=>p.length),[2,1]);
  for (const polygon of g.coordinates) for (const ring of polygon) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0],ring.at(-1));
    assert.ok(ring.every(pair=>pair.every(Number.isFinite)));
  }
});

test('2D and 3D camera conversion preserves the center and width', () => {
  const view={x:1234,y:987,w:120};
  const camera=svgViewToCamera(view,390), result=cameraToSvgView(camera.center,camera.zoom,390);
  for (const key of ['x','y','w']) assert.ok(Math.abs(view[key]-result[key])<1e-8);
});

test('GTX map features never bridge a segment without verified endpoints', () => {
  const data={geo:{gu:{},dong:{}},regions:{},routes:[{color:'#ff0000',stations:[{id:'a',coordinate:[127,37]},{id:'b',coordinate:null},{id:'c',coordinate:[127.1,37.1]}],segments:[{from:'a',to:'b',status:'계획'},{from:'b',to:'c',status:'계획'}]}]};
  const g=buildSceneFeatures({data,area:'11'}).gtxFeatures;
  assert.equal(g.features.filter(f=>f.geometry.type==='LineString').length,0);
  assert.equal(g.features.filter(f=>f.geometry.type==='Point').length,2);
});

test('province warning detects polygon containment, holes and unknown positions without guessing',()=>{
  const geo={gu:{a:{s:'11',b:[0,0,10,10],d:'M0,0L10,0L10,10L0,10Z M2,2L4,2L4,4L2,4Z'},b:{s:'41',b:[20,0,10,10],d:'M20,0L30,0L30,10L20,10Z'}}};
  const at=(x,y)=>svgViewToCamera({x:x-1,y:y-1.3,w:2},440).center;
  assert.equal(provinceAtCoordinate(geo,at(1,1)),'11');
  assert.equal(provinceAtCoordinate(geo,at(3,3)),null);
  assert.equal(provinceAtCoordinate(geo,at(25,5)),'41');
  assert.equal(provinceAtCoordinate(geo,at(15,5)),null);
});
