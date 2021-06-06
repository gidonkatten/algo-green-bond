const { stringToBytes } = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');
const {
  masterAddr,
  investorAddr,
  financialRegulatorAddr,
  MIN_BALANCE,
  mainStateStorage,
  createInitialApp,
  updateMainApp,
} = require("./utils");

describe('Freeze Tests', function () {
  let runtime;
  let master, investor, financialRegulator;
  let mainAppId;

  const getMainGlobal = (key) => runtime.getGlobalState(mainAppId, key);
  const getMainLocal = (addr, key) => runtime.getLocalState(mainAppId, addr, key);

  /**
   * This creates bond, stablecoin and escrow accounts
   */
  this.beforeEach(() => {
    // refresh accounts + initialize runtime
    master = new AccountStore(1000e6, { addr: masterAddr, sk: new Uint8Array(0) });
    investor = new AccountStore(MIN_BALANCE, { addr: investorAddr, sk: new Uint8Array(0) });
    financialRegulator = new AccountStore(MIN_BALANCE, { addr: financialRegulatorAddr, sk: new Uint8Array(0) });
    runtime = new Runtime([master, investor, financialRegulator]);

    // create and update app + opt in
    mainAppId = createInitialApp(runtime, master.account, mainStateStorage);
    updateMainApp(runtime, masterAddr, mainAppId);
    runtime.optInToApp(investorAddr, mainAppId, {}, {});
  });

  describe('freeze (account)', function () {

    it('default frozen', () => {
      assert.isUndefined(getMainGlobal('Frozen'));
    });

    it('non financialRegulator cannot set freeze', () => {
      assert.throws(() => {
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes("freeze"), 'int:1'],
          accounts: [investorAddr],
        })
      }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');
    });

    // can set local freeze (test unfreezes and freezes)
    it('can set local freeze', () => {
      // Unfreeze
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze"), 'int:1'],
        accounts: [investorAddr],
      })

      assert.equal(getMainLocal(investorAddr, 'Frozen'), 1);

      // freeze
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze"), 'int:0'],
        accounts: [investorAddr],
      })

      assert.equal(getMainLocal(investorAddr, 'Frozen'), 0);
    });
  });

  describe('freeze_all (all accounts)', function () {

    it('default frozen', () => {
      assert.isUndefined(getMainLocal(investorAddr, 'Frozen'));
    });

    it('non financialRegulator cannot set freeze', () => {
      assert.throws(() => {
        runtime.executeTx({
          type: types.TransactionType.CallNoOpSSC,
          sign: types.SignType.SecretKey,
          fromAccount: investor.account,
          appId: mainAppId,
          payFlags: {},
          appArgs: [stringToBytes("freeze_all"), 'int:1'],
        })
      }, 'RUNTIME_ERR1009: TEAL runtime encountered err opcode');
    });

    // can set global freeze (test unfreezes and freezes)
    it('can set global freeze', () => {
      // Unfreeze
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze_all"), 'int:1'],
      })

      assert.equal(getMainGlobal( 'Frozen'), 1);

      // freeze
      runtime.executeTx({
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: financialRegulator.account,
        appId: mainAppId,
        payFlags: {},
        appArgs: [stringToBytes("freeze_all"), 'int:0'],
      })

      assert.equal(getMainGlobal('Frozen'), 0);
    });

  });
});

