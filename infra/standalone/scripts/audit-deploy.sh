#!/usr/bin/env bash
# Shell wrapper around audit-deploy.cjs so deploy-bluegreen.sh can call it
# without worrying about Node + Prisma context. Decrypts the API env,
# then invokes the Node script with it loaded.
#
# Usage: audit-deploy.sh <colour> <commit-sha> [actor]

set -euo pipefail

COLOUR="${1:-}"
COMMIT="${2:-}"
ACTOR="${3:-deploy-script}"
if [[ -z "$COLOUR" || -z "$COMMIT" ]]; then
  echo "usage: audit-deploy.sh <blue|green> <commit-sha> [actor]" >&2
  exit 2
fi

# Decrypt API env (idempotent).
sudo -u platform /opt/platform/scripts/decrypt-env.sh api

# Invoke the Node script with the decrypted env + deploy context.
# shellcheck disable=SC2046
sudo -u platform env \
  $(grep -v '^#' /run/platform/api.env | xargs) \
  DEPLOY_COLOUR="$COLOUR" \
  DEPLOY_COMMIT="$COMMIT" \
  DEPLOY_ACTOR="$ACTOR" \
  node /opt/platform/scripts/audit-deploy.cjs
