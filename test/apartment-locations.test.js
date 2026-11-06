import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load = file => JSON.parse(readFileSync(new URL(`../public/data/real/apartments/${file}`, import.meta.url), 'utf8'));
const norm = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
test('official snapshots preserve every distinct source ID and leave out-of-range locations empty', () => {
  for (const file of ['seoul-locations.json', 'hanam-locations.json', 'dalseo-locations.json', 'gwangsan-locations.json']) {
    const data=load(file), ids=new Set();
    for (const item of data.items) {
      assert.ok(!ids.has(item.id)); ids.add(item.id);
      assert.ok(!('phone' in item) && !('fax' in item));
      if (item.locationVerified) {
        assert.ok(Array.isArray(item.coordinate) && item.coordinate.length===2);
        assert.ok(item.coordinate[0]>126 && item.coordinate[0]<130 && item.coordinate[1]>33 && item.coordinate[1]<39);
        assert.match(item.locationQuality,/미검증/);
      } else assert.equal(item.coordinate,null);
    }
  }
});
test('Seoul cross-source links require unique name and full road address on both sides', () => {
  const data=load('seoul-locations.json').items, national=load('11.json').items;
  const key=(name,address)=>`${norm(name)}|${norm(address)}`;
  const nationalById=new Map(national.map(item=>[item.id,item]));
  const countA=new Map(),countB=new Map();
  for(const a of data) if(a.roadAddress) {const k=key(a.name,a.roadAddress);countA.set(k,(countA.get(k)||0)+1);}
  for(const b of national) if(b.roadAddress) {const prefix=b.address.split(' ').slice(0,2).join(' '); const road=b.roadAddress.startsWith('서울특별시 ')?b.roadAddress:`${prefix} ${b.roadAddress}`;const k=key(b.name,road);countB.set(k,(countB.get(k)||0)+1);}
  for(const a of data.filter(item=>item.nationalId)) {
    const b=nationalById.get(a.nationalId);assert.ok(b);
    const k=key(a.name,a.roadAddress);assert.equal(countA.get(k),1);assert.equal(countB.get(k),1);
  }
});
test('duplicate official coordinates remain distinct records and marked as duplicates', () => {
  for(const file of ['seoul-locations.json','hanam-locations.json','dalseo-locations.json','gwangsan-locations.json']) {
    const data=load(file), groups=new Map();
    for(const item of data.items) if(item.coordinate) {const key=item.coordinate.map(x=>x.toFixed(6)).join(',');groups.set(key,(groups.get(key)||0)+1);}
    for(const item of data.items) if(item.coordinate) assert.equal(item.duplicateCoordinate,groups.get(item.coordinate.map(x=>x.toFixed(6)).join(','))>1);
  }
});

test('Dalseo links only unambiguous name and full road address matches', () => {
  const data=load('dalseo-locations.json').items, national=load('27.json').items;
  const key=(name,address)=>`${norm(name)}|${norm(address)}`;
  const nationalById=new Map(national.map(item=>[item.id,item]));
  const countA=new Map(),countB=new Map();
  for(const a of data) if(a.roadAddress) {const k=key(a.name,a.roadAddress);countA.set(k,(countA.get(k)||0)+1);}
  for(const b of national) if(b.roadAddress) {const prefix=b.address.split(' ').slice(0,2).join(' ');const road=b.roadAddress.startsWith('대구광역시 ')?b.roadAddress:`${prefix} ${b.roadAddress}`;const k=key(b.name,road);countB.set(k,(countB.get(k)||0)+1);}
  for(const a of data.filter(item=>item.nationalId)) {const b=nationalById.get(a.nationalId);assert.ok(b);const k=key(a.name,a.roadAddress);assert.equal(countA.get(k),1);assert.equal(countB.get(k),1);}
});
