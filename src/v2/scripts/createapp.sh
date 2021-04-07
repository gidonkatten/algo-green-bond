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

# create asset
ASSETID=$(
  ${gcmd} asset create \
    --creator ${ACCOUNT} \
    --total 1000 \
    --unitname bond \
    --decimals 0 \
  | awk '{ print $6 }' | tail -n 1
)
echo "Asset ID="$ASSETID 

# need to opt in second account to new asset id
${gcmd2} asset send -a 0 -f ${ACCOUNT2} -t ${ACCOUNT2} --creator ${ACCOUNT} --assetid ${ASSETID}

# create app
TEAL_APPROVAL_PROG="../approval_program.teal"
TEAL_CLEAR_PROG="../clear_state_program.teal"

GLOBAL_BYTESLICES=1
GLOBAL_INTS=5
LOCAL_BYTESLICES=0
LOCAL_INTS=0

BOND_COST=5000000 # 5 algos
BOND_PRINCIPAL=10000000 # 10 algos
BOND_LENGTH=30 # seconds
CURRRENT_DATE=$(date '+%s')
START_DATE=$(($CURRRENT_DATE + 60))
END_DATE=$(($START_DATE + $BOND_LENGTH))

APPID=$(
  ${gcmd} app create --creator ${ACCOUNT} \
    --approval-prog $TEAL_APPROVAL_PROG \
    --clear-prog $TEAL_CLEAR_PROG \
    --global-byteslices $GLOBAL_BYTESLICES \
    --global-ints $GLOBAL_INTS \
    --local-byteslices $LOCAL_BYTESLICES \
    --local-ints $LOCAL_INTS \
    --app-arg "int:${START_DATE}" \
    --app-arg "int:${END_DATE}" \
    --app-arg "int:${ASSETID}" \
    --app-arg "int:${BOND_COST}" \
    --app-arg "int:${BOND_PRINCIPAL}" \
  | grep Created \
  | awk '{ print $6 }'
)
echo "App ID="$APPID 

# Read global state of contract
${gcmd} app read --app-id $APPID --guess-format --global --from $ACCOUNT
