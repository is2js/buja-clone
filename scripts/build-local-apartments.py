"""Build distinct municipality apartment snapshots from public data portal files."""
import argparse,csv,hashlib,io,json,os,re,tempfile,unicodedata
from collections import Counter,defaultdict
from datetime import datetime,timezone,timedelta
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parent.parent
SOURCES={
'dalseo':{'id':'15054183','area':'27','label':'대구광역시 달서구 공동주택 아파트 현황','asOf':'2026-09-09','name':'아파트명','address':'도로명주소','kind':None,'lat':'위도','lon':'경도','households':'세대수','dongCount':'동수','approvedOn':'사용승인일','bbox':(128.3,128.8,35.7,36.0)},
'gwangsan':{'id':'15100132','area':'12','label':'전남광주통합특별시 광산구 공동주택현황','asOf':'2026-04-02','name':'아파트명','address':'소재지도로명주소','kind':None,'lat':'위도','lon':'경도','households':'세대수','dongCount':'동수','approvedOn':'사용검사일자','bbox':(126.6,127.0,35.0,35.4)},
}
p=argparse.ArgumentParser();p.add_argument('source',choices=SOURCES);p.add_argument('--csv',type=Path);p.add_argument('--as-of',required=True);p.add_argument('--output',type=Path);args=p.parse_args();spec=SOURCES[args.source]
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',args.as_of):p.error('--as-of YYYY-MM-DD 필요')
if args.csv:raw=args.csv.read_bytes()
else:
 s=requests.Session();response=s.get(f"https://www.data.go.kr/data/{spec['id']}/fileData.do",timeout=45);response.raise_for_status()
 match=re.search(r"fn_fileDataDown\('"+spec['id']+r"',\s*'([^']+)',\s*'([^']*)',\s*'([^']+)'",response.text)
 if not match:raise ValueError('다운로드 정보를 찾지 못함. 기존 결과 보존')
 detail,atch,sn=match.groups();par={'publicDataDetailPk':detail,'publicDataPk':spec['id'],'atchFileId':atch,'fileDetailSn':sn,'publicDataTyCode':'PR0051'}
 meta=s.get('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do',params=par,timeout=45);meta.raise_for_status();m=meta.json()
 if not m.get('status'):raise ValueError('다운로드 메타 오류. 기존 결과 보존')
 name=m.get('dataSetFileDetailInfo',{}).get('dataNm','');date=re.search(r'(20\d{6})',name)
 if not date or date.group(1)!=args.as_of.replace('-',''):raise ValueError('파일 기준일과 --as-of가 불일치하거나 확인 불가. 기존 결과 보존')
 token={'atchFileId':m['atchFileId'],'fileDetailSn':m['fileDetailSn']};check=s.post('https://www.data.go.kr/cmm/cmm/check-limit.json',data=token,timeout=45);check.raise_for_status()
 if check.json().get('needCaptcha'):raise ValueError('다운로드 추가 확인 필요. 기존 결과 보존')
 response=s.get('https://www.data.go.kr/cmm/cmm/fileDownload.do',params={**token,'dataNm':'apartment'},timeout=45);response.raise_for_status();raw=response.content
try:decoded=raw.decode('cp949')
except UnicodeDecodeError:decoded=raw.decode('utf-8-sig')
reader=csv.DictReader(io.StringIO(decoded,newline=''));reader.fieldnames=[k.strip() for k in reader.fieldnames or []]
required={spec[k] for k in ('name','address','lat','lon','households','dongCount','approvedOn')}
if not required.issubset(reader.fieldnames):raise ValueError('공식 CSV 필수 열 불일치. 기존 결과 보존')
def norm(s):return re.sub(r'\s+','',unicodedata.normalize('NFKC',str(s or '')).strip())
def full_road(item):
 road=item.get('roadAddress') or '';prefix=' '.join((item.get('address') or '').split()[:2]);return road if road.startswith(('대구광역시 ','광주광역시 ','전남광주통합특별시 ')) else prefix+' '+road if road and prefix else ''
