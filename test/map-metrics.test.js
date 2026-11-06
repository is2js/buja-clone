import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetricScale,SEQUENTIAL,DIVERGING,MISSING} from '../src/map-metrics.js';
const make = (metric, value, extra={}) => ({area:'41', kind:'legal', [metric]:value, ...extra});

test('quintiles are relative to the active area and geography; nulls are not zero', () => {
  const rows = [1,2,3,4,5].map(v => make('price',v,{sampleCount:30}));
  const outlier = make('price',999,{area:'11'}), wrongKind = make('price',999,{kind:'dong'}), missing = make('price',null);
  const s = createMetricScale({metric:'price', regions:[...rows,outlier,wrongKind,missing],area:'41',kind:'legal'});
  assert.deepEqual(s.cuts,[1,2,3,4]);
  assert.deepEqual(rows.map(s.color),SEQUENTIAL);
  assert.equal(s.color(outlier),MISSING); assert.equal(s.color(wrongKind),MISSING); assert.equal(s.color(missing),MISSING);
});

test('price map excludes insufficient or missing samples from both thresholds and color', () => {
  const valid=[100,200,300,400,500].map(v=>make('price',v,{sampleCount:30}));
  const low=make('price',10000,{sampleCount:6}), unknown=make('price',10001);
  const scale=createMetricScale({metric:'price',regions:[...valid,low,unknown],area:'41',kind:'legal'});
  assert.deepEqual(scale.cuts,[100,200,300,400]);
  assert.equal(scale.color(low),MISSING); assert.equal(scale.color(unknown),MISSING);
  assert.equal(scale.color(valid[4]),SEQUENTIAL[4]);
  assert.match(scale.note,/30건 이상/);
});

test('percentage thresholds and legend swatches describe the exact same colors', () => {
  const s = createMetricScale({metric:'change3', regions:[],area:'41',kind:'legal'});
  assert.deepEqual([-5,-2,0,2,5].map(v => s.color(make('change3',v))),DIVERGING);
  assert.deepEqual(s.swatches,DIVERGING); assert.equal(s.lo,'−4%'); assert.equal(s.hi,'+4%');
  const rent = createMetricScale({metric:'jeonse',regions:[],area:'41',kind:'legal'});
  assert.equal(rent.color(make('jeonse',80)),DIVERGING[4]); assert.equal(rent.swatches[4],DIVERGING[4]);
});

test('partial scores from distinct source snapshots are never put on the same scale', () => {
  const inf = (period) => ({source:'official',asOf:'2026-10',period});
  const first = [1,2,3,4,5].map(v => make('score',63+v,{scoreInfo:inf('2026-08~10')}));
  const older = make('score',99,{scoreInfo:inf('2026-05~07')});
  const s = createMetricScale({metric:'score',regions:[...first,older],area:'41',kind:'legal'});
  assert.notEqual(s.color(first[0]),MISSING); assert.equal(s.color(older),MISSING);
  assert.equal(s.note.includes('부분 점수'),true);
});

test('national comparison uses national rank intervals rather than re-ranking a few local scores', () => {
  const info = {source:'official',asOf:'2026-10',period:'2026-08~10',comparisonScope:'national'};
  const rows = [64,65,66].map(v => make('score',v,{area:'50',scoreInfo:info}));
  const s = createMetricScale({metric:'score',regions:rows,area:'50',kind:'legal'});
  assert.deepEqual(rows.map(s.color),[SEQUENTIAL[0],SEQUENTIAL[0],SEQUENTIAL[0]]);
  assert.equal(s.lo,'63점'); assert.equal(s.hi,'100점'); assert.match(s.note,/전국 비교/);
  const local = make('score',66,{area:'50',scoreInfo:{...info,comparisonScope:'sido'}});
  assert.equal(s.color(local),MISSING);
});
