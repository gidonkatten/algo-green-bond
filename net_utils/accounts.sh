gcmd="goal -d ../net1/Primary"
gcmd2="goal -d ../net1/Node"

ACCOUNT=$(${gcmd} account list|awk '{ print $3 }'|head -n 1)
ACCOUNT2=$(${gcmd2} account list|awk '{ print $3 }'|head -n 1)

echo "Primary Account:"
${gcmd} account balance -a=${ACCOUNT}
${gcmd} account info -a=${ACCOUNT}

printf "\n\n\n"

echo "Buyer Account:"
${gcmd} account balance -a=${ACCOUNT2}
${gcmd} account info -a=${ACCOUNT2}

printf "\n\n\n"

# compile stateless contract to get its address
echo "Contract Account:"
STATELESS_TEAL="../src/v2/stateless.teal"
STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stateless Contract Address = ${STATELESS_ADDRESS}"
${gcmd} account balance -a=${STATELESS_ADDRESS}
${gcmd} account info -a=${STATELESS_ADDRESS}