national=json.loads((ROOT/'public/data/real/apartments'/f"{spec['area']}.json").read_text(encoding='utf-8'))['items']; national_keys=defaultdict(list)
for x in national:
 road=full_road(x)
 if road:national_keys[(norm(x['name']),norm(road))].append(x)
items=[];seen=set();identities=set();keys=defaultdict(list);stats=Counter(); xmin,xmax,ymin,ymax=spec['bbox']
for row in reader:
 name=(row[spec['name']] or '').strip(); address=(row[spec['address']] or '').strip()
 if not name or not address:stats['missingIdentity']+=1;continue
 identity=unicodedata.normalize('NFKC',name+'|'+address)
 if identity in identities:stats['duplicateIdentity']+=1
 identities.add(identity)
 # Some source rows share complex name/address but differ in building data. Preserve every source row.
 source_row=(row.get('연번') or '').strip()
 key=hashlib.sha256((identity+'|'+source_row).encode()).hexdigest()[:16]
 if key in seen:raise ValueError('동일 원천 행 식별자 중복. 기존 결과 보존')
 seen.add(key)
 try:lat,lon=float(row[spec['lat']]),float(row[spec['lon']])
 except (ValueError,TypeError):lat=lon=0
 valid=xmin<lon<xmax and ymin<lat<ymax
 def positive(s):s=str(s or '').strip().replace(',','');return int(s) if s.isdecimal() and int(s)>0 else None
 x={'id':args.source+':'+key,'sourceId':key,'name':name,'area':spec['area'],'kind':'residential','complexType':'공동주택 원본 행 · 동/단지 단위 미상' if args.source=='gwangsan' else '아파트','address':address,'roadAddress':address,'households':positive(row[spec['households']]),'dongCount':positive(row[spec['dongCount']]),'approvedOn':(row[spec['approvedOn']] or '').strip() or None,'coordinate':[lon,lat] if valid else None,'locationVerified':valid,'locationQuality':'지자체 제공 대표 좌표 · 실제 출입구와 정밀도 미검증','locationSource':spec['label'],'locationSourceUrl':f"https://www.data.go.kr/data/{spec['id']}/fileData.do",'locationAsOf':args.as_of,'nationalId':None,'buildings':[],'sample':False}
 items.append(x);keys[(norm(name),norm(address))].append(x);stats['validCoordinates' if valid else 'missingOrInvalidCoordinates']+=1
if len(items)<20 or stats['validCoordinates']<10:raise ValueError('원천 데이터 부족. 기존 결과 보존')
for k,group in keys.items():
 if len(group)==1 and len(national_keys.get(k,[]))==1:group[0]['nationalId']=national_keys[k][0]['id'];stats['unambiguousMatched']+=1
coords=Counter(tuple(round(v,6) for v in x['coordinate']) for x in items if x['coordinate'])
for x in items:x['duplicateCoordinate']=bool(x['coordinate'] and coords[tuple(round(v,6) for v in x['coordinate'])]>1)
stats['duplicateCoordinateGroups']=sum(v>1 for v in coords.values());stats['duplicateCoordinateItems']=sum(v for v in coords.values() if v>1);stats['rows']=len(items)
source={'label':spec['label'],'url':f"https://www.data.go.kr/data/{spec['id']}/fileData.do",'asOf':args.as_of,'collectedAt':datetime.now(timezone(timedelta(hours=9))).date().isoformat(),'license':'이용허락범위 제한 없음','notice':'지자체 대표 좌표이며 위치 정밀도 및 실제 출입구는 검증되지 않았습니다.'}
out=args.output or ROOT/'public/data/real/apartments'/f'{args.source}-locations.json';out.parent.mkdir(parents=True,exist_ok=True)
with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=out.parent,delete=False,suffix='.tmp') as f:
 temp=Path(f.name)
 try:json.dump({'source':source,'area':spec['area'],'diagnostics':dict(stats),'items':items},f,ensure_ascii=False,separators=(',',':'));f.flush();os.fsync(f.fileno())
 except BaseException:temp.unlink(missing_ok=True);raise
try:os.replace(temp,out)
finally:temp.unlink(missing_ok=True)
print(args.source,json.dumps(stats,ensure_ascii=False))
