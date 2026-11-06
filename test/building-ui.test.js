import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingDisplayInfo,createBuildingCard,withBuildingIds,planBuildingLabels} from '../src/building-ui.js';

function rectangle(id,name,x=127,y=37,height=30) {
  return {type:'Feature',geometry:{type:'Polygon',coordinates:[[[x,y],[x+.0001,y],[x+.0001,y+.0001],[x,y+.0001],[x,y]]]},properties:{id,name,height,levels:10,heightSource:'levels',source:'vworld'}};
}
const params={zoom:16,width:500,height:500,bounds:{contains:()=>true},project:([x,y])=>({x:(x-127)*100000+50,y:(y-37)*100000+50})};

test('missing identity is explicit and height estimates stay distinct from stated values',()=>{
  const estimated=buildingDisplayInfo({name:'  정든마을  ',height:30,levels:10,heightSource:'levels',source:'vworld'});
  assert.equal(estimated.title,'정든마을');
  assert.match(estimated.meta,/지상 10층/); assert.match(estimated.meta,/층수 × 3m 추정/);
  assert.equal(buildingDisplayInfo({name:' ',height:null,heightSource:'unknown'}).title,'이름 미등록 건물');
  assert.match(buildingDisplayInfo({height:null,heightSource:'unknown'}).meta,/높이 정보 없음/);
  assert.match(buildingDisplayInfo({height:42,heightSource:'height'}).meta,/OSM 기재 높이/);
  const numeric=buildingDisplayInfo({name:'507',height:61,heightSource:'height'});
  assert.equal(numeric.title,'이름 미등록 건물'); assert.equal(numeric.rawName,'507');
});

test('provider IDs cannot collide, and input source objects remain untouched',()=>{
  const a=rectangle('1','A'), b={...rectangle('1','B'),properties:{...rectangle('1','B').properties,source:'OpenStreetMap'}};
  const result=withBuildingIds([a,b]);
  assert.deepEqual(result.map(f=>f.id),['vworld:1','osm:1']); assert.equal(a.id,undefined);
});

test('building names wait for close zoom and yield to apartment labels',()=>{
  const features=withBuildingIds([rectangle('a','A'),rectangle('b','B',127.003,37)]);
  assert.equal(planBuildingLabels(features,{...params,zoom:15}).length,0);
  const rows=planBuildingLabels(features,params); assert.equal(rows.length,2);
  const reserved=planBuildingLabels(features,{...params,obstacles:[rows.find(r=>r.title==='A').box]});
  assert.deepEqual(reserved.map(r=>r.title),['B']);
});

test('label density is bounded, unnamed and numeric-only footprints are not named',()=>{
  const features=withBuildingIds(Array.from({length:60},(_,i)=>rectangle(String(i),`건물${i}`,127+i*.003,37)));
  const wide={...params,width:30000,project:([x,y])=>({x:(x-127)*100000+50,y:(y-37)*100000+50})};
  assert.equal(planBuildingLabels(features,wide).length,40);
  assert.equal(planBuildingLabels(withBuildingIds([rectangle('x',''),rectangle('y','101'),rectangle('z','  ')]),params).length,0);
});

test('provider text is literal DOM text and attribution details are separate from the title',()=>{
  const make=tag=>({tag,children:[],className:'',classList:{add(){}},appendChild(child){this.children.push(child);},set textContent(value){this.text=String(value);},get textContent(){return this.text;},set innerHTML(_){throw new Error('HTML interpolation is forbidden');}});
  const doc={createElement:make};
  const attack='<img src=x onerror=alert(1)>';
  const card=createBuildingCard({name:attack,height:12,heightSource:'levels',source:'vworld',alternativeMatch:true,alternativeHeight:null},{document:doc,expanded:true});
  assert.equal(card.children[0].tag,'strong'); assert.equal(card.children[0].text,attack);
  assert.equal(card.children[2].tag,'details'); assert.equal(card.children[2].children[0].text,'자료 정보');
  assert.match(card.children[2].children[2].text,/동일 건물 여부/);
  const hover=createBuildingCard({name:'A'},{document:doc});
  assert.equal(hover.children.some(row=>row.tag==='details'),false);
  const numeric=createBuildingCard({name:'507'},{document:doc,expanded:true});
  assert.equal(numeric.children[0].text,'이름 미등록 건물');
  assert.equal(numeric.children[2].children[2].text,'원천 이름 표기: 507');
});
