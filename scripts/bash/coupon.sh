#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

gcmd="goal -d ../../net1/Primary"

MASTER=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)

# compile stateless contract for bond to get its address
BOND_STATELESS_TEAL="../../generated-src/bondEscrow.teal"
BOND_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${BOND_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Bond Stateless Contract Address = ${BOND_STATELESS_ADDRESS}"

# compile stateless contract for stablecoin to get its address
STABLECOIN_STATELESS_TEAL="../../generated-src/stablecoinEscrow.teal"
STABLECOIN_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STABLECOIN_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Stateless Contract Address = ${STABLECOIN_STATELESS_ADDRESS}"

BOND_ID=1
STABLECOIN_ID=2
APP_ID=13
MANAGE_APP_ID=14

# create transactions
${gcmd} app call --app-id ${APP_ID} --app-arg "str:coupon" --from ${INVESTOR} --out=unsignedtx0.tx
${gcmd} clerk send --from=${INVESTOR} --to=${STABLECOIN_STATELESS_ADDRESS} --fee=1000 --amount=1000 --out=unsignedtx1.tx
${gcmd} asset send --from=${STABLECOIN_STATELESS_ADDRESS} --to=${INVESTOR} --assetid ${STABLECOIN_ID} --fee=1000 --amount=7500000 --out=unsignedtx2.tx
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-account ${STABLECOIN_STATELESS_ADDRESS} --app-account ${BOND_STATELESS_ADDRESS} --from ${INVESTOR} --out=unsignedtx3.tx
# combine transactions
cat unsignedtx0.tx unsignedtx1.tx unsignedtx2.tx unsignedtx3.tx > combinedtransactions.tx
# group transactions
${gcmd} clerk group -i combinedtransactions.tx -o groupedtransactions.tx
# split transactions
${gcmd} clerk split -i groupedtransactions.tx -o split.tx
# sign transactions
${gcmd} clerk sign -i split-0.tx -o signout-0.tx
${gcmd} clerk sign -i split-1.tx -o signout-1.tx
${gcmd} clerk sign -i split-2.tx -p ${STABLECOIN_STATELESS_TEAL} -o signout-2.tx
${gcmd} clerk sign -i split-3.tx -o signout-3.tx
# assemble transaction group
cat signout-0.tx signout-1.tx signout-2.tx signout-3.tx > signout.tx
# submit
${gcmd} clerk rawsend -f signout.tx

# Read local state of contract to see coupon payment installments
${gcmd} app read --app-id ${APP_ID} --guess-format --local --from ${INVESTOR}

# clean up files
rm -f *.tx
