#!/usr/bin/env bash
# Watch the CI run of one commit: prints each job as it finishes, then "RUN <id> <conclusion>" and exits.
# Usage (as a Monitor command): bash tools/ci-watch.sh <sha>
# Uses only gh's own --jq (jq is not installed on this PC, so a jq pipe stays silent forever).
[ -n "$1" ] || { echo "usage: ci-watch.sh <sha>"; exit 2; }
sha=$(git rev-parse "$1" 2>/dev/null || echo "$1"); prev=""; fails=0   # gh matches only the full sha
while :; do
  id=$(gh run list --commit "$sha" --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  if [ -z "$id" ]; then
    fails=$((fails + 1)); [ "$fails" = 20 ] && echo "no CI run found for $sha after 15 min"
  else
    cur=$(gh run view "$id" --json jobs --jq '.jobs[] | select(.status == "completed") | "\(.name): \(.conclusion)"' 2>/dev/null | sort)
    [ -n "$cur" ] && comm -13 <(printf '%s\n' "$prev") <(printf '%s\n' "$cur") | grep .
    prev=$cur
    st=$(gh run view "$id" --json status,conclusion --jq '.status + " " + .conclusion' 2>/dev/null)
    case $st in completed*) echo "RUN $id ${st#completed }"; exit 0 ;; esac
  fi
  sleep 45
done
