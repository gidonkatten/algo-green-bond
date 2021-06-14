const { getProgram } = require('@algo-builder/algob');
const { Runtime, AccountStore, stringToBytes, types } = require('@algo-builder/runtime');
const { assert } = require('chai');
const {
  greenVerifierAddr,
  financialRegulatorAddr,
  investorAddr,
  issuerAddr,
  masterAddr,
  traderAddr,
  MIN_BALANCE,
  START_BUY_DATE,
  MATURITY_DATE,
  BOND_COST,
  BOND_COUPON,
  mainStateStorage,
  manageStateStorage,
  createInitialApp,
  updateMainApp,
  updateManageApp,
  fundAlgo,
  fundAsset,
  buyBondTxns,
  claimCouponTxns,
  claimDefaultTxns
} = require("./utils");

describe('Path Tests', function () {
  let runtime;
  let master, issuer, investor, trader, greenVerifier, financialRegulator;
  let bondEscrow, bondEscrowLsig, stablecoinEscrow, stablecoinEscrowLsig;
  let mainAppId, manageAppId, bondId, stablecoinId;

  const getMainGlobal = (key) => runtime.getGlobalState(mainAppId, key);
  const getMainLocal = (addr, key) => runtime.getLocalState(mainAppId, addr, key);

  // fetch latest account state
  function syncAccounts () {
    master = runtime.getAccount(masterAddr);
    issuer = runtime.getAccount(issuerAddr);
    investor = runtime.getAccount(investorAddr);
    trader = runtime.getAccount(traderAddr);
    greenVerifier = runtime.getAccount(greenVerifierAddr);
    if (bondEscrow) bondEscrow = runtime.getAccount(bondEscrow.address);
    if (stablecoinEscrow) stablecoinEscrow = runtime.getAccount(stablecoinEscrow.address);
  }

  /**
   * This function buys bonds
   */
  function buyBond(noOfBonds, bondCost, account) {
    const buyTxGroup = buyBondTxns(
      noOfBonds,
      bondCost,
      bondEscrowLsig,
      bondId,
      stablecoinId,
      mainAppId,
      account,
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
    financialRegulator = new AccountStore(MIN_BALANCE, { addr: financialRegulatorAddr, sk: new Uint8Array(0) });
    runtime = new Runtime([master, issuer, investor, trader, greenVerifier, financialRegulator]);

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
    runtime.optIntoASA(bondId, traderAddr, {})
    runtime.optIntoASA(bondId, bondEscrowAddress, {})

    runtime.executeTx({
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      revocationTarget: masterAddr,
      recipient: bondEscrowAddress,
      amount: 100000000,
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
    runtime.optIntoASA(stablecoinId, traderAddr, {})
    runtime.optIntoASA(stablecoinId, stablecoinEscrowAddress, {})
  });

  describe('two buyers', function () {

    const INVESTOR_NUM_BONDS_OWNED = 4900000;
    const TRADER_NUM_BONDS_OWNED = 1004540;
    const TOTAL_BONDS_OWNED = INVESTOR_NUM_BONDS_OWNED + TRADER_NUM_BONDS_OWNED;

    this.beforeEach(() => {
      updateMainApp(runtime, masterAddr, mainAppId, {
        MANAGE_APP_ID: manageAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
      });
      updateManageApp(runtime, masterAddr, manageAppId, {
        MAIN_APP_ID: mainAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
      });
      runtime.optInToApp(investorAddr, mainAppId, {}, {});
      runtime.optInToApp(traderAddr, mainAppId, {}, {});

      // unfreeze
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze"), 'int:1'],
        accounts: [investorAddr],
      });
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze"), 'int:1'],
        accounts: [traderAddr],
      });
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze_all"), 'int:1'],
      });

      // buy
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * INVESTOR_NUM_BONDS_OWNED);
      fundAsset(runtime, master.account, traderAddr, stablecoinId, BOND_COST * TRADER_NUM_BONDS_OWNED);
      buyBond(INVESTOR_NUM_BONDS_OWNED, BOND_COST, investor.account);
      buyBond(TRADER_NUM_BONDS_OWNED, BOND_COST, trader.account);
    });


    it('coupons and then default', () => {
      runtime.setRoundAndTimestamp(5, MATURITY_DATE);

      // Fund two and half coupon rounds worth
      const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
      const couponRound = BOND_COUPON * TOTAL_BONDS_OWNED;
      const fundAmount = 3 * couponRound - 1;
      fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, fundAmount);

      // Investor claims coupons
      const claimCouponTxGroup = claimCouponTxns(
        INVESTOR_NUM_BONDS_OWNED,
        BOND_COUPON,
        stablecoinEscrowLsig,
        bondEscrowLsig,
        bondId,
        stablecoinId,
        mainAppId,
        manageAppId,
        investor.account
      )
      runtime.executeTx(claimCouponTxGroup);
      runtime.executeTx(claimCouponTxGroup);

      // Verify reserve global state
      const claimed = 2 * BOND_COUPON * INVESTOR_NUM_BONDS_OWNED;
      const reserve = getMainGlobal('Reserve');
      assert.equal(reserve, (2 * couponRound) - claimed);

      // verify escrow balance
      const escrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);
      assert.equal(escrowStablecoinHolding.amount, fundAmount - claimed);

      // Investor claims default
      const defaultAmount = (Number(escrowStablecoinHolding.amount- reserve)) * (INVESTOR_NUM_BONDS_OWNED / (TOTAL_BONDS_OWNED));
      const claimDefaultTxGroup = claimDefaultTxns(
        INVESTOR_NUM_BONDS_OWNED,
        Math.floor(defaultAmount),
        stablecoinEscrowLsig,
        bondEscrowLsig,
        bondId,
        stablecoinId,
        mainAppId,
        manageAppId,
        investor.account,
      );
      runtime.executeTx(claimDefaultTxGroup);
    });

  });
});
