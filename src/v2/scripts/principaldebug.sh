#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

gcmd2="goal -d ../../../net1/Node"
ACCOUNT2=$(${gcmd2} account list | awk '{ print $3 }' | head -n 1)

# compile stateless contract for bond to get its address
BOND_STATELESS_TEAL="../bond_stateless.teal"
BOND_STATELESS_ADDRESS=$(
  ${gcmd2} clerk compile -n ${BOND_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Bond Stateless Contract Address = ${BOND_STATELESS_ADDRESS}"

# compile stateless contract for stablecoin to get its address
STABLECOIN_STATELESS_TEAL="../stablecoin_stateless.teal"
STABLECOIN_STATELESS_ADDRESS=$(
  ${gcmd2} clerk compile -n ${STABLECOIN_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Stateless Contract Address = ${STABLECOIN_STATELESS_ADDRESS}"

BOND_ID=1
STABLECOIN_ID=2
APP_ID=3

# create transactions
${gcmd2} app call --app-id ${APP_ID} --app-arg "str:principal" --from ${ACCOUNT2} --out=unsignedtx0.tx
${gcmd2} asset send --from=${ACCOUNT2} --to=${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID} --clawback ${BOND_STATELESS_ADDRESS} --fee=1000 --amount=3 --out=unsignedtx1.tx
${gcmd2} asset send --from=${STABLECOIN_STATELESS_ADDRESS} --to=${ACCOUNT2} --assetid ${STABLECOIN_ID} --fee=1000 --amount=300000000 --out=unsignedtx2.tx
${gcmd2} clerk send --from=${ACCOUNT2} --to=${BOND_STATELESS_ADDRESS} --fee=1000 --amount=1000 --out=unsignedtx3.tx
${gcmd2} clerk send --from=${ACCOUNT2} --to=${STABLECOIN_STATELESS_ADDRESS} --fee=1000 --amount=1000 --out=unsignedtx4.tx
# combine transactions
cat unsignedtx0.tx unsignedtx1.tx unsignedtx2.tx unsignedtx3.tx unsignedtx4.tx > combinedtransactions.tx
# group transactions
${gcmd2} clerk group -i combinedtransactions.tx -o groupedtransactions.tx
# split transactions
${gcmd2} clerk split -i groupedtransactions.tx -o split.tx
# sign transactions
${gcmd2} clerk sign -i split-0.tx -o signout-0.tx
${gcmd2} clerk sign -i split-1.tx -p ${BOND_STATELESS_TEAL} -o signout-1.tx
${gcmd2} clerk sign -i split-2.tx -p ${STABLECOIN_STATELESS_TEAL} -o signout-2.tx
${gcmd2} clerk sign -i split-3.tx -o signout-3.tx
${gcmd2} clerk sign -i split-4.tx -o signout-4.tx
# assemble transaction group
cat signout-0.tx signout-1.tx signout-2.tx signout-3.tx signout-4.tx > signout.tx
# two options: can either generate context debug file or create your own to use
${gcmd2} clerk dryrun -t signout.tx --dryrun-dump -o dr.json
# debug first transaction. Change index to 1 to debug second transaction
#tealdbg debug ../approval_program.teal -d dr.json --group-index 0
tealdbg debug ../bond_stateless.teal -d dr.json --group-index 1


# clean up files
rm -f *.tx
rm -f dr.json
