#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

WALLET=$1


# Directory of this bash program
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

gcmd="goal -d ../../net1/Primary"

ACCOUNT=$(${gcmd} account list|awk '{ print $3 }'|head -n 1)

APP_ID=10

# update app
NEW_TEAL_APPROVAL_PROG="../../generated-src/greenBondApproval.teal"
TEAL_CLEAR_PROG="../../generated-src/greenBondClear.teal"
${gcmd} app update --app-id ${APP_ID} --approval-prog $NEW_TEAL_APPROVAL_PROG --clear-prog $TEAL_CLEAR_PROG --from ${ACCOUNT}

# Read global state of contract
${gcmd} app read --app-id ${APP_ID} --guess-format --global --from ${ACCOUNT}
