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

MASTER=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)
GREEN_VERIFIER=$(${gcmd} account list|awk '{ print $3 }'|tail -2|head -1)

# create assets
BOND_TOTAL=5
BOND_ID=$(
  ${gcmd} asset create \
    --creator ${MASTER} \
    --total ${BOND_TOTAL} \
    --unitname bond \
    --decimals 0 \
    --defaultfrozen=true \
    | awk '{ print $6 }' | tail -n 1
)
echo "Bond ID = ${BOND_ID}"
STABLECOIN_ID=$(
  ${gcmd} asset create \
    --creator ${MASTER} \
    --total 100000000000000000 \
    --unitname USDC \
    --decimals 6 \
    | awk '{ print $6 }' | tail -n 1
)
echo "Stablecoin ID = ${STABLECOIN_ID}"

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

# send 1000 algos to each account
THOUSAND_ALGOS=1000000000
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${MASTER} -t ${ISSUER}
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${MASTER} -t ${INVESTOR}
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${MASTER} -t ${GREEN_VERIFIER}
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${MASTER} -t ${BOND_STATELESS_ADDRESS}
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${MASTER} -t ${STABLECOIN_STATELESS_ADDRESS}

# opt in bond escrow to bond asset and send all bonds to it
${gcmd} asset send -a 0 -f ${BOND_STATELESS_ADDRESS} -t ${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID} -o unsigned_escrow_bond_optin.txn
${gcmd} clerk sign -i unsigned_escrow_bond_optin.txn -p ${BOND_STATELESS_TEAL} -o escrow_bond_optin.ltxn
${gcmd} clerk rawsend -f escrow_bond_optin.ltxn
${gcmd} asset send -a ${BOND_TOTAL} -f ${MASTER} -t ${BOND_STATELESS_ADDRESS} --assetid ${BOND_ID} --clawback ${MASTER}

# configure bond
${gcmd} asset config  --manager ${MASTER} --new-clawback ${BOND_STATELESS_ADDRESS} --new-freezer "" --new-manager "" --assetid ${BOND_ID}
${gcmd} asset info --assetid=${BOND_ID}

# opt in stablecoin escrow to stablecoin asset and fund it
${gcmd} asset send -a 0 -f ${STABLECOIN_STATELESS_ADDRESS} -t ${STABLECOIN_STATELESS_ADDRESS} --assetid ${STABLECOIN_ID} -o unsigned_escrow_stablecoin_optin.txn
${gcmd} clerk sign -i unsigned_escrow_stablecoin_optin.txn -p ${STABLECOIN_STATELESS_TEAL} -o escrow_stablecoin_optin.ltxn
${gcmd} clerk rawsend -f escrow_stablecoin_optin.ltxn
${gcmd} asset send -a 10000000000 -f ${MASTER} -t ${STABLECOIN_STATELESS_ADDRESS} --assetid ${STABLECOIN_ID}

# opt in issuer to stablecoin
${gcmd} asset send -a 0 -f ${ISSUER} -t ${ISSUER} --assetid ${STABLECOIN_ID}

# clean up files
rm -f *.txn
rm -f *.ltxn
rm -f *.rej
