#!/usr/bin/env bash
# Builds libfvad (WebRTC VAD) to a standalone WASM module (I-05b, decision D-L).
# Runs INSIDE the pinned emscripten/emsdk image: see build-fvad-docker.sh.
#
#   build-fvad.sh OUT_DIR
#
# No JS glue is produced (R2: no eval / new Function). The source is fetched by
# git at a pinned commit; git checks the commit id, so the content is fixed.
set -euo pipefail

FVAD_REPO="https://github.com/dpirch/libfvad.git"
FVAD_COMMIT="532ab666c20d3cfda38bca63abbb0f152706c369"
OUT_DIR="${1:?usage: build-fvad.sh OUT_DIR}"

export LC_ALL=C
export SOURCE_DATE_EPOCH=0

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -c advice.detachedHead=false init -q "$WORK/libfvad"
git -C "$WORK/libfvad" fetch -q --depth 1 "$FVAD_REPO" "$FVAD_COMMIT"
git -C "$WORK/libfvad" checkout -q FETCH_HEAD
HEAD="$(git -C "$WORK/libfvad" rev-parse HEAD)"
if [ "$HEAD" != "$FVAD_COMMIT" ]; then
  echo "libfvad: expected commit $FVAD_COMMIT, got $HEAD" >&2
  exit 1
fi

cd "$WORK/libfvad"
# Sorted file list: the link order must not depend on the file system.
mapfile -t SOURCES < <(printf '%s\n' src/fvad.c src/signal_processing/*.c src/vad/*.c | sort)

emcc --version 2>&1 | sed -n 1p
emcc -O2 -g0 -std=c11 -Iinclude "${SOURCES[@]}" \
  -o "$WORK/fvad.wasm" \
  --no-entry \
  -sSTANDALONE_WASM=1 \
  -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=262144 \
  -sSTACK_SIZE=65536 \
  -sEXPORTED_FUNCTIONS=_fvad_new,_fvad_free,_fvad_reset,_fvad_set_mode,_fvad_set_sample_rate,_fvad_process,_malloc,_free

mkdir -p "$OUT_DIR"
cp "$WORK/fvad.wasm" "$OUT_DIR/fvad.wasm"
cp LICENSE "$OUT_DIR/LICENSE"
cp PATENTS "$OUT_DIR/PATENTS"

# I-06b (ADR-0023, D-X): license notices of the Emscripten parts linked into
# fvad.wasm (musl libc, compiler-rt, dlmalloc, Emscripten's own runtime),
# copied from this pinned image so the shipped texts match the build.
EM_ROOT="$(dirname "$(readlink -f "$(command -v emcc)")")"
NOTICES="$OUT_DIR/notices"
mkdir -p "$NOTICES"
copy_notice() { # SOURCE DEST
  if [ ! -f "$1" ]; then
    echo "notice not found: $1" >&2
    find "$EM_ROOT/system/lib" -maxdepth 3 \( -iname 'COPYRIGHT*' -o -iname 'LICENSE*' \) >&2 || true
    exit 1
  fi
  cp "$1" "$NOTICES/$2"
}
copy_notice "$EM_ROOT/LICENSE" emscripten-LICENSE.txt
copy_notice "$EM_ROOT/system/lib/libc/musl/COPYRIGHT" musl-COPYRIGHT.txt
copy_notice "$EM_ROOT/system/lib/compiler-rt/LICENSE.TXT" compiler-rt-LICENSE.txt
DLMALLOC="$EM_ROOT/system/lib/dlmalloc.c"
if [ ! -f "$DLMALLOC" ]; then
  echo "notice not found: $DLMALLOC" >&2
  exit 1
fi
# The public-domain dedication is the file's leading comment, up to its first "*/".
sed -n '1,/\*\//p' "$DLMALLOC" > "$NOTICES/dlmalloc-NOTICE.txt"
( cd "$NOTICES" && sha256sum ./*.txt )
( cd "$OUT_DIR" && sha256sum fvad.wasm | tee fvad.wasm.sha256 )
echo "size: $(stat -c %s "$OUT_DIR/fvad.wasm") bytes"
