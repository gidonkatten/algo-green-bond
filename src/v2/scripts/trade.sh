#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

gcmd="goal -d ../../../net1/Primary"
gcmd2="goal -d ../../../net1/Node"

ACCOUNT=$(${gcmd} account list | awk '{ print $3 }' | head -n 1)
ACCOUNT2=$(${gcmd2} account list | awk '{ print $3 }' | head -n 1)

# compile stateless contract for bond to get its address
BOND_STATELESS_TEAL="../bond_stateless.teal"
BOND_STATELESS_ADDRESS=$(
  ${gcmd2} clerk compile -n ${BOND_STATELESS_TEAL} |
    awk '{ print $2 }' |
    head -n 1
)
echo "Bond Stateless Contract Address = ${BOND_STATELESS_ADDRESS}"

BOND_ID=1
STABLECOIN_ID=2
APP_ID=3

# create transactions
${gcmd2} app call --app-id ${APP_ID} --app-arg "str:trade" --app-account ${ACCOUNT} --from ${ACCOUNT2} --out=unsignedtx0.tx
${gcmd2} asset send --from=${ACCOUNT2} --to=${ACCOUNT} --assetid ${BOND_ID} --clawback ${BOND_STATELESS_ADDRESS} --fee=1000 --amount=1 --out=unsignedtx1.tx
${gcmd2} clerk send --from=${ACCOUNT2} --to=${BOND_STATELESS_ADDRESS} --fee=1000 --amount=1000 --out=unsignedtx2.tx
# combine transactions
cat unsignedtx0.tx unsignedtx1.tx unsignedtx2.tx >combinedtransactions.tx
# group transactions
${gcmd2} clerk group -i combinedtransactions.tx -o groupedtransactions.tx
# split transactions
${gcmd2} clerk split -i groupedtransactions.tx -o split.tx
# sign transactions
${gcmd2} clerk sign -i split-0.tx -o signout-0.tx
${gcmd2} clerk sign -i split-1.tx -p ${BOND_STATELESS_TEAL} -o signout-1.tx
${gcmd2} clerk sign -i split-2.tx -o signout-2.tx
# assemble transaction group
cat signout-0.tx signout-1.tx signout-2.tx >signout.tx
# submit
${gcmd2} clerk rawsend -f signout.tx

# Read local state of contract to see ownership
${gcmd} app read --app-id ${APP_ID} --guess-format --local --from ${ACCOUNT}
${gcmd2} app read --app-id ${APP_ID} --guess-format --local --from ${ACCOUNT2}

# clean up files
rm -f *.tx
