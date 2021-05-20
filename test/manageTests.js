const { getProgram, stringToBytes } = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');
const {
  greenVerifierAddr,
  investorAddr,
  issuerAddr,
  masterAddr,
  traderAddr,
  MIN_BALANCE,
  PERIOD,
  BOND_LENGTH,
  START_BUY_DATE,
  END_BUY_DATE,
  MATURITY_DATE,
  BOND_COST,
  BOND_COUPON,
  BOND_PRINCIPAL,
  mainStateStorage,
  manageStateStorage,
  createInitialApp,
  updateMainApp,
  updateManageApp,
  fundAlgo,
  fundAsset,
  buyBondTxns,
} = require("./utils");

describe('Manage Green Bond Tests', function () {
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

  describe('Rating', function () {

    beforeEach(() => {
      updateManageApp(runtime, masterAddr, manageAppId, {
        MAIN_APP_ID: mainAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
        BOND_COUPON: 0
      });
    });

    // TODO: TEAL3

  });


  describe('Defaults', function () {

    const NUM_BONDS_BUYING = 3;

    beforeEach(() => {
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
      fundAsset(runtime, master.account, investorAddr, stablecoinId, BOND_COST * NUM_BONDS_BUYING);
      buyBond(NUM_BONDS_BUYING, BOND_COST);
    });

    describe('has defaulted', function () {

      it('yes passes', () => {
        // Set time to when have money to owe
        runtime.setRoundAndTimestamp(5, MATURITY_DATE);
        const stablecoinEscrowHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrow.address);
        assert.equal(stablecoinEscrowHolding.amount, 0);

        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: manageAppId,
          payFlags: {},
          appArgs: [stringToBytes("defaulted")],
          accounts: [stablecoinEscrow.address, bondEscrow.address],
          foreignApps: [mainAppId],
          foreignAssets: [bondId]
        })
      });

      it('no fails', () => {
        // Set time to when have money to owe
        runtime.setRoundAndTimestamp(5, MATURITY_DATE);
        const stablecoinEscrowHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrow.address);
        assert.equal(stablecoinEscrowHolding.amount, 0);

        assert.throws(() => {
          runtime.executeTx({
            type: types.TransactionType.CallNoOpSSC,
            sign: types.SignType.SecretKey,
            fromAccount: investor.account,
            appId: manageAppId,
            payFlags: {},
            appArgs: [stringToBytes("not_defaulted")],
            accounts: [stablecoinEscrow.address, bondEscrow.address],
            foreignApps: [mainAppId],
            foreignAssets: [bondId]
          })
        }, 'RUNTIME_ERR1007: Teal code rejected by logic');
      });
    });


    describe('has not defaulted', function () {

      it('no passes', () => {
        // Set time to when have money to owe
        runtime.setRoundAndTimestamp(5, MATURITY_DATE);
        fundAsset(runtime, master.account, stablecoinEscrow.address, stablecoinId, 10000000000);

        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: manageAppId,
          payFlags: {},
          appArgs: [stringToBytes("not_defaulted")],
          accounts: [stablecoinEscrow.address, bondEscrow.address],
          foreignApps: [mainAppId],
          foreignAssets: [bondId]
        })
      });

      it('yes fails', () => {
        // Set time to when have money to owe
        runtime.setRoundAndTimestamp(5, MATURITY_DATE);
        fundAsset(runtime, master.account, stablecoinEscrow.address, stablecoinId, 10000000000);

        assert.throws(() => {
          runtime.executeTx({
            type: types.TransactionType.CallNoOpSSC,
            sign: types.SignType.SecretKey,
            fromAccount: investor.account,
            appId: manageAppId,
            payFlags: {},
            appArgs: [stringToBytes("defaulted")],
            accounts: [stablecoinEscrow.address, bondEscrow.address],
            foreignApps: [mainAppId],
            foreignAssets: [bondId]
          })
        }, 'RUNTIME_ERR1007: Teal code rejected by logic');
      });
    });

  });

});
