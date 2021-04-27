const {
  addressToPk,
  getProgram,
  stringToBytes,
  uint64ToBigEndian
} = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');

const MIN_BALANCE = 10e6; // 10 algo
const BOND_COST = 50e6; // $50
const BOND_COUPON_PAYMENT_VALUE = 2.5e6; // $2.5
const BOND_LENGTH = 2; // 1 year ie 2 six month periods
const BOND_PRINCIPAL = 100e6; // $100
const START_BUY_DATE = 50;
const END_BUY_DATE = 100;
const SIX_MONTH_PERIOD = 15768000;

const masterAddr = "A6BDLTPR4IEIZG4CCUGEXVMZSXTFO7RWNSOWHBWZL3CX2CLWTKW5FF4SE4";
const issuerAddr = "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY";
const investorAddr = "FCRSMPKRY5JPS4IQ2M7P4JRRIJSHRXL5S3NFTGHYP5GQD2XERNYUWEXG54";
const traderAddr = "TWYS3Y6SJOUW6WIEIXTBOII7523QI4MUO3TSYDS7SCG4TIGGC2S6V6TJP4";

/**
 * NOTE: The following unit tests test the happy flow of the bond application.
 * - Each test is independent of each other
 * - We are testing each branch of TEAL code independently here.
 * eg. To test the "buy:" branch, we prepare the state using getLocalState, setGlobalState
 * functions in runtime, and set the state directly (to avoid calling the smart contract)
 * We only call the smart contract during the actual 'claim' tx call, and verify state later.
 */
