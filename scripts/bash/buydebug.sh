#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS


gcmd="goal -d ../../net1/Primary"
gcmd2="goal -d ../../net1/Node"

ACCOUNT=$(${gcmd} account list | awk '{ print $3 }' | head -n 1)
ACCOUNT2=$(${gcmd2} account list | awk '{ print $3 }' | head -n 1)

TEAL_APPROVAL_PROG="../../generated-src/greenBondApproval.teal"

# compile stateless contract for bond to get its address
BOND_STATELESS_TEAL="../../generated-src/bondEscrow.teal"
BOND_STATELESS_ADDRESS=$(
  ${gcmd2} clerk compile -n ${BOND_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Bond Stateless Contract Address = ${BOND_STATELESS_ADDRESS}"

# compile stateless contract for stablecoin to get its address
STABLECOIN_STATELESS_TEAL="../../generated-src/stablecoinEscrow.teal"
STABLECOIN_STATELESS_ADDRESS=$(
  ${gcmd2} clerk compile -n ${STABLECOIN_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Stateless Contract Address = ${STABLECOIN_STATELESS_ADDRESS}"

BOND_ID=1
STABLECOIN_ID=2
APP_ID=10

NUM_BONDS=3
BOND_COST=50000000 # $50.000000
TOTAL_COST=$(($NUM_BONDS * $BOND_COST))

# need to opt in second account to new bond, stablecoin and app
${gcmd2} asset send -a 0 -f ${ACCOUNT2} -t ${ACCOUNT2} --assetid ${BOND_ID}
${gcmd2} asset send -a 0 -f ${ACCOUNT2} -t ${ACCOUNT2} --assetid ${STABLECOIN_ID}
${gcmd2} app optin --app-id ${APP_ID} --from ${ACCOUNT2}

# send $1000 to second account so has funds to buy bond
${gcmd} asset send -a 1000000000 -f ${ACCOUNT} -t ${ACCOUNT2} --assetid ${STABLECOIN_ID}

# create transactions
${gcmd2} app call --app-id ${APP_ID} --app-arg "str:buy" --from ${ACCOUNT2} --out=unsignedtx0.tx
${gcmd2} asset send --from=${BOND_STATELESS_ADDRESS} --to=${ACCOUNT2} --assetid ${BOND_ID} --clawback ${BOND_STATELESS_ADDRESS} --fee=1000 --amount=${NUM_BONDS} --out=unsignedtx1.tx
${gcmd2} clerk send --from=${ACCOUNT2} --to=${BOND_STATELESS_ADDRESS} --fee=1000 --amount=1000 --out=unsignedtx2.tx
${gcmd2} asset send --from=${ACCOUNT2} --to=${ACCOUNT} --assetid ${STABLECOIN_ID} --fee=1000 --amount=${TOTAL_COST} --out=unsignedtx3.tx
# combine transactions
cat unsignedtx0.tx unsignedtx1.tx unsignedtx2.tx unsignedtx3.tx > combinedtransactions.tx
# group transactions
${gcmd2} clerk group -i combinedtransactions.tx -o groupedtransactions.tx
# split transactions
${gcmd2} clerk split -i groupedtransactions.tx -o split.tx
# sign transactions
${gcmd2} clerk sign -i split-0.tx -o signout-0.tx
${gcmd2} clerk sign -i split-1.tx -p ${BOND_STATELESS_TEAL} -o signout-1.tx
${gcmd2} clerk sign -i split-2.tx -o signout-2.tx
${gcmd2} clerk sign -i split-3.tx -o signout-3.tx
# assemble transaction group
cat signout-0.tx signout-1.tx signout-2.tx signout-3.tx > signout.tx
# two options: can either generate context debug file or create your own to use
${gcmd2} clerk dryrun -t signout.tx --dryrun-dump -o dr.json
# debug first transaction. Change index to 1 to debug second transaction
tealdbg debug ${TEAL_APPROVAL_PROG} -d dr.json --group-index 0


# clean up files
rm -f *.tx
rm -f dr.json
