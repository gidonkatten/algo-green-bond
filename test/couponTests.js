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
  PERIOD,
  START_BUY_DATE,
  END_BUY_DATE,
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
  claimCouponTxns
} = require("./utils");

describe('Coupon Tests', function () {
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
    runtime.optIntoASA(stablecoinId, stablecoinEscrowAddress, {})
  });

  describe('claim_coupon', function () {

    const NUM_BONDS_OWNED = 3;

    describe('without coupon', function () {

      this.beforeEach(() => {
        updateMainApp(runtime, masterAddr, mainAppId, {
          MANAGE_APP_ID: manageAppId,
          STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
          BOND_ESCROW_ADDR: bondEscrow.address,
          BOND_COUPON: 0,
        });
        updateManageApp(runtime, masterAddr, manageAppId, {
          MAIN_APP_ID: mainAppId,
          STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
          BOND_ESCROW_ADDR: bondEscrow.address,
          BOND_COUPON: 0,
        });
        runtime.optInToApp(investorAddr, mainAppId, {}, {});

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
          appArgs: [stringToBytes("freeze_all"), 'int:1'],
        });

        // buy
        runtime.setRoundAndTimestamp(3, START_BUY_DATE);
        fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_OWNED);
        buyBond(NUM_BONDS_OWNED, BOND_COST, investor.account);
      });

      it('cannot claim coupon when 0 coupon', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED,
          BOND_COUPON,
          stablecoinEscrowLsig,
          bondEscrowLsig,
          bondId,
          stablecoinId,
          mainAppId,
          manageAppId,
          investor.account
        )
        assert.throws(
          () => runtime.executeTx(claimCouponTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });
    });

    describe('with coupon', function () {

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
          appArgs: [stringToBytes("freeze_all"), 'int:1'],
        });

        // buy
        runtime.setRoundAndTimestamp(3, START_BUY_DATE);
        fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_OWNED);
        buyBond(NUM_BONDS_OWNED, BOND_COST, investor.account);
      });

      it('cannot claim coupon when account frozen', () => {
        // freeze
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: financialRegulator.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes("freeze"), 'int:0'],
          accounts: [investorAddr],
        });
        assert.equal(getMainLocal(investorAddr, 'Frozen'), 0);

        // claim coupon
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED,
          BOND_COUPON,
          stablecoinEscrowLsig,
          bondEscrowLsig,
          bondId,
          stablecoinId,
          mainAppId,
          manageAppId,
          investor.account
        )
        assert.throws(
          () => runtime.executeTx(claimCouponTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot claim coupon when all frozen', () => {
        // freeze
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: financialRegulator.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes("freeze_all"), 'int:0'],
        });
        assert.equal(getMainGlobal('Frozen'), 0);

        // claim coupon
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED,
          BOND_COUPON,
          stablecoinEscrowLsig,
          bondEscrowLsig,
          bondId,
          stablecoinId,
          mainAppId,
          manageAppId,
          investor.account
        )
        assert.throws(
          () => runtime.executeTx(claimCouponTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot claim coupon before coupon date', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD - 1);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED,
          BOND_COUPON,
          stablecoinEscrowLsig,
          bondEscrowLsig,
          bondId,
          stablecoinId,
          mainAppId,
          manageAppId,
          investor.account
        )
        assert.throws(
          () => runtime.executeTx(claimCouponTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot claim coupon if dont cover txn fee', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED,
          BOND_COUPON,
          stablecoinEscrowLsig,
          bondEscrowLsig,
          bondId,
          stablecoinId,
          mainAppId,
          manageAppId,
          investor.account
        )
        claimCouponTxGroup[2].amountMicroAlgos -= 1;
        assert.throws(
          () => runtime.executeTx(claimCouponTxGroup),
          'RUNTIME_ERR1007: Teal code rejected by logic'
        );
      });

      it('cannot claim coupon for not all your bonds owned', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED - 1,
          BOND_COUPON,
          stablecoinEscrowLsig,
          bondEscrowLsig,
          bondId,
          stablecoinId,
          mainAppId,
          manageAppId,
          investor.account
        )
        assert.throws(
          () => runtime.executeTx(claimCouponTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('can claim coupon', () => {
        // claim coupon
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + PERIOD);
        const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
        fundAsset(runtime, master.account, stablecoinEscrowAddress, stablecoinId, BOND_COUPON * NUM_BONDS_OWNED);

        const initialInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
        const initialEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

        // Atomic Transaction
        const claimCouponTxGroup = claimCouponTxns(
          NUM_BONDS_OWNED,
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

        const localCouponsPaid = getMainLocal(investorAddr, 'CouponsPaid');
        const globalCouponsPaid = getMainGlobal('CouponsPaid');
        const reserve = getMainGlobal('Reserve');
        const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
        const afterEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

        assert.equal(localCouponsPaid, 1);
        assert.equal(globalCouponsPaid, 1);
        assert.equal(reserve, 0);
        assert.equal(afterInvestorStablecoinHolding.amount,
          initialInvestorStablecoinHolding.amount + BigInt(NUM_BONDS_OWNED * BOND_COUPON));
        assert.equal(afterEscrowStablecoinHolding.amount,
          initialEscrowStablecoinHolding.amount - BigInt(NUM_BONDS_OWNED * BOND_COUPON));
      });
    });

  });

});
