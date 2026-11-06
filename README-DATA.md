# 데이터 구성과 연동

현재 지도는 Alpine.js와 정적 JSON을 사용한다. `public/data/demo.json`과 `sample-3d.json`은 가상 예시다. 실제 거래 집계와 부분 점수는 별도 공개 자료에서 계산되며 없는 값은 데이터 없음으로 나타낸다. 원천·기준일·검증 범위는 [실데이터 출처](docs/real-data-sources.md)와 [점수 품질](docs/data-quality-and-maintenance.md)을 참조한다.

- 행정동 경계: `public/data/geo.json`. 법정동 코드 및 일부 경계: `public/data/legal.json`. 경계 시점과 재배포 조건은 [지도 데이터 출처](public/data/SOURCES.md)를 확인한다.
- GTX: `public/data/gtx.json`과 좌표 파일. 출처와 상태는 [GTX 자료](docs/gtx-sources.md)에 별도로 기록한다. 역 사이 선은 실제 선로가 아니라 개략도다.
- 공동주택: `public/data/real/apartments/`의 공식 정적 자료. 대표 좌표와 개별 건물의 ID를 동일하다고 가정하지 않는다. [단지 자료](docs/apartment-sources.md)
- 3D 건물: `public/data/buildings/`의 OSM 대한민국 추출본. 지상 높이 또는 층수 정보가 있는 건물만 표시한다. [건물 출처와 갱신](docs/buildings-data.md)
- 보행 경로: `public/data/walking/`의 서울·하남 주변 OSM 시범 자료. 저해상도 DEM에서 계산한 경사는 참고 추정치다. [보행망 자료](docs/walking-data.md)
- 데이터 접근은 `src/data.js`, `src/legal.js`, `src/apartment-data.js` 등에서 담당한다. API 수집/백엔드로 교체하는 과정은 별도 구현이 필요하다.
- 공개 전 권리·자료 교체 및 운영 조건: [배포 준비](docs/release-readiness.md). 일부 지도 경계와 GTX 좌표는 부자 원본의 중간 가공물을 사용하고 있어 이용 조건 확인 또는 독립 원천의 재생성이 필요하다.

## 브이월드 및 GitHub Pages

로컬 Vite 개발 서버에서는 `.env.local`의 키로 브이월드 WMTS 배경과 도로명주소건물 WFS를 전국 화면 범위에서 조회한다. 밀집 구역의 응답은 분할 재조회하며 실패와 결과 제한을 표시한다. 정적 GitHub Pages 및 미리보기는 서버 프록시가 없어 OSM을 이용한다. WFS 층수 × 3m는 추정 높이이고 층수 미상은 평면 외곽으로 표시한다. 지역 표본과 범위의 한계는 [전국 건물 자료 확인](docs/nationwide-building-audit.md), 키 관리 및 공개 배포는 [브이월드와 Pages 안내](docs/vworld-pages.md)를 참조한다. 키는 public 데이터나 Vite 공개 번들에 넣지 않는다.
