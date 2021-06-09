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
  END_BUY_DATE,
  BOND_COST,
  mainStateStorage,
  manageStateStorage,
  createInitialApp,
  updateMainApp,
  fundAlgo,
  fundAsset,
  buyBondTxns,
  tradeTxns,
  tradeTxnsUsingLsig
} = require("./utils");

describe('Trade Tests', function () {
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
    // TODO: Use python sdk and import account using mnemonic
    investor = new AccountStore(MIN_BALANCE, { addr: investorAddr, sk: new Uint8Array(
      [55,99,85,4,192,247,129,39,58,174,90,54,27,69,174,254,27,91,1,151,107,66,183,
        200,141,138, 63,48,210,132,128,238,40,163,38,61,81,199,82,249,113,16,211,62,254,38,
        49,66,100,120,221,125,150,218,89,152,248,127,77,1,234,228,139,113])
    });
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

    runtime.optIntoASA(bondId, investorAddr, {});
    runtime.optIntoASA(bondId, traderAddr, {});
    runtime.optIntoASA(bondId, bondEscrowAddress, {});

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

  describe('trade', function () {

    const NUM_BONDS_BUYING = 3;
    const NUM_BONDS_TRADING = 2;
    const WILLING_TO_TRADE = 3;

    this.beforeEach(() => {
      updateMainApp(runtime, masterAddr, mainAppId, {
        MANAGE_APP_ID: manageAppId,
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
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      buyBond(NUM_BONDS_BUYING, BOND_COST);
    });

    it('cannot trade bond when owner is unwilling to trade', () => {
      runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);

      // Atomic Transaction
      const tradeTxGroup = tradeTxns(
        NUM_BONDS_TRADING,
        bondEscrowLsig,
        bondId,
        mainAppId,
        investor.account,
      )
      assert.throws(
        () => runtime.executeTx(tradeTxGroup),
        'RUNTIME_ERR1005: Result of current operation caused integer underflow'
      );
    });

    describe('when willing to trade', function () {

      this.beforeEach(() => {
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes('set_trade'), 'int:' + WILLING_TO_TRADE],
        });
      });

      it('can set amount willing to trade', () => {
        const localTrade = getMainLocal(investorAddr, 'Trade');
        assert.equal(localTrade, WILLING_TO_TRADE);
      });

      it('cannot trade when sender account frozen', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);

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

        // Atomic Transaction
        const tradeTxGroup = tradeTxns(
          NUM_BONDS_TRADING,
          bondEscrowLsig,
          bondId,
          mainAppId,
          investor.account,
        )
        assert.throws(
          () => runtime.executeTx(tradeTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot trade when receiver account frozen', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);

        // freeze
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: financialRegulator.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes("freeze"), 'int:0'],
          accounts: [traderAddr],
        });
        assert.equal(getMainLocal(traderAddr, 'Frozen'), 0);

        // Atomic Transaction
        const tradeTxGroup = tradeTxns(
          NUM_BONDS_TRADING,
          bondEscrowLsig,
          bondId,
          mainAppId,
          investor.account,
        )
        assert.throws(
          () => runtime.executeTx(tradeTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot trade when all frozen', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);

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

        // Atomic Transaction
        const tradeTxGroup = tradeTxns(
          NUM_BONDS_TRADING,
          bondEscrowLsig,
          bondId,
          mainAppId,
          investor.account,
        )
        assert.throws(
          () => runtime.executeTx(tradeTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot trade bond before or at end buy date', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE);
        const tradeTxGroup = tradeTxns(
          NUM_BONDS_TRADING,
          bondEscrowLsig,
          bondId,
          mainAppId,
          investor.account,
        )
        assert.throws(
          () => runtime.executeTx(tradeTxGroup),
          'RUNTIME_ERR1009: TEAL runtime encountered err opcode'
        );
      });

      it('cannot trade bond if dont cover txn fee', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
        const tradeTxGroup = tradeTxns(
          NUM_BONDS_TRADING,
          bondEscrowLsig,
          bondId,
          mainAppId,
          investor.account,
        )
        tradeTxGroup[1].amountMicroAlgos -= 1;
        assert.throws(
          () => runtime.executeTx(tradeTxGroup),
          'RUNTIME_ERR1007: Teal code rejected by logic'
        );
      });

      it('owner can trade bond', () => {
        runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
        const initialInvestorBondsHolding = runtime.getAssetHolding(bondId, investorAddr);

        // Atomic Transaction
        const tradeTxGroup = tradeTxns(
          NUM_BONDS_TRADING,
          bondEscrowLsig,
          bondId,
          mainAppId,
          investor.account,
        )
        runtime.executeTx(tradeTxGroup);

        // verify traded
        const afterInvestorBondsHolding = runtime.getAssetHolding(bondId, investorAddr);
        const traderBondHolding = runtime.getAssetHolding(bondId, traderAddr);
        const localTrade = getMainLocal(investorAddr, 'Trade');

        assert.equal(afterInvestorBondsHolding.amount,
          initialInvestorBondsHolding.amount - BigInt(NUM_BONDS_TRADING));
        assert.equal(traderBondHolding.amount, NUM_BONDS_TRADING);
        assert.equal(localTrade, WILLING_TO_TRADE - NUM_BONDS_TRADING);
      });

      describe('using logic sig', function () {

        const TRADE_PRICE = 70e6;

        it('cannot trade bond if past expiry', () => {
          const tradeLsigProg = getProgram('tradeLsig.py', {
            MAIN_APP_ID: mainAppId,
            MANAGE_APP_ID: manageAppId,
            LV: 1,
            TRADE_PRICE
          });
          const tradeLsig = runtime.getLogicSig(tradeLsigProg, []);
          tradeLsig.sign(investor.account.sk);

          runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
          fundAsset(runtime, master.account, traderAddr, stablecoinId, TRADE_PRICE * NUM_BONDS_TRADING);

          // Atomic Transaction
          const tradeTxGroup = tradeTxnsUsingLsig(
            NUM_BONDS_TRADING,
            TRADE_PRICE,
            tradeLsig,
            bondEscrowLsig,
            bondId,
            stablecoinId,
            mainAppId,
            trader.account,
            investorAddr
          )
          assert.throws(
            () => runtime.executeTx(tradeTxGroup),
            'RUNTIME_ERR1007: Teal code rejected by logic'
          );
        });

        it('cannot trade bond if paying below trade price', () => {
          const tradeLsigProg = getProgram('tradeLsig.py', {
            MAIN_APP_ID: mainAppId,
            MANAGE_APP_ID: manageAppId,
            LV: 1500,
            TRADE_PRICE: TRADE_PRICE
          });
          const tradeLsig = runtime.getLogicSig(tradeLsigProg, []);
          tradeLsig.sign(investor.account.sk);

          runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
          fundAsset(runtime, master.account, traderAddr, stablecoinId, TRADE_PRICE * NUM_BONDS_TRADING);

          // Atomic Transaction
          const tradeTxGroup = tradeTxnsUsingLsig(
            NUM_BONDS_TRADING,
            TRADE_PRICE - 1,
            tradeLsig,
            bondEscrowLsig,
            bondId,
            stablecoinId,
            mainAppId,
            trader.account,
            investorAddr
          )
          assert.throws(
            () => runtime.executeTx(tradeTxGroup),
            'RUNTIME_ERR1007: Teal code rejected by logic'
          );
        });

        it('cannot trade bond if over pay fee txn', () => {
          const tradeLsigProg = getProgram('tradeLsig.py', {
            MAIN_APP_ID: mainAppId,
            MANAGE_APP_ID: manageAppId,
            LV: 1500,
            TRADE_PRICE
          });
          const tradeLsig = runtime.getLogicSig(tradeLsigProg, [])
          tradeLsig.sign(investor.account.sk);

          runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
          fundAsset(runtime, master.account, traderAddr, stablecoinId, TRADE_PRICE * NUM_BONDS_TRADING);

          // Atomic Transaction
          const tradeTxGroup = tradeTxnsUsingLsig(
            NUM_BONDS_TRADING,
            TRADE_PRICE,
            tradeLsig,
            bondEscrowLsig,
            bondId,
            stablecoinId,
            mainAppId,
            trader.account,
            investorAddr
          )
          tradeTxGroup[1].amountMicroAlgos += 1;
          assert.throws(
            () => runtime.executeTx(tradeTxGroup),
            'RUNTIME_ERR1007: Teal code rejected by logic'
          );
        });

        it('cannot trade bond if over pay ssc call fee', () => {
          const tradeLsigProg = getProgram('tradeLsig.py', {
            MAIN_APP_ID: mainAppId,
            MANAGE_APP_ID: manageAppId,
            LV: 1500,
            TRADE_PRICE
          });
          const tradeLsig = runtime.getLogicSig(tradeLsigProg, [])
          tradeLsig.sign(investor.account.sk);

          runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
          fundAsset(runtime, master.account, traderAddr, stablecoinId, TRADE_PRICE * NUM_BONDS_TRADING);

          // Atomic Transaction
          const tradeTxGroup = tradeTxnsUsingLsig(
            NUM_BONDS_TRADING,
            TRADE_PRICE,
            tradeLsig,
            bondEscrowLsig,
            bondId,
            stablecoinId,
            mainAppId,
            trader.account,
            investorAddr
          )
          tradeTxGroup[0].payFlags.totalFee += 1;
          assert.throws(
            () => runtime.executeTx(tradeTxGroup),
            'RUNTIME_ERR1007: Teal code rejected by logic'
          );
        });

        it('cannot trade bond if over pay txn fee fee', () => {
          const tradeLsigProg = getProgram('tradeLsig.py', {
            MAIN_APP_ID: mainAppId,
            MANAGE_APP_ID: manageAppId,
            LV: 1500,
            TRADE_PRICE
          });
          const tradeLsig = runtime.getLogicSig(tradeLsigProg, [])
          tradeLsig.sign(investor.account.sk);

          runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
          fundAsset(runtime, master.account, traderAddr, stablecoinId, TRADE_PRICE * NUM_BONDS_TRADING);

          // Atomic Transaction
          const tradeTxGroup = tradeTxnsUsingLsig(
            NUM_BONDS_TRADING,
            TRADE_PRICE,
            tradeLsig,
            bondEscrowLsig,
            bondId,
            stablecoinId,
            mainAppId,
            trader.account,
            investorAddr
          )
          tradeTxGroup[1].payFlags.totalFee += 1;
          assert.throws(
            () => runtime.executeTx(tradeTxGroup),
            'RUNTIME_ERR1007: Teal code rejected by logic'
          );
        });

        it('can trade bond', () => {
          const tradeLsigProg = getProgram('tradeLsig.py', {
            MAIN_APP_ID: mainAppId,
            MANAGE_APP_ID: manageAppId,
            LV: 1500,
            TRADE_PRICE
          });
          const tradeLsig = runtime.getLogicSig(tradeLsigProg, []);
          tradeLsig.sign(investor.account.sk);

          runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);
          fundAsset(runtime, master.account, traderAddr, stablecoinId, TRADE_PRICE * NUM_BONDS_TRADING);
          const initialInvestorBondsHolding = runtime.getAssetHolding(bondId, investorAddr);
          const initialInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
          const initialTraderStablecoinHolding = runtime.getAssetHolding(stablecoinId, traderAddr);

          // Atomic Transaction
          const tradeTxGroup = tradeTxnsUsingLsig(
            NUM_BONDS_TRADING,
            TRADE_PRICE,
            tradeLsig,
            bondEscrowLsig,
            bondId,
            stablecoinId,
            mainAppId,
            trader.account,
            investorAddr
          )
          runtime.executeTx(tradeTxGroup);

          // verify traded
          const afterInvestorBondsHolding = runtime.getAssetHolding(bondId, investorAddr);
          const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
          const afterTraderStablecoinHolding = runtime.getAssetHolding(stablecoinId, traderAddr);
          const traderBondHolding = runtime.getAssetHolding(bondId, traderAddr);
          const localTrade = getMainLocal(investorAddr, 'Trade');

          assert.equal(afterInvestorBondsHolding.amount,
            initialInvestorBondsHolding.amount - BigInt(NUM_BONDS_TRADING));
          assert.equal(afterInvestorStablecoinHolding.amount,
            initialInvestorStablecoinHolding.amount + BigInt(NUM_BONDS_TRADING * TRADE_PRICE));
          assert.equal(afterTraderStablecoinHolding.amount,
            initialTraderStablecoinHolding.amount - BigInt(NUM_BONDS_TRADING * TRADE_PRICE));
          assert.equal(traderBondHolding.amount, NUM_BONDS_TRADING);
          assert.equal(localTrade, WILLING_TO_TRADE - NUM_BONDS_TRADING);
        });
      });

    });
  });

});
