#!/usr/bin/env bash
# Build /out and photograph the four views of the built page with headless Chrome.
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
shoot() { # shoot <name> <height> <hash>
  google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1440,"$2" --virtual-time-budget=5000 \
    --screenshot="$shots/$1.png" "$page$3" >/dev/null 2>&1
  python3 - "$shots/$1.png" <<'PY'
import os, sys
path = sys.argv[1]
if os.path.getsize(path) > 350_000:
    from PIL import Image
    im = Image.open(path).convert('RGB')
    for colors in (256, 192, 128, 96, 64):
        im.quantize(colors=colors, method=Image.MEDIANCUT).save(path, optimize=True)
        if os.path.getsize(path) <= 350_000:
            break
print(f"{os.path.basename(path):16} {os.path.getsize(path):>9,} bytes")
PY
}

# the board with its three cards and the seal; one protocol; a filtered board; the model tab
shoot 1-board   1000 '#tab=board'
shoot 2-detail   900 '#tab=board&p=figure-markets-exchange'
shoot 3-filtered 1000 '#tab=board&fam=trading&v=FARM&sort=net&dir=desc'
shoot 4-method   900 '#tab=model'
