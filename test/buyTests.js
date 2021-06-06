const { getProgram, stringToBytes } = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
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
  BOND_COST,
  mainStateStorage,
  manageStateStorage,
  createInitialApp,
  updateMainApp,
  fundAlgo,
  fundAsset,
  buyBondTxns
} = require("./utils");

describe('Buy Tests', function () {
  let runtime;
  let master, issuer, investor, trader, greenVerifier, financialRegulator;
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

  describe('buy', function () {

    const NUM_BONDS_BUYING = 3;

    this.beforeEach(() => {
      updateMainApp(runtime, masterAddr, mainAppId, {
        MANAGE_APP_ID: manageAppId,
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
    });

    it('cannot buy when account frozen', () => {
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);

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

      // buy
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      assert.throws(() => {
        buyBond(NUM_BONDS_BUYING, BOND_COST);
      }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');
    });

    it('cannot buy when all frozen', () => {
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);

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

      // buy
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      assert.throws(() => {
        buyBond(NUM_BONDS_BUYING, BOND_COST);
      }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');
    });

    it('cannot buy when before start buy date', () => {
      runtime.setRoundAndTimestamp(3, START_BUY_DATE - 1);

      // buy
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      assert.throws(() => {
        buyBond(NUM_BONDS_BUYING, BOND_COST);
      }, 'RUNTIME_ERR1007: Teal code rejected by logic');
    });

    it('should be able to buy bond', () => {
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);

      // buy
      const NUM_BONDS_BUYING = 3;
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      const initialStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // verify bought
      const afterStablecoinHolding = runtime.getAssetHolding(stablecoinId, investorAddr);
      const bondsHolding = runtime.getAssetHolding(bondId, investorAddr);

      assert.equal(afterStablecoinHolding.amount,
        initialStablecoinHolding.amount - BigInt(BOND_COST * NUM_BONDS_BUYING));
      assert.equal(bondsHolding.amount, NUM_BONDS_BUYING);
    });
  });

});
