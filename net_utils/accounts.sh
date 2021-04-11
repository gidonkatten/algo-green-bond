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

# compile stateless contract for bond to get its address
echo "Bond Contract Account:"
BOND_STATELESS_TEAL="../src/v2/bond_stateless.teal"
BOND_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${BOND_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Bond Stateless Contract Address = ${BOND_STATELESS_ADDRESS}"
${gcmd} account balance -a=${BOND_STATELESS_ADDRESS}
${gcmd} account info -a=${BOND_STATELESS_ADDRESS}

printf "\n\n\n"

# compile stateless contract for stablecoin to get its address
echo "Stablecoin Contract Account:"
STABLECOIN_STATELESS_TEAL="../src/v2/stablecoin_stateless.teal"
STABLECOIN_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STABLECOIN_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Stateless Contract Address = ${STABLECOIN_STATELESS_ADDRESS}"
${gcmd} account balance -a=${STABLECOIN_STATELESS_ADDRESS}
${gcmd} account info -a=${STABLECOIN_STATELESS_ADDRESS}
