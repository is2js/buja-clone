/**
 * Reference-inspired relative score using only the three independently verified
 * indicators currently available. A score is not the original five-factor score.
 * Scores are comparable only within the same area, geography type and snapshot.
 */
export const PARTIAL_SCORE_VERSION = 'buja-partial-v1';
export const PARTIAL_SCORE_MIN_SAMPLE = 30;
export const PARTIAL_SCORE_MIN_PEERS = 5;
const factors = [
  { key: 'price', label: '아파트 시세', originalWeight: 40, high: true, unit: '만원/3.3㎡' },
  { key: 'transactions', label: '3개월 거래량', originalWeight: 10, high: true, unit: '건' },
  { key: 'jeonse', label: '전세가율', originalWeight: 10, high: false, unit: '%' },
];
const missing = [
  { key: 'yoy', label: '1년 가격 흐름', originalWeight: 25, reason: '이 점수 버전에서는 전년 동기 비교를 반영하지 않음' },
  { key: 'gtx', label: 'GTX', originalWeight: 15, reason: '이 점수 버전에서는 지역별 역 연결을 반영하지 않음' },
];
const isFiniteNumber = value => value != null && Number.isFinite(Number(value));

function eligibility(r) {
  if (!['gu', 'legal', 'dong'].includes(r?.kind) || !r.area || !r.source || !r.asOf || !r.period) return false;
  if (r.demo || r.isFallback || r.scoreComparable === false) return false;
  if (!isFiniteNumber(r.price) || Number(r.price) <= 0 || (Number(r.sampleCount) || 0) < PARTIAL_SCORE_MIN_SAMPLE) return false;
  if (!isFiniteNumber(r.transactions) || Number(r.transactions) < PARTIAL_SCORE_MIN_SAMPLE) return false;
  if (!isFiniteNumber(r.jeonse) || Number(r.jeonse) <= 0) return false;
  return (Number(r.rentSampleCount) || 0) >= PARTIAL_SCORE_MIN_SAMPLE &&
    (Number(r.jeonseSaleSampleCount) || 0) >= PARTIAL_SCORE_MIN_SAMPLE;
}
function percentile(sorted, value) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const middle = (lo + hi) >> 1; if (sorted[middle] < value) lo = middle + 1; else hi = middle; }
  let end = lo;
  while (end < sorted.length && sorted[end] === value) end++;
  return sorted.length > 1 ? (lo + (end - lo - 1) / 2) / (sorted.length - 1) : 1;
}
const groupKey = r => JSON.stringify([r.area, r.kind, r.source, r.asOf, r.period]);
const round2 = n => Math.round(n * 100) / 100;

/**
 * Mutates region.score and region.scoreInfo; call after all real stats are merged.
 * `regions` must contain only one record per typed region, preferably
 * [...data.regionList, ...data.legalRegions]. All absent/unqualified scores stay null.
 * Returns scored and excluded counts for diagnostics.
 */
export function applyPartialScores(regions) {
  const groups = new Map();
  for (const r of regions) {
    r.score = null;
    r.scoreInfo = null;
    if (!eligibility(r)) continue;
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // A nationwide pool is used only when an eligible legal-dong cohort has
  // fewer than five peers in its own province. The source and period must match.
  const nationwide = new Map();
  for (const group of groups.values()) for (const r of group) {
    if (r.kind !== 'legal') continue;
    const key = JSON.stringify([r.kind, r.source, r.asOf, r.period]);
    if (!nationwide.has(key)) nationwide.set(key, []);
    nationwide.get(key).push(r);
  }
  let scored = 0;
  function scoreGroup(reference, targets, scope) {
    const values = Object.fromEntries(factors.map(f => [f.key, reference.map(r => Number(r[f.key])).sort((a,b) => a-b)]));
    const totalWeight = factors.reduce((sum, f) => sum + f.originalWeight, 0);
    const rows = reference.map(region => {
      const parts = factors.map(f => {
        const value = Number(region[f.key]);
        const pct = percentile(values[f.key], value);
        return { ...f, value, percentile: Math.round((f.high ? pct : 1 - pct) * 100), effectiveWeight: f.originalWeight / totalWeight };
      });
      return { region, parts, total: parts.reduce((sum,p) => sum + p.percentile * p.originalWeight, 0) / totalWeight };
    }).sort((a,b) => b.total - a.total);
    const targetSet = new Set(targets);
    let first = 0;
    rows.forEach((row,index) => {
      if (index > 0 && Math.abs(row.total - rows[index - 1].total) > 1e-9) first = index;
      if (!targetSet.has(row.region)) return;
      const top = (rows.length - 1 - first) / (rows.length - 1);
      row.region.score = round2(63 + 37 * top);
      row.region.scoreInfo = {
        version: PARTIAL_SCORE_VERSION,
        label: scope === 'national' ? '전국 비교 부분 점수' : '부분 점수',
        comparisonScope: scope,
        comparisonLabel: scope === 'national' ? '전국 법정동' : '같은 시도·지역 유형',
        score: row.region.score,
        total: round2(row.total),
        rank: first + 1,
        groupSize: rows.length,
        area: row.region.area,
        kind: row.region.kind,
        source: row.region.source,
        asOf: row.region.asOf,
        period: row.region.period,
        parts: row.parts,
        missing: missing.map(item => ({...item})),
        includedOriginalWeight: totalWeight,
        originalWeight: 100,
        sampleCount: Number(row.region.sampleCount),
        rentSampleCount: Number(row.region.rentSampleCount),
        jeonseSaleSampleCount: Number(row.region.jeonseSaleSampleCount),
      };
      scored++;
    });
  }
  for (const group of groups.values()) {
    if (group.length >= PARTIAL_SCORE_MIN_PEERS) {
      scoreGroup(group, group, 'sido');
    } else if (group[0].kind === 'legal') {
      const r = group[0];
      const reference = nationwide.get(JSON.stringify([r.kind, r.source, r.asOf, r.period])) || [];
      if (reference.length >= PARTIAL_SCORE_MIN_PEERS) scoreGroup(reference, group, 'national');
    }
  }
  return { scored, excluded: regions.length - scored, groups: groups.size, version: PARTIAL_SCORE_VERSION };
}
