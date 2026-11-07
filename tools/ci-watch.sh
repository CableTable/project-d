#!/usr/bin/env bash
exec node "$(dirname "$0")/kit.mjs" ci-watch.sh "$@" # TODO 219c shim: the kit's ci-watch.sh (hq.json "kit", default kit/), same arguments and exit code
