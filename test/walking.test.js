import test from 'node:test';
import assert from 'node:assert/strict';
import {computeWalkingRoute,findNearestEdge,distanceMeters,enrichWalkingRoute,isWalkingCoverage} from '../src/walking.js';
const graph={source:{label:'OSM test'},nodes:[[127,37.5],[127.001,37.5],[127.002,37.5],[127,37.502],[127.001,37.502]],edges:[[0,1,0],[1,2,0],[3,4,0]]};
test('snaps to edges, routes, samples slope and preserves provenance', async()=>{
 const out=await computeWalkingRoute({graph,start:[127.0005,37.5001],end:[127.0017,37.5001],sampleElevations:async p=>p.map((_,i)=>100+i*3)});
 assert.equal(out.status,'ok');assert.ok(out.startSnapMeters<12);assert.ok(out.endSnapMeters<12);assert.ok(out.distanceMeters>100&&out.distanceMeters<120);assert.equal(out.source.label,'OSM test');assert.ok(out.profile.length>=4);assert.ok(out.elevationGainMeters>0);
});
test('rejects snaps at or beyond 50m and disconnected components',async()=>{
 let r=await computeWalkingRoute({graph,start:[127.0005,37.5006],end:[127.001,37.5]});assert.equal(r.status,'snap_too_far');
 r=await computeWalkingRoute({graph,start:[127.0005,37.5],end:[127.0005,37.502]});assert.equal(r.status,'no_route');
});
test('no fake slope when a DEM tile fails; the network geometry remains available',async()=>{
 const out=await computeWalkingRoute({graph,start:[127.0001,37.5],end:[127.0019,37.5],sampleElevations:async p=>p.map((_,i)=>i===1?null:12)});
 assert.equal(out.status,'elevation_unavailable');assert.ok(out.geometry.length>=2);assert.equal(out.profile.length,0);assert.equal(out.elevationGainMeters,null);
});
test('oneway:foot is respected even for snap points on the same segment',async()=>{
 const g={nodes:[[127,37.5],[127.001,37.5]],edges:[[0,1,1]]};
 const f=await computeWalkingRoute({graph:g,start:[127.0001,37.5],end:[127.0009,37.5],sampleElevations:async p=>p.map(()=>12)});
 const b=await computeWalkingRoute({graph:g,start:[127.0009,37.5],end:[127.0001,37.5]});
 assert.equal(f.status,'ok');assert.equal(b.status,'no_route');
});
test('a midpoint 50m from an edge is not accidentally accepted by edge projection',()=>{
 const g={nodes:[[127,37.5],[127.001,37.5]],edges:[[0,1,0]]};
 const exactly=[127.0005,37.5+50/111320];assert.equal(findNearestEdge(g,exactly),null);
 assert.ok(distanceMeters(g.nodes[0],g.nodes[1])>80);
});
test('coverage guard rejects outside endpoints before loading the pilot graph',()=>{
 assert.equal(isWalkingCoverage([127.1,37.5]),true);
 assert.equal(isWalkingCoverage([126.53,33.5]),false);
 assert.equal(isWalkingCoverage([NaN,37.5]),false);
});
test('worker path can be enriched with real samples without inventing a missing profile',async()=>{
 const raw=await computeWalkingRoute({graph,start:[127.0001,37.5],end:[127.0019,37.5]});
 assert.equal(raw.status,'elevation_unavailable');
 const withElevation=await enrichWalkingRoute(raw,async points=>points.map((_,i)=>50+i));
 assert.equal(withElevation.status,'ok'); assert.ok(withElevation.profile.length>1);
 const failed=await enrichWalkingRoute(raw,async points=>points.map(()=>null));
 assert.equal(failed.status,'elevation_unavailable'); assert.equal(failed.profile.length,0);
});
test('spatial index retains long segments and searches across cell boundaries',()=>{
 const g={nodes:[[126.95,37.5],[127.10,37.5],[127.0001,37.501],[127.0002,37.501]],edges:[[0,1,0],[2,3,0]]};
 assert.equal(findNearestEdge(g,[127,37.5001]).edgeIndex,0);
 assert.equal(findNearestEdge(g,[127.00015,37.5011]).edgeIndex,1);
});
