"""서울 25개 자치구 경계(GeoJSON)를 data/seoul_districts.geojson 으로 저장합니다.
사용법:  python scripts/download_geo.py
출처: https://github.com/southkorea/seoul-maps (juso/2015, simplified)
"""
import urllib.request, pathlib

URL = "https://cdn.jsdelivr.net/gh/southkorea/seoul-maps@master/juso/2015/json/seoul_municipalities_geo_simple.json"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "seoul_districts.geojson"

if __name__ == "__main__":
    print("다운로드 중:", URL)
    urllib.request.urlretrieve(URL, OUT)
    print("저장 완료:", OUT, f"({OUT.stat().st_size/1024:.0f} KB)")
