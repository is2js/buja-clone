# GitHub Pages 공개 데이터 프로필

확인일: 2026-11-07 (한국 시간). 공개판 프로필은 `github-pages-public-v1`이다. 로컬 개발 자료를 삭제하거나 공개 권한이 확인됐다고 일괄 변경하지 않고, 게시할 파일을 별도로 준비한다.

## 실거래 집계를 제외하는 이유

로컬 `public/data/real/transactions.json`과 `transactions-other.json`은 [RTMS 조건별 자료제공](https://rt.molit.go.kr/pt/xls/xls.do)의 계약일 기준 CSV를 집계했다. 수집 경로는 `real-data-sources.md`에 기록되어 있으며, 두 집계 스크립트와 JSON의 `source`도 실거래가 공개시스템으로 명시한다. 공공데이터포털 API에서 별도로 승인·수집한 결과로 바꿔 표현하지 않는다.

[공공데이터포털 3050988](https://www.data.go.kr/data/3050988/fileData.do)의 메타데이터는 이용허락범위 제한 없음을 표기하지만, 실제 RTMS 다운로드 화면은 외부 공개에 신고일 기준 공식통계 사용을 안내한다. [공개안내](https://rt.molit.go.kr/pt/info/info.do)는 대량·반복 이용은 공공데이터포털을 사용하도록 안내하고 자동화된 수집·가공·재배포를 제한한다. 이 안내의 적용을 자체 판단으로 허용 처리하지 않고, 공개판에서는 해당 계약일 집계와 그 집계로 계산되는 가격·거래량·전세가율·부분 점수를 제외한다. 제공기관 조건을 확인한 독립 API 수집 자료 또는 공식통계로 교체하는 것은 후속 단계다.

## 포함 자료와 조건 확인

- 전국 OSM 건물·서울/하남 시범 보행망은 [Geofabrik](https://download.geofabrik.de/asia/south-korea.html)의 OSM 파생 자료다. © OpenStreetMap contributors와 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)을 표시하고, 가공 데이터와 처리 스크립트를 함께 제공한다. 다른 독립 원천과 파일을 구분한다.
- [OSM 타일 정책](https://operations.osmfoundation.org/policies/tiles/)은 현재 화면의 일반 대화형 조회와 브라우저 기본 캐시·Referer 사용을 허용한다. 사이트는 HTTPS 타일 URL을 사용하고 사전 일괄 다운로드나 캐시 우회를 제공하지 않는다. 출처표시는 지도에서 계속 보여야 한다. 공개 트래픽 증가 시 다른 제공자로 변경할 수 있으며 무중단 제공은 보장되지 않는다.
- [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)는 공개 S3 고도 자료다. 한국 범위의 글로벌 SRTM/GMTED2010 원천과 USGS를 [Joerd 출처 안내](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)에 따라 표시한다. 고도는 저해상도 참고 추정치다.
- [한국부동산원 기본정보](https://www.data.go.kr/data/15106861/fileData.do)·[동정보](https://www.data.go.kr/data/15106866/fileData.do), [하남시](https://www.data.go.kr/data/3047304/fileData.do)·[달서구](https://www.data.go.kr/data/15054183/fileData.do)·[광산구](https://www.data.go.kr/data/15100132/fileData.do) 좌표, [상가·상권 파일](https://www.data.go.kr/data/15083033/fileData.do)은 확인 당시 공식 메타데이터의 이용허락범위가 제한 없음이다. 연락처·소유자·거주자 정보는 산출물에 넣지 않는다.
- [서울시 공동주택](https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do)은 공공누리 제1유형이며, 제공기관·자료명·출처 링크와 가공 여부를 표시한다.
- 행정 경계의 공개 프로필 검토는 별도다. `prepare-pages.mjs`는 허용 경계로 교체됐는지 자체 추정하거나 기존 배포 점검표를 자동 통과시키지 않는다.
- GTX는 `gtx-public.json`을 사용한다. 구성·동탄 두 역의 KRIC 좌표는 현재 공개 재사용 조건을 확인하지 못해 공개용 파일에서 `null`로 두고 인접 구간도 그리지 않는다. 역명·상태·공식 자료 링크는 유지하며, 임의의 위치나 인근 역 좌표로 대체하지 않는다. 로컬 원본 `gtx.json`은 공개 저장소와 배포물에서 제외한다.

## 공개 산출물 준비

1. 공개용 UI 설정과 경계·GTX 출처 검토를 마친 뒤 정적 빌드를 실행한다.
2. `node scripts/prepare-pages.mjs`는 `dist/`의 명시적 허용 목록만 `work/pages-dist/`로 복사한다. 실거래 두 파일은 빈 `status: withheld` 메타데이터로 새로 만들며, 원본 값·기간·표본·차트·점수는 복사하지 않는다. 다른 허용 JSON에서 실거래 지표가 발견되면 중단한다.
3. `release-profile.json`에 공개 프로필과 제외 사유를 기록하고 `DATA-LICENSES.md`, ODbL 직접 링크, OSM 처리 스크립트 및 `.nojekyll`을 추가한다. 기존 산출물은 확인된 프로필만 `work/pages-previous-*/pages-dist/`로 보존한 뒤 새 후보로 교체한다. Windows에서 디렉터리 이름 변경이 잠겨 있으면 완성된 `work/pages-candidate-*`를 그대로 최종 산출물로 사용하며, 기존 폴더에 덮어 섞지 않는다. 임의 경로의 재귀 삭제는 하지 않는다.
4. 공개 저장소의 소스 브랜치에도 로컬 실거래 JSON·원본 CSV·작업 폴더·`.env.local`을 올리지 않는다. 배포 산출물만 거르는 것으로 소스 저장소 공개가 안전해지는 것은 아니다. 공개용 저장소에 선택한 파일만 올리고 키 값·원본 가공물 포함 여부를 검사한다.
5. 완료된 후보의 실제 상대경로는 `work/pages-output.json`의 `outputDir`에서 읽는다. GitHub Actions에서는 같은 경로를 `GITHUB_OUTPUT`의 `pages_dir`로 기록한다. **이 경로가 가리키는 완성된 산출물만** Pages 게시 대상으로 사용한다. 브이월드 키·프록시가 없으므로 공개판은 정적 OSM 건물을 표시한다. 공개 URL에서 JSON·워커·건물 타일·자료 제외 안내를 확인한다.

이 프로필은 모든 로컬 자료의 재배포 허가나 법률 판정을 의미하지 않는다. 포함 자료의 출처와 현재 검토 결과, 제외된 자료를 구분하기 위한 게시 절차다.
