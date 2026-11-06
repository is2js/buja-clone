"""Download Seoul OpenAptInfo Sheet as CSV and produce a standalone public snapshot.

Only unambiguous full road address + name matches join the existing REB ID.
The source provides representative coordinates, not entrance/footprint accuracy.
A failed download or validation leaves the previous snapshot untouched.
"""
import argparse
import csv
import io
import json
import os
import re
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--csv', type=Path, help='Optional locally downloaded official Sheet CSV')
parser.add_argument('--as-of', default=datetime.now(timezone(timedelta(hours=9))).date().isoformat(), help='Collection date YYYY-MM-DD')
parser.add_argument('--output', type=Path, default=ROOT / 'public/data/real/apartments/seoul-locations.json')
args = parser.parse_args()
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.as_of): parser.error('Invalid --as-of')
if args.csv:
    raw = args.csv.read_bytes()
else:
    response = requests.post('https://datafile.seoul.go.kr/bigfile/iot/sheet/csv/download.do', data={'srvType':'S','infId':'OA-15818','serviceKind':'0','pageNo':'1','ssUserId':'SAMPLE_VIEW','strWhere':'','strOrderby':'SN ASC'}, headers={'Referer':'https://data.seoul.go.kr/','User-Agent':'Mozilla/5.0'}, timeout=120)
    response.raise_for_status(); raw = response.content
try: decoded = raw.decode('cp949')
except UnicodeDecodeError: decoded = raw.decode('utf-8-sig')
rows = csv.DictReader(io.StringIO(decoded, newline=''))
required = ['k-아파트코드','k-아파트명','k-단지분류(아파트,주상복합등등)','kapt도로명주소','좌표X','좌표Y']
if not rows.fieldnames or not set(required).issubset(rows.fieldnames): raise ValueError('서울시 CSV 형식 불일치. 기존 자료 보존')
national = json.loads((ROOT/'public/data/real/apartments/11.json').read_text(encoding='utf-8'))['items']
def normalized(s): return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(s or '')).strip())
def identity(name,address): return (normalized(name), normalized(address))
def full_road(item):
    road = item.get('roadAddress') or ''
    address = item.get('address') or ''
    prefix = ' '.join(address.split()[:2])
    return road if road.startswith(('서울특별시 ','서울 ')) else prefix+' '+road if prefix and road else ''
national_by_key = defaultdict(list)
for item in national:
    road = full_road(item)
    if item.get('name') and road: national_by_key[identity(item['name'], road)].append(item)
items=[]; keys=defaultdict(list); seen=set(); diagnostics=Counter()
def positive_int(s):
    value=str(s or '').strip().replace(',','')
    return int(value) if value.isdecimal() and int(value)>0 else None
for row in rows:
    source_id = (row.get('k-아파트코드') or '').strip()
    name = (row.get('k-아파트명') or '').strip()
    if not source_id or source_id in seen or not name: raise ValueError('서울 단지 ID·이름 누락 또는 중복. 기존 자료 보존')
    seen.add(source_id)
    kind = (row.get('k-단지분류(아파트,주상복합등등)') or '').strip()
    address = (row.get('kapt도로명주소') or '').strip()
    try: lon,lat=float(row.get('좌표X') or ''),float(row.get('좌표Y') or '')
    except (ValueError,TypeError): lon=lat=0.0
    valid=126.5<lon<127.5 and 37.3<lat<38
    if valid: diagnostics['coordinatesInSeoulBounds'] += 1
    else: diagnostics['missingOrOutOfBounds'] += 1
    item = {'id':'seoul:'+source_id,'sourceId':source_id,'name':name,'area':'11', 'kind':'residential', 'complexType':kind or '분류 미상',
            'address':address,'roadAddress':address or None,'households':positive_int(row.get('k-전체세대수')),'dongCount':positive_int(row.get('k-전체동수')),
            'approvedOn':(row.get('k-사용검사일-사용승인일') or '').strip()[:10] or None,
            'coordinate':[lon,lat] if valid else None,'locationVerified':valid,'locationQuality':'서울시 제공 대표 좌표 · 실제 출입구와 정밀도 미검증',
            'locationSource':'서울시 공동주택 아파트 정보','locationSourceUrl':'https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do','locationAsOf':args.as_of,
            'nationalId':None,'buildings':[], 'sample':False}
    if address: keys[identity(name,address)].append(item)
    items.append(item)
if len(items)<1000 or diagnostics['coordinatesInSeoulBounds']<500: raise ValueError('서울 자료 부족. 기존 자료 보존')
for key, matches in keys.items():
    if len(matches)==1 and len(national_by_key.get(key,[]))==1:
        matches[0]['nationalId']=national_by_key[key][0]['id'];diagnostics['unambiguousMatched'] += 1
        if matches[0]['coordinate']: diagnostics['unambiguousMatchedWithCoordinate'] += 1
coordinate_counts=Counter(tuple(round(v,6) for v in item['coordinate']) for item in items if item['coordinate'])
for item in items:
    c=item['coordinate']; item['duplicateCoordinate'] = bool(c and coordinate_counts[tuple(round(v,6) for v in c)]>1)
diagnostics['duplicateCoordinateGroups'] = sum(v>1 for v in coordinate_counts.values())
diagnostics['duplicateCoordinateItems'] = sum(v for v in coordinate_counts.values() if v>1)
diagnostics['rows']=len(items)
source={'label':'서울시 공동주택 아파트 정보','url':'https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do','collectedAt':args.as_of,'license':'공공누리 제1유형: 출처표시','notice':'서울시 제공 대표 좌표. 위치 정밀도 및 실제 출입구는 검증되지 않았습니다.'}
payload={'source':source,'area':'11','diagnostics':dict(diagnostics),'items':items}
args.output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=args.output.parent,delete=False,suffix='.tmp') as f:
    temp=Path(f.name)
    try: json.dump(payload,f,ensure_ascii=False,separators=(',',':'));f.flush();os.fsync(f.fileno())
    except BaseException: temp.unlink(missing_ok=True);raise
try: os.replace(temp,args.output)
finally: temp.unlink(missing_ok=True)
print(json.dumps(diagnostics,ensure_ascii=False))
