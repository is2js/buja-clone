import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingFocusCamera} from '../src/building-focus.js';

test('building action zooms the current city without changing its geographic center',()=>{
  for(const center of [[126.978,37.5665],[127.127,37.4065],[129.174,35.171]]) {
    const original={center,zoom:9};
    const target=buildingFocusCamera(original);
    assert.deepEqual(target.center,center);
    assert.notEqual(target.center,center);
    assert.equal(target.zoom,15.5);
    assert.equal(original.zoom,9);
  }
});

test('already close views keep their scale unless a wide viewport requires another zoom step',()=>{
  const view={center:[127,37],zoom:16};
  assert.equal(buildingFocusCamera(view).zoom,16);
  assert.equal(buildingFocusCamera(view,true).zoom,17);
  assert.equal(buildingFocusCamera({...view,zoom:20},true).zoom,20);
  assert.equal(buildingFocusCamera({center:[NaN,37],zoom:9}),null);
});
