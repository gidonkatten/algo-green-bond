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

# update app
OLD_TEAL_APPROVAL_PROG="../../generated-src/initialStateful.teal"
NEW_TEAL_APPROVAL_PROG="../../generated-src/greenBondApproval.teal"
TEAL_CLEAR_PROG="../../generated-src/greenBondClear.teal"
${gcmd} app update --app-id ${APP_ID} --approval-prog $NEW_TEAL_APPROVAL_PROG --clear-prog $TEAL_CLEAR_PROG --from ${MASTER} --dryrun-dump -o dump1.dr

# debug
tealdbg debug ${OLD_TEAL_APPROVAL_PROG} -d dump1.dr

# clean up files
rm -f dump1.dr