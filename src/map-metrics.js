/**
 * Map color scale derived from the original visual language.
 * The caller supplies the active area and geographic type; mixed geography
 * or different partial-score cohorts must never share one visual ranking.
 */
export const SEQUENTIAL = Object.freeze(['#e1e8f3', '#b9cae6', '#85a2d3', '#4f74b6', '#22447f']);
export const DIVERGING = Object.freeze(['#2c66d0', '#8babe5', '#e9edf2', '#e69393', '#d23b3b']);
export const MISSING = '#dde2e9';
export const MIN_PRICE_SAMPLES = 30;
export const hasComparablePrice = r => r?.price != null && Number.isFinite(Number(r.price)) && Number(r.price) > 0 && r.sampleCount != null && Number.isFinite(Number(r.sampleCount)) && Number(r.sampleCount) >= MIN_PRICE_SAMPLES;

const text = {
  score: {kind:'q', lo:'낮음', hi:'높음', note:'부분 점수 · 같은 시도·지역 유형·자료 기준 안의 5단계'},
  price: {kind:'q', lo:'낮음', hi:'높음', note:'아파트 3.3㎡당 실거래 중앙값 · 표본 30건 이상 · 같은 시도·지역 유형 안의 5단계'},
  transactions: {kind:'q', lo:'적음', hi:'많음', note:'최근 3개월 아파트 매매 건수 · 같은 시도·지역 유형 안의 5단계'},
  change1: {kind:'div', thresholds:[0.5,2], note:'아파트 거래 중앙값 변화 · 단지·면적 구성 차이 포함 · 지난달과 그 전달'},
  change3: {kind:'div', thresholds:[1,4], note:'아파트 거래 중앙값 변화 · 단지·면적 구성 차이 포함 · 최근 3개월과 이전 3개월'},
  change6: {kind:'div', thresholds:[2,6], note:'아파트 거래 중앙값 변화 · 단지·면적 구성 차이 포함 · 최근 6개월과 이전 6개월'},
  yoy: {kind:'div', thresholds:[1,5], note:'아파트 최근 3개월과 1년 전 같은 기간 비교'},
  jeonse: {kind:'risk', lo:'50% 미만', hi:'80% 이상', note:'전세가율 · 높을수록 빨강'},
  peak: {kind:'peak', lo:'−5% 넘게 하락', hi:'최고가 근처', note:'최고가 대비 · 데이터 확보 시 표시'},
};
const finite = v => v != null && Number.isFinite(Number(v));
const scoreKey = r => {
  const i = r?.scoreInfo;
  return i ? JSON.stringify([i.source, i.asOf, i.period, i.comparisonScope || 'sido']) : '';
};

/**
 * createMetricScale({metric, regions, area, kind, scoreCohort?})
 * regions is an array or a code-keyed object. kind = 'legal' or 'dong'.
 * Returns {color(region), swatches, lo, hi, note, cuts, scoreCohort}.
 * The same score cohort should be used by the neighboring score ranking.
 */
export function createMetricScale({metric, regions, area, kind, scoreCohort} = {}) {
  metric = text[metric] ? metric : 'score';
  const spec = text[metric];
  const pool = (Array.isArray(regions) ? regions : Object.values(regions || {}))
    .filter(r => r && (!area || r.area === area) && (!kind || r.kind === kind) && !r.demo);

  let cohort = scoreCohort || '';
  if (metric === 'score' && !cohort) {
    const counts = new Map();
    for (const region of pool) if (finite(region.score)) {
      const key = scoreKey(region);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    cohort = [...counts].sort((a,b) => b[1] - a[1])[0]?.[0] || '';
  }
  const values = pool.filter(r => finite(r[metric]) && (metric !== 'price' || hasComparablePrice(r)) && (metric !== 'score' || (cohort && scoreKey(r) === cohort)))
    .map(r => Number(r[metric])).sort((a,b) => a-b);
  const national = metric === 'score' && pool.some(r => scoreKey(r) === cohort && r.scoreInfo?.comparisonScope === 'national');
  // National scores already encode nationwide rank over 63–100; splitting the
  // few visible local values again would misrepresent their national standing.
  const cuts = national ? [0.2,0.4,0.6,0.8].map(v => 63 + 37 * v) : spec.kind === 'q' && values.length ? [0.2,0.4,0.6,0.8].map(v => values[Math.floor(v * (values.length - 1))]) : [];
  const swatches = spec.kind === 'q' ? [...SEQUENTIAL]
    : spec.kind === 'div' ? [...DIVERGING]
    : spec.kind === 'risk' ? [SEQUENTIAL[1],SEQUENTIAL[2],SEQUENTIAL[3],SEQUENTIAL[4],DIVERGING[4]]
    : DIVERGING.slice(0,3);
  const [a,b] = spec.thresholds || [];
  const lo = national ? '63점' : spec.kind === 'div' ? `−${b}%` : spec.lo;
  const hi = national ? '100점' : spec.kind === 'div' ? `+${b}%` : spec.hi;
  function color(region) {
    if (!region || (area && region.area !== area) || (kind && region.kind !== kind) || region.demo || !finite(region[metric])) return MISSING;
    if (metric === 'price' && !hasComparablePrice(region)) return MISSING;
    if (metric === 'score' && (!cohort || scoreKey(region) !== cohort)) return MISSING;
    const v = Number(region[metric]);
    if (spec.kind === 'q') {
      if (!cuts.length) return MISSING;
      return SEQUENTIAL[v > cuts[3] ? 4 : v > cuts[2] ? 3 : v > cuts[1] ? 2 : v > cuts[0] ? 1 : 0];
    }
    if (spec.kind === 'div') return DIVERGING[v >= b ? 4 : v >= a ? 3 : v > -a ? 2 : v > -b ? 1 : 0];
    if (spec.kind === 'risk') return v >= 80 ? DIVERGING[4] : SEQUENTIAL[v >= 70 ? 4 : v >= 60 ? 3 : v >= 50 ? 2 : 1];
    return DIVERGING[v >= -1 ? 2 : v >= -5 ? 1 : 0];
  }
  return { color, swatches, lo, hi, note:national ? '전국 비교 부분 점수 · 같은 법정동 유형·자료 기준의 전국 순위 구간' : spec.note, cuts, scoreCohort:cohort };
}
