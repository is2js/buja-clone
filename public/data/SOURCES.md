# 지도 데이터와 출처

- 행정동 경계 원자료: 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr/), 공공누리 제1유형(출처표시).
- 경계 데이터의 가공 출처: [vuski/admdongkor](https://github.com/vuski/admdongkor), ver20261001, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 이 저장소의 [데이터 라이선스와 출처표시](https://github.com/vuski/admdongkor/blob/master/LICENSE-DATA)를 참조하세요.
- 이 프로토타입의 행정 경계 가공: `scripts/generate-admin-geo.py`가 위 원자료의 WGS84 폴리곤을 독립 변환합니다. `geo.json`에는 부자 사이트의 중간 경계·중심점·역 매핑을 사용하지 않습니다. 원자료의 행정안전부 10자리 `adm_cd2`와 5자리 시군구 코드를 유지하고, 구·시도는 하위 원본 폴리곤을 합쳐 생성합니다. GTX 좌표는 별도 `gtx.json`의 [역·구간 출처 문서](../../docs/gtx-sources.md)를 확인하세요.
- 배경 지도: © [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright). 기본 타일 서버는 소규모 대화형 조회용으로만 사용하며 사전 다운로드하지 않습니다. 공개 배포 및 사용량 증가 전에 [타일 사용 정책](https://operations.osmfoundation.org/policies/tiles/)에 맞는 제공자를 선택해야 합니다.
- 시세·거래량은 확보된 공개 계약 자료를 집계하고, 부분 점수는 확보된 지표로만 계산합니다. 원천이 없는 항목은 데이터 없음으로 표시합니다. `demo.json`과 `sample-3d.json`은 가상 예시입니다. [공개 자료와 한계](../../docs/real-data-sources.md)
- 실제 3D 건물은 전국 OpenStreetMap 대한민국 추출본의 건물 외곽과 OSM 기재 높이 또는 층수 기반 추정값을 이용합니다. [건물 자료와 갱신](../../docs/buildings-data.md)

## 행정 경계의 고정 원천과 재생성

2026-11-07 독립 재생성 기준은 [vuski/admdongkor 커밋 `3bc00489b76696db864bdbea4b19985cdfa8b403`](https://github.com/vuski/admdongkor/tree/3bc00489b76696db864bdbea4b19985cdfa8b403/ver20261001)의 `HangJeongDong_ver20261001.geojson`입니다. 시점은 원자료의 `ver20261001`이며 갱신일과 혼동하지 않습니다.

- [원천 GeoJSON](https://raw.githubusercontent.com/vuski/admdongkor/3bc00489b76696db864bdbea4b19985cdfa8b403/ver20261001/HangJeongDong_ver20261001.geojson), SHA-256: `843ece3a0b3429742cd4a1b699cc13987a88b5e5401f382e7fdaaa194ea5e605`.
- [동일 커밋의 데이터 라이선스](https://github.com/vuski/admdongkor/blob/3bc00489b76696db864bdbea4b19985cdfa8b403/LICENSE-DATA), SHA-256: `d892791d5ba176e3bb7cc178937b26d3b33e2ad19da581af168c9e48428ba507`. 가공 데이터는 CC BY 4.0이며 원자료 SGIS의 공공누리 제1유형 출처표시를 유지합니다. 저장소 소스 코드의 MIT와 데이터 라이선스를 구분합니다.
- 원천의 3,559개 행정동, 256개 시군구, 16개 시도 코드·이름을 검증합니다. 원천이 사용하는 전남광주 통합 코드 `12` 등은 원천 시점대로 유지합니다. 이를 다른 기준 시점의 법정동 코드로 추정 변환하지 않습니다.
- WGS84에서 위상 보존 단순화 허용오차 0.0002도를 적용하고 기존 지도와 동일한 SVG 투영으로 변환합니다. 구멍·다중 폴리곤을 유지하고 이름표 위치는 내부 대표점을 사용합니다. 거리 측정이나 법적 경계 판정용 자료가 아닙니다.
- Python 3.13과 Shapely 2.x 환경에서 `py -3.13 scripts/generate-admin-geo.py`로 재생성합니다. `--dry-run`은 검증·변환만 합니다. 고정 원천 해시·코드·이름·필수 지역 검증이 실패하면 기존 결과를 보존합니다. 이전 결과의 복구본과 내려받은 원천은 무시되는 `work/geo-deps/` 아래에 두며 공개 배포물에 넣지 않습니다.

필수 출처 표기: **통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr) 공공누리 제1유형 행정동 경계 / 가공 vuski/admdongkor(https://github.com/vuski/admdongkor), CC BY 4.0 / SVG 변환 buja-static-prototype.** 경계 데이터는 있는 그대로 제공되며 정확성·완전성을 보증하지 않습니다.

## 브이월드 인증키와 배포

로컬 Vite 개발 서버는 비공개 `.env.local`의 키로 브이월드 WMTS 배경과 도로명주소건물 WFS를 조회합니다. 정적 배포에서는 기존 OSM 자료를 사용합니다. 인증키는 이 데이터 폴더나 공개 JSON에 저장하지 않습니다. 로컬 보관, 향후 수집 환경, 공개 브라우저 키의 제한과 GitHub Pages 배포 절차는 [브이월드 키 관리와 배포](../../docs/vworld-pages.md)를 참조하세요.
