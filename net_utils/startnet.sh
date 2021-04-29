#!/bin/bash
set -e
echo "### Creating private network"
goal network create -n tn50e -t ../networktemplate.json -r ../net1
echo
echo "### Updating token"
echo 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > ../net1/Primary/algod.token
echo
echo "### Starting private network"
goal network start -r ../net1
echo
echo "### Checking node status"
goal network status -r ../net1
echo "### Importing root keys"
gcmd="goal -d ../net1/Primary"
NODEKEY=$(${gcmd} account list |  awk '{print $2}')
echo "Imported ${NODEKEY}"

echo "### Importing accounts and funding them"
${gcmd} account import -m "engage load empty enlist script live rookie spin half drum matter power mango bless piano board skill normal airport fabric nephew bring barrel ability aim"
${gcmd} account import -m "group few acquire lab advance measure impact follow grocery behave fire say renew scare frequent draw black damp shed advance piece cancel inject abstract deliver"
