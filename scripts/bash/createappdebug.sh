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

# create app
TEAL_APPROVAL_PROG="../../generated-src/initialStateful.teal"
TEAL_CLEAR_PROG="../../generated-src/greenBondClear.teal"

GLOBAL_BYTESLICES=2
GLOBAL_INTS=10
LOCAL_BYTESLICES=0
LOCAL_INTS=1

BOND_COST=50000000 # $50.000000
BOND_COUPON_PAYMENT_VALUE=2500000 # $2.500000 every 6 months for the BOND_LENGTH
BOND_PRINCIPAL=100000000 # $100.000000
SETUP_LENGTH=20 # seconds
BUY_LENGTH=100 # seconds
BOND_LENGTH=2 # no of 6 month periods ie 1 year
BOND_ID=1
CURRENT_DATE=$(date '+%s')
START_BUY_DATE=$(($CURRENT_DATE + $SETUP_LENGTH))
END_BUY_DATE=$(($START_BUY_DATE + $BUY_LENGTH))

${gcmd} app create --creator ${ACCOUNT} \
  --approval-prog $TEAL_APPROVAL_PROG \
  --clear-prog $TEAL_CLEAR_PROG \
  --global-byteslices $GLOBAL_BYTESLICES \
  --global-ints $GLOBAL_INTS \
  --local-byteslices $LOCAL_BYTESLICES \
  --local-ints $LOCAL_INTS \
  --app-arg "addr:${ACCOUNT}" \
  --app-arg "int:${START_BUY_DATE}" \
  --app-arg "int:${END_BUY_DATE}" \
  --app-arg "int:${BOND_LENGTH}" \
  --app-arg "int:${BOND_ID}" \
  --app-arg "int:${BOND_COST}" \
  --app-arg "int:${BOND_COUPON_PAYMENT_VALUE}" \
  --app-arg "int:${BOND_PRINCIPAL}" \
  --dryrun-dump -o dump1.dr

# debug
tealdbg debug ${TEAL_APPROVAL_PROG} -d dump1.dr

# clean up files
rm -f dump1.dr