describe('Green Bond Tests', function () {
  let master = new AccountStore(1000e6, { addr: masterAddr, sk: new Uint8Array(0) });
  let issuer = new AccountStore(MIN_BALANCE, { addr: issuerAddr, sk: new Uint8Array(0) });
  let investor = new AccountStore(MIN_BALANCE, { addr: investorAddr, sk: new Uint8Array(0) });
  let trader = new AccountStore(MIN_BALANCE, { addr: traderAddr, sk: new Uint8Array(0) });
  let bondEscrow, bondEscrowLsig; // initialized later
  let stablecoinEscrow, stablecoinEscrowLsig; // initialized later

  let runtime;
  let applicationId;
  let creationFlags;
  let bondId;
  let bondDef;
  let stablecoinId;
  let stablecoinDef;
  const approvalProgram = getProgram('greenBondApproval.py');
  const clearProgram = getProgram('greenBondClear.py');

  const getGlobal = (key) => runtime.getGlobalState(applicationId, key);
  const getLocal = (addr, key) => runtime.getLocalState(applicationId, addr, key);

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
   * This function creates app and sets app id to 3
   */
  function createApp(params) {
    const args = {
      startBuyDate: START_BUY_DATE,
      endBuyDate: END_BUY_DATE,
      bondLength: BOND_LENGTH,
      bondId,
      bondCost: BOND_COST,
      bondCouponPaymentValue: BOND_COUPON_PAYMENT_VALUE,
      bondPrincipal: BOND_PRINCIPAL,
      ...params
    }

    runtime.appCounter = 2;

    creationFlags = {
      sender: master.account,
      localInts: 2,
      localBytes: 0,
      globalInts: 8,
      globalBytes: 2
    };

    const creationArgs = [
      addressToPk(issuer.address),
      uint64ToBigEndian(BigInt(args.startBuyDate)),
      uint64ToBigEndian(BigInt(args.endBuyDate)),
      uint64ToBigEndian(BigInt(args.bondLength)),
      uint64ToBigEndian(BigInt(args.bondId)),
      uint64ToBigEndian(BigInt(args.bondCost)),
      uint64ToBigEndian(BigInt(args.bondCouponPaymentValue)),
      uint64ToBigEndian(BigInt(args.bondPrincipal))
    ];

    // create application
    applicationId = runtime.addApp(
      { ...creationFlags, appArgs: creationArgs },
      {},
      approvalProgram,
      clearProgram
    );

    assert.equal(applicationId, 3);
  }

  /**
   * This function sets stablecoin escrow address in application global state
   */
  function setStablecoinEscrowInApp() {
    const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
    runtime.executeTx({
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      appId: applicationId,
      payFlags: {},
      appArgs: [stringToBytes("set_stablecoin_escrow"), addressToPk(stablecoinEscrowAddress)]
    })
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
        appId: applicationId,
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
    it('should create bond stateful application', () => {
      createApp({});

      // assert.deepEqual(getGlobal('Creator'), master.address); // TODO: Add when switch to version 3
      assert.deepEqual(getGlobal('IssuerAddr'), addressToPk(issuer.address));
      assert.deepEqual(getGlobal('StartBuyDate'), BigInt(START_BUY_DATE));
      assert.deepEqual(getGlobal('EndBuyDate'), BigInt(END_BUY_DATE));
      assert.deepEqual(getGlobal('BondLength'), BigInt(BOND_LENGTH));
      assert.deepEqual(getGlobal('BondID'), BigInt(bondId));
      assert.deepEqual(getGlobal('BondCost'), BigInt(BOND_COST));
      assert.deepEqual(getGlobal('BondCouponPaymentValue'), BigInt(BOND_COUPON_PAYMENT_VALUE));
      assert.deepEqual(getGlobal('BondPrincipal'), BigInt(BOND_PRINCIPAL));
      assert.deepEqual(getGlobal('MaturityDate'), BigInt(END_BUY_DATE + SIX_MONTH_PERIOD * BOND_LENGTH));
    });
  });

  describe('Opt-in', function () {
    it('should be able to opt-in to app', () => {
      createApp({});
      setStablecoinEscrowInApp();

      runtime.optInToApp(investor.address, applicationId, {}, {});
      syncAccounts();

      // verify opt-in
      assert.isDefined(investor.getAppFromLocal(applicationId));
    });
  });

  describe('set_stablecoin_escrow', function () {
    it('creator can set stablecoin escrow address', () => {
      createApp({});
      setStablecoinEscrowInApp();

      const stablecoinEscrowAddress = stablecoinEscrowLsig.address();
      assert.deepEqual(getGlobal('StablecoinEscrowAddr'), addressToPk(stablecoinEscrowAddress));
    });

    // TODO: Will pass when TEAL3
    // it('non creator cannot set stablecoin escrow address', () => {
    //   createApp({});
    //
    //   assert.throws(() => {
    //     runtime.executeTx({
    //       type: types.TransactionType.CallNoOpSSC,
    //       sign: types.SignType.SecretKey,
    //       fromAccount: investor.account,
    //       appId: applicationId,
    //       payFlags: {},
    //       appArgs: [stringToBytes("set_stablecoin_escrow"), addressToPk(investor.address)]
    //     })
    //   }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');
    // });

    it('creator cannot set stablecoin escrow address when START_BUY_DATE and later', () => {
      createApp({});

      // Set time to START_BUY_DATE
      runtime.setRoundAndTimestamp(2, START_BUY_DATE)

      assert.throws(() => {
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: master.account,
          appId: applicationId,
          payFlags: {},
          appArgs: [stringToBytes("set_stablecoin_escrow"), addressToPk(master.address)]
        })
      }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');

      // Set time to START_BUY_DATE + 1
      runtime.setRoundAndTimestamp(3, START_BUY_DATE + 1)

      assert.throws(() => {
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: master.account,
          appId: applicationId,
          payFlags: {},
          appArgs: [stringToBytes("set_stablecoin_escrow"), addressToPk(master.address)]
        })
      }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');
    });
  });

  describe('buy', function () {

    it('should be able to buy bond after StartBuyDate and before EndBuyDate', () => {
      // setup
      createApp({});
      setStablecoinEscrowInApp();
      runtime.optInToApp(investor.address, applicationId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);

      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      const initialStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);

      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // verify bought
      const bondsHolding = runtime.getAssetHolding(bondId, investor.address);
      const afterStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const localBondsOwned = getLocal(investor.address, 'NoOfBondsOwned');

      assert.equal(bondsHolding.amount, NUM_BONDS_BUYING);
      assert.equal(afterStablecoinHolding.amount,
        initialStablecoinHolding.amount - BigInt(BOND_COST * NUM_BONDS_BUYING));
      assert.equal(localBondsOwned, NUM_BONDS_BUYING);
    });
  });

  describe('trade', function () {

    it('should be able to trade bond after EndBuyDate and before MaturityDate', () => {
      // setup
      createApp({});
      setStablecoinEscrowInApp();
      runtime.optInToApp(investor.address, applicationId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      runtime.optInToApp(trader.address, applicationId, {}, {});
      runtime.optIntoASA(bondId, trader.address, {})

      // trade
      runtime.setRoundAndTimestamp(4, END_BUY_DATE + 1);

      const bondEscrowAddress = bondEscrowLsig.address();
      const NUM_BONDS_TRADING = 2;

      const initialInvestorBondsHolding = runtime.getAssetHolding(bondId, investor.address);
      const initialInvestorLocalBondsOwned = getLocal(investor.address, 'NoOfBondsOwned');

      // Atomic Transaction
      const tradeTxGroup = [
        {
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: applicationId,
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
      const afterInvestorLocalBondsOwned = getLocal(investor.address, 'NoOfBondsOwned');
      const traderBondHolding = runtime.getAssetHolding(bondId, trader.address);
      const traderLocalBondsOwned = getLocal(trader.address, 'NoOfBondsOwned');

      assert.equal(afterInvestorBondsHolding.amount,
        initialInvestorBondsHolding.amount - BigInt(NUM_BONDS_TRADING));
      assert.equal(afterInvestorLocalBondsOwned,
        initialInvestorLocalBondsOwned - BigInt(NUM_BONDS_TRADING));
      assert.equal(traderBondHolding.amount, NUM_BONDS_TRADING);
      assert.equal(traderLocalBondsOwned, NUM_BONDS_TRADING);
    });
  });

  describe('claim_coupon', function () {

    it('should be able to claim coupon at coupon time', () => {
      // setup
      createApp({});
      setStablecoinEscrowInApp();
      runtime.optInToApp(investor.address, applicationId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // claim coupon
      runtime.setRoundAndTimestamp(4, END_BUY_DATE + SIX_MONTH_PERIOD);
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
          appId: applicationId,
          payFlags: {},
          appArgs: [stringToBytes('claim_coupon')]
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
          amount: NUM_BONDS_BUYING * BOND_COUPON_PAYMENT_VALUE,
          assetID: stablecoinId,
          payFlags: { totalFee: 1000 }
        }
      ];

      runtime.executeTx(claimCouponTxGroup);

      const localNoOfBondCouponPayments = getLocal(investor.address, 'NoOfBondCouponPayments');
      const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const afterEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      assert.equal(localNoOfBondCouponPayments, 1);
      assert.equal(afterInvestorStablecoinHolding.amount,
        initialInvestorStablecoinHolding.amount + BigInt(NUM_BONDS_BUYING * BOND_COUPON_PAYMENT_VALUE));
      assert.equal(afterEscrowStablecoinHolding.amount,
        initialEscrowStablecoinHolding.amount - BigInt(NUM_BONDS_BUYING * BOND_COUPON_PAYMENT_VALUE));
    });
  });

  describe('claim_principal', function () {

    it('should be able to claim principal at maturity time', () => {
      // setup
      createApp({ bondCouponPaymentValue: 0 });
      setStablecoinEscrowInApp();
      runtime.optInToApp(investor.address, applicationId, {}, {});
      runtime.setRoundAndTimestamp(3, START_BUY_DATE);
      const NUM_BONDS_BUYING = 3;
      fundStablecoin(BOND_COST * NUM_BONDS_BUYING, investor.address);
      buyBond(NUM_BONDS_BUYING, BOND_COST);

      // claim principal
      const maturityDate = getGlobal("MaturityDate")
      runtime.setRoundAndTimestamp(4, maturityDate);
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
          appId: applicationId,
          payFlags: {},
          appArgs: [stringToBytes('claim_principal')]
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

      const localBondsOwned = getLocal(investor.address, 'NoOfBondsOwned');
      const investorBondHolding = runtime.getAssetHolding(bondId, investor.address);
      const afterEscrowBondHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
      const afterInvestorStablecoinHolding = runtime.getAssetHolding(stablecoinId, investor.address);
      const afterEscrowStablecoinHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);

      assert.equal(localBondsOwned, 0);
      // assert.isUndefined(investorBondHolding); TODO: Why not opted out of bond
      assert.equal(investorBondHolding.amount, 0);
      assert.equal(afterEscrowBondHolding.amount,
        initialEscrowBondHolding.amount + BigInt(NUM_BONDS_BUYING));
      assert.equal(afterInvestorStablecoinHolding.amount,
        initialInvestorStablecoinHolding.amount + BigInt(NUM_BONDS_BUYING * BOND_PRINCIPAL));
      assert.equal(afterEscrowStablecoinHolding.amount,
        initialEscrowStablecoinHolding.amount - BigInt(NUM_BONDS_BUYING * BOND_PRINCIPAL));
    });
  });

    // it('Receiver should be able to withdraw funds if Goal is met', () => {
  //   setupAppAndEscrow();
  //   // fund end date should be passed
  //   runtime.setRoundAndTimestamp(2, 15); // StartTs=1, EndTs=10
  //   runtime.getAccount(creator.address).setGlobalState(applicationId, 'Escrow', addressToPk(escrow.address));
  //   syncAccounts();
  //
  //   creator.optInToApp(applicationId, runtime.getApp(applicationId));
  //   donor.optInToApp(applicationId, runtime.getApp(applicationId));
  //   syncAccounts();
  //
  //   // fund escrow with amount = goal
  //   runtime.executeTx({
  //     type: types.TransactionType.TransferAlgo,
  //     sign: types.SignType.SecretKey,
  //     fromAccount: donor.account,
  //     toAccountAddr: escrow.address,
  //     amountMicroAlgos: goal,
  //     payFlags: {}
  //   });
  //
  //   // update Global State
  //   runtime.getAccount(creator.address).setGlobalState(applicationId, 'Total', BigInt(goal));
  //   syncAccounts();
  //
  //   // transaction to claim/withdraw funds from escrow
  //   const fundReceiverBal = fundReceiver.balance(); // fund receiver's balance before 'claim' tx
  //   const escrowFunds = escrow.balance(); //  funds in escrow
  //   const claimTxGroup = [
  //     {
  //       type: types.TransactionType.CallNoOpSSC,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: creator.account,
  //       appId: applicationId,
  //       payFlags: { totalFee: 1000 },
  //       appArgs: [stringToBytes('claim')]
  //     },
  //     {
  //       type: types.TransactionType.TransferAlgo,
  //       sign: types.SignType.LogicSignature,
  //       fromAccount: escrow.account,
  //       toAccountAddr: fundReceiver.address,
  //       amountMicroAlgos: 0,
  //       lsig: escrowLsig, // initialized in setUpApp
  //       payFlags: { totalFee: 1000, closeRemainderTo: fundReceiver.address }
  //     }
  //   ];
  //   runtime.executeTx(claimTxGroup);
  //
  //   syncAccounts();
  //   assert.equal(escrow.balance(), 0); // escrow should be empty after claim
  //   assert.equal(fundReceiver.balance(), fundReceiverBal + escrowFunds - 1000n); // funds transferred to receiver from escrow
  // });
  //
  // it('Donor should be able reclaim funds if Goal is not met', () => {
  //   setupAppAndEscrow();
  //   // fund end date should be passed
  //   runtime.setRoundAndTimestamp(2, 15); // StartTs=1, EndTs=10
  //   runtime.getAccount(creator.address).setGlobalState(applicationId, 'Escrow', addressToPk(escrow.address));
  //   syncAccounts();
  //
  //   creator.optInToApp(applicationId, runtime.getApp(applicationId));
  //   donor.optInToApp(applicationId, runtime.getApp(applicationId));
  //   syncAccounts();
  //
  //   // fund escrow with amount < goal
  //   runtime.executeTx({
  //     type: types.TransactionType.TransferAlgo,
  //     sign: types.SignType.SecretKey,
  //     fromAccount: donor.account,
  //     toAccountAddr: escrow.address,
  //     amountMicroAlgos: goal - 1e6,
  //     payFlags: {}
  //   });
  //   syncAccounts();
  //
  //   // update Global State
  //   creator.setGlobalState(applicationId, 'Total', BigInt(goal - 1e6));
  //   donor.setLocalState(applicationId, 'MyAmountGiven', BigInt(goal - 1e6));
  //   syncAccounts();
  //
  //   // reclaim transaction
  //   const reclaimTxGroup = [
  //     {
  //       type: types.TransactionType.CallNoOpSSC,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: donor.account,
  //       appId: applicationId,
  //       payFlags: { totalFee: 1000 },
  //       appArgs: [stringToBytes('reclaim')],
  //       accounts: [escrow.address] //  AppAccounts
  //     },
  //     {
  //       type: types.TransactionType.TransferAlgo,
  //       sign: types.SignType.LogicSignature,
  //       fromAccount: escrow.account,
  //       toAccountAddr: donor.address,
  //       amountMicroAlgos: 300000,
  //       lsig: escrowLsig,
  //       payFlags: { totalFee: 1000 }
  //     }
  //   ];
  //   const donorBalance = donor.balance();
  //   const escrowBalance = escrow.balance();
  //   runtime.executeTx(reclaimTxGroup);
  //
  //   syncAccounts();
  //   // verify 300000 is withdrawn from escrow (with tx fee of 1000 as well)
  //   assert.equal(escrow.balance(), escrowBalance - 300000n - 1000n);
  //   assert.equal(donor.balance(), donorBalance + 300000n - 1000n);
  // });
  //
  // it('Creator should be able to delete the application after the fund close date (using single tx)', () => {
  //   setupAppAndEscrow();
  //   // fund close date should be passed
  //   runtime.setRoundAndTimestamp(2, 25); // fundCloseTs=20n
  //   runtime.getAccount(creator.address).setGlobalState(applicationId, 'Escrow', addressToPk(escrow.address));
  //   syncAccounts();
  //
  //   creator.optInToApp(applicationId, runtime.getApp(applicationId));
  //   donor.optInToApp(applicationId, runtime.getApp(applicationId));
  //   syncAccounts();
  //
  //   // let's close escrow account first
  //   runtime.executeTx({
  //     type: types.TransactionType.TransferAlgo,
  //     sign: types.SignType.SecretKey,
  //     fromAccount: escrow.account,
  //     toAccountAddr: fundReceiver.address,
  //     amountMicroAlgos: 0,
  //     payFlags: { totalFee: 1000, closeRemainderTo: fundReceiver.address }
  //   });
  //   syncAccounts();
  //
  //   // escrow is already empty so we don't need a tx group
  //   const deleteTx = {
  //     type: types.TransactionType.DeleteSSC,
  //     sign: types.SignType.SecretKey,
  //     fromAccount: creator.account,
  //     appId: applicationId,
  //     payFlags: { totalFee: 1000 },
  //     appArgs: [],
  //     accounts: [escrow.address] //  AppAccounts
  //   };
  //
  //   // verify app is present before delete
  //   const app = runtime.getApp(applicationId);
  //   assert.isDefined(app);
  //
  //   runtime.executeTx(deleteTx);
  //
  //   // app should be deleted now
  //   try {
  //     runtime.getApp(applicationId);
  //   } catch (error) {
  //     console.log('[Expected: app does not exist] ', error.message);
  //   }
  // });
  //
  // it('Creator should be able to delete the application after the fund close date (using group tx)', () => {
  //   setupAppAndEscrow();
  //   // fund close date should be passed
  //   runtime.setRoundAndTimestamp(2, 25); // fundCloseTs=20n
  //   runtime.getAccount(creator.address).setGlobalState(applicationId, 'Escrow', addressToPk(escrow.address));
  //   syncAccounts();
  //
  //   creator.optInToApp(applicationId, runtime.getApp(applicationId));
  //   donor.optInToApp(applicationId, runtime.getApp(applicationId));
  //   syncAccounts();
  //
  //   // here escrow still has some funds (minBalance), so this must be a group tx
  //   // where in the second tx, we empty the escrow account to receiver using closeRemainderTo
  //   const deleteTxGroup = [
  //     {
  //       type: types.TransactionType.DeleteSSC,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: creator.account,
  //       appId: applicationId,
  //       payFlags: { totalFee: 1000 },
  //       appArgs: [],
  //       accounts: [escrow.address] //  AppAccounts
  //     },
  //     {
  //       type: types.TransactionType.TransferAlgo,
  //       sign: types.SignType.LogicSignature,
  //       fromAccount: escrow.account,
  //       toAccountAddr: donor.address,
  //       amountMicroAlgos: 0,
  //       lsig: escrowLsig,
  //       payFlags: { totalFee: 1000, closeRemainderTo: fundReceiver.address }
  //     }
  //   ];
  //   // verify app is present before delete
  //   const app = runtime.getApp(applicationId);
  //   assert.isDefined(app);
  //
  //   runtime.executeTx(deleteTxGroup);
  //
  //   // app should be deleted now
  //   try {
  //     runtime.getApp(applicationId);
  //   } catch (error) {
  //     console.log('[Expected: app does not exist] ', error.message);
  //   }
  // });
});
