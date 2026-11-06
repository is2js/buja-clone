import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleBuildingTiles, loadBuildingTile } from '../src/building-data.js';

test('visible tiles include the extra centroid tile, but not remote tiles', () => {
  const manifest={tileSize:.02, tiles:[
    {id:'adjacent',bounds:[127.02,37.50,127.04,37.52]},
    {id:'remote',bounds:[127.10,37.50,127.12,37.52]},
  ]};
  assert.deepEqual(visibleBuildingTiles(manifest,[127,37.50,127.01,37.51]).map(t=>t.id),['adjacent']);
});

test('tiles reject malformed IDs and exclude missing/unknown heights', async () => {
  const originalFetch=globalThis.fetch;
  try {
    await assert.rejects(loadBuildingTile({id:'../../secret'}));
    globalThis.fetch=async()=>({ok:true,json:async()=>({type:'FeatureCollection',features:[
      {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{height:18,heightSource:'levels'}},
      {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{height:null,heightSource:'height'}},
      {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{height:9,heightSource:'unknown'}},
    ]})});
    const features=await loadBuildingTile({id:'test_tile'});
    assert.equal(features.length,1);
    assert.equal(features[0].properties.height,18);
  } finally { globalThis.fetch=originalFetch; }
});


test('national tiles south and west of the preserved origin remain selectable and loadable', async () => {
  const manifest = {tileSize:.02, tiles:[{id:'-13_-196',bounds:[126.49,33.48,126.51,33.50]}]};
  assert.deepEqual(visibleBuildingTiles(manifest,[126.49,33.48,126.50,33.49]).map(tile => tile.id),['-13_-196']);
  const originalFetch=globalThis.fetch;
  try {
    let requested='';
    globalThis.fetch=async url => {requested=String(url); return {ok:true,json:async()=>({type:'FeatureCollection',features:[]})};};
    assert.deepEqual(await loadBuildingTile(manifest.tiles[0]),[]);
    assert.ok(requested.endsWith('/data/buildings/tiles/-13_-196.json'));
  } finally { globalThis.fetch=originalFetch; }
});

test('versioned tile sets use immutable paths and cache independently of legacy tiles', async () => {
  const originalFetch=globalThis.fetch, requested=[];
  try {
    globalThis.fetch=async url => {requested.push(String(url)); return {ok:true,json:async()=>({type:'FeatureCollection',features:[]})};};
    await loadBuildingTile({id:'test_atomic',tileSet:'buildings-a1'});
    await loadBuildingTile({id:'test_atomic',tileSet:'buildings-b2'});
    await loadBuildingTile({id:'test_atomic'});
    assert.ok(requested[0].endsWith('/data/buildings/versions/buildings-a1/tiles/test_atomic.json'));
    assert.ok(requested[1].endsWith('/data/buildings/versions/buildings-b2/tiles/test_atomic.json'));
    assert.ok(requested[2].endsWith('/data/buildings/tiles/test_atomic.json'));
    await assert.rejects(loadBuildingTile({id:'test_atomic',tileSet:'../../secret'}));
  } finally { globalThis.fetch=originalFetch; }
});
