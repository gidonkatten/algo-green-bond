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


# compile stateless contract to get its address
STATELESS_TEAL="../stateless.teal"
STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stateless Contract Address = ${STATELESS_ADDRESS}"

# send 1000 algos
THOUSAND_ALGOS=1000000000
${gcmd} clerk send -a ${THOUSAND_ALGOS} -f ${ACCOUNT} -t ${STATELESS_ADDRESS}

# send 1000 bonds to stateless address
ASSETID=1
LEASE_VALUE="TGVhc2UgdmFsdWUgKGF0IG1vc3QgMzItYnl0ZXMpCgo="
# create transaction
${gcmd} asset send -a 0 -f ${STATELESS_ADDRESS} -t ${STATELESS_ADDRESS} --assetid ${ASSETID} --lease ${LEASE_VALUE} -o unsigned_escrow_optin.txn
# sign transaction with stateless contract logic
${gcmd} clerk sign -i unsigned_escrow_optin.txn -p ${STATELESS_TEAL} -o escrow_optin.ltxn
# submit opt in
${gcmd} clerk rawsend -f escrow_optin.ltxn
# submit transfer
${gcmd} asset send -a 1000 -f ${ACCOUNT} -t ${STATELESS_ADDRESS} --assetid ${ASSETID}


# clean up files
rm -f *.txn
rm -f *.ltxn
rm -f *.rej
