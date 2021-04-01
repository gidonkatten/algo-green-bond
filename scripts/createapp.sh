#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

WALLET=$1


# Directory of this bash program
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

gcmd="goal -d ../net1/Primary"

ACCOUNT=$(${gcmd} account list|awk '{ print $3 }'|head -n 1)

# create asset
ASSETID=$(${gcmd} asset create --creator ${ACCOUNT} --total 1000 --unitname bond --decimals 0  | awk '{ print $6 }'|tail -n 1)
echo "Asset ID="$ASSETID 

# need to opt in second account to new asset id
gcmd2="goal -d ../net1/Node"
ACCOUNT2=$(${gcmd2} account list|awk '{ print $3 }'|head -n 1)
${gcmd2} asset send -a 0 -f ${ACCOUNT2} -t ${ACCOUNT2}  --creator ${ACCOUNT} --assetid ${ASSETID}

# create app
BondCost=5000000 # 5 algos
BondPrincipal=10000000 # 10 algos
BondLength=30 # seconds
CurrentDate=$(date '+%s')
StartDate=$(($CurrentDate + 60))
EndDate=$(($StartDate + $BondLength))
APPID=$(${gcmd} app create --creator ${ACCOUNT} --app-arg "int:${StartDate}" --app-arg "int:${EndDate}" --app-arg "int:${ASSETID}" --app-arg "int:${BondCost}" --app-arg "int:${BondPrincipal}" --approval-prog ../src/approval_program.teal --global-byteslices 1 --global-ints 5 --local-byteslices 0 --local-ints 0  --clear-prog ../src/clear.teal | grep Created | awk '{ print $6 }')

# Read global state of contract
echo "App ID="$APPID 
${gcmd} app read --app-id $APPID --guess-format --global --from $ACCOUNT