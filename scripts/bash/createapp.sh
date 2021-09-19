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

PYTHON=python3

MAIN=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)

# create assets
BOND_TOTAL=5
BOND_ID=$(
  ${gcmd} asset create \
    --creator ${MAIN} \
    --total ${BOND_TOTAL} \
    --unitname bond \
    --decimals 0 \
    --defaultfrozen=true \
    | awk '{ print $6 }' | tail -n 1
)
echo "Bond ID = ${BOND_ID}"
STABLECOIN_ID=$(
  ${gcmd} asset create \
    --creator ${MAIN} \
    --total 100000000000000000 \
    --unitname USDC \
    --decimals 6 \
    | awk '{ print $6 }' | tail -n 1
)
echo "Stablecoin ID = ${STABLECOIN_ID}"

# create app
PYTEAL_APPROVAL_PROG="../../assets/initial.py"
PYTEAL_CLEAR_PROG="../../assets/clear.py"
TEAL_APPROVAL_PROG="../../assets/initial.teal"
TEAL_CLEAR_PROG="../../assets/clear.teal"

# compile PyTeal into TEAL
"$PYTHON" "$PYTEAL_APPROVAL_PROG" > "$TEAL_APPROVAL_PROG"
"$PYTHON" "$PYTEAL_CLEAR_PROG" > "$TEAL_CLEAR_PROG"

START_BUY_DATE=$(date +%s)
let END_BUY_DATE=$START_BUY_DATE+50
let MATURITY_DATE=$END_BUY_DATE+100
BOND_COUPON=25 # $2.500000 for 1 bond or $0.000025 for 0.000001 bond
BOND_PRINCIPAL=100 # $100.000000 for 1 bond or $0.000100 for 0.000001 bond
BOND_LENGTH=4
FINANCIAL_REGULATOR_ADDR="NDVDOPWPQEWUL3VLQYYVD7S2LGO3ZJXQLEXBU2ZOP4AI44ZM2KINQGPFCM"
GREEN_VERIFIER_ADDR="OF6CYTCWXXZQCIFLUBNFZJ43V5BWZAL7BBMSQRIGUYQJVM63GIJ5SPA3JE"

APP_ID=$(
  ${gcmd} app create --creator ${MAIN} \
    --approval-prog $TEAL_APPROVAL_PROG \
    --clear-prog $TEAL_CLEAR_PROG \
    --global-byteslices 5 \
    --global-ints 10 \
    --local-byteslices 0 \
    --local-ints 3 \
    --app-arg "int:$START_BUY_DATE" \
    --app-arg "int:$END_BUY_DATE" \
    --app-arg "int:$MATURITY_DATE" \
    --app-arg "int:$BOND_ID" \
    --app-arg "int:$BOND_COUPON" \
    --app-arg "int:$BOND_PRINCIPAL" \
    --app-arg "int:$BOND_LENGTH" \
    --app-arg "addr:$FINANCIAL_REGULATOR_ADDR" \
    --app-arg "addr:$GREEN_VERIFIER_ADDR" |
    grep Created |
    awk '{ print $6 }'
)
echo "App ID = ${APP_ID}"

# Read global state of contracts
${gcmd} app read --app-id ${APP_ID} --guess-format --global --from ${MAIN}
