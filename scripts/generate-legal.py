"""Build a static legal-dong list and available nationwide legal boundaries.

code.go.kr: latest active code list; third-party 2023-07 boundary derivative is
paired only on identical first-eight-digit codes. Geometry is display-only.
"""
import hashlib, io, json, math, os, tempfile, zipfile, requests, re, xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
root = Path(__file__).resolve().parents[1]
response = requests.post('https://www.code.go.kr/etc/codeFullDown.do', data={'codeseId': '법정동코드'}, timeout=45)
response.raise_for_status()
archive = zipfile.ZipFile(io.BytesIO(response.content))
lines = archive.read(archive.namelist()[0]).decode('cp949').splitlines()
GEOMETRY_REVISION = '3a859f2a45be8acf8237d9eefd9565f99cc603da'
GEOMETRY_SHA256 = 'ca8d03b0df83e5d90f78b83090ef0ef03143c1be339cce9c448260005ac1e004'
geometry_url = f'https://raw.githubusercontent.com/KnellBalm/kr-admin-geojson/{GEOMETRY_REVISION}/emd.geojson'
boundary = requests.get(geometry_url, timeout=60)
boundary.raise_for_status()
if hashlib.sha256(boundary.content).hexdigest() != GEOMETRY_SHA256:
    raise SystemExit('법정 경계 원천 해시가 달라 기존 자료를 보존합니다.')
features = boundary.json()['features']
matched = {f['properties']['EMD_CD']: f for f in features}
# Official July 2026 before/after legal-code tables. Only unambiguous, same-name
# 읍면동 mappings are accepted; geometry remains the 2023 snapshot.
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
crosswalk = defaultdict(set)
for file_sn in (6, 7, 8):
    url = f'https://mois.go.kr/cmm/fms/FileDown.do?atchFileId=FILE_00146280tlU2Y2B&fileSn={file_sn}'
    res = requests.get(url, timeout=60); res.raise_for_status()
    book = zipfile.ZipFile(io.BytesIO(res.content))
    strings = [''.join(si.itertext()) for si in ET.fromstring(book.read('xl/sharedStrings.xml'))]
    xml = ET.fromstring(book.read('xl/worksheets/sheet1.xml'))
    before_gu = after_gu = ''
    for row in xml.findall('.//m:sheetData/m:row', ns):
        cells = {}
        for cell in row.findall('m:c', ns):
            column = re.match(r'[A-Z]+', cell.get('r', '')).group()
            v = cell.find('m:v', ns); value = v.text if v is not None else ''
            cells[column] = strings[int(value)] if value and cell.get('t') == 's' else value
        old_col, old_name, old_suffix, new_col, new_name, new_suffix = ('A','C','D','E','H','I') if file_sn == 6 else ('A','D','E','F','I','J')
        for col, which in ((old_col, 'old'), (new_col, 'new')):
            m = re.search(r'\((\d{5})\)', cells.get(col, ''))
            if m:
                if which == 'old': before_gu = m.group(1)
                else: after_gu = m.group(1)
        old, new = cells.get(old_suffix, ''), cells.get(new_suffix, '')
        if before_gu and after_gu and re.fullmatch(r'\d{5}', old) and re.fullmatch(r'\d{5}', new) and cells.get(old_name) and cells.get(old_name) == cells.get(new_name):
            crosswalk[after_gu + new].add(before_gu + old)
pk, mx, my, scale = math.cos(36.5 * math.pi / 180), 100.1684389, -38.6136915, 1200

def xy(coord):
    lon, lat = coord[:2]
    return [(lon * pk - mx) * scale, (-lat - my) * scale]

def convert(geometry):
    if not geometry or geometry['type'] not in ('Polygon', 'MultiPolygon'):
        return None, None
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    paths, points = [], []
    for poly in polygons:
        for ring in poly:
            pts = [xy(coord) for coord in ring]
            if not pts: continue
            points.extend(pts)
            paths.append('M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in pts)+'Z')
    if not points: return None, None
    xs, ys = zip(*points)
    return ''.join(paths), [round(min(xs),2),round(min(ys),2),round(max(xs)-min(xs),2),round(max(ys)-min(ys),2)]

rows=[]
for line in lines[1:]:
    col=line.strip().split('\t')
    if len(col)!=3: continue
    code,name,status=col
    if status!='존재' or len(code)!=10 or code.endswith('00000') or not code.endswith('00'): continue
    area=code[:2]
    parts=name.split()
    # Active 10-digit 읍·면·동 codes end in 00; upper-level codes end in 00000.
    # Do not infer type from the name: 세종로 and 세종시-level 동 are valid.
    if len(parts)<2: continue
    feature=matched.get(code[:8]); d=b=None
    if not feature and code.startswith('52'):
        # Jeonbuk's 2024 change replaced 45 with 52; remaining code and name must match.
        candidate=matched.get('45'+code[2:8])
        if candidate and candidate['properties'].get('EMD_KOR_NM') == parts[-1]: feature=candidate
    if not feature:
        oldcodes=crosswalk.get(code, set())
        if len(oldcodes)==1:
            candidate=matched.get(next(iter(oldcodes))[:8])
            if candidate and candidate['properties'].get('EMD_KOR_NM') == parts[-1]: feature=candidate
    if feature:
        d,b=convert(feature['geometry'])
    rows.append({'code':code,'name':parts[-1],'area':area,'guCode':code[:5], 'full':name,'path':d,'bbox':b})
result={'source':{'codes':'https://www.code.go.kr/stdcode/regCodeL.do?menuNo=101010100010','codesCheckedAt':datetime.now(timezone.utc).isoformat(),'codesSha256':hashlib.sha256(response.content).hexdigest(),'geometry':'https://github.com/KnellBalm/kr-admin-geojson','geometryUrl':geometry_url,'geometryRevision':GEOMETRY_REVISION,'geometrySha256':GEOMETRY_SHA256,'geometryBasis':'V-World 2023-07-29; 2023 legal boundary, simplified','geometryLicense':'출처표시: 국가공간정보포털 및 공공데이터포털; 2차 가공 KnellBalm/kr-admin-geojson','codeCrosswalk':'https://mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039'},'regions':rows}
destination = root/'public/data/legal.json'
if len(rows) < 1000 or not any(r['code'] == '4113511300' for r in rows) or not any(r['code'] == '1111011900' for r in rows):
    raise SystemExit('Code source incomplete; existing legal.json preserved.')
with tempfile.NamedTemporaryFile('w', encoding='utf8', dir=destination.parent, delete=False, suffix='.tmp') as f:
    temp = Path(f.name)
    try:
        json.dump(result, f, ensure_ascii=False, separators=(',',':')); f.flush(); os.fsync(f.fileno())
    except BaseException:
        temp.unlink(missing_ok=True); raise
try: os.replace(temp, destination)
finally: temp.unlink(missing_ok=True)
print(f'legal {len(rows)}, 전국 geometry {sum(bool(x["path"]) for x in rows)}; 동원동 {next(x for x in rows if x["code"] == "4113511300")["full"]}')
