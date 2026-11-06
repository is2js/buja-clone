import test from 'node:test';
import assert from 'node:assert/strict';
import {planApartmentLabels} from '../src/scene3d.js';

const apartment=(id,coordinate,households=0) => ({id,name:id,coordinate,area:'11',households,locationVerified:true});
const params={area:'11',bounds:{contains:()=>true},width:440,height:500,zoom:15,project:([x,y])=>({x:(x-126)*1000,y:(y-37)*1000})};

test('same source coordinates remain selectable as a single named group',()=>{
  const a=apartment('A',[126.1,37.1]),b=apartment('B',[126.1,37.1]);
  const rows=planApartmentLabels([a,b],params);
  assert.equal(rows.length,1);
  assert.equal(rows[0].title,'A 외');
  assert.deepEqual(rows[0].point,[126.1,37.1]);
  assert.deepEqual(rows[0].group.map(item=>item.id),['A','B']);
});

test('overlapping names are suppressed in favor of the larger complex and reappear after zooming',()=>{
  const a=apartment('A',[126.1,37.1],10),b=apartment('B',[126.105,37.1],100);
  assert.deepEqual(planApartmentLabels([a,b],params).map(row=>row.title),['B']);
  const spread={...params,project:([x,y])=>({x:(x-126.1)*20000+100,y:(y-37)*1000})};
  assert.deepEqual(planApartmentLabels([a,b],spread).map(row=>row.title),['B','A']);
});

test('wide view, invalid coordinates and other areas do not produce labels',()=>{
  assert.equal(planApartmentLabels([apartment('A',[126.1,37.1])],{...params,zoom:13}).length,0);
  assert.equal(planApartmentLabels([{...apartment('A',[126.1,37.1]),area:'41'},apartment('B',[NaN,1])],params).length,0);
});
