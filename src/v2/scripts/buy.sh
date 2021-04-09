#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

gcmd2="goal -d ../../../net1/Node"
ACCOUNT2=$(${gcmd2} account list | awk '{ print $3 }' | head -n 1)

BOND_ID=1
STABLECOIN_ID=2

# compile stateless contract to get its address
STATELESS_TEAL="../stateless.teal"
STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STATELESS_TEAL} |
    awk '{ print $2 }' |
    head -n 1
)
echo "Stateless Contract Address = ${STATELESS_ADDRESS}"

# create transactions
${gcmd2} app call --app-id 3 --app-arg "str:buy" --from ${ACCOUNT2} --out=unsignedtransaction1.tx
${gcmd2} asset send --from=${STATELESS_ADDRESS} --to=${ACCOUNT2} --assetid ${BOND_ID} --fee=1000 --amount=3 --out=unsignedtransaction3.tx
${gcmd2} clerk send --from=${ACCOUNT2} --to=${STATELESS_ADDRESS} --fee=1000 --amount=1000 --out=unsignedtransaction2.tx
${gcmd2} asset send --from=${STATELESS_ADDRESS} --to=${ACCOUNT2} --assetid ${STABLECOIN_ID} --fee=1000 --amount=150 --out=unsignedtransaction3.tx
# combine transactions
cat unsignedtransaction1.tx unsignedtransaction2.tx unsignedtransaction3.tx >combinedtransactions.tx
# group transactions
${gcmd2} clerk group -i combinedtransactions.tx -o groupedtransactions.tx
# split transactions
${gcmd2} clerk split -i groupedtransactions.tx -o split.tx
# sign transactions
${gcmd2} clerk sign -i split-0.tx -o signout-0.tx
${gcmd2} clerk sign -i split-1.tx -o signout-1.tx
${gcmd2} clerk sign -i split-2.tx -o signout-2.tx
# assemble transaction group
cat signout-0.tx signout-1.tx signout-2.tx >signout.tx
# submit
${gcmd2} clerk rawsend -f signout.tx

# clean up files
rm -f *.tx
