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
gcmd2="goal -d ../../net1/Node"

ACCOUNT=$(${gcmd} account list|awk '{ print $3 }'|head -n 1)
ACCOUNT2=$(${gcmd2} account list|awk '{ print $3 }'|head -n 1)

# create asset
BOND_ID=$(
  ${gcmd} asset create \
    --creator ${ACCOUNT} \
    --total 5 \
    --unitname bond \
    --decimals 0 \
    --defaultfrozen=true \
    | awk '{ print $6 }' | tail -n 1
)
echo "Bond ID = ${BOND_ID}"

# create app
TEAL_APPROVAL_PROG="../../generated-src/greenBondApproval.teal"
TEAL_CLEAR_PROG="../../generated-src/greenBondClear.teal"

GLOBAL_BYTESLICES=2
GLOBAL_INTS=8
LOCAL_BYTESLICES=0
LOCAL_INTS=2

BOND_COST=50000000 # $50.000000
BOND_COUPON_PAYMENT_VALUE=2500000 # $2.500000
BOND_COUPON_INSTALLMENTS=4 # pay BOND_COUPON 4 times evenly distributed throughout BOND_LENGTH
BOND_PRINCIPAL=100000000 # $100.000000
SETUP_LENGTH=20 # seconds
BUY_LENGTH=100 # seconds
BOND_LENGTH=300 # seconds
CURRRENT_DATE=$(date '+%s')
START_BUY_DATE=$(($CURRRENT_DATE + $SETUP_LENGTH))
END_BUY_DATE=$(($START_BUY_DATE + $BUY_LENGTH))
MATURITY_DATE=$(($END_BUY_DATE + $BOND_LENGTH))

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
  --app-arg "int:${MATURITY_DATE}" \
  --app-arg "int:${BOND_ID}" \
  --app-arg "int:${BOND_COST}" \
  --app-arg "int:${BOND_COUPON_PAYMENT_VALUE}" \
  --app-arg "int:${BOND_COUPON_INSTALLMENTS}" \
  --app-arg "int:${BOND_PRINCIPAL}" \
  --dryrun-dump -o dump1.dr

# debug
tealdbg debug ${TEAL_APPROVAL_PROG} -d dump1.dr

# clean up files
rm -f dump1.dr
