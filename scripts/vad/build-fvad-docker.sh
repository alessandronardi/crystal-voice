#!/usr/bin/env bash
# Runs build-fvad.sh in the pinned Emscripten image (I-05b, D-L).
#
#   scripts/vad/build-fvad-docker.sh [OUT_DIR]   (default: dist/fvad)
#
# emsdk 6.0.13, published 2026-10-19: at least two weeks old when chosen
# (2026-11-12). Pinned by digest, so a re-tagged image cannot change the build.
set -euo pipefail

IMAGE="emscripten/emsdk:6.0.13@sha256:fb7864e398acfda863dfcea78b8bc8adad359fa60c6a0bbeb845931de64aa68a"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${1:-$ROOT/dist/fvad}"
mkdir -p "$OUT_DIR"

# Runs as the image's default user: the Emscripten cache inside the image must
# stay usable. Output files are root-owned on Linux hosts.
docker run --rm \
  -v "$ROOT/scripts/vad:/scripts:ro" \
  -v "$OUT_DIR:/out" \
  "$IMAGE" \
  bash /scripts/build-fvad.sh /out
