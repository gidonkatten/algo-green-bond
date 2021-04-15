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
const BOND_COUPON_INSTALLMENTS = 0;
const BOND_PRINCIPAL = 100e6; // $100

const masterAddr = "A6BDLTPR4IEIZG4CCUGEXVMZSXTFO7RWNSOWHBWZL3CX2CLWTKW5FF4SE4";
const issuerAddr = "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY";
const buyerAddr = "FCRSMPKRY5JPS4IQ2M7P4JRRIJSHRXL5S3NFTGHYP5GQD2XERNYUWEXG54"

/**
 * NOTE: The following unit tests test the happy flow of the bond application.
 * - Each test is independent of each other
 * - We are testing each branch of TEAL code independently here.
 * eg. To test the "buy:" branch, we prepare the state using getLocalState, setGlobalState
 * functions in runtime, and set the state directly (to avoid calling the smart contract)
 * We only call the smart contract during the actual 'claim' tx call, and verify state later.
 */
describe('Crowdfunding Tests - Happy Paths', function () {
  const master = new AccountStore(1000e6, { addr: masterAddr, sk: new Uint8Array(0) });
  let issuer = new AccountStore(MIN_BALANCE, { addr: issuerAddr, sk: new Uint8Array(0) });
  let buyer = new AccountStore(MIN_BALANCE, { addr: buyerAddr, sk: new Uint8Array(0) });
  let bondEscrow, bondEscrowLsig; // initialized later
  let stablecoinEscrow, stablecoinEscrowLsig; // initialized later

  let runtime;
  let creationFlags;
  let applicationId;
  let bondId;
  let bondDef;
  let stablecoinId;
  let stablecoinDef;
  const approvalProgram = getProgram('greenBondApproval.py');
  const clearProgram = getProgram('greenBondClear.py');

  this.beforeAll(async function () {
    runtime = new Runtime([master, issuer, buyer]);

    creationFlags = {
      sender: issuer.account,
      localInts: 2,
      localBytes: 0,
      globalInts: 8,
      globalBytes: 2
    };
  });

  const getGlobal = (key) => runtime.getGlobalState(applicationId, key);

  // fetch latest account state
  function syncAccounts () {
    issuer = runtime.getAccount(issuer.address);
    buyer = runtime.getAccount(buyer.address);
    if (bondEscrow) bondEscrow = runtime.getAccount(bondEscrow.address);
    if (stablecoinEscrow) stablecoinEscrow = runtime.getAccount(stablecoinEscrow.address);
  }

  /**
   * This function sets up the assets, application and escrow account
   * Not in 'beforeEach' so that can test creating application
   */
  function setupAppAndEscrow () {
    // refresh accounts + initialize runtime
    issuer = new AccountStore(MIN_BALANCE);
    buyer = new AccountStore(MIN_BALANCE);
    runtime = new Runtime([master, issuer, buyer]);

    applicationId = 3;
    issuer.addApp(applicationId, creationFlags, approvalProgram, clearProgram);
    runtime.store.globalApps.set(applicationId, issuer.address);

    // set creation args in global state
    issuer.setGlobalState(applicationId, 'Creator', addressToPk(issuer.address));
    issuer.setGlobalState(applicationId, 'StartBuyDate', 1n);
    issuer.setGlobalState(applicationId, 'EndBuyDate', 10n);
    issuer.setGlobalState(applicationId, 'MaturityDate', 50n);
    issuer.setGlobalState(applicationId, 'BondID', 2n);
    issuer.setGlobalState(applicationId, 'BondCost', BigInt(BOND_COST));
    issuer.setGlobalState(applicationId, 'BondCouponPaymentValue', BigInt(BOND_COUPON_PAYMENT_VALUE));
    issuer.setGlobalState(applicationId, 'BondCouponInstallments', BigInt(BOND_COUPON_INSTALLMENTS));
    issuer.setGlobalState(applicationId, 'BondPrincipal', BigInt(BOND_PRINCIPAL));

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

    runtime.optIntoASA(bondId, buyer.address, {})
    runtime.optIntoASA(bondId, bondEscrowAddress, {})
    let buyerBondHolding = runtime.getAssetHolding(bondId, buyer.address);
    let bondEscrowHolding = runtime.getAssetHolding(bondId, bondEscrowAddress);
    assert.isDefined(buyerBondHolding);
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

    // Create stablecoin and fund
    stablecoinId = runtime.addAsset("stablecoin", { creator: { ...master.account, name: 'master' } });
    stablecoinDef = runtime.getAssetDef(stablecoinId);

    runtime.optIntoASA(stablecoinId, buyer.address, {})
    runtime.optIntoASA(stablecoinId, stablecoinEscrowAddress, {})
    let buyerStablecoinHolding = runtime.getAssetHolding(stablecoinId, buyer.address);
    let stablecoinEscrowHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);
    assert.isDefined(buyerStablecoinHolding);
    assert.isDefined(stablecoinEscrowHolding);

    runtime.executeTx({
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      toAccountAddr: buyer.address,
      amount: 1000e6,
      assetID: stablecoinId,
      payFlags: {}
    });
    buyerStablecoinHolding = runtime.getAssetHolding(stablecoinId, buyer.address);
    assert.equal(buyerStablecoinHolding.amount, BigInt(1000e6));

    runtime.executeTx({
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      toAccountAddr: stablecoinEscrowAddress,
      amount: 1000e6,
      assetID: stablecoinId,
      payFlags: {}
    });
    stablecoinEscrowHolding = runtime.getAssetHolding(stablecoinId, stablecoinEscrowAddress);
    assert.equal(stablecoinEscrowHolding.amount, BigInt(1000e6));
  }

  it('should create bond stateful application', () => {
    const startBuyDate = 1n;
    const endBuyDate = 10n;
    const maturityDate = 50n;
    const bondID = 2n;
    const bondCost = BigInt(BOND_COST);
    const bondCouponPaymentValue = BigInt(BOND_COUPON_PAYMENT_VALUE);
    const bondCouponInstallments = BigInt(BOND_COUPON_INSTALLMENTS);
    const bondPrincipal = BigInt(BOND_PRINCIPAL);

    const creationArgs = [
      uint64ToBigEndian(startBuyDate),
      uint64ToBigEndian(endBuyDate),
      uint64ToBigEndian(maturityDate),
      uint64ToBigEndian(bondID),
      uint64ToBigEndian(bondCost),
      uint64ToBigEndian(bondCouponPaymentValue),
      uint64ToBigEndian(bondCouponInstallments),
      uint64ToBigEndian(bondPrincipal)
    ];

    // create application
    applicationId = runtime.addApp(
      { ...creationFlags, appArgs: creationArgs },
      {},
      approvalProgram,
      clearProgram
    );

    assert.isDefined(applicationId);
    assert.deepEqual(getGlobal('Creator'), addressToPk(issuer.address));
    assert.deepEqual(getGlobal('StartBuyDate'), startBuyDate);
    assert.deepEqual(getGlobal('EndBuyDate'), endBuyDate);
    assert.deepEqual(getGlobal('MaturityDate'), maturityDate);
    assert.deepEqual(getGlobal('BondID'), bondID);
    assert.deepEqual(getGlobal('BondCost'), bondCost);
    assert.deepEqual(getGlobal('BondCouponPaymentValue'), bondCouponPaymentValue);
    assert.deepEqual(getGlobal('BondCouponInstallments'), bondCouponInstallments);
    assert.deepEqual(getGlobal('BondPrincipal'), bondPrincipal);
  });

  it('should setup escrow account and update application with escrow address', () => {
    setupAppAndEscrow();
    //
    // const escrowPk = addressToPk(escrow.address);
    // runtime.updateApp(
    //   creator.address,
    //   applicationId,
    //   approvalProgram,
    //   clearProgram,
    //   {}, {
    //     appArgs: [escrowPk]
    //   });
    // syncAccounts();
    //
    // // verify escrow storage
    // assert.deepEqual(getGlobal('Escrow'), escrowPk);
  });
  //
  // it('should opt-in to app successfully after setting up escrow', () => {
  //   setupAppAndEscrow();
  //
  //   // update global storage to add escrow address
  //   const escrowPk = addressToPk(escrow.address);
  //   creator.setGlobalState(applicationId, 'Escrow', escrowPk);
  //
  //   runtime.optInToApp(creator.address, applicationId, {}, {});
  //   runtime.optInToApp(donor.address, applicationId, {}, {});
  //   syncAccounts();
  //
  //   // verify opt-in
  //   assert.isDefined(creator.getAppFromLocal(applicationId));
  //   assert.isDefined(donor.getAppFromLocal(applicationId));
  // });
  //
  // it('should be able to donate funds to escrow before end date', () => {
  //   setupAppAndEscrow();
  //   runtime.setRoundAndTimestamp(2, 5); // StartTs=1, EndTs=10
  //
  //   // update global storage to add escrow address
  //   const escrowPk = addressToPk(escrow.address);
  //   runtime.getAccount(creator.address).setGlobalState(applicationId, 'Escrow', escrowPk);
  //   syncAccounts();
  //
  //   // opt-in to app
  //   creator.optInToApp(applicationId, runtime.getApp(applicationId));
  //   donor.optInToApp(applicationId, runtime.getApp(applicationId));
  //   syncAccounts();
  //
  //   // Atomic Transaction (Stateful Smart Contract call + Payment Transaction)
  //   const donorBal = donor.balance();
  //   const escrowBal = escrow.balance();
  //   const donateTxGroup = [
  //     {
  //       type: types.TransactionType.CallNoOpSSC,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: donor.account,
  //       appId: applicationId,
  //       payFlags: { totalFee: 1000 },
  //       appArgs: [stringToBytes('donate')]
  //     },
  //     {
  //       type: types.TransactionType.TransferAlgo,
  //       sign: types.SignType.SecretKey,
  //       fromAccount: donor.account,
  //       toAccountAddr: escrow.address,
  //       amountMicroAlgos: 7000000,
  //       payFlags: { totalFee: 1000 }
  //     }
  //   ];
  //
  //   runtime.executeTx(donateTxGroup);
  //
  //   syncAccounts();
  //   assert.equal(escrow.balance(), escrowBal + BigInt(7e6)); // verify donation of 7000000
  //   assert.equal(donor.balance(), donorBal - BigInt(7e6) - 2000n); // 2000 is also deducted because of tx fee
  // });
  //
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
