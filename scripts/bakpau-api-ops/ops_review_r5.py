#!/usr/bin/env python3
"""
ops_review_r5.py — uji jalur GAGAL switch_3001_api.sh TANPA menyentuh PM2/3001 asli.

Isolasi:
  * `pm2`  -> stub (mencatat delete/start/save; tidak pernah menyentuh proses nyata)
  * `curl` -> stub (menjawab kode/HTML sesuai skenario; tidak ada jaringan)
  * direktori kandidat, target rollback, snapshot -> direktori sementara

Kontras "skrip lama": fixture `fixtures/switch_3001_api.pre-r5.sh` adalah salinan
byte-identik skrip sebelum perbaikan R5. Karena skrip itu memakai path hard-coded,
salinan sandbox dibuat dengan mengganti HANYA 6 baris variabel path/nama (dicek
jumlahnya), tanpa menyentuh alur kontrol — jadi urutan gerbang yang cacat tetap
persis seperti aslinya. Fixture aslinya tidak pernah dieksekusi langsung.

Setiap kasus mencetak PASS/FAIL; exit != 0 bila ada FAIL.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT_DIR = "/home/ubuntu/dev-workspaces/purchasing-api-t_dd743609"
SCRIPT = os.environ.get("SWITCH_SCRIPT", f"{ROOT_DIR}/scripts/bakpau-api-ops/switch_3001_api.sh")
OLD_RAW = os.environ.get("SWITCH_SCRIPT_OLD", f"{ROOT_DIR}/scripts/bakpau-api-ops/fixtures/switch_3001_api.pre-r5.sh")

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (("  [" + str(detail)[:400] + "]") if not cond else ""))


PM2_STUB = r"""#!/usr/bin/env bash
set -u
STATE="$PM2_STUB_STATE"
cmd="${1:-}"
case "$cmd" in
  jlist)
    if [[ -f "$STATE" ]]; then cat "$STATE"; else echo '[]'; fi ;;
  delete)
    name="${2:-}"
    echo "delete $name cwd=$(pwd)" >> "$PM2_STUB_LOG"
    python3 - "$STATE" "$name" <<'PY'
import json,sys
st,name=sys.argv[1],sys.argv[2]
try: d=json.load(open(st))
except Exception: d=[]
for p in d:
    if p.get('name')==name: p['pm2_env']['status']='stopped'
json.dump(d,open(st,'w'))
PY
    ;;
  start)
    echo "start cwd=$(pwd) args=$*" >> "$PM2_STUB_LOG"
    name=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--name" ]]; then name="$2"; shift 2; continue; fi
      shift
    done
    python3 - "$STATE" "$name" "$(pwd)" <<'PY'
import json,sys,os
st,name,cwd=sys.argv[1],sys.argv[2],sys.argv[3]
try: d=json.load(open(st))
except Exception: d=[]
found=False
for e in d:
    if e.get('name')==name:
        e['pm2_env']['pm_cwd']=cwd; e['pm2_env']['status']='online'; found=True
if not found: d.append({'name':name,'pm2_env':{'pm_cwd':cwd,'status':'online'}})
json.dump(d,open(st,'w'))
PY
    ;;
  save) echo "save" >> "$PM2_STUB_LOG" ;;
  *) echo "pm2-stub-unknown $*" >> "$PM2_STUB_LOG" ;;
esac
exit 0
"""

CURL_STUB = r"""#!/usr/bin/env bash
set -u
SC="$CURL_STUB_STATE"
want=0; url=""
for a in "$@"; do
  case "$a" in
    -w) want=1 ;;
    http*) url="$a" ;;
  esac
done
echo "curl $*" >> "$CURL_STUB_LOG"
python3 - "$SC" "$want" "$url" "$*" <<'PY'
import json,sys
sc=json.load(open(sys.argv[1])); want=int(sys.argv[2]); url=sys.argv[3]; allargs=sys.argv[4]
is_read='/api/bakpau/v1/read' in url
is_tg='/api/bakpau/telegram' in url
post='-X POST' in allargs
if is_read: code=sc.get('read_post_code' if post else 'read_get_code',405)
elif is_tg: code=sc.get('telegram_code',405)
else: code=sc.get('root_code',200)
if want: print(code)
else:
    print('<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"buildId":"%s"}</script></body></html>' % sc.get('html_build_id',''))
