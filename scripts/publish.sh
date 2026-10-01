#!/usr/bin/env bash
# Zero-click publisher for commitment edits.
#
# Triggers the "Publish Commitment Edits" GitHub Actions workflow (publish.yml),
# which pulls manual_recruits.json + suppress_recruits.json from a source branch,
# re-runs the scraper to regenerate recruits.json with those edits merged, and
# commits the result to main via the github-actions bot. This means curated
# commitment edits go live WITHOUT a manual PR merge.
#
# Requires: GH_COMMIT_TRACKER_ACTIONS_PAT — a fine-grained PAT scoped to this repo
# with "Actions: Read and write". (Saved as a repo-scoped Devin secret.)
#
# Usage:
#   scripts/publish.sh <source_ref>
# where <source_ref> is the branch holding the updated manual_recruits.json /
# suppress_recruits.json (push it first). Example:
#   git push -u origin my-edit-branch
#   scripts/publish.sh my-edit-branch
#
# Env override: set GH_PAT to use a different token variable name.

set -euo pipefail

REPO="lgermain30/lacrosse-commitment-tracker"
SOURCE_REF="${1:-}"
TOKEN="${GH_PAT:-${GH_COMMIT_TRACKER_ACTIONS_PAT:-}}"

if [[ -z "$SOURCE_REF" ]]; then
  echo "usage: scripts/publish.sh <source_ref>" >&2
  exit 2
fi
if [[ -z "$TOKEN" ]]; then
  echo "error: GH_COMMIT_TRACKER_ACTIONS_PAT (or GH_PAT) is not set" >&2
  exit 2
fi

echo "Dispatching publish.yml with source_ref=$SOURCE_REF ..."
code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/actions/workflows/publish.yml/dispatches" \
  -d "{\"ref\":\"main\",\"inputs\":{\"source_ref\":\"$SOURCE_REF\"}}")

if [[ "$code" != "204" ]]; then
  echo "dispatch failed (HTTP $code)" >&2
  exit 1
fi
echo "Dispatched (HTTP 204). Waiting for the run to finish ..."

sleep 6
for _ in $(seq 1 40); do
  read -r status conclusion url < <(curl -sS \
    -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/actions/workflows/publish.yml/runs?per_page=1" \
    | python3 -c "import sys,json;r=json.load(sys.stdin)['workflow_runs'];print((r[0]['status'],r[0].get('conclusion') or '-',r[0]['html_url']) and ' '.join([r[0]['status'],r[0].get('conclusion') or '-',r[0]['html_url']]) if r else 'none - -')")
  echo "  $status $conclusion $url"
  if [[ "$status" == "completed" ]]; then
    [[ "$conclusion" == "success" ]] && { echo "Published to main."; exit 0; } || { echo "Publish run did not succeed."; exit 1; }
  fi
  sleep 15
done
echo "Timed out waiting for the run; check $url" >&2
exit 1
