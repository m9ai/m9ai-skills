#!/usr/bin/env bash
# 读取 SKILL.md 的 YAML frontmatter 字段。
#
# 作为库使用:  source scripts/read-meta.sh; fm_get <SKILL.md> <key>
# 单独使用:    scripts/read-meta.sh <skill 目录> <key>

fm_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  awk -v key="$key" '
    /^---[[:space:]]*$/ { if (seen) exit; seen = 1; next }
    seen && index($0, key ":") == 1 {
      sub(/^[^:]*:[[:space:]]*/, "")
      print
      exit
    }
  ' "$file" | tr -d '"' | tr -d "'" | tr -d '\r' | sed 's/[[:space:]]*$//'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  dir="${1:-}"
  key="${2:-}"
  if [ -z "$dir" ] || [ -z "$key" ]; then
    echo "用法: $(basename "$0") <skill 目录> <字段名>" >&2
    exit 2
  fi
  fm_get "$dir/SKILL.md" "$key"
fi
