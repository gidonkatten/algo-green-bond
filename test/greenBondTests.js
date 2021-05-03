const {
  addressToPk,
  getProgram,
  stringToBytes
} = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');

const MIN_BALANCE = 10e6; // 10 algo

const SIX_MONTH_PERIOD = 15768000;
const BOND_LENGTH = 2; // 1 year ie 2 six month periods
const START_BUY_DATE = 50;
const END_BUY_DATE = START_BUY_DATE + 50;
const MATURITY_DATE = END_BUY_DATE + (SIX_MONTH_PERIOD * BOND_LENGTH);
const BOND_COST = 50000000; // $50
const BOND_COUPON = 2500000; // $2.5
const BOND_PRINCIPAL = 100000000; // $100

const masterAddr = "A6BDLTPR4IEIZG4CCUGEXVMZSXTFO7RWNSOWHBWZL3CX2CLWTKW5FF4SE4";
const issuerAddr = "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY";
const investorAddr = "FCRSMPKRY5JPS4IQ2M7P4JRRIJSHRXL5S3NFTGHYP5GQD2XERNYUWEXG54";
const traderAddr = "TWYS3Y6SJOUW6WIEIXTBOII7523QI4MUO3TSYDS7SCG4TIGGC2S6V6TJP4";

describe('Green Bond Tests', function () {
  let master = new AccountStore(1000e6, { addr: masterAddr, sk: new Uint8Array(0) });
  let issuer = new AccountStore(MIN_BALANCE, { addr: issuerAddr, sk: new Uint8Array(0) });
  let investor = new AccountStore(MIN_BALANCE, { addr: investorAddr, sk: new Uint8Array(0) });
  let trader = new AccountStore(MIN_BALANCE, { addr: traderAddr, sk: new Uint8Array(0) });
  let bondEscrow, bondEscrowLsig; // initialized later
  let stablecoinEscrow, stablecoinEscrowLsig; // initialized later

  let runtime;
  let mainAppId;
  let manageAppId;
  let bondId;
  let bondDef;
  let stablecoinId;
  let stablecoinDef;

  const initialApprovalProgram = getProgram('initialStateful.py');
  let updatedApprovalProgram;
  let manageApprovalProgram;
  const clearProgram = getProgram('greenBondClear.py');

  const getGlobal = (key) => runtime.getGlobalState(mainAppId, key);
  const getLocal = (addr, key) => runtime.getLocalState(mainAppId, addr, key);

  // fetch latest account state
  function syncAccounts () {
    master = runtime.getAccount(master.address);
    issuer = runtime.getAccount(issuer.address);
    investor = runtime.getAccount(investor.address);
    trader = runtime.getAccount(trader.address);
    if (bondEscrow) bondEscrow = runtime.getAccount(bondEscrow.address);
    if (stablecoinEscrow) stablecoinEscrow = runtime.getAccount(stablecoinEscrow.address);
  }


  /**
   * This function funds given address with stablecoin
   */
  function fundStablecoin(amount, toAccountAddr) {
    const initialHolding = runtime.getAssetHolding(stablecoinId, toAccountAddr);

    runtime.executeTx({
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      toAccountAddr,
      amount: amount,
      assetID: stablecoinId,
      payFlags: {}
    });

    const afterHolding = runtime.getAssetHolding(stablecoinId, toAccountAddr);
    assert.equal(initialHolding.amount + BigInt(amount), afterHolding.amount);
  }

  /**
   * This function creates main app and sets app id to 13
   */
  function createMainApp() {
    runtime.appCounter = 12;

    // create application
    mainAppId = runtime.addApp(
      {
        sender: master.account,
        localInts: 1,
        localBytes: 0,
        globalInts: 1,
        globalBytes: 1,
        appArgs: []
      },
      {},
      initialApprovalProgram,
      clearProgram
    );


    assert.equal(mainAppId, 13);
  }

  /**
   * This function creates manage app and sets app id to 14
   */
  function createManageApp(params) {
    manageApprovalProgram = getProgram('manageGreenBondApproval.py', {
      MAIN_APP_ID: mainAppId,
      STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
      BOND_ESCROW_ADDR: bondEscrow.address,
      SIX_MONTH_PERIOD: SIX_MONTH_PERIOD,
      BOND_LENGTH: BOND_LENGTH, // 1 year ie 2 six month periods
      START_BUY_DATE: START_BUY_DATE,
      END_BUY_DATE: END_BUY_DATE,
      MATURITY_DATE: MATURITY_DATE,
      BOND_COUPON: BOND_COUPON, // $2.5
      BOND_PRINCIPAL: BOND_PRINCIPAL,
      ...params
    });

    // create application
    manageAppId = runtime.addApp(
      {
        sender: master.account,
        localInts: 0,
        localBytes: 0,
        globalInts: 0,
        globalBytes: 0,
        appArgs: []
      },
      {},
      manageApprovalProgram,
      clearProgram
    );


    assert.equal(manageAppId, 14);
  }

  /**
   * This function updates main app from given addr
   */
  function updateMainApp(addr, params) {
    updatedApprovalProgram = getProgram('greenBondApproval.py', {
      STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
      BOND_ESCROW_ADDR: bondEscrow.address,
      SIX_MONTH_PERIOD: SIX_MONTH_PERIOD,
      BOND_LENGTH: BOND_LENGTH, // 1 year ie 2 six month periods
      START_BUY_DATE: START_BUY_DATE,
      END_BUY_DATE: END_BUY_DATE,
      MATURITY_DATE: MATURITY_DATE,
      BOND_COST: BOND_COST, // $50
      BOND_COUPON: BOND_COUPON, // $2.5
      BOND_PRINCIPAL: BOND_PRINCIPAL,
      ...params
    });

    runtime.updateApp(addr, mainAppId, updatedApprovalProgram, clearProgram, {}, {});
  }

  /**
   * This function buys bonds
   */
  function buyBond(noOfBonds, bondCost) {
    const bondEscrowAddress = bondEscrowLsig.address();

    // Atomic Transaction
    const buyTxGroup = [
      {
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: investor.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes('buy')]
      },
      {
        type: types.TransactionType.RevokeAsset,
        sign: types.SignType.LogicSignature,
        fromAccount: bondEscrow.account,
        lsig: bondEscrowLsig,
        revocationTarget: bondEscrowAddress,
        recipient: investor.address,
        amount: noOfBonds,
        assetID: bondId,
        payFlags: { totalFee: 1000 }
      },
      {
        type: types.TransactionType.TransferAlgo,
        sign: types.SignType.SecretKey,
        fromAccount: investor.account,
        toAccountAddr: bondEscrowAddress,
        amountMicroAlgos: 1000,
        payFlags: { totalFee: 1000 }
      },
      {
        type: types.TransactionType.TransferAsset,
        sign: types.SignType.SecretKey,
        fromAccount: investor.account,
        toAccountAddr: issuer.address,
        amount: noOfBonds * bondCost,
        assetID: stablecoinId,
        payFlags: { totalFee: 1000 }
      }
    ];

    runtime.executeTx(buyTxGroup);
  }

  this.beforeAll(async function () {
    runtime = new Runtime([master, issuer, investor, trader]);

    creationFlags = {
      sender: master.account,
      localInts: 2,
      localBytes: 0,
      globalInts: 8,
      globalBytes: 2
    };
  });

  /**
   * This creates bond, stablecoin and escrow accounts
   */
  this.beforeEach(() => {
    // refresh accounts + initialize runtime
    master = new AccountStore(1000e6, { addr: masterAddr, sk: new Uint8Array(0) });
    issuer = new AccountStore(MIN_BALANCE, { addr: issuerAddr, sk: new Uint8Array(0) });
    investor = new AccountStore(MIN_BALANCE, { addr: investorAddr, sk: new Uint8Array(0) });
    trader = new AccountStore(MIN_BALANCE, { addr: traderAddr, sk: new Uint8Array(0) });
    runtime = new Runtime([master, issuer, investor, trader]);

    // setup and sync bond escrow account
    const bondEscrowProg = getProgram('bondEscrow.py');
    bondEscrowLsig = runtime.getLogicSig(bondEscrowProg, []);
    const bondEscrowAddress = bondEscrowLsig.address();
    bondEscrow = runtime.getAccount(bondEscrowAddress);

    // setup and sync stablecoin escrow account
    const stablecoinEscrowProg = getProgram('stablecoinEscrow.py');
    stablecoinEscrowLsig = runtime.getLogicSig(stablecoinEscrowProg, []);
    const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
    stablecoinEscrow = runtime.getAccount(stablecoinEscrowAddress);

    // fund escrows with some minimum balance
    runtime.executeTx({
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      toAccountAddr: bondEscrowAddress,
      amountMicroAlgos: MIN_BALANCE,
      payFlags: {}
    });
    runtime.executeTx({
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      toAccountAddr: stablecoinEscrowAddress,
      amountMicroAlgos: MIN_BALANCE,
      payFlags: {}
    });

    // Create bond, opt-in, fund and configure
    bondId = runtime.addAsset("bond", { creator: { ...master.account, name: 'master' } });
    assert.equal(bondId, 1);

    runtime.optIntoASA(bondId, investor.address, {})
    runtime.optIntoASA(bondId, bondEscrowAddress, {})
    let investorBondHolding = runtime.getAssetHolding(bondId, investor.address);
    let bondEscrowHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
    assert.isDefined(investorBondHolding);
    assert.isDefined(bondEscrowHolding);

    runtime.executeTx({
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      revocationTarget: master.address,
      recipient: bondEscrowAddress,
      amount: 5,
      assetID: bondId,
      payFlags: {}
    });
    bondEscrowHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
    assert.equal(bondEscrowHolding.amount, BigInt(5));

    runtime.executeTx({
      type: types.TransactionType.ModifyAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      assetID: bondId,
      fields: {
        manager: "",
        // reserve: master.address,
        freeze: "",
        clawback: bondEscrowAddress
      },
      payFlags: {}
    })
    bondDef = runtime.getAssetDef(bondId);
    assert.equal(bondDef['default-frozen'], true);
    assert.equal(bondDef.manager, "");
    assert.equal(bondDef.freeze, "");
    assert.equal(bondDef.clawback, bondEscrowAddress);

    // Create stablecoin
    stablecoinId = runtime.addAsset("stablecoin", { creator: { ...master.account, name: 'master' } });
    stablecoinDef = runtime.getAssetDef(stablecoinId);
    assert.equal(stablecoinId, 2);

    runtime.optIntoASA(stablecoinId, issuer.address, {})
    runtime.optIntoASA(stablecoinId, investor.address, {})
    runtime.optIntoASA(stablecoinId, stablecoinEscrowAddress, {})
    let issuerStablecoinHolding = runtime.getAssetHolding(stablecoinId, issuer.address);
    let investorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
    let stablecoinEscrowHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);
    assert.isDefined(issuerStablecoinHolding);
    assert.isDefined(investorStablecoinHolding);
    assert.isDefined(stablecoinEscrowHolding);
  });

  describe('Creation', function () {
    it('should create and update bond stateful application', () => {
      createMainApp();

      // assert.deepEqual(getGlobal('Creator'), master.address); // TODO: Add when switch to version 3
      assert.deepEqual(getGlobal('CreatorAddr'), addressToPk(master.address)); // TODO: Remove when switch to version 3
    });
  });

  describe('Update', function () {
    it('creator can update app', () => {
      createMainApp();
      updateMainApp(masterAddr);
    });


    it('non creator cannot update app', () => {
      createMainApp();

      assert.throws(() => {
        updateMainApp(investorAddr)
      }, 'RUNTIME_ERR1007: Teal code rejected by logic');
    });
  });

    describe('Opt-in', function () {
    it('should be able to opt-in to app', () => {
      createMainApp();
      updateMainApp(masterAddr);

      // verify not opted-in
      assert.isUndefined(investor.getAppFromLocal(mainAppId));

      // opt-in
      runtime.optInToApp(investor.address, mainAppId, {}, {});
      syncAccounts();

      // verify opt-in
      assert.isDefined(investor.getAppFromLocal(mainAppId));
    });
  });

  describe('buy', function () {

    it('should be able to buy bond', () => {
      // setup
      createMainApp();
      updateMainApp(masterAddr);
      runtime.optInToApp(investor.address, mainAppId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);

      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      const initialStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);

      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // verify bought
      const afterStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const bondsHolding = runtime.getAssetHolding(bondId, investor.address);

      assert.equal(afterStablecoinHolding.amount,
        initialStablecoinHolding.amount - BigInt(BOND_COST * NUM_BONDS_BUYING));
      assert.equal(bondsHolding.amount, NUM_BONDS_BUYING);
    });
  });

  describe('trade', function () {

    it('should be able to trade bond', () => {
      // setup
      createMainApp();
      updateMainApp(masterAddr);
      runtime.optInToApp(investor.address, mainAppId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      runtime.optInToApp(trader.address, mainAppId, {}, {});
      runtime.optIntoASA(bondId, trader.address, {})

      // trade
      runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);

      const bondEscrowAddress = bondEscrowLsig.address();
      const NUM_BONDS_TRADING = 2;

      const initialInvestorBondsHolding = runtime.getAssetHolding(bondId, investor.address);

      // Atomic Transaction
      const tradeTxGroup = [
        {
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes('trade')],
          accounts: [trader.address]
        },
        {
          type: types.TransactionType.RevokeAsset,
          sign: types.SignType.LogicSignature,
          fromAccount: bondEscrow.account,
          lsig: bondEscrowLsig,
          revocationTarget: investor.address,
          recipient: trader.address,
          amount: NUM_BONDS_TRADING,
          assetID: bondId,
          payFlags: { totalFee: 1000 }
        },
        {
          type: types.TransactionType.TransferAlgo,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          toAccountAddr: bondEscrowAddress,
          amountMicroAlgos: 1000,
          payFlags: { totalFee: 1000 }
        }
      ];

      runtime.executeTx(tradeTxGroup);

      // verify traded
      const afterInvestorBondsHolding = runtime.getAssetHolding(bondId, investor.address);
      const traderBondHolding = runtime.getAssetHolding(bondId, trader.address);

      assert.equal(afterInvestorBondsHolding.amount,
        initialInvestorBondsHolding.amount - BigInt(NUM_BONDS_TRADING));
      assert.equal(traderBondHolding.amount, NUM_BONDS_TRADING);
    });
  });

  describe('claim_coupon', function () {

    it('should be able to claim coupon', () => {
      // setup
      createMainApp();
      updateMainApp(masterAddr);
      // createManageApp();
      runtime.optInToApp(investor.address, mainAppId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // claim coupon
      runtime.setRoundAndTimestamp(4, END_BUY_DATE + SIX_MONTH_PERIOD);
      // const bondEscrowAddress = bondEscrowLsig.address();
      const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, stablecoinEscrowAddress);

      const initialInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const initialEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      // Atomic Transaction
      const claimCouponTxGroup = [
        {
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes('coupon')]
        },
        {
          type: types.TransactionType.TransferAlgo,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          toAccountAddr: stablecoinEscrowAddress,
          amountMicroAlgos: 1000,
          payFlags: { totalFee: 1000 }
        },
        {
          type: types.TransactionType.TransferAsset,
          sign: types.SignType.LogicSignature,
          fromAccount: stablecoinEscrow.account,
          lsig: stablecoinEscrowLsig,
          toAccountAddr: investor.address,
          amount: NUM_BONDS_BUYING * BOND_COUPON,
          assetID: stablecoinId,
          payFlags: { totalFee: 1000 }
        }
      ];

      runtime.executeTx(claimCouponTxGroup);

      const localCouponsPayed = getLocal(investor.address, 'CouponsPayed');
      const totalCouponsPayed = getGlobal('TotCouponsPayed');
      const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const afterEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      assert.equal(localCouponsPayed, 1);
      assert.equal(totalCouponsPayed, NUM_BONDS_BUYING);
      assert.equal(afterInvestorStablecoinHolding.amount,
        initialInvestorStablecoinHolding.amount + BigInt(NUM_BONDS_BUYING * BOND_COUPON));
      assert.equal(afterEscrowStablecoinHolding.amount,
        initialEscrowStablecoinHolding.amount - BigInt(NUM_BONDS_BUYING * BOND_COUPON));
    });
  });

  describe('claim_principal', function () {

    it('should be able to claim principal', () => {
      // setup
      createMainApp();
      updateMainApp(masterAddr, {
        BOND_COUPON: 0
      });
      runtime.optInToApp(investor.address, mainAppId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // claim principal
      runtime.setRoundAndTimestamp(4, MATURITY_DATE);
      const bondEscrowAddress = bondEscrowLsig.address();
      const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
      fundStablecoin(BOND_PRINCIPAL * NUM_BONDS_BUYING, stablecoinEscrowAddress);

      const initialEscrowBondHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
      const initialInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const initialEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      // Atomic Transaction
      const claimPrincipalTxGroup = [
        {
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes('sell')]
        },
        {
          type: types.TransactionType.RevokeAsset,
          sign: types.SignType.LogicSignature,
          fromAccount: bondEscrow.account,
          lsig: bondEscrowLsig,
          revocationTarget: investor.address,
          recipient: bondEscrowAddress,
          amount: NUM_BONDS_BUYING,
          assetID: bondId,
          payFlags: { totalFee: 1000, closeRemainderTo: bondEscrowAddress }
        },
        {
          type: types.TransactionType.TransferAsset,
          sign: types.SignType.LogicSignature,
          fromAccount: stablecoinEscrow.account,
          lsig: stablecoinEscrowLsig,
          toAccountAddr: investor.address,
          amount: NUM_BONDS_BUYING * BOND_PRINCIPAL,
          assetID: stablecoinId,
          payFlags: { totalFee: 1000 }
        },
        {
          type: types.TransactionType.TransferAlgo,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          toAccountAddr: bondEscrowAddress,
          amountMicroAlgos: 1000,
          payFlags: { totalFee: 1000 }
        },
        {
          type: types.TransactionType.TransferAlgo,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          toAccountAddr: stablecoinEscrowAddress,
          amountMicroAlgos: 1000,
          payFlags: { totalFee: 1000 }
        },
      ];

      runtime.executeTx(claimPrincipalTxGroup);

      const investorBondHolding = runtime.getAssetHolding(bondId, investor.address);
      const afterEscrowBondHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
      const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const afterEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      assert.equal(investorBondHolding.amount, 0);
      assert.equal(afterEscrowBondHolding.amount,
        initialEscrowBondHolding.amount + BigInt(NUM_BONDS_BUYING));
      assert.equal(afterInvestorStablecoinHolding.amount,
        initialInvestorStablecoinHolding.amount + BigInt(NUM_BONDS_BUYING * BOND_PRINCIPAL));
      assert.equal(afterEscrowStablecoinHolding.amount,
        initialEscrowStablecoinHolding.amount - BigInt(NUM_BONDS_BUYING * BOND_PRINCIPAL));
    });
  });

  // describe('Manage green bond', function () {
  //
  //   it('has defaulted', () => {
  //     createMainApp();
  //     updateMainApp(masterAddr);
  //     createManageApp();
  //     runtime.optInToApp(investor.address, mainAppId, {}, {});
  //     runtime.setRoundAndTimestamp(3, START_BUY_DATE);
  //     const NUM_BONDS_BUYING = 3;
  //     fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
  //     buyBond(NUM_BONDS_BUYING, BOND_COST);
  //
  //     runtime.setRoundAndTimestamp(5, MATURITY_DATE);
  //
  //     runtime.executeTx({
  //       type: types.TransactionType.CallNoOpSSC,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: investor.account,
  //       appId: manageAppId,
  //       payFlags: {},
  //       appArgs: [stringToBytes("yes")],
  //       accounts: [stablecoinEscrow.address, bondEscrow.address],
  //       foreignApps: [mainAppId],
  //       foreignAssets: [bondId]
  //     })
  //   });
  //
  //   it('has not defaulted', () => {
  //     createMainApp();
  //     updateMainApp(masterAddr);
  //     createManageApp();
  //     runtime.optInToApp(investor.address, mainAppId, {}, {});
  //     runtime.setRoundAndTimestamp(3, START_BUY_DATE);
  //     const NUM_BONDS_BUYING = 3;
  //     fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
  //     buyBond(NUM_BONDS_BUYING, BOND_COST);
  //
  //     runtime.executeTx({
  //       type: types.TransactionType.CallNoOpSSC,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: investor.account,
  //       appId: manageAppId,
  //       payFlags: {},
  //       appArgs: [stringToBytes("no")],
  //       accounts: [stablecoinEscrow.address, bondEscrow.address],
  //       foreignApps: [mainAppId],
  //       foreignAssets: [bondId]
  //     })
  //   });
  // });
});
