// All property metrics come from the official-data adapter. No generated figures.
import { loadRealData } from './real-data.js';
const base = import.meta.env.BASE_URL;

async function readJson(path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`데이터를 불러오지 못했습니다: ${path}`);
  return response.json();
}

function regionFromBoundary(code, item, kind, geo, real) {
  const guCode = kind === 'gu' ? code : item.g;
  const parent = geo.gu[guCode];
  const area = kind === 'gu' ? item.s : parent?.s;
  const guName = parent?.n || item.n;
  const full = kind === 'gu' ? item.n : `${guName} ${item.n}`;
  const stats = real.byRegion?.[`${kind}:${code}`] || {};
  const commercial = real.commercialByRegion?.[`${kind}:${code}`] || null;
  const b = real.businessesByRegion?.[`${kind}:${code}`];
  const businesses = b ? { ...b, source: real.sources?.businesses?.source, asOf: real.sources?.businesses?.asOf } : null;
  return {
    code, name: item.n, kind, area, gu: guCode, guCode, guName, full, fullName: full,
    score: null, price: stats.price ?? null, change: stats.change1 ?? null,
    change1: stats.change1 ?? null, change3: stats.change3 ?? null,
    change6: stats.change6 ?? null, yoy: stats.yoy ?? null,
    tx: stats.transactions ?? null, transactions: stats.transactions ?? null,
    jeonse: stats.jeonse ?? null, peak: stats.peak ?? null,
    history: stats.history || stats.series || [], series: stats.series || stats.history || [], monthlyCounts: stats.monthlyCounts || [],
    sampleCount: stats.sampleCount ?? null, change1Samples: stats.change1Samples ?? null, change3Samples: stats.change3Samples ?? null, change6Samples: stats.change6Samples ?? null, jeonseSaleSampleCount: stats.jeonseSaleSampleCount ?? null, rentMedian: stats.rentMedian ?? null, rentSampleCount: stats.rentSampleCount ?? null, monthlyRentMedian: stats.monthlyRentMedian ?? null, monthlyRentSampleCount: stats.monthlyRentSampleCount ?? null, source: stats.source ?? null,
    asOf: stats.asOf ?? null, period: stats.period ?? null, method: stats.method ?? null, commercial, businesses, news: [], buildings: [], demo: false,
  };
}

export async function loadData() {
  const [geo, gtx, gtxCoordinates, real, sample, officialApartments, hanamApartments, dalseoApartments, gwangsanApartments] = await Promise.all([
    readJson('data/geo.json'), readJson(import.meta.env.DEV ? 'data/gtx.json' : 'data/gtx-public.json').catch(() => readJson('data/gtx-public.json')), readJson('data/gtx-coordinates.json'), loadRealData(), readJson('data/sample-3d.json').catch(() => null), readJson('data/real/apartments/seoul-locations.json').catch(() => null), readJson('data/real/apartments/hanam-locations.json').catch(() => null), readJson('data/real/apartments/dalseo-locations.json').catch(() => null), readJson('data/real/apartments/gwangsan-locations.json').catch(() => null),
  ]);
  const order = ['11','41','28','26','27','12','30','31','36','51','43','44','52','47','48','50'];
  const areas = order.filter(code => geo.sido[code]).map(code => ({ code, name:geo.sido[code].n }));
  const regions = {};
  for (const [code, region] of Object.entries(geo.gu)) regions[code] = regionFromBoundary(code, region, 'gu', geo, real);
  for (const [code, region] of Object.entries(geo.dong)) regions[code] = regionFromBoundary(code, region, 'dong', geo, real);
  const routes = (gtx.routes || []).map(route => ({ ...route, stations: (route.stations || []).map(station => {
    const reference = gtxCoordinates.coordinates?.[station.id];
    return station.coordinate || !reference ? station : { ...station, ...reference };
  }) }));
  return {
    geo, areas, regions, byCode: regions, regionList: Object.values(regions),
    routes, gtx: routes, gtxAsOf: gtx.asOf, buildings: [], news: [],
    apartments: sample?.apartments || [], actualApartments: [...(officialApartments?.items || []), ...(hanamApartments?.items || []), ...(dalseoApartments?.items || []), ...(gwangsanApartments?.items || [])], actualApartmentSources: [officialApartments?.source, hanamApartments?.source, dalseoApartments?.source, gwangsanApartments?.source].filter(Boolean), sampleTerrain: { hills: sample?.terrainHills || [] },
    real, notice: '실제 확보한 자료만 표시하며, 없는 자료는 데이터 없음으로 표시합니다.',
    asOf: real.asOf, demo: false,
  };
}
