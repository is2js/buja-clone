import test from 'node:test';
import assert from 'node:assert/strict';
import {planVWorldBuildingTiles, vworldBuildingsAvailable, loadVWorldBuildings} from '../src/vworld-buildings.js';

test('small view is divided into bounded aligned tiles and excessive views are rejected',()=>{
  const tiles=planVWorldBuildingTiles([127.126,37.406,127.129,37.409]);
  assert.equal(tiles.length,1); assert.deepEqual(tiles[0],{west:127.125,south:37.405,east:127.13,north:37.41});
  assert.deepEqual(planVWorldBuildingTiles([127,37,127.2,37.2]),[]);
  assert.deepEqual(planVWorldBuildingTiles([126,37,125,38]),[]);
});

test('status is fetched only on localhost and requires a valid enabled JSON response',async()=>{
  let called=0; const fetcher=async()=>{called++;return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({enabled:true,wfs:true})};};
  assert.equal(await vworldBuildingsAvailable({fetcher,hostname:'example.com'}),false); assert.equal(called,0);
  assert.equal(await vworldBuildingsAvailable({fetcher,hostname:'127.0.0.1'}),true); assert.equal(called,1);
});

test('tiles deduplicate repeated buildings and report incomplete results without inventing heights',async()=>{
  let active=0,peak=0,calls=0;
  const fetcher=async()=>{const i=calls++;active++;peak=Math.max(active,peak);await Promise.resolve();active--;
    if(i===1) return {ok:false,headers:{get:()=>''}};
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({type:'FeatureCollection',metadata:{truncated:i===0,missingHeight:2,received:4},features:[
      {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{id:'id1',height:30,heightSource:'levels',source:'vworld'}},
      {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{id:'bad',height:0,heightSource:'levels',source:'vworld'}}]})};};
  const result=await loadVWorldBuildings([127.126,37.406,127.134,37.414],{fetcher});
  assert.equal(result.features.length,1); assert.equal(result.metadata.failedTiles,1); assert.equal(result.metadata.truncated,false); assert.equal(peak<=4,true); assert.equal(calls,8);
});

test('retains unknown height footprints and flags dense tiles if bounded splitting still truncates',async()=>{
  let calls=0;
  const fetcher=async()=>{ calls++; return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({type:'FeatureCollection',metadata:{truncated:true,received:500},features:[
    {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{id:'flat',height:null,heightSource:'unknown',source:'vworld'}}]})}; };
  const result=await loadVWorldBuildings([127.126,37.406,127.129,37.409],{fetcher});
  assert.equal(calls,21); assert.equal(result.metadata.truncated,true); assert.equal(result.metadata.missingHeight,1);
  assert.equal(result.features.length,1); assert.equal(result.features[0].properties.height,null);
});

test('only complete tiles are reused in the short-lived memory cache',async()=>{
  const original=globalThis.fetch; let calls=0, partial=false;
  globalThis.fetch=async()=>{calls++;return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({type:'FeatureCollection',metadata:{truncated:partial},features:[]})};};
  try {
    const bounds=[127.181,37.181,127.182,37.182];
    await loadVWorldBuildings(bounds); await loadVWorldBuildings(bounds); assert.equal(calls,1);
    calls=0; partial=true;
    const other=[127.191,37.191,127.192,37.192];
    await loadVWorldBuildings(other); await loadVWorldBuildings(other); assert.equal(calls,42);
  } finally { globalThis.fetch=original; }
});
