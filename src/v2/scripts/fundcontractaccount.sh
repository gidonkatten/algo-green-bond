#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

WALLET=$1


# Directory of this bash program
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

gcmd="goal -d ../../../net1/Primary"
gcmd2="goal -d ../../../net1/Node"

ACCOUNT=$(${gcmd} account list|awk '{ print $3 }'|head -n 1)
ACCOUNT2=$(${gcmd2} account list|awk '{ print $3 }'|head -n 1)


# compile stateless contract for bond to get its address
BOND_STATELESS_TEAL="../bond_stateless.teal"
BOND_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${BOND_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Bond Stateless Contract Address = ${BOND_STATELESS_ADDRESS}"

# compile stateless contract for stablecoin to get its address
STABLECOIN_STATELESS_TEAL="../stablecoin_stateless.teal"
STABLECOIN_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STABLECOIN_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Stateless Contract Address = ${STABLECOIN_STATELESS_ADDRESS}"

# send 1000 algos to each stateless account
THOUSAND_ALGOS=1000000000
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${ACCOUNT} -t ${BOND_STATELESS_ADDRESS}
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${ACCOUNT} -t ${STABLECOIN_STATELESS_ADDRESS}

# send 5 bonds to stateless address for bond
BOND_ID=1
# create transaction
${gcmd} asset send -a 0 -f ${BOND_STATELESS_ADDRESS} -t ${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID} -o unsigned_escrow_bond_optin.txn
# sign transaction with stateless contract logic
${gcmd} clerk sign -i unsigned_escrow_bond_optin.txn -p ${BOND_STATELESS_TEAL} -o escrow_bond_optin.ltxn
# submit opt in
${gcmd} clerk rawsend -f escrow_bond_optin.ltxn
# submit transfer
${gcmd} asset send -a 5 -f ${ACCOUNT} -t ${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID} --clawback ${ACCOUNT}

# stateless address becomes new clawback
${gcmd} asset config  --manager ${ACCOUNT} --new-clawback ${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID}

# lock the asset by clearing the freezer and manager
${gcmd} asset config  --manager ${ACCOUNT} --new-freezer "" --assetid ${BOND_ID}
${gcmd} asset config  --manager ${ACCOUNT} --new-manager "" --assetid ${BOND_ID}
${gcmd} asset info --assetid=${BOND_ID}


# send $10000 to stateless address for stablecoin
STABLECOIN_ID=2
# create transaction
${gcmd} asset send -a 0 -f ${STABLECOIN_STATELESS_ADDRESS} -t ${STABLECOIN_STATELESS_ADDRESS} --assetid ${STABLECOIN_ID} -o unsigned_escrow_stablecoin_optin.txn
# sign transaction with stateless contract logic
${gcmd} clerk sign -i unsigned_escrow_stablecoin_optin.txn -p ${STABLECOIN_STATELESS_TEAL} -o escrow_stablecoin_optin.ltxn
# submit opt in
${gcmd} clerk rawsend -f escrow_stablecoin_optin.ltxn
# submit transfer
${gcmd} asset send -a 10000000000 -f ${ACCOUNT} -t ${STABLECOIN_STATELESS_ADDRESS} --assetid ${STABLECOIN_ID}


# clean up files
rm -f *.txn
rm -f *.ltxn
rm -f *.rej

