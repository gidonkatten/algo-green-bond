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

# send 1000 algos to each stateless account
THOUSAND_ALGOS=1000000000
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${ACCOUNT} -t ${BOND_STATELESS_ADDRESS}
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${ACCOUNT} -t ${STABLECOIN_STATELESS_ADDRESS}

# debug opt in
BOND_ID=1
# create transaction
${gcmd} asset send -a 0 -f ${BOND_STATELESS_ADDRESS} -t ${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID} -o unsigned_escrow_bond_optin.txn
# sign transaction with stateless contract logic
${gcmd} clerk sign -i unsigned_escrow_bond_optin.txn -p ${BOND_STATELESS_TEAL} -o escrow_bond_optin.ltxn
# two options: can either generate context debug file or create your own to use
${gcmd} clerk dryrun -t escrow_bond_optin.ltxn --dryrun-dump -o dr.json
# debug
tealdbg debug ${BOND_STATELESS_TEAL} -d dr.json

# clean up files
rm -f *.txn
rm -f *.ltxn
rm -f *.rej
rm -f dr.json
