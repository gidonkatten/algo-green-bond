const { getProgram } = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');
const {
  greenVerifierAddr,
  investorAddr,
  issuerAddr,
  masterAddr,
  traderAddr,
  MIN_BALANCE,
  START_BUY_DATE,
  MATURITY_DATE,
  BOND_COST,
  BOND_PRINCIPAL,
  mainStateStorage,
  manageStateStorage,
  createInitialApp,
  updateMainApp,
  updateManageApp,
  fundAlgo,
  fundAsset,
  buyBondTxns,
  claimDefaultTxns
} = require("./utils");

describe('Default Tests', function () {
  let runtime;
  let master, issuer, investor, trader, greenVerifier;
  let bondEscrow, bondEscrowLsig, stablecoinEscrow, stablecoinEscrowLsig;
  let mainAppId, manageAppId, bondId, stablecoinId;

  const getMainGlobal = (key) => runtime.getGlobalState(mainAppId, key);
  const getMainLocal = (addr, key) => runtime.getLocalState(mainAppId, addr, key);

  /**
   * This function buys bonds
   */
  function buyBond(noOfBonds, bondCost) {
    const buyTxGroup = buyBondTxns(
      noOfBonds,
      bondCost,
      bondEscrowLsig,
      bondId,
      stablecoinId,
      mainAppId,
      investor.account,
    )

    runtime.executeTx(buyTxGroup);
  }

  /**
   * This creates bond, stablecoin and escrow accounts
   */
  this.beforeEach(() => {
    // refresh accounts + initialize runtime
    master = new AccountStore(1000e6, { addr: masterAddr, sk: new Uint8Array(0) });
    issuer = new AccountStore(MIN_BALANCE, { addr: issuerAddr, sk: new Uint8Array(0) });
    investor = new AccountStore(MIN_BALANCE, { addr: investorAddr, sk: new Uint8Array(0) });
    trader = new AccountStore(MIN_BALANCE, { addr: traderAddr, sk: new Uint8Array(0) });
    greenVerifier = new AccountStore(MIN_BALANCE, { addr: greenVerifierAddr, sk: new Uint8Array(0) });
    runtime = new Runtime([master, issuer, investor, trader, greenVerifier]);

    // create and get app id for the stateful contracts
    mainAppId = createInitialApp(runtime, master.account, mainStateStorage);
    manageAppId = createInitialApp(runtime, master.account, manageStateStorage);

    // setup and sync bond escrow account
    const bondEscrowProg = getProgram('bondEscrow.py', {
      MAIN_APP_ID: mainAppId,
      MANAGE_APP_ID: manageAppId
    });
    bondEscrowLsig = runtime.getLogicSig(bondEscrowProg, []);
    const bondEscrowAddress = bondEscrowLsig.address();
    bondEscrow = runtime.getAccount(bondEscrowAddress);

    // setup and sync stablecoin escrow account
    const stablecoinEscrowProg = getProgram('stablecoinEscrow.py', {
      MAIN_APP_ID: mainAppId,
      MANAGE_APP_ID: manageAppId
    });
    stablecoinEscrowLsig = runtime.getLogicSig(stablecoinEscrowProg, []);
    const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
    stablecoinEscrow = runtime.getAccount(stablecoinEscrowAddress);

    // fund escrows with some minimum balance
    fundAlgo(runtime, master.account, bondEscrowAddress, MIN_BALANCE);
    fundAlgo(runtime, master.account, stablecoinEscrowAddress, MIN_BALANCE);

    // Create bond, opt-in, fund and configure
    bondId = runtime.addAsset("bond", { creator: { ...master.account, name: 'master' } });

    runtime.optIntoASA(bondId, investorAddr, {})
    runtime.optIntoASA(bondId, bondEscrowAddress, {})

    runtime.executeTx({
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      revocationTarget: masterAddr,
      recipient: bondEscrowAddress,
      amount: 5,
      assetID: bondId,
      payFlags: {}
    });

    runtime.executeTx({
      type: types.TransactionType.ModifyAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      assetID: bondId,
      fields: {
        manager: "",
        // reserve: masterAddr,
        freeze: "",
        clawback: bondEscrowAddress
      },
      payFlags: {}
    })

    // Create stablecoin and opt-in
    stablecoinId = runtime.addAsset("stablecoin", { creator: { ...master.account, name: 'master' } });

    runtime.optIntoASA(stablecoinId, issuerAddr, {})
    runtime.optIntoASA(stablecoinId, investorAddr, {})
    runtime.optIntoASA(stablecoinId, stablecoinEscrowAddress, {})
  });

  describe('default', function () {

    it('should be able to claim default', () => {
      // setup
      updateMainApp(runtime, masterAddr, mainAppId, {
        MANAGE_APP_ID: manageAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
        BOND_COUPON: 0
      });
      updateManageApp(runtime, masterAddr, manageAppId, {
        MAIN_APP_ID: mainAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
        BOND_COUPON: 0
      });
      runtime.optInToApp(investorAddr, mainAppId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      const defaultAmount = BOND_PRINCIPAL * NUM_BONDS_BUYING / 2;
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // claim default
      runtime.setRoundAndTimestamp(4, MATURITY_DATE);
      const bondEscrowAddress = bondEscrowLsig.address();
      const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
      fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, defaultAmount);

      const initialEscrowBondHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
      const initialInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
      const initialEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      // Atomic Transaction
      const claimDefaultTxGroup = claimDefaultTxns(
        NUM_BONDS_BUYING,
        defaultAmount,
        stablecoinEscrowLsig,
        bondEscrowLsig,
        bondId,
        stablecoinId,
        mainAppId,
        manageAppId,
        investor.account,
      )

      runtime.executeTx(claimDefaultTxGroup);

      const localCouponsPaid = getMainLocal(investorAddr, 'CouponsPaid');
      const investorBondHolding = runtime.getAssetHolding(bondId, investorAddr);
      const afterEscrowBondHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
      const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
      const afterEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      assert.isUndefined(localCouponsPaid);
      assert.equal(investorBondHolding.amount, 0);
      assert.equal(afterEscrowBondHolding.amount,
        initialEscrowBondHolding.amount + BigInt(NUM_BONDS_BUYING));
      assert.equal(afterInvestorStablecoinHolding.amount,
        initialInvestorStablecoinHolding.amount + BigInt((NUM_BONDS_BUYING * BOND_PRINCIPAL) / 2));
      assert.equal(afterEscrowStablecoinHolding.amount,
        initialEscrowStablecoinHolding.amount - BigInt((NUM_BONDS_BUYING * BOND_PRINCIPAL) / 2));
    });
  });

});
