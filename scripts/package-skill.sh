#!/usr/bin/env bash
# 打包单个 skill 为 {目录名}-v{版本号}.zip，并输出产物路径。
#
# 用法: scripts/package-skill.sh <skill 目录> [输出目录，默认 dist]
set -euo pipefail

DIR="${1:-}"
OUT="${2:-dist}"

if [ -z "$DIR" ]; then
  echo "用法: $(basename "$0") <skill 目录> [输出目录]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=read-meta.sh
source "$SCRIPT_DIR/read-meta.sh"

version="$(fm_get "$DIR/SKILL.md" version)"
if [ -z "$version" ]; then
  echo "::error::[$DIR] 无法读取 SKILL.md 的 version" >&2
  exit 1
fi

mkdir -p "$OUT"
zipfile="${OUT}/${DIR}-v${version}.zip"
rm -f "$zipfile"

# 保留顶层目录（解析器按「根目录/二级目录/文件」解读），排除系统与版本控制文件
zip -qr "$zipfile" "$DIR" -x '*.DS_Store' -x '*/.git/*' -x '*/.workbuddy/*'

echo "$zipfile"
