gcmd="goal -d ../net1/Primary"

MASTER=$(${gcmd} account list|awk '{ print $3 }'|tail -1)
ISSUER=$(${gcmd} account list|awk '{ print $3 }'|head -1)
INVESTOR=$(${gcmd} account list|awk '{ print $3 }'|head -2|tail -1)

echo "Master Account Address = ${MASTER}"
${gcmd} account balance -a=${MASTER}
${gcmd} account info -a=${MASTER}

printf "\n\n\n"

echo "Issuer Account Address = ${ISSUER}"
${gcmd} account balance -a=${ISSUER}
${gcmd} account info -a=${ISSUER}

printf "\n\n\n"

echo "Investor Account Address = ${INVESTOR}"
${gcmd} account balance -a=${INVESTOR}
${gcmd} account info -a=${INVESTOR}

printf "\n\n\n"

# compile stateless contract for bond to get its address
echo "Bond Contract Account:"
BOND_STATELESS_TEAL="../generated-src/bondEscrow.teal"
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
STABLECOIN_STATELESS_TEAL="../generated-src/stablecoinEscrow.teal"
STABLECOIN_STATELESS_ADDRESS=$(
  ${gcmd} clerk compile -n ${STABLECOIN_STATELESS_TEAL} \
  | awk '{ print $2 }' \
  | head -n 1
)
echo "Stablecoin Stateless Contract Address = ${STABLECOIN_STATELESS_ADDRESS}"
${gcmd} account balance -a=${STABLECOIN_STATELESS_ADDRESS}
${gcmd} account info -a=${STABLECOIN_STATELESS_ADDRESS}
