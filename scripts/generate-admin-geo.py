"""Independently build SVG administrative boundaries from pinned SGIS/vuski data.

Run with Python 3.13 and Shapely 2.x. The local ignored work/geo-deps directory
is accepted as a dependency location; no geometry from the previous geo.json is
used in this transform. Code/name sets are compared only to prevent regressions.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPS = ROOT / 'work/geo-deps'
if LOCAL_DEPS.exists():
    sys.path.insert(0, str(LOCAL_DEPS))
from shapely import make_valid
from shapely.geometry import MultiPolygon, shape
from shapely.ops import unary_union

REVISION = '3bc00489b76696db864bdbea4b19985cdfa8b403'
VERSION = '20261001'
SOURCE_PATH = f'ver{VERSION}/HangJeongDong_ver{VERSION}.geojson'
SOURCE_URL = f'https://raw.githubusercontent.com/vuski/admdongkor/{REVISION}/{SOURCE_PATH}'
SOURCE_SHA256 = '843ece3a0b3429742cd4a1b699cc13987a88b5e5401f382e7fdaaa194ea5e605'
LICENSE_URL = f'https://raw.githubusercontent.com/vuski/admdongkor/{REVISION}/LICENSE-DATA'
LICENSE_SHA256 = 'd892791d5ba176e3bb7cc178937b26d3b33e2ad19da581af168c9e48428ba507'
PK, SCALE, MX, MY = math.cos(math.radians(36.5)), 1200, 100.1684389, -38.6136915
SIMPLIFY = 0.0002
SIDO_NAMES = {'11':'서울','12':'전남광주','26':'부산','27':'대구','28':'인천',
              '30':'대전','31':'울산','36':'세종','41':'경기','43':'충북','44':'충남',
              '47':'경북','48':'경남','50':'제주','51':'강원','52':'전북'}


def verified_bytes(url, sha256, cache_file):
    """Pinned hashes fail closed, including when a cached download is corrupt."""
    if cache_file.exists():
        body = cache_file.read_bytes()
    else:
        request = urllib.request.Request(url, headers={'User-Agent':'buja-static-boundary-builder/1.0'})
        with urllib.request.urlopen(request, timeout=90) as response:
            body = response.read(64 * 1024 * 1024 + 1)
        if len(body) > 64 * 1024 * 1024:
            raise ValueError('Source exceeds the bounded download size; existing output preserved.')
    if hashlib.sha256(body).hexdigest() != sha256:
        raise ValueError(f'Pinned source hash mismatch: {url}; existing output preserved.')
    if not cache_file.exists():
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(body)
    return body


def polygonal(geometry):
    if geometry.geom_type in ('Polygon','MultiPolygon'):
        return geometry
    polygons=[]
    for part in getattr(geometry, 'geoms', []):
        if part.geom_type == 'Polygon': polygons.append(part)
        elif part.geom_type == 'MultiPolygon': polygons.extend(part.geoms)
    if not polygons:
        raise ValueError('Source has no polygon geometry; existing output preserved.')
    return MultiPolygon(polygons)


def xy(lon, lat):
    return ((lon * PK - MX) * SCALE, (-lat - MY) * SCALE)


def bounds(geometry):
    west,south,east,north = geometry.bounds
    left,top = xy(west,north)
    right,bottom = xy(east,south)
    # Round the outside outward so even the exact source edge remains included.
    left,top,right,bottom = math.floor(left*100)/100,math.floor(top*100)/100,math.ceil(right*100)/100,math.ceil(bottom*100)/100
    return [left,top,round(right-left,2),round(bottom-top,2)]


def path_data(geometry):
    geometry = geometry.simplify(SIMPLIFY, preserve_topology=True)
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError('Invalid simplified polygon; existing output preserved.')
    polygons = [geometry] if geometry.geom_type == 'Polygon' else geometry.geoms
    parts=[]
    for polygon in polygons:
        for ring in (polygon.exterior,*polygon.interiors):
            points=[]
            for lon,lat,*_ in ring.coords:
                point=tuple(round(value,2) for value in xy(lon,lat))
                if not points or point != points[-1]: points.append(point)
            if points and points[0] == points[-1]: points.pop()
            if len(set(points)) < 3: continue
            parts.append('M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in points)+'Z')
    if not parts:
        raise ValueError('Simplification removed a region; existing output preserved.')
    center=geometry.representative_point()
    return ''.join(parts),[round(value,2) for value in xy(center.x,center.y)]


def build(source):
    features = source.get('features')
    if source.get('type') != 'FeatureCollection' or not isinstance(features,list) or len(features) != 3559:
        raise ValueError('Unexpected pinned feature count; existing output preserved.')
    if source.get('crs',{}).get('properties',{}).get('name') != 'urn:ogc:def:crs:OGC:1.3:CRS84':
        raise ValueError('Unexpected coordinate reference system; existing output preserved.')
    dongs,gu_parts,sido_parts,gu_names = {},defaultdict(list),defaultdict(list),{}
    repaired=0
    for feature in features:
        p=feature['properties']; code=p.get('adm_cd2',''); gu=p.get('sgg',''); sido=p.get('sido','')
        if not re.fullmatch(r'\d{10}',code) or gu != code[:5] or sido != code[:2] or sido not in SIDO_NAMES or code in dongs:
            raise ValueError('Invalid or duplicate administrative identity; existing output preserved.')
        name=p.get('adm_nm','').split()[-1]; gu_name=p.get('sggnm','')
        if not name or not gu_name or (gu in gu_names and gu_names[gu] != gu_name):
            raise ValueError('Conflicting names; existing output preserved.')
        geometry=shape(feature['geometry'])
        if not geometry.is_valid:
            geometry=polygonal(make_valid(geometry)); repaired+=1
        if geometry.is_empty or geometry.geom_type not in ('Polygon','MultiPolygon') or not geometry.is_valid:
            raise ValueError('Invalid boundary; existing output preserved.')
        west,south,east,north=geometry.bounds
        if not (124 <= west < east <= 132.5 and 32 <= south < north <= 39):
            raise ValueError('Source coordinates outside Korea; existing output preserved.')
        path,center=path_data(geometry)
        dongs[code]={'n':name,'g':gu,'d':path,'c':center}
        gu_parts[gu].append(geometry); sido_parts[sido].append(geometry); gu_names[gu]=gu_name
    if len(gu_parts) != 256 or len(sido_parts) != 16 or not {'11110','11680','41135','26350'} <= gu_parts.keys():
        raise ValueError('Expected provinces/districts missing; existing output preserved.')
    districts={}
    for code,parts in sorted(gu_parts.items()):
        geometry=polygonal(unary_union(parts)); path,center=path_data(geometry)
        districts[code]={'n':gu_names[code],'s':code[:2],'d':path,'c':center,'b':bounds(geometry)}
    provinces={}
    province_geometries=[]
    for code,parts in sorted(sido_parts.items()):
        geometry=polygonal(unary_union(parts)); province_geometries.append(geometry)
        provinces[code]={'n':SIDO_NAMES[code],'b':bounds(geometry)}
    frame=bounds(unary_union(province_geometries))
    return {'w':math.ceil(frame[2]),'h':math.ceil(frame[3]),'bounds':frame,'sido':provinces,'gu':districts,
            'dong':dict(sorted(dongs.items())), 'source':{
                'title':'SGIS administrative boundaries, modified by vuski/admdongkor','independentlyGenerated':True,
                'upstream':'https://sgis.kostat.go.kr/','upstreamLicense':'KOGL-1.0',
                'repository':'https://github.com/vuski/admdongkor','version':VERSION,
                'revision':REVISION,'url':SOURCE_URL,'sha256':SOURCE_SHA256,
                'license':'CC-BY-4.0','licenseUrl':LICENSE_URL,'licenseSha256':LICENSE_SHA256,
                'generatedAt':datetime.now(timezone.utc).isoformat(),'generator':'scripts/generate-admin-geo.py',
                'transformation':'Original WGS84 polygons dissolved by MOIS code; topology-preserving simplification; local SVG projection; representative-point labels.',
                'simplifyDegrees':SIMPLIFY,'projection':{'cosLatitude':36.5,'scale':SCALE,'mx':MX,'my':MY},
                'repairedInputGeometries':repaired,'stationsIncluded':False,
                'attribution':'통계청 통계지리정보서비스(SGIS, 공공누리 제1유형) / 가공 vuski/admdongkor(CC BY 4.0) / SVG 변환 buja-static-prototype',
            }}


def publish(result, destination, backup_dir):
    if destination.exists():
        old_bytes=destination.read_bytes(); old=json.loads(old_bytes)
        for kind in ('sido','gu','dong'):
            if set(old.get(kind,{})) != set(result[kind]):
                raise ValueError(f'Administrative {kind} code set changed; manual review required; previous output preserved.')
        for kind in ('gu','dong'):
            changed=[code for code,row in result[kind].items() if row['n'] != old[kind][code].get('n')]
            if changed:
                raise ValueError(f'Administrative {kind} names changed for {changed[:5]}; previous output preserved.')
        backup_dir.mkdir(parents=True,exist_ok=True)
        backup=backup_dir / f'geo-before-independent-{hashlib.sha256(old_bytes).hexdigest()[:16]}.json'
        if not backup.exists(): shutil.copyfile(destination,backup)
    destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=None
    try:
        with tempfile.NamedTemporaryFile('w',encoding='utf8',dir=destination.parent,suffix='.tmp',delete=False) as stream:
            temporary=Path(stream.name)
            json.dump(result,stream,ensure_ascii=False,separators=(',',':'));stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,destination)
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'public/data/geo.json')
    parser.add_argument('--cache-dir',type=Path,default=LOCAL_DEPS/'admin-geo-input')
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    body=verified_bytes(SOURCE_URL,SOURCE_SHA256,args.cache_dir/f'HangJeongDong_ver{VERSION}.geojson')
    license_body=verified_bytes(LICENSE_URL,LICENSE_SHA256,args.cache_dir/'LICENSE-DATA')
    if b'CC-BY-4.0' not in license_body or b'SGIS' not in license_body:
        raise ValueError('Expected attribution license missing; existing output preserved.')
    result=build(json.loads(body))
    if not args.dry_run:
        publish(result,args.output,LOCAL_DEPS/'admin-geo-backups')
    print(json.dumps({'dryRun':args.dry_run,'sido':len(result['sido']),'gu':len(result['gu']),
                      'dong':len(result['dong']),'sourceSha256':SOURCE_SHA256,
                      'repairedInputGeometries':result['source']['repairedInputGeometries'],
                      'outputBytes':len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode('utf8'))}))


if __name__ == '__main__':
    main()
