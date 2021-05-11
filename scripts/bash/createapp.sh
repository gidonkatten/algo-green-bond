#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

WALLET=$1

# Directory of this bash program
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

gcmd="goal -d ../../net1/Primary"

MASTER=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)

# create app
TEAL_APPROVAL_PROG="../../generated-src/initialStateful.teal"
TEAL_CLEAR_PROG="../../generated-src/greenBondClear.teal"

# Can remove local-byteslices with TEAL3
APP_ID=$(
  ${gcmd} app create --creator ${MASTER} \
    --approval-prog $TEAL_APPROVAL_PROG \
    --clear-prog $TEAL_CLEAR_PROG \
    --global-byteslices 0 \
    --global-ints 1 \
    --local-byteslices 1 \
    --local-ints 1 |
    grep Created |
    awk '{ print $6 }'
)
echo "App ID = ${APP_ID}"

# Can remove local-byteslices with TEAL3
MANAGE_APP_ID=$(
  ${gcmd} app create --creator ${MASTER} \
    --approval-prog $TEAL_APPROVAL_PROG \
    --clear-prog $TEAL_CLEAR_PROG \
    --global-byteslices 5 \
    --global-ints 0 \
    --local-byteslices 1 \
    --local-ints 0 |
    grep Created |
    awk '{ print $6 }'
)
echo "MANAGE App ID = ${MANAGE_APP_ID}"

# Read global state of contracts
${gcmd} app read --app-id ${APP_ID} --guess-format --global --from ${MASTER}
${gcmd} app read --app-id ${MANAGE_APP_ID} --guess-format --global --from ${MASTER}
