"""Download the DB-IP Lite city and ASN databases (CC BY 4.0, https://db-ip.com) for the visit log."""
import datetime
import gzip
import pathlib
import shutil
import sys
import urllib.request

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/code/geo")
out.mkdir(parents=True, exist_ok=True)
today = datetime.date.today()
months = [today.strftime("%Y-%m"), (today.replace(day=1) - datetime.timedelta(days=1)).strftime("%Y-%m")]
for kind in ("city", "asn"):
    for m in months:
        url = f"https://download.db-ip.com/free/dbip-{kind}-lite-{m}.mmdb.gz"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; portfolio-geo-fetch/1.0)"})
            with urllib.request.urlopen(req, timeout=180) as r, gzip.open(r) as g, open(out / f"{kind}.mmdb", "wb") as f:
                shutil.copyfileobj(g, f)
            print("downloaded", url)
            break
        except Exception as e:  # geo lookups are optional; the API still runs without them
            print("skip", url, e)
