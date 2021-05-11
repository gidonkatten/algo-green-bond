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

MASTER=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)
GREEN_VERIFIER=$(${gcmd} account list|awk '{ print $3 }'|tail -2|head -1)

MANAGE_APP_ID=9

# Rate
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:0" --app-arg "int:5" --from ${GREEN_VERIFIER}
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:1" --app-arg "int:4" --from ${GREEN_VERIFIER}
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:2" --app-arg "int:1" --from ${GREEN_VERIFIER}
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:8" --app-arg "int:5" --from ${GREEN_VERIFIER}
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:30" --app-arg "int:2" --from ${GREEN_VERIFIER}
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:9" --app-arg "int:1" --from ${GREEN_VERIFIER}
${gcmd} app call --app-id ${MANAGE_APP_ID} --app-arg "str:rate" --app-arg "int:9" --app-arg "int:3" --from ${GREEN_VERIFIER}

${gcmd} app read --app-id ${MANAGE_APP_ID} --guess-format --global --from ${MASTER}
