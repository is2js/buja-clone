# 부자 부동산 지도 프로토타입

Alpine.js, Tailwind CSS, Vite로 만든 정적 지도 프로토타입입니다. 공개판은 전국 지도·OSM 3D 건물·단지 목록과 GTX를 제공하며, 현재 실거래·부분 점수는 자료 준비 중으로 표시합니다. 로컬에 보관한 2025-11~2026-10 계약일 실거래 집계와 API 키는 저장소 및 배포물에서 제외합니다. 없는 수치는 생성하지 않으며 상권 업소는 실거래 가격과 다른 자료입니다.

## 실행

Node.js 20 이상에서 프로젝트 폴더에서 실행하세요.

```bash
npm install
npm run dev
```

표시된 주소를 브라우저에서 엽니다. JSON을 불러오므로 HTML을 직접 열지 말고 서버를 사용하세요. `npm run build`는 `dist/`를 생성하며 `npm run preview`로 확인할 수 있습니다.

## GitHub Pages 공개판

`npm run build:pages`로 `/buja-clone/` 경로의 공개 후보를 준비합니다. 실제 산출물 경로는 `work/pages-output.json`에 기록됩니다. `dist/` 자체는 로컬 자료를 포함할 수 있으므로 게시하지 않습니다. GitHub의 **Actions → Deploy map demo → Run workflow**로만 게시하며 일반 push는 자동 배포하지 않습니다. [제외 자료·출처·배포 절차](docs/pages-data-profile.md)를 참고하세요.

광역 화면의 3D에서는 개별 건물이 아직 보이지 않을 수 있습니다. **이 위치 건물 보기**를 누르면 현재 중심을 유지해 확대합니다. 공개판은 OSM 자료를 사용하므로 로컬 브이월드가 보완한 건물과 표시 밀도가 다를 수 있습니다.

## 데이터와 출처

- `public/data/real/transactions.json`: 서울·경기 아파트와 상업·업무용 거래 집계. [획득·집계 방법](docs/real-data-sources.md)
- `public/data/real/businesses.json`: 소상공인시장진흥공단의 업소·업종 집계. 임대료·매매가격·매출액과는 다릅니다.
- `public/data/legal.json`: 공식 현존 법정동 코드와 별도로 수집한 2023년 법정동 경계. [경계 출처와 기준일](docs/legal-geography.md)
- `public/data/geo.json`: 원본 사이트에서 변환한 행정동 경계. [출처 및 재배포 조건](public/data/SOURCES.md)
- `public/data/gtx.json`: GTX A~F 및 연장의 역·구간 상태, 기준일, 확인일과 출처. [GTX 근거](docs/gtx-sources.md)
- `src/data.js`, `src/legal.js`, `src/real-data.js`: 원천을 화면에 연결하는 데이터 접근 계층.
- 브이월드 인증키와 GitHub Pages 배포: [키 관리 및 배포 안내](docs/vworld-pages.md). 로컬 Vite에서만 브이월드 배경·건물 조회를 사용하며 정적 Pages는 OSM으로 동작합니다.

서울·경기 법정동 1,214개 중 1,150개에 2023년 경계를 연결했습니다. 나머지는 다른 지역의 경계로 대체하지 않습니다. 실제 거래 자료는 법정동·시군구로만 정확히 연결하며 행정동에 임의 배분하지 않습니다. GTX는 출처가 확인된 좌표만 지도에 표시하고 역 간 직선은 실제 선로가 아닌 개략도입니다.

이 거래 집계는 계약일 기준 로컬 참고 자료입니다. 국토부 다운로드 자료는 외부 공개 통계에 신고일 기준 공식통계 사용을 안내하므로, 외부 서비스에 공개하기 전 이용 조건과 공식통계 사용을 확인해야 합니다. 법정동 경계의 시점과 행정동 중간 가공물의 재배포 조건 및 OSM 타일 정책도 확인해야 합니다. 이 프로젝트는 자동 배포하지 않습니다.

## 향후 갱신

공식 CSV 또는 상권 ZIP을 받아 `scripts/aggregate-transactions.py`, `scripts/aggregate-shops.py`로 정적 집계를 재생성합니다. 기간 설정과 사용법은 [실데이터 출처 문서](docs/real-data-sources.md)에 있습니다. 추후 API 승인과 키가 준비되면 비공개 수집 환경에서 갱신하고 JSON만 공개할 수 있으며, FastAPI는 필요할 때 별도로 추가합니다. 원본 부자 사이트의 데이터 구조와 확인 한계는 [분석 문서](docs/buja-data-analysis.md)를 참조하세요.

## 점수와 데이터 관리

화면의 부분 점수는 원본 다섯 항목 중 아파트 가격·거래량·전세가율만을 사용합니다. 원본 가중치 100 중 60에 해당하며 1년 흐름과 GTX를 제외하므로 원본 점수와 직접 비교하지 않습니다. 세 지표 모두 충분한 유효 표본이 있고 비교군이 5개 이상일 때만 같은 시도·지역유형·출처·기준기간 안에서 순위를 계산합니다. 자세한 항목과 표본 수는 지역 상세에 표시합니다. 행정동 거래는 법정동 수치를 임의 배분하지 않으며 상위 시·군·구 수치는 별도의 참고 정보입니다.

정적 데이터는 자동 갱신되지 않습니다. [데이터 확보 및 재집계 절차](docs/real-data-sources.md)에 따라 공식 자료를 다시 받아 수동 갱신하세요. `node scripts/check-data.mjs`로 기준일, 부분 점수 대상, 상권 코드 불일치와 법정동-시군구 합계 차이를 검사합니다. 자동 갱신이나 FastAPI는 별도 수집 환경·API 승인·키 관리가 준비된 후 도입할 수 있습니다.