PY
exit 0
"""

# 6 baris yang diganti di salinan sandbox skrip lama (hanya path/nama).
OLD_REPLACEMENTS = [
    (r'^APP="purchasing-staging-3001"$', 'APP="${BAKPAU_SWITCH_APP:-purchasing-staging-3001}"'),
    (r'^PORT=3001$', 'PORT="${BAKPAU_SWITCH_PORT:-3001}"'),
    (r'^NEW_DIR="[^"]*"$', 'NEW_DIR="${BAKPAU_SWITCH_NEW_DIR:-/nonexistent}"'),
    (r'^STATE="[^"]*"$', 'STATE="${BAKPAU_SWITCH_STATE:-/nonexistent}"'),
    (r'^SNAP="\$STATE/3001-before-api-switch\.json"$', 'SNAP="${BAKPAU_SWITCH_SNAP:-$STATE/3001-before-api-switch.json}"'),
    (r'^ENVFILE="\$HOME/\.hermes/secure/bakpau/api-server\.env"$', 'ENVFILE="${BAKPAU_SWITCH_ENVFILE:-/nonexistent}"'),
    (r'^if \[\[ -f /home/ubuntu/purchasing-app/\.env\.local \]\]; then$',
     'if [[ -f "${BAKPAU_SWITCH_APP_ENV:-/nonexistent}" ]]; then'),
    (r'^  set -a; \. /home/ubuntu/purchasing-app/\.env\.local; set \+a$',
     '  set -a; . "${BAKPAU_SWITCH_APP_ENV:-/nonexistent}"; set +a'),
]


def build_old_sandbox_copy(dest):
    src = open(OLD_RAW).read()
    hits = 0
    for pat, rep in OLD_REPLACEMENTS:
        src, n = re.subn(pat, rep, src, flags=re.M)
        hits += n
    open(dest, "w").write(src)
    os.chmod(dest, 0o755)
    return hits


def make_sandbox(root, *, candidate_bid="CANDIDATEBID01", snapshot="auto",
                 old_cwd_bid="OLDRUNBID0001", old_cwd_exists=True,
                 html_bid="auto", root_code=200, candidate_exists=True,
                 snapshot_dir_override=None, expect_bid=None):
    sb = tempfile.mkdtemp(dir=root, prefix="sb-")
    bindir = os.path.join(sb, "bin")
    os.makedirs(bindir)
    pm2_state = os.path.join(sb, "pm2.json")
    pm2_log = os.path.join(sb, "pm2.log")
    curl_state = os.path.join(sb, "curl.json")
    curl_log = os.path.join(sb, "curl.log")
    open(pm2_log, "w").close()
    open(curl_log, "w").close()

    old_dir = os.path.join(sb, "old-release")
    cand_dir = os.path.join(sb, "candidate")
    if old_cwd_exists:
        os.makedirs(os.path.join(old_dir, ".next"), exist_ok=True)
        open(os.path.join(old_dir, ".next", "BUILD_ID"), "w").write(old_cwd_bid)
    if candidate_exists:
        os.makedirs(os.path.join(cand_dir, ".next"), exist_ok=True)
        open(os.path.join(cand_dir, ".next", "BUILD_ID"), "w").write(candidate_bid)

    json.dump([{"name": "purchasing-staging-3001",
                "pm2_env": {"pm_cwd": old_dir if old_cwd_exists else "", "status": "online"}}],
              open(pm2_state, "w"))

    snap_path = os.path.join(sb, "3001-before-api-switch.json")
    if snapshot == "auto":
        snapshot = {"cwd": old_dir, "build_id": old_cwd_bid}
    if snapshot is not None:
        json.dump(snapshot, open(snap_path, "w"), indent=2)

    json.dump({"root_code": root_code,
               "html_build_id": (old_cwd_bid if html_bid == "auto" else html_bid),
               "read_get_code": 405, "read_post_code": 401, "telegram_code": 405},
              open(curl_state, "w"))

    for name, body in (("pm2", PM2_STUB), ("curl", CURL_STUB)):
        p = os.path.join(bindir, name)
        open(p, "w").write(body)
        os.chmod(p, 0o755)

    env = dict(os.environ)
    env.update({
        "PATH": bindir + ":" + env["PATH"],
        "PM2_STUB_STATE": pm2_state, "PM2_STUB_LOG": pm2_log,
        "CURL_STUB_STATE": curl_state, "CURL_STUB_LOG": curl_log,
        "BAKPAU_SWITCH_APP": "purchasing-staging-3001",
        "BAKPAU_SWITCH_PORT": "3999",
        "BAKPAU_SWITCH_NEW_DIR": cand_dir,
        "BAKPAU_SWITCH_STATE": sb,
        "BAKPAU_SWITCH_SNAP": snap_path,
        "BAKPAU_SWITCH_ENVFILE": os.path.join(sb, "no-such.env"),
        "BAKPAU_SWITCH_APP_ENV": os.path.join(sb, "no-such.env.local"),
        "BAKPAU_SWITCH_WAIT_TRIES": "1",
    })
    if expect_bid:
        env["BAKPAU_SWITCH_EXPECT_BUILD_ID"] = expect_bid
    return dict(sb=sb, env=env, pm2_state=pm2_state, pm2_log=pm2_log,
                curl_log=curl_log, snap=snap_path, old_dir=old_dir, cand_dir=cand_dir)


def run(sb, args, script=None):
    return subprocess.run(["bash", script or SCRIPT] + args, env=sb["env"],
                          capture_output=True, text=True, timeout=120)


def pm2_calls(sb):
    try:
        return open(sb["pm2_log"]).read()
    except Exception:
        return ""


def main():
    root = tempfile.mkdtemp(prefix="ops-review-r5-")
    old_copy = os.path.join(root, "switch_old_sandbox.sh")
    try:
        n = build_old_sandbox_copy(old_copy)
        check("0 fixture skrip lama disalin dengan 8 penggantian path (alur kontrol utuh)",
              n == 8, f"replacements={n}")
        # sanity: fixture lama memang memeriksa kandidat SEBELUM cabang rollback
        old_src = open(old_copy).read().splitlines()
        i_cand = next(i for i, l in enumerate(old_src) if ".next/BUILD_ID\" ]]" in l and "NEW_DIR" in l)
        i_rb = next(i for i, l in enumerate(old_src) if '--rollback" ]]' in l)
        check("0b (bukti) di skrip lama pemeriksaan kandidat mendahului --rollback",
              i_cand < i_rb, f"candidate_line={i_cand+1} rollback_line={i_rb+1}")

        # ---- A: kandidat RUSAK/hilang, rollback HARUS tetap bisa jalan
        sb = make_sandbox(root, candidate_exists=False)
        p = run(sb, ["--rollback"])
        check("A1 kandidat hilang + --rollback sukses (exit 0)", p.returncode == 0,
              f"exit={p.returncode} out={p.stdout[-250:]} err={p.stderr[-250:]}")
        check("A2 rollback benar-benar men-start rilis lama",
              "start cwd=" + sb["old_dir"] in pm2_calls(sb), pm2_calls(sb))
        check("A3 rollback DIVERIFIKASI, bukan sekadar dicetak",
              "ROLLBACK TERVERIFIKASI" in p.stdout, p.stdout[-300:])

        sb_old = make_sandbox(root, candidate_exists=False)
        p_old = run(sb_old, ["--rollback"], script=old_copy)
        check("A4 (kontras) skrip lama GAGAL rollback saat kandidat hilang",
              p_old.returncode != 0 and "delete" not in pm2_calls(sb_old),
              f"exit={p_old.returncode} err={p_old.stderr[-200:]}")

        # ---- B: snapshot tidak ada
        sb = make_sandbox(root, snapshot=None)
        p = run(sb, ["--rollback"])
        check("B1 snapshot hilang -> ditolak", p.returncode != 0, f"exit={p.returncode}")
        check("B2 snapshot hilang -> proses TIDAK disentuh", "delete" not in pm2_calls(sb), pm2_calls(sb))

        # ---- C: snapshot menunjuk build lain (indikasi tertimpa)
        sb = make_sandbox(root, snapshot={"cwd": "/tmp", "build_id": "WRONGBUILD999"},
                          expect_bid="OLDRUNBID0001")
        p = run(sb, ["--rollback"])
        check("C1 snapshot != build yang diharapkan -> ditolak", p.returncode != 0, f"exit={p.returncode}")
        check("C2 snapshot salah -> proses TIDAK disentuh", "delete" not in pm2_calls(sb), pm2_calls(sb))

        # ---- D: direktori target hilang
        sb = make_sandbox(root, snapshot={"cwd": "/nonexistent/target", "build_id": "OLDRUNBID0001"})
        p = run(sb, ["--rollback"])
        check("D1 target rollback tidak ada -> ditolak", p.returncode != 0, f"exit={p.returncode}")
        check("D2 target hilang -> proses TIDAK disentuh (tanpa downtime sia-sia)",
              "delete" not in pm2_calls(sb), pm2_calls(sb))

        # ---- E: BUILD_ID di disk != snapshot
        sb = make_sandbox(root, old_cwd_bid="DISKBUILD00002",
                          snapshot={"cwd": None, "build_id": "OLDRUNBID0001"})
        json.dump({"cwd": sb["old_dir"], "build_id": "OLDRUNBID0001"}, open(sb["snap"], "w"))
        p = run(sb, ["--rollback"])
        check("E1 BUILD_ID disk != snapshot -> ditolak", p.returncode != 0, f"exit={p.returncode}")
        check("E2 mismatch disk -> proses TIDAK disentuh", "delete" not in pm2_calls(sb), pm2_calls(sb))

        # ---- F: server melayani build yang SALAH setelah rollback
        sb = make_sandbox(root, html_bid="STILLCANDIDATE", root_code=200)
        p = run(sb, ["--rollback"])
        check("F1 rollback tapi buildId HTML salah -> exit != 0", p.returncode != 0, f"exit={p.returncode}")
        check("F2 pesan menyebut mismatch buildId", "buildId HTML" in (p.stdout + p.stderr),
              (p.stdout + p.stderr)[-250:])

        sb_old = make_sandbox(root, html_bid="STILLCANDIDATE", root_code=200)
        p_old = run(sb_old, ["--rollback"], script=old_copy)
        check("F3 (kontras) skrip lama exit 0 walau build yang dilayani salah",
              p_old.returncode == 0, f"exit={p_old.returncode}")

        # ---- G: root bukan 200 setelah rollback
        sb = make_sandbox(root, root_code=502)
        p = run(sb, ["--rollback"])
        check("G1 root 502 setelah rollback -> exit != 0", p.returncode != 0, f"exit={p.returncode}")

        # ---- H: rollback sukses normal
        sb = make_sandbox(root, root_code=200)
        p = run(sb, ["--rollback"])
        check("H1 rollback normal -> exit 0 + terverifikasi",
              p.returncode == 0 and "ROLLBACK TERVERIFIKASI" in p.stdout, f"exit={p.returncode}")

        # ---- I: --apply saat kandidat hilang tetap ditolak
        sb = make_sandbox(root, candidate_exists=False)
        p = run(sb, ["--apply"])
        check("I1 --apply tanpa artefak kandidat -> ditolak", p.returncode != 0, f"exit={p.returncode}")
        check("I2 --apply ditolak -> proses tidak disentuh", "delete" not in pm2_calls(sb), pm2_calls(sb))

        # ---- J: snapshot TIDAK ditimpa oleh --apply kedua
        sb = make_sandbox(root, candidate_bid="CANDIDATEBID01", html_bid="CANDIDATEBID01")
        p1 = run(sb, ["--apply"])
        snap1 = json.load(open(sb["snap"]))
        p2 = run(sb, ["--apply"])
        snap2 = json.load(open(sb["snap"]))
        hist = sb["snap"].replace(".json", ".history.json")
        check("J1 --apply pertama sukses terverifikasi",
              p1.returncode == 0 and "SWITCH TERVERIFIKASI" in p1.stdout,
              f"exit={p1.returncode} {p1.stdout[-250:]}")
        check("J2 snapshot pertama tetap menunjuk rilis lama",
              snap1.get("build_id") == "OLDRUNBID0001", json.dumps(snap1))
        check("J3 --apply kedua TIDAK menimpa snapshot",
              snap2.get("build_id") == "OLDRUNBID0001", json.dumps(snap2))
        check("J4 riwayat switch kedua tercatat di .history.json",
              os.path.exists(hist) and len(json.load(open(hist))) >= 1, hist)

        # ---- K: --apply tapi HTML melayani build lain
        sb = make_sandbox(root, html_bid="SOMETHINGELSE")
        p = run(sb, ["--apply"])
        check("K1 --apply dengan buildId HTML salah -> exit != 0", p.returncode != 0, f"exit={p.returncode}")

        # ---- L: dry-run tidak menyentuh apa pun
        sb = make_sandbox(root)
        p = run(sb, [])
        check("L1 dry-run exit 0 tanpa delete/start",
              p.returncode == 0 and "delete" not in pm2_calls(sb) and "start" not in pm2_calls(sb),
              pm2_calls(sb))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print()
    print(f"RESULT {passed}/{total} PASS, {total - passed} FAIL")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
