#!/usr/bin/env bash
# 校验单个 skill 是否符合 WorkBuddy 技能包规范。
#
# 用法: scripts/validate-skill.sh <skill 目录> [base-ref]
#   传入 base-ref 时会额外校验「内容变更但版本号未递增」。
set -euo pipefail

DIR="${1:-}"
BASE="${2:-}"

if [ -z "$DIR" ]; then
  echo "用法: $(basename "$0") <skill 目录> [base-ref]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=read-meta.sh
source "$SCRIPT_DIR/read-meta.sh"

errors=0
err() { echo "::error::[$DIR] $*"; errors=$((errors + 1)); }
warn() { echo "::warning::[$DIR] $*"; }

if [ ! -d "$DIR" ]; then
  err "目录不存在"
  exit 1
fi
if [ ! -f "$DIR/SKILL.md" ]; then
  err "缺少 SKILL.md（技能包必需）"
  exit 1
fi

# 1. frontmatter 必填字段
for key in name description description_zh description_en version author; do
  if [ -z "$(fm_get "$DIR/SKILL.md" "$key")" ]; then
    err "SKILL.md frontmatter 缺少必填字段: $key"
  fi
done

version="$(fm_get "$DIR/SKILL.md" version)"

# 2. 版本号格式
if [ -n "$version" ] && ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  err "版本号不符合语义化格式 x.y.z: '$version'"
fi

# 3. 包内目录层级不得超过两级（包根/二级目录/文件）
#    DIR/SKILL.md 计为 2 段，DIR/scripts/query.js 计为 3 段，均合法；4 段即超限
deepest="$(find "$DIR" -type f | awk -F/ '{ print NF }' | sort -n | tail -1)"
if [ -n "$deepest" ] && [ "$deepest" -gt 3 ]; then
  err "目录层级超限（最深 $((deepest - 1)) 层），技能包仅支持两级目录结构（根目录/二级目录/文件）"
fi

# 4. 不得包含系统垃圾文件
if find "$DIR" -name '.DS_Store' | grep -q .; then
  err "包含 .DS_Store，请删除后重新提交"
fi

# 5. name 与目录名一致性（仅警告，产物以目录名为准）
name="$(fm_get "$DIR/SKILL.md" name)"
if [ -n "$name" ] && [ "$name" != "$DIR" ]; then
  warn "SKILL.md 的 name($name) 与目录名($DIR) 不一致，产物将使用目录名"
fi

# 6. 分类与标签（推荐字段，缺失仅告警：官网市集筛选依赖它们，见 docs/TAXONOMY.md）
#    等存量技能补齐后再改成 err 强制
for key in category scenarios roles; do
  if [ -z "$(fm_get "$DIR/SKILL.md" "$key")" ]; then
    # 注意：必须用 ${key} 定界——$key 后紧跟中文全角字符时 bash 会把它并入变量名，
    # 在 set -u 下报 "unbound variable"
    warn "SKILL.md frontmatter 缺少推荐字段: ${key}（分类标准见 docs/TAXONOMY.md）"
  fi
done

# 7. 内容已变更则版本号必须递增
if [ -n "$BASE" ] && git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  if git cat-file -e "${BASE}:${DIR}/SKILL.md" 2>/dev/null; then
    tmp="$(mktemp)"
    git show "${BASE}:${DIR}/SKILL.md" > "$tmp"
    old_version="$(fm_get "$tmp" version)"
    rm -f "$tmp"
    if [ "$old_version" = "$version" ]; then
      err "内容已变更但版本号未递增（仍为 ${version}），请先修改 SKILL.md 的 version"
    fi
  fi
fi

if [ "$errors" -gt 0 ]; then
  echo "[$DIR] 校验未通过，共 $errors 个问题"
  exit 1
fi

echo "[$DIR] 校验通过 (v${version})"
