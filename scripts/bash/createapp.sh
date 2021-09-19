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

MAIN=$(${gcmd} account list|awk '{ print $3 }'|tail -1) # is also the issuer
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -1)
FINANCIAL_REGULATOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)
GREEN_VERIFIER=$(${gcmd} account list|awk '{ print $3 }'|tail -2|head -1)


echo "-------------------------------------------------------------------------------"


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


echo "-------------------------------------------------------------------------------"


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
    --app-arg "addr:$FINANCIAL_REGULATOR" \
    --app-arg "addr:$GREEN_VERIFIER" |
    grep Created |
    awk '{ print $6 }'
)
echo "App ID = ${APP_ID}"

# Read global state of contracts
${gcmd} app read --app-id ${APP_ID} --guess-format --global --from ${MAIN}


echo "-------------------------------------------------------------------------------"


# setup escrows
PYTEAL_BOND_ESCROW="../../assets/bondEscrow.py"
TEAL_BOND_ESCROW="../../assets/bondEscrow.teal"
PYTEAL_STABLECOIN_ESCROW="../../assets/stablecoinEscrow.py"
TEAL_STABLECOIN_ESCROW="../../assets/stablecoinEscrow.teal"
"$PYTHON" "$PYTEAL_BOND_ESCROW" "${APP_ID}" "${BOND_ID}" 1500 > "$TEAL_BOND_ESCROW"
"$PYTHON" "$PYTEAL_STABLECOIN_ESCROW" "${APP_ID}" "${STABLECOIN_ID}" 1500 > "$TEAL_STABLECOIN_ESCROW"

BOND_ESCROW_ADDRESS=$(
  ${gcmd} clerk compile -n ${TEAL_BOND_ESCROW} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Bond Escrow Address = ${ESCROW_ADDRESS}"

STABLECOIN_ESCROW_ADDRESS=$(
  ${gcmd} clerk compile -n ${TEAL_STABLECOIN_ESCROW} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Escrow Address = ${ESCROW_ADDRESS}"

# send algos to escrows
${gcmd} clerk send -a ${1000000000} -f ${MAIN} -t ${BOND_ESCROW_ADDRESS}
${gcmd} clerk send -a ${1000000000} -f ${MAIN} -t ${STABLECOIN_ESCROW_ADDRESS}

# opt in bond escrow to bond asset and send all bonds to it
${gcmd} asset send -a 0 -f ${BOND_ESCROW_ADDRESS} -t ${BOND_ESCROW_ADDRESS} --assetid ${BOND_ID} -o unsigned_escrow_bond_optin.txn
${gcmd} clerk sign -i unsigned_escrow_bond_optin.txn -p ${TEAL_BOND_ESCROW} -o escrow_bond_optin.ltxn
${gcmd} clerk rawsend -f escrow_bond_optin.ltxn
${gcmd} asset send -a ${BOND_TOTAL} -f ${MAIN} -t ${BOND_ESCROW_ADDRESS} --assetid ${BOND_ID} --clawback ${MAIN}

# configure bond
${gcmd} asset config  --manager ${MAIN} --new-clawback ${BOND_ESCROW_ADDRESS} --new-freezer "" --new-manager "" --assetid ${BOND_ID}
${gcmd} asset info --assetid=${BOND_ID}

# opt in stablecoin escrow to stablecoin asset and fund it
${gcmd} asset send -a 0 -f ${STABLECOIN_ESCROW_ADDRESS} -t ${STABLECOIN_ESCROW_ADDRESS} --assetid ${STABLECOIN_ID} -o unsigned_escrow_stablecoin_optin.txn
${gcmd} clerk sign -i unsigned_escrow_stablecoin_optin.txn -p ${TEAL_STABLECOIN_ESCROW} -o escrow_stablecoin_optin.ltxn
${gcmd} clerk rawsend -f escrow_stablecoin_optin.ltxn
${gcmd} asset send -a 10000000000 -f ${MAIN} -t ${STABLECOIN_ESCROW_ADDRESS} --assetid ${STABLECOIN_ID}


echo "-------------------------------------------------------------------------------"


# setup investor
${gcmd} clerk send -a ${1000000000} -f ${MAIN} -t ${INVESTOR}
${gcmd} asset send -a 0 -f ${ISSUER} -t ${ISSUER} --assetid ${STABLECOIN_ID}


echo "-------------------------------------------------------------------------------"


# update app
PYTEAL_APPROVAL_PROG="../../assets/stateful.teal"
TEAL_APPROVAL_PROG="../../assets/stateful.teal"

${gcmd} app update --app-id ${APP_ID} --approval-prog ${TEAL_APPROVAL_PROG} --clear-prog ${TEAL_CLEAR_PROG} --from ${MAIN}

# Read global state of contract
${gcmd} app read --app-id ${APP_ID} --guess-format --global --from ${MAIN}
