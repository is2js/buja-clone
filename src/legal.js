// Separate legal boundaries from the existing administrative-dong geometry.
export async function loadLegalData() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/legal.json`);
  if (!response.ok) throw new Error('법정동 자료를 불러오지 못했습니다.');
  const source = await response.json();
  const regions = source.regions.map((item) => ({
    ...item, sourceCode: item.code, code: `legal:${item.code}`,
    kind: 'legal', districtType: '법정동', gu: item.guCode,
    guName: item.full.split(' ').slice(1, -1).join(' '),
    fullName: item.full, geometryAvailable: Boolean(item.path && item.bbox),
    geometryAsOf: '2023-07-29', codeAsOf: source.source.codesCheckedAt,
    score: null, price: null, change: null, change1: null, change3: null,
    change6: null, yoy: null, tx: null, transactions: null, jeonse: null,
    peak: null, history: null, series: null, news: [], buildings: [], demo: false,
  }));
  return { source: source.source, regions, byCode: Object.fromEntries(regions.map(r => [r.code, r])) };
}
