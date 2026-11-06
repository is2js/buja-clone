import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapController,selectedMapRegion,hasMapSelectionScore,mapRegionActionLabel} from '../src/map.js';

const district={code:'41135',name:'성남시 분당구',kind:'gu',area:'41'};
const dong={code:'legal:4113511300',name:'동원동',kind:'legal',area:'41',guCode:'41135',bbox:[20,30,4,6],path:'M20,30L24,30L24,36L20,36Z',score:95,scoreInfo:{label:'부분 점수'}};
function component() {
  const app=createMapController();
  Object.assign(app,{area:'41',boundaryMode:'legal',selectedGu:'',selectedDong:'',selectedCity:'',selectedRegion:{old:true},selectedApartment:{old:true},mapDimensions:{width:440,height:572},mapView:{x:0,y:0,w:400},
    data:{regions:{'41135':district},legalByCode:{[dong.code]:dong},geo:{sido:{'41':{b:[0,0,400,400]}},gu:{'41135':{b:[10,10,100,100]}},dong:{}}},
    renderMap(){},clearCategoryDetails(){this.selectedRegion=null;this.selectedApartment=null;this.selectedApartmentGroup=null;this.legalWarning='';},
    openRegion(){throw new Error('Map selection must not open details');},$nextTick(callback){callback();},
  });
  return app;
}

test('map dong selection focuses the complete dong before an explicit information action',()=>{
  const app=component();
  app.selectMapRegion(dong);
  assert.equal(app.selectedRegion,null);
  assert.equal(app.selectedApartment,null);
  assert.equal(app.selectedDong,dong.code);
  assert.equal(app.selectedGu,'41135');
  assert.equal(app.selectedCity,'4113');
  assert.ok(app.mapView.w<10);
  assert.equal(selectedMapRegion(app.data,app.selectedDong,app.selectedGu),dong);
  app.selectMapRegion(dong);
  assert.equal(app.selectedRegion,null);
  assert.equal(app.selectedDong,dong.code);
});

test('district selection and a later map dong click never open a score sheet',()=>{
  const app=component();app.selectMapRegion(district);
  assert.equal(app.selectedGu,district.code);assert.equal(app.selectedDong,'');assert.equal(app.selectedRegion,null);
  app.onMapClick({target:{closest:selector=>selector==='[data-code], [data-sido]'?{dataset:{code:dong.code}}:null}});
  assert.equal(app.selectedDong,dong.code);assert.equal(app.selectedRegion,null);
});

test('a missing legal boundary keeps the selected dong and its warning without a popup',()=>{
  const app=component(),missing={...dong,path:null,bbox:null};app.data.legalByCode[dong.code]=missing;
  app.selectMapRegion(missing);
  assert.equal(app.selectedDong,dong.code);assert.equal(app.selectedRegion,null);
  assert.match(app.legalWarning,/동원동.*상위 지역/);
  assert.ok(app.mapView.w>100);
});

test('administrative dong and cross-province selection synchronize the category and viewport only',()=>{
  const app=component(),admin={code:'1111051500',name:'청운효자동',kind:'dong',area:'11',guCode:'11110'};
  app.data.geo.gu['11110']={b:[100,100,20,20]};
  app.data.geo.dong[admin.code]={g:'11110',d:'M100,100L105,100L105,106L100,106Z'};
  app.data.regions[admin.code]=admin;
  app.selectMapRegion(admin);
  assert.equal(app.area,'11');assert.equal(app.boundaryMode,'admin');assert.equal(app.selectedDong,admin.code);
  assert.equal(app.selectedGu,'11110');assert.equal(app.selectedCity,'');assert.equal(app.selectedRegion,null);
});

test('explicit action distinguishes available partial scores and missing/public data',()=>{
  assert.equal(mapRegionActionLabel(dong),'동원동 부분 점수·정보 보기');
  const missing={...dong,score:null,scoreInfo:null};
  assert.equal(hasMapSelectionScore(missing),false);
  assert.equal(mapRegionActionLabel(missing),'동원동 정보 보기');
  assert.equal(hasMapSelectionScore({...dong,scoreInfo:null}),false);
  assert.equal(selectedMapRegion({},'',null),null);
});

test('GTX station clicks retain station detail and do not select a region',()=>{
  const app=component(),station={id:'A-test',name:'역'},route={id:'A',stations:[station]};app.data.routes=[route];
  app.onMapClick({target:{closest:selector=>selector==='[data-gtx-station]'?{dataset:{gtxRoute:'A',gtxStation:'A-test'}}:null}});
  assert.deepEqual(app.selectedGtx,{route,station});assert.equal(app.selectedDong,'');
});
