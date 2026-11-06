"""Download public Hanam apartment CSV without an API key, excluding contacts."""
import argparse,csv,hashlib,io,json,os,re,tempfile,unicodedata
from collections import Counter
from datetime import datetime,timezone,timedelta
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--csv',type=Path);p.add_argument('--as-of',default='2026-09-01');p.add_argument('--output',type=Path,default=ROOT/'public/data/real/apartments/hanam-locations.json');args=p.parse_args()
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',args.as_of): p.error('--as-of YYYY-MM-DD 필요')
if args.csv: raw=args.csv.read_bytes()
else:
 s=requests.Session(); response=s.get('https://www.data.go.kr/data/3047304/fileData.do',timeout=45);response.raise_for_status()
 match=re.search(r"fn_fileDataDown\('3047304',\s*'([^']+)',\s*'([^']*)',\s*'([^']+)'",response.text)
 if not match:raise ValueError('하남시 파일 다운로드 정보를 찾지 못함. 기존 자료 보존')
 detail,atch,sn=match.groups();data={'publicDataDetailPk':detail,'publicDataPk':'3047304','atchFileId':atch,'fileDetailSn':sn,'publicDataTyCode':'PR0051'}
 meta=s.get('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do',params=data,timeout=45);meta.raise_for_status();m=meta.json()
 if not m.get('status'):raise ValueError('하남시 파일 다운로드 메타데이터 오류. 기존 자료 보존')
 dataset_name=m.get('dataSetFileDetailInfo',{}).get('dataNm','')
 dataset_date=re.search(r'(20\d{6})',dataset_name)
 if not dataset_date or dataset_date.group(1)!=args.as_of.replace('-',''):raise ValueError('파일 기준일과 --as-of가 불일치하거나 확인 불가. 기존 자료 보존')
 token={'atchFileId':m['atchFileId'],'fileDetailSn':m['fileDetailSn']};check=s.post('https://www.data.go.kr/cmm/cmm/check-limit.json',data=token,timeout=45);check.raise_for_status()
 if check.json().get('needCaptcha'):raise ValueError('다운로드 제공자 추가 확인 필요. 기존 자료 보존')
 response=s.get('https://www.data.go.kr/cmm/cmm/fileDownload.do',params={**token,'dataNm':'apartment'},timeout=45);response.raise_for_status();raw=response.content
try: decoded=raw.decode('cp949')
except UnicodeDecodeError:decoded=raw.decode('utf-8-sig')
reader=csv.DictReader(io.StringIO(decoded,newline='')); required={'단지명','주택유형','소재지지번주소','세대수','위도','경도','사용검사일자'}
if not reader.fieldnames or not required.issubset(reader.fieldnames):raise ValueError('하남시 CSV 필드 오류. 기존 자료 보존')
items=[];seen=set();stats=Counter()
for row in reader:
 name=(row['단지명'] or '').strip();address=(row['소재지지번주소'] or '').strip();kind=(row['주택유형'] or '').strip()
 if not name or not address:stats['missingNameOrAddress']+=1;continue
 # Stable IDs based on official name/address, not mutable ordinal. No contact details.
 canonical=unicodedata.normalize('NFKC',name+'|'+address);key=hashlib.sha256(canonical.encode()).hexdigest()[:16]
 if key in seen:stats['duplicateIdentity']+=1;continue
 seen.add(key)
 try:lat,lon=float(row['위도']),float(row['경도'])
 except (ValueError,TypeError):lat=lon=0
 valid=37.3<lat<37.8 and 127.0<lon<127.5 and address.startswith('경기도 하남시 ')
 count=(row['세대수'] or '').strip().replace(',','');households=int(count) if count.isdecimal() else None
 items.append({'id':'hanam:'+key,'sourceId':key,'name':name,'area':'41','kind':'residential','complexType':kind or '분류 미상','address':address,'roadAddress':None,'households':households,'dongCount':None,'approvedOn':(row['사용검사일자'] or '').strip() or None,'coordinate':[lon,lat] if valid else None,'locationVerified':valid,'locationQuality':'하남시 제공 대표 좌표 · 실제 출입구와 정밀도 미검증','locationSource':'경기도 하남시 공동주택 현황','locationSourceUrl':'https://www.data.go.kr/data/3047304/fileData.do','locationAsOf':args.as_of,'nationalId':None,'buildings':[],'sample':False});stats['validCoordinates' if valid else 'missingOrInvalidCoordinates']+=1
if len(items)<20 or stats['validCoordinates']<10:raise ValueError('하남시 자료 부족. 기존 자료 보존')
coordinates=Counter(tuple(round(v,6) for v in x['coordinate']) for x in items if x['coordinate'])
for item in items:item['duplicateCoordinate']=bool(item['coordinate'] and coordinates[tuple(round(v,6) for v in item['coordinate'])]>1)
stats['duplicateCoordinateGroups']=sum(v>1 for v in coordinates.values());stats['duplicateCoordinateItems']=sum(v for v in coordinates.values() if v>1);stats['rows']=len(items)
source={'label':'경기도 하남시 공동주택 현황','url':'https://www.data.go.kr/data/3047304/fileData.do','asOf':args.as_of,'collectedAt':datetime.now(timezone(timedelta(hours=9))).date().isoformat(),'license':'이용허락범위 제한 없음','notice':'하남시 제공 대표 좌표. 위치 정밀도 및 실제 출입구는 검증되지 않았습니다.'}
args.output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=args.output.parent,delete=False,suffix='.tmp') as f:
 temp=Path(f.name)
 try:json.dump({'source':source,'area':'41','diagnostics':dict(stats),'items':items},f,ensure_ascii=False,separators=(',',':'));f.flush();os.fsync(f.fileno())
 except BaseException:temp.unlink(missing_ok=True);raise
try:os.replace(temp,args.output)
finally:temp.unlink(missing_ok=True)
print(json.dumps(stats,ensure_ascii=False))
