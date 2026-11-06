# 브이월드 인증키 관리와 GitHub Pages 배포

확인일: 2026-11-05. 로컬 Vite 개발 서버는 `.env.local`의 비공개 키로 브이월드 WMTS 배경과 WFS 도로명주소건물을 조회한다. 앱은 화면의 층수 있는 건물을 층수 × 3m로 세우고 높이 미상 도형은 평면으로 나타낸다. OSM과 매우 비슷한 외곽은 중복 표시를 완화한다. 넓은 화면은 중심 부근만 조회할 수 있으며, 브이월드의 높이 미상·잘림·실패는 구분하고 필요할 때 OSM을 유지한다. 이 연동은 로컬 개발 서버에서만 동작하고 GitHub Pages·정적 미리보기에는 프록시가 없어 기존 OSM 자료를 사용한다.

## 브이월드는 필수인가?

필수는 아니다. 현재 3D 건물은 OpenStreetMap 외곽과 높이·층수 정보를 정적 자료로 변환해 사용하며 인증키가 없다. 다만 OSM은 지역·시점에 따라 도형과 높이, 이름이 빠질 수 있고, 이 프로젝트는 높이도 층수도 없는 건물을 세우지 않는다.

[국토교통부 GIS건물통합정보 WMS/WFS](https://www.data.go.kr/data/15123970/openapi.do)는 전국 건물 공간정보와 건축물대장 속성을 결합한 공식 자료를 제공한다. 연동하면 해당 API가 실제로 제공하는 구역·필드에 따라 OSM에 없는 건물 외곽이나 속성을 보완하고 갱신할 가능성이 있다. 전국 서비스 범위가 모든 건물의 완전성·높이 정확도를 보증하는 것은 아니며, 실제 응답의 필드, 개별 지역 커버리지, 높이 사용 가능 여부는 인증 후 시험해야 한다.

실시간 조회는 데이터가 제공처 갱신 주기를 따라갈 수 있으나 API 장애·호출량·네트워크에 의존한다. 정적 수집은 배포 당시 스냅샷으로 동작하므로 별도 갱신이 필요하며 가공·공개 허용 여부를 확인해야 한다. 두 방식 모두 실사 건물 모델을 자동으로 얻는 것은 아니며 지형 DEM의 해상도를 높이는 기능과도 별도다. 로컬에서 도로명주소건물 WFS와 WMTS를 연결했지만 건물·단지 ID의 정확한 매칭은 검증되지 않았다. GIS건물통합정보 레이어와 높이 필드는 아직 확인하지 않았다.

## 임장가자와 비슷한 지도를 위한 API 항목

브이월드 발급 화면에서 여러 활용 API를 선택할 수 있다면 아래 두 항목을 우선 선택한다. 메뉴·심사·이용 조건은 현재 발급 화면에서 재확인한다.

| 선택 항목 | 용도 |
| --- | --- |
| **WMS/WFS API** | `WFS`로 건물 도형과 속성을 조회한다. `도로명주소건물` 및 [GIS건물통합정보](https://www.data.go.kr/data/15123970/openapi.do)를 검토한다. WMS는 일반적으로 지도 이미지이므로 이미지 자체로 개별 건물을 돌출할 수 없다. 정확한 레이어 ID, 높이·층수·ID 필드 및 지역별 응답은 인증 후 확인한다. |
| **WMTS/TMS API** | [브이월드 배경 타일](https://www.data.go.kr/data/3046388/openapi.do)을 사용한다. 임장가자는 WMTS 배경을 사용한다고 밝힌다. |

2D데이터 API는 추후 WFS 대안으로 쓸 때 추가한다. 지금 설계는 기존 MapLibre로 건물 외곽을 돌출하므로 별도 3D 지도 API가 필수는 아니다. [임장가자 데이터 안내](https://imjangmap.co.kr/)와 공개 화면 코드는 WMTS 배경과 `도로명주소건물`·`GIS건물통합정보`를 자체 서버를 거쳐 조회한다고 설명하지만, 서버 내부의 가공 결과나 이용 조건은 이 프로젝트에 자동 적용되지 않는다.

### 키를 준비한 이후의 작업

1. 로컬 개발 환경에서 도로명주소건물 WFS의 건물명·지상층수와 성남 표본 응답을 확인했다. 높이는 지상층수 × 3m의 추정치다. 실측 높이 필드와 GIS건물통합정보 별도 레이어는 아직 확인하지 않았으며 높이와 층수가 없으면 임의의 높이를 생성하지 않는다.
2. 로컬 Vite 프록시를 통해 화면 범위의 WFS를 제한된 격자로 조회한다. 넓은 화면은 중심 부근부터, 500건 제한이 걸린 격자는 재분할해 조회하고 제한이나 실패를 알린다. 양방향으로 유일하게 일치하는 유사 외곽은 시각적 중복을 완화하며, OSM 기재 높이가 있으면 이를 우선한다. 양쪽 후보의 도형·높이·출처를 보존하고 마우스 오버에 표시하며, 이는 동일 건물 ID 매칭이 아니다. 조회가 불완전해도 받은 도형과 OSM을 유지한다. [지역별 확인](nationwide-building-audit.md)
3. WMTS 배경은 로컬 2D·3D에 연결했으며 실패 시 OSM 배경으로 돌아간다. GitHub Pages에서도 키를 숨긴 실시간 조회를 하려면 외부의 중계 서버가 별도로 필요하다.
4. 서울 원본의 5m DEM, 보행망과 건물의 단지별 연결은 별도 자료·검증이 필요하며, 브이월드 키만으로 같은 정밀도를 보장하지 않는다.

인증된 원천에서 적법하게 확보한 GeoJSON 샘플을 검토할 수 있는 [로컬 후보 변환 도구](vworld-candidate.md)가 준비되어 있다. 이 도구는 API를 호출하지 않고 지도에도 자동 연결하지 않는다.

## 우선 권장: Pages는 정적 사이트, 비밀키는 수집 환경

GitHub Pages는 공개되는 HTML·JavaScript·JSON을 제공한다. 이 안에 넣은 값은 이용자가 읽을 수 있으며, Pages에서 Python/FastAPI나 비공개 환경변수를 서버처럼 실행할 수 없다. [GitHub Pages 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

- **정적 수집 방식:** 제공 조건이 허용한다면 로컬 컴퓨터나 비공개 GitHub Actions 작업에서 키로 자료를 수집·가공한다. 키·원본 응답·요청 URL을 출력물과 로그에 넣지 말고, 재배포가 허용되는 정적 JSON만 Pages에 올린다. 획득·캐시·가공·재배포 권한은 선택한 API와 데이터별로 제공처에 확인한다. GitHub Actions에서 수집할 경우 저장소의 `Settings → Secrets and variables → Actions`에 키를 저장해 수집 단계에만 주입한다. GitHub Secrets는 워크플로에서 명시적으로 사용할 때 전달된다. [GitHub Secrets 설명](https://docs.github.com/en/actions/concepts/security/secrets)
- **브라우저 직접 조회 방식:** 브이월드가 공개 웹 호출을 허용하고 URL 등록 등 조건을 충족할 때만 웹용 키를 사용한다. 이 키는 사용자가 개발자 도구나 네트워크 요청에서 볼 수 있으므로 비밀키가 아니다. 제공자가 지원하는 도메인 제한, 호출량 제한, 모니터링 등을 적용하고 사용 조건을 확인한다. 도메인 제한은 비밀 보관과 같지 않다. 각 실제 API의 도메인 검사·CORS·호출량은 별도 검증이 필요하다.
- **실시간 비밀 조회 방식:** 브라우저에 키를 내려보내지 않으려면 인증·요청 제한 등을 갖춘 별도의 백엔드 또는 서버리스 환경이 필요하다. 이 경우 Pages는 화면만 제공하며, 별도 서버가 비밀키를 사용한다. 현재는 로컬 개발 서버 프록시만 있으며 공개 배포용 서버는 없다.

**Actions Secrets에 저장했다는 이유만으로 브라우저에 전달한 값이 숨겨지지는 않는다.** 예를 들어 나중에 `VITE_` 변수를 빌드에 사용하면 해당 값이 웹 자산에 포함된다. 비밀키를 `VITE_` 변수에 넣거나 공개 JS·HTML·JSON에 기록하지 않는다. [Vite 환경변수 문서](https://vite.dev/guide/env-and-mode). 로그의 자동 가림도 모든 변환 형태를 보장하지 않는다. 이미 공개된 키는 제공처에서 폐기·재발급한다.

## 발급과 로컬 보관

1. [브이월드](https://www.vworld.kr/)에 가입·로그인한다. 기존 [브이월드 교육자료](https://www.spacein.kr/data/bbs/279/%5B3_4%EC%B0%A8%EC%8B%9C%5D_%EB%B8%8C%EC%9D%B4%EC%9B%94%EB%93%9C%EC%84%9C%EB%B9%84%EC%8A%A4%ED%99%9C%EC%9A%A9%EB%B0%8F%EA%B0%9C%EB%B0%9C.pdf)는 `마이포털 → 나의 오픈API → 인증키 관리 → 발급하기` 순서를 안내하지만, 실제 발급 화면의 최신 절차와 약관을 우선한다.
2. 서비스명·용도·실제 주소와 필요한 API를 선택한다. 건물 외곽과 속성에는 [GIS건물일반집합정보 WMS/WFS](https://www.data.go.kr/data/15123552/openapi.do) 등 선택지가 있다. 구체 레이어·엔드포인트와 이용 조건은 실제 연동 시 정한다. 등록 URL이 개발용 `http://127.0.0.1:5189/`인지, 최종 `https://사용자명.github.io/저장소명/`인지에 따라 등록 가능 여부와 키 구분을 제공처에 확인한다. 포트·localhost·경로 처리와 개발/운영 승인 조건을 미리 단정하지 않는다.
3. 키는 채팅·공개 저장소·공개 파일에 붙여넣지 않는다. 필요하면 로컬 비공개 `.env.local` 등으로 관리하고, 다음과 같은 값은 예시로만 취급한다. **로컬 개발 서버의 프록시가 이 이름을 읽는다.** 입력 또는 변경 뒤 서버를 재시작한다. 정적 Pages나 미리보기에는 키가 전달되지 않는다.

   ```dotenv
   VWORLD_API_KEY=발급받은_본인_키
   VWORLD_KEY_EXPIRES_ON=YYYY-MM-DD
   ```

   `.gitignore`는 `.env`와 `.env.*`를 제외하며, `.env.example`만 예외다. 예시 파일을 만들 때에는 키를 넣지 않는다. 이미 Git에 추적되었거나 공개된 파일에는 ignore가 소급 적용되지 않으므로 제거 및 재발급이 필요하다. `public/`은 빌드 때 복사되어 공개되므로 키 파일을 넣지 않는다. 로컬 파일도 OS 계정 권한과 백업 위치를 관리한다.
4. 브이월드의 최신 개발·운영키 유효기간, 운영 승인, 이용량, 데이터 출처 표시 및 저장·갱신·캐시·재배포 조건을 확인한다. 다른 서비스의 조건을 이 프로젝트에 그대로 적용하지 않는다.

현재 발급 화면에 표시된 로컬 **개발키 만료일은 2027-05-05**이며, `.env.local`의 `VWORLD_KEY_EXPIRES_ON`에 기록한다. 로컬 서버 시작과 지도 페이지 로드 시 한국 날짜 기준 만료 30일 전부터 경고하고, 만료일 다음 날부터 만료 경고를 표시한다. 이는 기록된 날짜를 기준으로 한 안내이며 실제 인증 상태 확인이나 자동 갱신은 아니다. 사이트가 열려 있지 않은 동안 별도 알림은 발송하지 않는다. 브이월드 인증키 관리 화면에서 연장·재발급 상태와 실제 만료일을 확인하고, 변경된 키와 날짜를 `.env.local`에 반영한 후 개발 서버와 페이지를 다시 시작한다. 키 및 환경 파일은 저장소와 배포 산출물에 포함하지 않는다.

## 키 없이 현재 사이트 배포하기

현재 프로젝트의 `vite.config.js`는 `base: './'`이므로 HTML 기준 상대 경로를 사용한다. 저장소 경로에 맞춰 명시하고 싶다면 `npm run build -- --base=/저장소명/`로 빌드할 수 있다. 계정 루트 사이트 `https://사용자명.github.io/` 또는 커스텀 도메인이라면 `/`를 사용한다. [Vite 정적 배포 문서](https://vite.dev/guide/static-deploy), [상대 base 설명](https://vite.dev/guide/build#relative-base).

1. Node.js 20 이상을 설치하고 프로젝트에서 `npm ci`와 `npm run build`를 실행한다. 빌드 결과는 `dist/`다. OSM 건물·보행망, 공식 통계 및 행정동 경계 등 **각 데이터의 공개·출처·재배포 조건을 확인**한다. 이 프로젝트는 일부 자료의 외부 재배포 조건이 아직 확인되지 않았으므로 확인되지 않은 파일은 공개하지 않는다.
2. GitHub에 본인 저장소를 만들고 키가 들어 있지 않은 소스와 배포가 허용된 데이터를 올린다. 저장소 `Settings → Pages → Build and deployment → Source`에서 `GitHub Actions`를 선택한다. [GitHub Pages 게시 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. 아래 예시를 `.github/workflows/deploy.yml`로 저장한 뒤 `main`에 반영하면 Actions가 빌드된 `dist/`를 게시한다. 기본 브랜치가 다르면 `branches`를 그 이름으로 바꾼다. 이 예시는 브이월드 키를 전혀 사용하지 않으며, 배포 사이트는 OSM 자료를 사용한다. 파일을 작성하기 전까지 자동 배포는 활성화되지 않는다.

   ```yaml
   name: Deploy static site
   on:
     push:
       branches: [main]
     workflow_dispatch:

   permissions:
     contents: read
     pages: write
     id-token: write

   jobs:
     deploy:
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - uses: actions/checkout@v6
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: npm
         - run: npm ci
         - run: npm run build
         - uses: actions/configure-pages@v5
         - uses: actions/upload-pages-artifact@v4
           with:
             path: dist
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

4. Actions 실행 상태와 Pages 주소를 확인하고, 배포 주소에서 데이터 JSON·지도 타일·2D/3D 및 건물 출처 표시가 정상인지 점검한다. 공개 페이지와 배포 산출물, 개발자 도구 네트워크 요청에 키가 들어가지 않았는지 확인한다. HTTPS·OSM 타일 사용 정책·대역폭 제한도 확인한다.

실제 공개 배포는 별도 단계다. 이 문서는 페이지나 인증키를 생성하지 않는다.
