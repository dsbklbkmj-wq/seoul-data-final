"""서울 열린데이터광장 / KOSIS / 행정안전부에서 내려받은 '구별 주민등록인구' 파일(xlsx 또는 csv)을
웹페이지가 읽는 data/population.csv(연도 × 25개 구) 형식으로 변환합니다.

예시:
  python scripts/convert_opendata.py 주민등록인구_구별.xlsx --year-col 기간 --district-col 자치구 --pop-col 계
  python scripts/convert_opendata.py pop.csv --year-col 시점 --district-col 행정구역 --pop-col 총인구수

- year-col 값에서 첫 4자리 숫자를 연도로 추출합니다. ("2020.4/4", "2020년 12월" 등 모두 OK)
- 같은 연도에 여러 행(분기/월)이 있으면 마지막 행(연말)을 사용합니다.
- 25개 자치구 이름과 정확히 일치하는 행만 사용합니다. ("합계", "소계" 등은 자동 제외)
"""
import argparse, pathlib, re
import pandas as pd

DISTRICTS = ["종로구","중구","용산구","성동구","광진구","동대문구","중랑구","성북구","강북구","도봉구",
             "노원구","은평구","서대문구","마포구","양천구","강서구","구로구","금천구","영등포구","동작구",
             "관악구","서초구","강남구","송파구","강동구"]

def read_any(path, sheet=None, header=0):
    p = pathlib.Path(path)
    if p.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(p, sheet_name=sheet or 0, header=header)
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return pd.read_csv(p, encoding=enc, header=header)
        except UnicodeDecodeError:
            continue
    raise SystemExit("CSV 인코딩을 인식할 수 없습니다.")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--header", type=int, default=0, help="헤더 행 번호(0부터). 머리글이 2줄이면 1")
    ap.add_argument("--year-col", required=True)
    ap.add_argument("--district-col", required=True)
    ap.add_argument("--pop-col", required=True)
    ap.add_argument("--start", type=int, default=1995)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "data" / "population.csv"))
    a = ap.parse_args()

    df = read_any(a.input, a.sheet, a.header)
    df.columns = [str(c).strip() for c in df.columns]
    for c in (a.year_col, a.district_col, a.pop_col):
        if c not in df.columns:
            raise SystemExit(f"컬럼 '{c}' 가 없습니다. 실제 컬럼: {list(df.columns)}")

    df["_year"] = df[a.year_col].astype(str).str.extract(r"(\d{4})")[0].astype(float)
    df["_dist"] = df[a.district_col].astype(str).str.strip()
    df["_pop"] = pd.to_numeric(df[a.pop_col].astype(str).str.replace(",", ""), errors="coerce")
    df = df.dropna(subset=["_year", "_pop"])
    df = df[df["_dist"].isin(DISTRICTS)]
    df["_year"] = df["_year"].astype(int)
    df = df[(df["_year"] >= a.start) & (df["_year"] <= a.end)]
    df = df.groupby(["_year", "_dist"], as_index=False).last()   # 연말(마지막) 값 사용

    wide = df.pivot(index="_year", columns="_dist", values="_pop").reindex(columns=DISTRICTS).sort_index()
    missing = wide.isna().sum().sum()
    if missing:
        print(f"경고: 비어 있는 셀 {int(missing)}개 (해당 연도/구는 지도에서 '자료 없음'으로 표시됩니다)")

    out = pathlib.Path(a.out)
    with open(out, "w", encoding="utf-8-sig") as f:
        f.write(f"# 출처: {pathlib.Path(a.input).name} (convert_opendata.py로 변환)\n")
        f.write("year," + ",".join(DISTRICTS) + "\n")
        for y, row in wide.iterrows():
            f.write(str(y) + "," + ",".join("" if pd.isna(v) else str(int(v)) for v in row.values) + "\n")
    print("저장 완료:", out, f"({len(wide)}개 연도)")
    # 웹페이지가 읽는 data/*.js 재생성
    import subprocess, sys
    subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("build_data.py"))], check=False)

if __name__ == "__main__":
    main()
