#!/bin/sh
# ADR-0035: the agent hook CLI for each platform, into dist/ (git-ignored). Building is
# local; publishing a release is the owner's call, never this script's.
set -eu
cd "$(dirname "$0")/../cli/interval"
out=../../dist/interval
mkdir -p "$out"
for target in darwin/amd64 darwin/arm64 linux/amd64 linux/arm64 windows/amd64 windows/arm64; do
  os=${target%/*}
  arch=${target#*/}
  ext=""
  [ "$os" = windows ] && ext=.exe
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags "-s -w" \
    -o "$out/interval-$os-$arch$ext" .
done
ls -1 "$out"
