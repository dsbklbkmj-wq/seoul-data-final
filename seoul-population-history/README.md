# 서울 인구 밀도 역사 (1995–2025)

서울 25개 자치구의 주민등록인구 변화를 연도 슬라이더와 점(코호트) 애니메이션으로 보여주는 인터랙티브 지도입니다.
Leaflet + 순수 JavaScript로 만들어져 빌드 과정 없이 GitHub Pages에 바로 올릴 수 있습니다.


## 실행 방법 (중요)

`index.html`을 **더블클릭해서 바로 열어도 동작**합니다. 인구 데이터는 `data/population.js`, `data/districts.js`에 임베드되어 있고,
자치구 경계(GeoJSON)만 인터넷(jsDelivr CDN)에서 불러오므로 네트워크 연결이 필요합니다.

로컬 서버로 열어도 됩니다: `python -m http.server 8000` → http://localhost:8000

## 데이터 수정 시 꼭 할 일

1. `data/population.csv`를 수정하거나 `scripts/convert_opendata.py`로 교체합니다.
   - CSV는 **UTF-8(BOM)** 로 저장되어 있어 엑셀에서 바로 열어도 한글이 정상 표시됩니다.
   - 엑셀에서 저장할 때는 "CSV UTF-8(쉼표로 분리)(*.csv)" 형식을 선택하세요. 일반 "CSV(쉼표로 분리)"로 저장하면 CP949로 저장되어 깨집니다.
2. `python scripts/build_data.py` 를 실행해 `data/*.js`를 다시 생성합니다. (convert_opendata.py는 자동으로 실행해 줍니다.)
   - 이 단계를 빼먹으면 웹페이지는 예전 데이터를 계속 보여줍니다.


## 기능
| 왼쪽 패널 | 오른쪽 지도 |
|---|---|
| 제목 · 설명 | 서울 25개 자치구 경계 (CARTO 라이트 베이스맵) |
| 연도 슬라이더 (1995–2025, 1년 단위) | 확대/축소 버튼 (오른쪽 위) |
| 재생/정지, 이전/다음 | 구 위에 hover → 인구·밀도·전년 대비 툴팁 |
| 속도 0.5x / 1x / 2x | 중앙에 서울 총인구 라벨 |
| 코호트 스케일 (점 1개 = 5천/1만/2만/5만 명) | 하단 출처 표시 |
| 표시 방식 (점 / 밀도 색 / 점+색) + 범례 | 점이 나타나고 사라지는 애니메이션 |
| 서울 전체 통계 카드 | 키보드: Space 재생, ←/→ 연도 이동 |

## 폴더 구조
```
seoul-population-history/
├── index.html
├── css/style.css
├── js/app.js
├── data/
│   ├── population.csv          # 연도 × 25개 구 인구  ← ★ 실제 데이터로 교체 필요
│   ├── districts.csv           # 구 이름(영문), 면적(km²)
│   └── seoul_districts.geojson # (선택) scripts/download_geo.py 로 생성. 없으면 CDN에서 자동 로드
├── scripts/
│   ├── download_geo.py         # 자치구 경계 GeoJSON 다운로드
│   └── convert_opendata.py     # 공공데이터 xlsx/csv → population.csv 변환
└── README.md
```

## 로컬 실행
`index.html`을 더블클릭(file://)하면 브라우저가 CSV/GeoJSON 읽기를 막습니다. 아래 중 하나로 실행하세요.

```bash
# 방법 1
python -m http.server 8000      # → http://localhost:8000
# 방법 2: VS Code 확장 "Live Server" → index.html 우클릭 → Open with Live Server
```

## ★ 데이터 교체 (반드시 할 것)
현재 `data/population.csv`는 **임시 데이터**입니다. 5년 단위 앵커 연도의 근사치를 선형보간한 값이라
추세 확인용으로만 쓰고, 제출 전에 실제 통계로 교체해야 합니다.

1. 데이터 받기 (둘 중 하나)
   - **서울 열린데이터광장** (data.seoul.go.kr) → "주민등록인구 (구별)" 검색 → 전체 기간 xlsx/csv 다운로드 (1992년~, 분기별)
   - **KOSIS** (kosis.kr) → 행정안전부 「주민등록인구현황」 → 행정구역(시군구)별 → 서울 25개 구 선택, 1995~2025
2. 변환
   ```bash
   pip install pandas openpyxl
   python scripts/convert_opendata.py 내려받은파일.xlsx --year-col 기간 --district-col 자치구 --pop-col 계
   ```
   컬럼 이름은 내려받은 파일의 실제 머리글에 맞게 바꿔 주세요. (실행 시 없는 컬럼이면 실제 컬럼 목록을 알려줍니다)
3. 또는 엑셀에서 직접 `data/population.csv` 형식(첫 열 `year`, 이후 25개 구, 쉼표 없는 정수)으로 저장해도 됩니다.
   `#`로 시작하는 줄은 주석으로 무시됩니다.

> 참고: 25개 구 체계가 완성된 해가 1995년(광진·강북·금천 분구)이라 1995년부터 끊김 없이 비교할 수 있습니다.

## GitHub Pages 배포
```bash
git init
git add .
git commit -m "서울 인구 밀도 역사 지도"
git branch -M main
git remote add origin https://github.com/<아이디>/<저장소이름>.git
git push -u origin main
```
GitHub 저장소 → **Settings → Pages → Branch: main / (root) → Save**
→ 1~2분 후 `https://<아이디>.github.io/<저장소이름>/` 에서 확인.

## 출처
- 인구: 서울 열린데이터광장 「주민등록인구 (구별)」, 행정안전부 주민등록인구통계
- 경계: [southkorea/seoul-maps](https://github.com/southkorea/seoul-maps) (juso 2015, simplified)
- 지도 타일: © OpenStreetMap contributors, © CARTO
- 라이브러리: [Leaflet 1.9.4](https://leafletjs.com/)

## 구현 메모 (발표용)
- 점 배치: 각 구 폴리곤의 bbox 안에서 난수를 뽑아 **ray-casting 점-내부 판정**으로 걸러냄.
  구 코드(`SIG_CD`)를 시드로 쓰는 **고정 난수(mulberry32)** 라서 연도가 바뀌어도 기존 점은 그대로 있고
  늘어난/줄어든 만큼만 나타나거나 사라짐 → 애니메이션이 자연스럽다.
- 성능: 점은 Leaflet `circleMarker`(SVG) + CSS 애니메이션. 1만 명 스케일에서 약 1,000개, 5천 명 스케일에서 약 2,000개.
- 밀도 색상: 인구 ÷ 면적(km²)을 6단계 고정 구간으로 나눠 choropleth 표시.
