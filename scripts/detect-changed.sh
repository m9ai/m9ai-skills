#!/usr/bin/env bash
# 检测本次变更涉及哪些 skill 目录，输出 JSON 数组，例如: ["jinshan-train-skill"]
#
# 用法: scripts/detect-changed.sh [base-ref] [head-ref]
#   base-ref 为空、全 0 或无效（首次推送 / force push）时，视为全量构建。
set -euo pipefail

BASE="${1:-}"
HEAD="${2:-HEAD}"

if [ -z "$BASE" ] \
  || [ "$BASE" = "0000000000000000000000000000000000000000" ] \
  || ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  changed="$(git ls-files)"
else
  changed="$(git diff --name-only "$BASE" "$HEAD")"
fi

# 取被改动文件路径的顶层目录，排除仓库自身的基础设施目录
dirs="$(printf '%s\n' "$changed" \
  | awk -F/ 'NF > 1 { print $1 }' \
  | grep -vE '^(\.github|docs|scripts)$' \
  | sort -u || true)"

skills=()
while IFS= read -r d; do
  [ -n "$d" ] || continue
  if [ -f "$d/SKILL.md" ]; then
    skills+=("$d")
  fi
done <<< "$dirs"

if [ ${#skills[@]} -eq 0 ]; then
  echo '[]'
  exit 0
fi

out='['
for i in "${!skills[@]}"; do
  [ "$i" -gt 0 ] && out+=','
  out+="\"${skills[$i]}\""
done
out+=']'
echo "$out"
