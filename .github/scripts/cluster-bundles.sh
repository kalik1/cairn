#!/usr/bin/env bash
# cluster-bundles.sh OUTDIR
#
# Writes Cairn's cluster objects as the file each GitHub Release carries,
# for distributions that install it next to the plugin image of the same
# release (k4all v2.7.0 and later, as the component "cairn"):
#
#   cairn-cluster.yaml  the roles cairn-viewer, cairn-editor and cairn-admin
#                       (distribution/rbac.yaml), all cluster-wide: the
#                       RoleBinding of cairn-admin in the Rook namespace is
#                       the administrator's.
#
# src/distribution.test.ts checks that it holds no namespaced object.
set -euo pipefail

out=${1:?output directory}
root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$out"

{
  echo "# Cairn's roles, from distribution/rbac.yaml (https://github.com/kalik1/cairn)."
  echo "---"
  cat "$root/distribution/rbac.yaml"
} > "$out/cairn-cluster.yaml"

echo "cairn-cluster.yaml: $(grep -c '^kind:' "$out/cairn-cluster.yaml") objects"
