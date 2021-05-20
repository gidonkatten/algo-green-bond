const { addressToPk, getProgram } = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');
const {
  greenVerifierAddr,
  investorAddr,
  issuerAddr,
  masterAddr,
  traderAddr,
  MIN_BALANCE,
  mainStateStorage,
  manageStateStorage,
  createInitialApp,
  updateMainApp,
} = require("./utils");

describe('Setup Tests', function () {
  let runtime;
  let master, issuer, investor, trader, greenVerifier;
  let bondEscrow, bondEscrowLsig, stablecoinEscrow, stablecoinEscrowLsig;
  let mainAppId, manageAppId;

  const getMainGlobal = (key) => runtime.getGlobalState(mainAppId, key);

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
    bondEscrow = runtime.getAccount(bondEscrowLsig.address());

    // setup and sync stablecoin escrow account
    const stablecoinEscrowProg = getProgram('stablecoinEscrow.py', {
      MAIN_APP_ID: mainAppId,
      MANAGE_APP_ID: manageAppId
    });
    stablecoinEscrowLsig = runtime.getLogicSig(stablecoinEscrowProg, []);
    stablecoinEscrow = runtime.getAccount(stablecoinEscrowLsig.address());
  });

  describe('Creation', function () {
    it('should create and update bond stateful application', () => {
      // assert.deepEqual(getGlobal('Creator'), master.address); // TODO: Add when switch to version 3
      assert.deepEqual(getMainGlobal('CreatorAddr'), addressToPk(master.address)); // TODO: Remove when switch to version 3
    });
  });

  describe('Update', function () {
    it('creator can update app', () => {
      updateMainApp(runtime, masterAddr, mainAppId, {
        MANAGE_APP_ID: manageAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
      });
    });


    it('non creator cannot update app', () => {
      assert.throws(() => {
        updateMainApp(runtime, investorAddr, mainAppId, {
          MANAGE_APP_ID: manageAppId,
          STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
          BOND_ESCROW_ADDR: bondEscrow.address,
        });
      }, 'RUNTIME_ERR1007: Teal code rejected by logic');
    });
  });

  describe('Opt-in', function () {
    it('should be able to opt-in to app', () => {
      updateMainApp(runtime, masterAddr, mainAppId, {
        MANAGE_APP_ID: manageAppId,
        STABLECOIN_ESCROW_ADDR: stablecoinEscrow.address,
        BOND_ESCROW_ADDR: bondEscrow.address,
      });

      // verify not opted-in
      assert.isUndefined(investor.getAppFromLocal(mainAppId));

      // opt-in
      runtime.optInToApp(investorAddr, mainAppId, {}, {});
      syncAccounts();

      // verify opt-in
      assert.isDefined(investor.getAppFromLocal(mainAppId));
    });
  });

});
