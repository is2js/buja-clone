// Apartment files are loaded on demand; official records never acquire guessed coordinates.
const base = import.meta.env.BASE_URL;
let indexPromise, seoulPromise, hanamPromise;
const localSnapshots = new Map();
const regions = new Map();
async function fetchJson(path) {
  const response = await fetch(`${base}data/real/apartments/${path}`);
  if (!response.ok) throw new Error('공식 단지 자료를 불러오지 못했습니다.');
  return response.json();
}
export function getSeoulApartments() {
  if (!seoulPromise) seoulPromise = fetchJson('seoul-locations.json').catch(error => { seoulPromise = null; throw error; });
  return seoulPromise;
}
export function getHanamApartments() {
  if (!hanamPromise) hanamPromise = fetchJson('hanam-locations.json').catch(error => { hanamPromise = null; throw error; });
  return hanamPromise;
}
export function getLocalApartments(name) {
  if (!['dalseo','gwangsan'].includes(name)) return Promise.reject(new Error('지역 자료가 없습니다.'));
  if (!localSnapshots.has(name)) localSnapshots.set(name, fetchJson(`${name}-locations.json`).catch(error => { localSnapshots.delete(name); throw error; }));
  return localSnapshots.get(name);
}
export function getApartmentIndex() {
  if (!indexPromise) indexPromise = Promise.all([fetchJson('index.json'), getSeoulApartments().catch(() => null), getHanamApartments().catch(() => null), getLocalApartments('dalseo').catch(() => null), getLocalApartments('gwangsan').catch(() => null)]).then(([index, seoul, hanam, dalseo, gwangsan]) => {
    const actual = [...(seoul?.items || []), ...(hanam?.items || []), ...(dalseo?.items || []), ...(gwangsan?.items || [])];
    const linked = new Map(actual.filter(item => item.nationalId).map(item => [item.nationalId, item]));
    return {...index, items:[...index.items.map(item => {
      const match = linked.get(item.id);
      return match ? {...item, coordinate:match.coordinate, locationVerified:match.locationVerified, locationQuality:match.locationQuality, locationSource:match.locationSource} : item;
    }), ...actual.filter(item => !item.nationalId).map(item => ({id:item.id,name:item.name,address:item.address,area:item.area,coordinate:item.coordinate,locationVerified:item.locationVerified,locationQuality:item.locationQuality,locationSource:item.locationSource,complexType:item.complexType}))]};
  }).catch(error => { indexPromise = null; throw error; });
  return indexPromise;
}
export function getApartmentArea(area) {
  if (!/^(11|12|26|27|28|30|31|36|41|43|44|47|48|50|51|52)$/.test(area)) return Promise.reject(new Error('지역 코드가 올바르지 않습니다.'));
  if (!regions.has(area)) regions.set(area, fetchJson(`${area}.json`).catch(error => { regions.delete(area); throw error; }));
  return regions.get(area);
}
export async function findApartment(reference) {
  if (/^(seoul|hanam|dalseo|gwangsan):/.test(String(reference.id))) {
    const prefix = String(reference.id).split(':')[0];
    const snapshot = prefix === 'seoul' ? await getSeoulApartments() : prefix === 'hanam' ? await getHanamApartments() : await getLocalApartments(prefix);
    const item = snapshot.items.find(item => item.id === reference.id);
    if (!item) throw new Error('해당 지자체 공동주택 상세 자료가 없습니다.');
    return {...item, source:snapshot.source?.label, sourceUrl:snapshot.source?.url, asOf:snapshot.source?.asOf || snapshot.source?.collectedAt};
  }
  const data = await getApartmentArea(reference.area);
  const item = data.items.find(item => item.id === reference.id);
  if (!item) throw new Error('단지 상세 자료가 없습니다.');
  const snapshot = reference.area === '11' ? await getSeoulApartments().catch(() => null) : reference.area === '27' ? await getLocalApartments('dalseo').catch(() => null) : reference.area === '12' ? await getLocalApartments('gwangsan').catch(() => null) : null;
  const location = snapshot?.items.find(row => row.nationalId === item.id);
  return {...item, ...(location ? {coordinate:location.coordinate, locationVerified:location.locationVerified, locationSource:location.locationSource, locationSourceUrl:location.locationSourceUrl, locationQuality:location.locationQuality, locationAsOf:location.locationAsOf, duplicateCoordinate:location.duplicateCoordinate, complexType:location.complexType} : {}), sample:false, source:data.source?.label, sourceUrl:data.source?.basicUrl, asOf:data.source?.asOf};
}
