import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPartialScores} from '../src/scoring.js';

const make = (n, overrides = {}) => ({ code: String(n), kind:'legal', area:'41', source:'official', asOf:'2026-10', period:'2026-08~2026-10', price:1000+n*100, transactions:40+n, sampleCount:35, jeonse:70-n, rentSampleCount:50, jeonseSaleSampleCount:50, ...overrides });
test('separate types, provinces and snapshots; unknown original factors are not zero', () => {
  const legal = Array.from({length:5},(_,i)=>make(i));
  const gu = Array.from({length:5},(_,i)=>make(i,{kind:'gu'}));
  const other = Array.from({length:5},(_,i)=>make(i,{area:'11'}));
  const newer = Array.from({length:5},(_,i)=>make(i,{asOf:'2026-11'}));
  const excluded = make(99,{sampleCount:29});
  const all = [...legal,...gu,...other,...newer,excluded];
  const result = applyPartialScores(all);
  assert.equal(result.scored,20); assert.equal(excluded.score,null);
  for (const group of [legal,gu,other,newer]) {
    assert.equal(group[0].score,63); assert.equal(group[4].score,100);
    assert.equal(group[0].scoreInfo.groupSize,5);
    assert.deepEqual(group[0].scoreInfo.missing.map(x=>x.key),['yoy','gtx']);
    assert.equal(group[0].scoreInfo.includedOriginalWeight,60);
  }
});
test('ties remain tied, stale cached scores cleared, small groups and missing inputs excluded', () => {
  const ties = Array.from({length:5},()=>make(1));
  const insufficient = make(10,{jeonseSaleSampleCount:29,score:98});
  const one = make(20,{area:'42',score:100});
  applyPartialScores([...ties,insufficient,one]);
  assert.deepEqual(new Set(ties.map(r=>r.score)),new Set([100]));
  assert.equal(insufficient.score,null); assert.equal(one.scoreInfo.comparisonScope,'national');
});
test('fallback, fictional, missing source, and incomplete rent samples do not contribute', () => {
  const notEligible = [make(1,{demo:true}), make(2,{isFallback:true}), make(3,{source:null}), make(4,{jeonse:null}), make(5,{rentSampleCount:29})];
  assert.equal(applyPartialScores(notEligible).scored,0);
});

test('eligible legal regions with too few local peers use only the matching nationwide reference', () => {
  const peers = Array.from({length:5},(_,i)=>make(i,{area:'28'}));
  const jeju = [make(5,{area:'50'}),make(6,{area:'50'}),make(7,{area:'50'})];
  const invalid = make(8,{area:'50',sampleCount:29});
  const wrongSnapshot = make(100,{area:'11',asOf:'2026-09'});
  const wrongKind = make(101,{area:'11',kind:'gu'});
  applyPartialScores([...peers,...jeju,invalid,wrongSnapshot,wrongKind]);
  assert.deepEqual(jeju.map(r=>r.scoreInfo.comparisonScope),['national','national','national']);
  assert.ok(jeju.every(r => r.scoreInfo.groupSize === 8));
  assert.equal(peers[0].scoreInfo.comparisonScope,'sido');
  assert.equal(peers[0].scoreInfo.groupSize,5);
  assert.equal(invalid.score,null); assert.equal(wrongSnapshot.score,null); assert.equal(wrongKind.score,null);
});
