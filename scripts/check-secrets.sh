#!/usr/bin/env bash
#
# Blocks credentials and AI agent files from entering the repository. The repository is
# public, so a leaked secret is exposed the moment it is pushed and stays in history.
#
# Usage:
#   check-secrets.sh --staged              pre-commit mode: staged changes only
#   check-secrets.sh --range <base> <head> CI mode: lines added in the range
#   check-secrets.sh --all                 every tracked file
#
# A line that must hold a secret-shaped placeholder can opt out with the marker
# "secret-scan:allow". Use it only for obvious fakes.

set -uo pipefail

SECRET_PATTERNS=(
  'ntn_[A-Za-z0-9]{30,}'                          # Notion integration token
  'secret_[A-Za-z0-9]{40,}'                       # Notion legacy token
  'GOCSPX-[A-Za-z0-9_-]{20,}'                     # Google OAuth client secret
  'AIza[0-9A-Za-z_-]{35}'                         # Google API key
  'ya29\.[0-9A-Za-z_-]{20,}'                      # Google access token
  '1//0[0-9A-Za-z_-]{30,}'                        # Google refresh token
  'gh[pousr]_[A-Za-z0-9]{36,}'                    # GitHub token
  'github_pat_[A-Za-z0-9_]{50,}'                  # GitHub fine-grained token
  'figd_[A-Za-z0-9_-]{20,}'                       # Figma personal access token
  'AKIA[0-9A-Z]{16}'                              # AWS access key
  'xox[abprs]-[A-Za-z0-9-]{10,}'                  # Slack token
  'sk-(ant-)?[A-Za-z0-9_-]{32,}'                  # OpenAI / Anthropic API key
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'            # private key
  '(password|passwd|secret|api_?key|token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{16,}["'"'"']'
)

# Connection strings with credentials, unless they point at a local dev database.
DSN_PATTERN='[a-z]+://[^:/@[:space:]]+:[^@[:space:]]+@[^[:space:]]+'
DSN_LOCAL='@(localhost|127\.0\.0\.1|postgres|db)[:/]'

BLOCKED_FILES='(^|/)(\.env(\.[^/]*)?|[^/]*\.pem|[^/]*\.key|[^/]*\.p12|credentials[^/]*\.json|client_secret[^/]*\.json|token[^/]*\.json)$'
ALLOWED_FILES='(^|/)\.env\.example$'
# The shared CLAUDE.md guide is allowed; tool state and personal agent files are not.
AGENT_FILES='(^|/)(CLAUDE\.local\.md|AGENTS\.md|GEMINI\.md|\.mcp\.json|\.cursorrules|\.windsurfrules)$|(^|/)(\.claude|\.cursor|\.windsurf|\.gemini|agent-notes)/'

problems=0
report() {
  echo "  $1"
  problems=$((problems + 1))
}

check_paths() {
  local paths="$1" bad
  bad=$(printf '%s\n' "$paths" | grep -E "$BLOCKED_FILES" | grep -vE "$ALLOWED_FILES")
  [ -n "$bad" ] && while read -r p; do report "secret file: $p"; done <<< "$bad"
  bad=$(printf '%s\n' "$paths" | grep -E "$AGENT_FILES")
  [ -n "$bad" ] && while read -r p; do report "AI agent file: $p"; done <<< "$bad"
  return 0
}

# Input: unified diff with file headers. Only added lines are inspected, all at once so
# large diffs (lockfiles) stay fast. Findings name the file and line, never the value,
# so a leaked secret is not copied into terminal or CI logs.
check_diff() {
  local annotated combined hits
  annotated=$(printf '%s\n' "$1" | awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^\+\+\+ /     { file = "?"; next }
    /^@@ / {
      split($3, a, ",")
      line = substr(a[1], 2) + 0
      next
    }
    /^\+/ {
      text = substr($0, 2)
      if (index(text, "secret-scan:allow") == 0) print file ":" line "\t" text
      line++
    }
  ')
  [ -z "$annotated" ] && return 0
  combined=$(IFS='|'; printf '%s' "${SECRET_PATTERNS[*]}")
  hits=$(printf '%s\n' "$annotated" | grep -E -- "$combined" | cut -f1)
  [ -n "$hits" ] && while read -r where; do report "possible secret at $where"; done <<< "$hits"
  hits=$(printf '%s\n' "$annotated" | grep -E "$DSN_PATTERN" | grep -vE "$DSN_LOCAL" | cut -f1)
  [ -n "$hits" ] && while read -r where; do report "connection string with credentials at $where"; done <<< "$hits"
  return 0
}

mode="${1:---staged}"
case "$mode" in
  --staged)
    check_paths "$(git diff --cached --name-only --diff-filter=ACMR)"
    check_diff "$(git diff --cached --diff-filter=ACMR -U0 --no-color)"
    ;;
  --range)
    base="${2:?--range needs a base sha}"
    head="${3:?--range needs a head sha}"
    if [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
      base=$(git hash-object -t tree /dev/null)   # empty tree: scan everything in head
    fi
    check_paths "$(git diff --name-only --diff-filter=ACMR "$base" "$head")"
    check_diff "$(git diff --diff-filter=ACMR -U0 --no-color "$base" "$head")"
    ;;
  --all)
    empty=$(git hash-object -t tree /dev/null)
    check_paths "$(git ls-files)"
    check_diff "$(git diff --diff-filter=ACMR -U0 --no-color "$empty" HEAD)"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac

if [ "$problems" -gt 0 ]; then
  echo ""
  echo "  REJECTED: $problems problem(s) above. Move secrets to an ignored .env file."
  echo "  If a real secret was already pushed, rotate it first; removing it from git is not enough."
  echo ""
  exit 1
fi
echo "OK: no secrets or AI agent files found."
