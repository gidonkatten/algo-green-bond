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
GREEN_VERIFIER=$(${gcmd} account list|awk '{ print $3 }'|tail -2|head -1)

MANAGE_APP_ID=9
MANAGE_TEAL_APPROVAL_PROG="../../generated-src/manageGreenBondApproval.teal"

# Rate use of proceeds as 5
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:8" --app-arg "int:5" --from ${GREEN_VERIFIER} --dryrun-dump -o dump1.dr

# debug
tealdbg debug ${MANAGE_TEAL_APPROVAL_PROG} -d dump1.dr


# clean up files
rm -f dump1.dr
