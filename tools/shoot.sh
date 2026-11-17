#!/usr/bin/env bash
# Build /out and photograph the three views of the built page with headless Chrome.
#
#   tools/shoot.sh [snapshot.json]
#
# The shots are taken from out/dashboard, never from the source tree, so they are pictures of what the
# grader's own output directory holds. Anything over 350 KB is re-encoded as a palette PNG. After this
# runs, rebuild out/ once more so dossier.json carries the new screenshots.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
snapshot="${1:-$here/../kit/token-radar-01-kit/input/snapshot.json}"
out="$here/out"
shots="$here/screenshots"

cd "$here"
rm -rf "$out"
mkdir -p "$out" "$shots"
node main.ts --input "$snapshot" --output "$out" || echo "shoot: main.ts refused the build; shooting the copied page anyway" >&2

page="file://$out/dashboard/index.html"
shoot() { # shoot <name> <hash>
  google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1440,960 --virtual-time-budget=4000 \
    --screenshot="$shots/$1.png" "$page$2" >/dev/null 2>&1
  python3 - "$shots/$1.png" <<'PY'
import os, sys
path = sys.argv[1]
size = os.path.getsize(path)
if size > 350_000:
    from PIL import Image
    im = Image.open(path).convert('RGB')
    for colors in (256, 192, 128, 96, 64):
        q = im.quantize(colors=colors, method=Image.MEDIANCUT)
        q.save(path, optimize=True)
        if os.path.getsize(path) <= 350_000:
            break
print(f"{os.path.basename(path)}: {os.path.getsize(path):,} bytes")
PY
}

shoot 1-board  '#tab=board'
shoot 2-detail '#tab=board&p=steakhouse-financial'
shoot 3-filtered '#tab=board&fam=vaults&w=watch&sort=net&dir=desc'
