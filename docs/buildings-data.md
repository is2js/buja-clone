# 실제 3D 건물: 전국 OSM 공개 자료

검토 및 추출 기준일: 2026-11-04 (대한민국 Geofabrik 추출본). `public/data/buildings/`는 [Geofabrik 대한민국 추출본](https://download.geofabrik.de/asia/south-korea.html)에서 가공한 © OpenStreetMap 기여자 자료이며, [ODbL 1.0](https://www.openstreetmap.org/copyright) 조건으로 제공한다. 원본과 파생 파일의 이용·배포 시 기여자 출처와 ODbL 및 데이터베이스 공유 조건을 확인해야 한다.

자료 처리 범위는 경도 124~132, 위도 32~39의 사각 영역 내 대한민국 OSM 추출본이며, 행정구역 경계와 정확히 일치하는 방식은 아니다. 서울·성남 및 다른 지역을 포함한다. **이 범위 내의 모든 건물이 등록된 것은 아니며** OSM에 외곽·높이 정보가 없는 건물은 나타나지 않는다. 건물 위치·형상·높이·갱신일은 입력 시점과 현장 상태에 따라 다를 수 있다. 대표 단지 좌표와 OSM 개별 건물은 같은 단지로 자동 연결하지 않는다.

2026-11-04 추출본에는 건물 외곽 221,517건이 포함된다. 그중 OSM 기재 높이 75,882건, 층수 × 3m 추정 145,635건이며 2,733개 타일의 총 용량은 약 91.5MB다. 클라이언트는 현재 지도 범위 주변 타일만 지연해서 불러온다. 지역별 등록률은 서로 다르고 높이 정보가 빠진 건물은 보이지 않는다.

OSM `building` 폴리곤 또는 멀티폴리곤 외곽에서 직접 확인되는 `height` 태그가 있으면 이를 사용한다. 이 값은 OSM에 **기재된 값**으로, 실측이나 지붕 형태의 정확성을 보증하지 않는다. 유효한 높이가 없고 `building:levels`가 있으면 층수 × 3m의 단순 추정치를 사용한다. 둘 다 없거나 파싱할 수 없는 값은 건물을 세우지 않는다. 높이 한계는 1~650m, 층수 한계는 1~200층이다. `building:part` 객체는 부모 건물 중복 돌출을 줄이기 위해 생략하므로 부분별 높이는 표현되지 않는다. 동일 외곽은 중복 생성하지 않고 Polygon 구멍·MultiPolygon은 유지한다. 주변 시설과 내부 건물이 모두 보이는 것을 보증하지 않는다.

`manifest.json` 통계에서 `nationwide`로 시작하는 입력·누락 건수는 대한민국 PBF 전체 기준이며, `included`, `heightTagged`, `heightFromLevels`, `relations`는 처리 경계 상자 기준이다. `manifest.json`은 자료·기준일·범위·타일 목록을 제공하고 `tiles/{x}_{y}.json`은 0.02도 격자의 GeoJSON FeatureCollection이다. `properties.heightSource`가 `height`이면 OSM 기재 높이, `levels`이면 층수×3m 추정이다. 타일은 중심점을 기준으로 지정하며 실제 건물 윤곽은 타일 바깥으로 걸칠 수 있다. 지도는 화면 주변 타일만 지연 로드해야 한다. API 키와 서버는 필요 없지만 새로 갱신하지 않으면 데이터는 그대로다.

## 갱신

1. 위 Geofabrik 파일 화면에서 대한민국 PBF를 직접 내려받고 추출 기준일을 확인한다. 원본은 `work/route-input/south-korea-latest.osm.pbf`에 보관하며 배포물에는 포함하지 않는다.
2. Python 환경에 `osmium`을 설치한다. 이전 보행망 처리용 `work/route-deps`가 같은 Python 버전으로 준비되어 있다면 PowerShell에서 `$env:PYTHONPATH='work/route-deps'`를 사용할 수 있다.
3. `py -3.13 scripts/build-osm-buildings.py work/route-input/south-korea-latest.osm.pbf --as-of YYYY-MM-DD`를 실행한다. 기준일은 실제 다운로드 추출일을 입력하고, OS·Python 버전이 다르면 대응 환경의 Python 명령을 사용한다. 추출·최소 건수 검증이 실패하면 이전 결과를 유지한다.
4. 기준일과 항목 수, 건물이 부족한 구역과 대표 건물의 위치·높이를 확인한 뒤 `npm run build`를 실행한다.

새로 생성한 건물 타일은 기존 `tiles/`를 덮어쓰지 않고 `versions/buildings-.../tiles/`에 완성한 뒤 `manifest.json`을 원자적으로 교체한다. 중단되면 이전 manifest와 타일을 유지하고, 교체에 실패해 남은 미참조 버전은 추후 확인할 수 있다. 기존 v1 `tiles/` 경로도 계속 읽는다. 열린 페이지가 이전 버전을 요청할 수 있으므로 게시 환경의 캐시 수명을 고려해 이전 버전을 보관하고, 참조되지 않음을 확인한 후에만 정리한다. 배포 시 manifest와 해당 버전의 모든 타일을 함께 게시한다.

이 자료는 임장가자의 브이월드 건물 데이터가 아니며 해당 사이트의 가공물을 재배포하지 않는다. 더 완전하고 풍부한 건물 범위는 브이월드 등 공식 데이터의 인증, 층수·높이 결합, 응답 범위·CORS·호출량·저장/캐시 조건을 확인한 이후 별도 단계에서 연결한다.
