#!/bin/bash

date '+keyreg-teal-test start %Y%m%d_%H%M%S'

set -e
set -x
set -o pipefail
export SHELLOPTS

gcmd="goal -d ../../../net1/Primary"
ACCOUNT=$(${gcmd} account list|awk '{ print $3 }'|head -n 1)

gcmd2="goal -d ../../../net1/Node"
ACCOUNT2=$(${gcmd2} account list|awk '{ print $3 }'|head -n 1)

# non atomic example
#${gcmd} app call --app-id 1  --app-arg "str:myarg" --app-arg "int:1025" --from $ACCOUNT --out=dump1.dr --dryrun-dump
#tealdbg debug ../src/approval_program.teal -d dump1.dr


#atomic example
ASSETID=1
# create transactions
${gcmd} app call --app-id 3  --app-arg "str:principal" --from $ACCOUNT2 --out=unsignedtransaction1.tx
${gcmd} clerk send --from=$ACCOUNT --to=$ACCOUNT2 --fee=1000 --amount=30000000 --out=unsignedtransaction2.tx
${gcmd} asset send --from=$ACCOUNT2 --to=$ACCOUNT --creator ${ACCOUNT} --assetid ${ASSETID} --fee=1000 --amount=3 --out=unsignedtransaction3.tx
# combine transactions
cat unsignedtransaction1.tx unsignedtransaction2.tx unsignedtransaction3.tx > combinedtransactions.tx
# group transactions
${gcmd} clerk group -i combinedtransactions.tx -o groupedtransactions.tx
# split transactions
${gcmd} clerk split -i groupedtransactions.tx -o split.tx
# sign transactions
${gcmd2} clerk sign -i split-0.tx -o signout-0.tx 
${gcmd} clerk sign -i split-1.tx -o signout-1.tx 
${gcmd2} clerk sign -i split-2.tx -o signout-2.tx 
# assemble transaction group
cat signout-0.tx signout-1.tx signout-2.tx  > signout.tx
# 
${gcmd} clerk rawsend -f signout.tx


# clean up files
rm *.tx