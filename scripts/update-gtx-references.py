"""Add explicitly matched, licensed existing-station reference coordinates.

Input is the nationwide urban railway station standard XLSX linked by data.go.kr
15013205. No geocoding, name-only ambiguity resolution or future GTX location is
inferred. A changed upstream file requires a new review and hash.
"""
import argparse
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://openapi.kric.go.kr/rips/dataset/download.file?type=filedata&id=32&operation=1'
SHA256 = 'cdf1d84a7e5c898b2aacd622783ba8ba9af35c40bee0561dc97d55ce8e063f94'
SELECTIONS = [
    ('A-대곡', '1953', 'I4108'), ('A-성남', '1512', 'I41K5'),
    ('A-구성', '1863', 'I4105'), ('B-별내', '1313', 'I41K2'),
    ('B-평내호평', '1317', 'I41K2'), ('B-마석', '1319', 'I41K2'),
    ('C-덕정', '1911', 'I4102'), ('C-의정부', '1906', 'I4102'),
    ('C-광운대', '1019', 'I4102'), ('C-정부과천청사', '1454', 'I4103'),
    ('C-인덕원', '1455', 'I4103'), ('C-금정', '1708', 'I4101'),
    ('C-의왕', '1710', 'I4101'), ('C-상록수', '1754', 'I4103'),
]


def read_rows(file):
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(file) as archive:
        strings = [''.join(n.itertext()) for n in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        for row in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//m:sheetData/m:row', ns):
            cells = {}
            for cell in row.findall('m:c', ns):
                val = cell.find('m:v', ns)
                text = val.text if val is not None else ''
                cells[cell.attrib['r'].rstrip('0123456789')] = strings[int(text)] if cell.get('t') == 's' and text else text
            yield cells


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'work/gtx-input/stations-standard.xlsx')
    parser.add_argument('--checked-on', required=True, type=date.fromisoformat)
    args = parser.parse_args()
    if not args.input.exists():
        args.input.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=45) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise SystemExit('GTX reference source changed; existing JSON preserved.')
        args.input.write_bytes(data)
    if hashlib.sha256(args.input.read_bytes()).hexdigest() != SHA256:
        raise SystemExit('GTX reference source hash differs; existing JSON preserved.')
    rows = list(read_rows(args.input))
    output = ROOT / 'public/data/gtx-coordinates.json'
    data = json.loads(output.read_text(encoding='utf8'))
    for station_id, code, line in SELECTIONS:
        matches = [row for row in rows if row.get('A') == code and row.get('C') == line]
        if len(matches) != 1:
            raise SystemExit(f'{station_id}: ambiguous station/line pair; existing JSON preserved.')
        row = matches[0]
        name = station_id.split('-', 1)[1]
        if row.get('B') not in (name, name + '역'):
            raise SystemExit(f'{station_id}: station name differs; existing JSON preserved.')
        lon, lat = float(row['K']), float(row['J'])
        if not (124 < lon < 132 and 32 < lat < 39):
            raise SystemExit(f'{station_id}: invalid coordinate; existing JSON preserved.')
        data['coordinates'][station_id] = {
            'coordinate': [round(lon, 6), round(lat, 6)],
            'coordinateKind': 'existing-transfer-reference',
            'coordinateNotice': f'GTX 신설 역사의 확정 위치가 아닌 기존 {row["D"]} {row["B"]}의 참고 좌표입니다. 실제 GTX 승강장·출입구와 다를 수 있습니다.',
            'sourceStationCode': code, 'sourceStationName': row['B'], 'sourceLineCode': line,
            'coordinateSource': {
                'label': '국가철도공단 전국도시철도역사정보표준데이터',
                'url': 'https://www.data.go.kr/data/15013205/standard.do',
                'downloadUrl': URL, 'sha256': SHA256,
                'asOf': row.get('O'), 'checkedAt': args.checked_on.isoformat(),
                'license': '공공데이터포털 이용허락범위 제한 없음',
            },
        }
    data['asOf'] = args.checked_on.isoformat()
    data['notice'] = '기존 환승역의 참고 좌표이며 GTX 신설 역사·승강장·출입구의 확정 위치가 아닙니다. 계획역은 추정하지 않으며 직선 연결은 실제 선로가 아닙니다.'
    with tempfile.NamedTemporaryFile('w', encoding='utf8', dir=output.parent, delete=False, suffix='.tmp') as temp:
        temporary = Path(temp.name)
        json.dump(data, temp, ensure_ascii=False, indent=2)
        temp.write('\n')
    try:
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Added/verified {len(SELECTIONS)} exact station/line references; total {len(data["coordinates"])}')


if __name__ == '__main__':
    main()
