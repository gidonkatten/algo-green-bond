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

MASTER=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)

APP_ID=13
MANAGE_APP_ID=14

MAIN_TEAL_APPROVAL_PROG="../../generated-src/greenBondApproval.teal"
TEAL_CLEAR_PROG="../../generated-src/greenBondClear.teal"
MANAGE_TEAL_APPROVAL_PROG="../../generated-src/manageGreenBondApproval.teal"

# update apps
${gcmd} app update --app-id ${APP_ID} --approval-prog $MAIN_TEAL_APPROVAL_PROG --clear-prog $TEAL_CLEAR_PROG --from ${MASTER}
${gcmd} app update --app-id ${MANAGE_APP_ID} --approval-prog $MANAGE_TEAL_APPROVAL_PROG --clear-prog $TEAL_CLEAR_PROG --from ${MASTER}

# Read global state of contract
${gcmd} app read --app-id ${APP_ID} --guess-format --global --from ${MASTER}
${gcmd} app read --app-id ${MANAGE_APP_ID} --guess-format --global --from ${MASTER}
