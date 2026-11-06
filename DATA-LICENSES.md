# 공개 데이터 출처와 라이선스

- `public/data/buildings/`, `public/data/walking/`: © OpenStreetMap contributors, [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Geofabrik 대한민국 추출본에서 만든 파생 데이터베이스를 ODbL 1.0으로 제공합니다. 가공 코드는 `scripts/build-osm-buildings.py`, `scripts/build-walking-graph.py`에 있습니다. 앱 소스 코드 전체의 라이선스를 뜻하지 않습니다.
- 행정 경계: 통계청 SGIS의 공공누리 제1유형 자료를 가공한 vuski/admdongkor, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 고정 원천·변환·출처 표기는 [공개 데이터 안내](public/data/SOURCES.md)에 있습니다.
- 법정 경계: 국가공간정보포털·공공데이터포털 원천, KnellBalm/kr-admin-geojson 가공, 출처표시 조건. [기준일과 한계](docs/legal-geography.md)를 확인하세요.
- 단지·좌표·상권 및 GTX: 자료별 제공기관·이용 조건·공개 제외 항목은 [공개 프로필](docs/pages-data-profile.md)에 정리했습니다. 조건을 확인하지 못한 KRIC 좌표 2곳은 공개 JSON에서 생략합니다.
- 배경지도: © OpenStreetMap contributors. 고도: Terrain Tiles / Mapzen, USGS SRTM/GMTED2010 등. 라이브 타일은 배포 파일에 포함하지 않으며 화면 범위의 대화형 요청으로만 표시합니다.

로컬 실거래 집계와 비밀키는 공개 소스 및 Pages 산출물에 포함하지 않습니다.
