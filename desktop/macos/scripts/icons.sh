#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/Uni.iconset
swift scripts/artwork.swift "$PWD/build"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/Uni-1024.png --out "build/Uni.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size*2))" "$((size*2))" build/Uni-1024.png --out "build/Uni.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil --convert icns --output build/Uni.icns build/Uni.iconset
