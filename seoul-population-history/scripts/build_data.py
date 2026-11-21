# -*- coding: utf-8 -*-
"""data/*.csv → data/*.js 변환.
CSV를 수정(또는 convert_opendata.py로 교체)한 뒤 반드시 한 번 실행하세요.
    python scripts/build_data.py
"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

def csv_to_js(src, varname, dst):
    with open(src, "rb") as f:
        txt = f.read().decode("utf-8-sig")  # BOM 유무 모두 처리
    lines = [l for l in txt.splitlines() if l.strip() and not l.strip().startswith("#")]
    body = "\n".join(lines).replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("// 자동 생성 파일 — 직접 수정하지 말고 data/%s 수정 후 `python scripts/build_data.py` 실행\n" % os.path.basename(src))
        f.write("window.%s = `%s`;\n" % (varname, body))
    print("생성:", dst, "(%d행)" % (len(lines) - 1))

if __name__ == "__main__":
    csv_to_js(os.path.join(DATA, "population.csv"), "SEOUL_POPULATION_CSV", os.path.join(DATA, "population.js"))
    csv_to_js(os.path.join(DATA, "districts.csv"),  "SEOUL_DISTRICTS_CSV",  os.path.join(DATA, "districts.js"))
