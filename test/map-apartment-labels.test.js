import test from 'node:test';
import assert from 'node:assert/strict';
import { apartmentsMarkup, createMapController, mapProjection } from '../src/map.js';
const [x,y] = mapProjection.toXY(127,37.5);
const view = {x:x-10,y:y-13,w:20};
const apartment = (id,coordinate=[127,37.5]) => ({id,area:'11',name:`단지${id}`,coordinate,locationVerified:true});

test('neighborhood labels replace numbered markers and keep coincident locations together', () => {
  const result=apartmentsMarkup([apartment('A'),apartment('B')],'11',view);
  assert.match(result.markup,/단지A 외/);
  assert.doesNotMatch(result.markup,/<circle|map-apartment-count/);
  assert.deepEqual(result.groups['0'].map(a=>a.id),['A','B']);
  assert.equal(apartmentsMarkup([apartment('A')],'11',{...view,w:161}).markup,'');
});

test('same-coordinate group opens a selection list without a pointless zoom', () => {
  const items=[apartment('A'),apartment('B')], component=createMapController();
  component.mapView=view; component.mapApartmentGroups={'0':items};
  component.onMapClick({target:{closest:selector=>selector==='[data-apartment-group]' ? {dataset:{apartmentGroup:'0'}} : null}});
  assert.equal(component.selectedApartmentGroup,items);
  assert.equal(component.mapView,view);
});
