const { getProgram, stringToBytes } = require('@algo-builder/algob');
const { types } = require('@algo-builder/runtime');

// Addresses
const masterAddr = "A6BDLTPR4IEIZG4CCUGEXVMZSXTFO7RWNSOWHBWZL3CX2CLWTKW5FF4SE4";
const issuerAddr = "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY";
const investorAddr = "FCRSMPKRY5JPS4IQ2M7P4JRRIJSHRXL5S3NFTGHYP5GQD2XERNYUWEXG54";
const traderAddr = "TWYS3Y6SJOUW6WIEIXTBOII7523QI4MUO3TSYDS7SCG4TIGGC2S6V6TJP4";
const greenVerifierAddr = "OF6CYTCWXXZQCIFLUBNFZJ43V5BWZAL7BBMSQRIGUYQJVM63GIJ5SPA3JE";

const MIN_BALANCE = 10e6; // 10 algo

// Bond parameters
const PERIOD = 15768000;
const BOND_LENGTH = 2;
const START_BUY_DATE = 50;
const END_BUY_DATE = START_BUY_DATE + 50;
const MATURITY_DATE = END_BUY_DATE + (PERIOD * BOND_LENGTH);
const BOND_COST = 50e6;
const BOND_COUPON = 25e6;
const BOND_PRINCIPAL = 100e6;

const clearProgram = getProgram('greenBondClear.py');

const mainStateStorage = {
  localInts: 2, // CouponsPaid, Trade
  localBytes: 0,
  globalInts: 2, // CouponsPaid, Reserve
  globalBytes: 1, // Creator TODO: TEAL3 0
};
const manageStateStorage = {
  localInts: 0,
  localBytes: 0,
  globalInts: 0,
  globalBytes: 1,  // <rating-array> Math.ceil((bondLength + 1) / 8)
};

/**
 * This function creates initial app and returns its app id
 */
function createInitialApp(runtime, account, stateStorage) {
  const initialApprovalProgram = getProgram('initialStateful.py');

  // create application
  const creationFlags = {
    sender: account,
    localInts: stateStorage.localInts,
    localBytes: stateStorage.localBytes,
    globalInts: stateStorage.globalInts,
    globalBytes: stateStorage.globalBytes,
    appArgs: []
  }
  return runtime.addApp(creationFlags, {}, initialApprovalProgram, clearProgram);
}

/**
 * This function updates main app from given addr
 */
function updateMainApp(runtime, addr, mainAppId, params) {
  const mainApprovalProgram = getProgram('greenBondApproval.py', {
    PERIOD: PERIOD,
    BOND_LENGTH: BOND_LENGTH,
    START_BUY_DATE: START_BUY_DATE,
    END_BUY_DATE: END_BUY_DATE,
    MATURITY_DATE: MATURITY_DATE,
    BOND_COST: BOND_COST,
    BOND_COUPON: BOND_COUPON,
    BOND_PRINCIPAL: BOND_PRINCIPAL,
    ...params
  });

  runtime.updateApp(addr, mainAppId, mainApprovalProgram, clearProgram, {}, {});
}

/**
 * This function updates manage app from given addr
 */
function updateManageApp(runtime, addr, manageAppId, params) {
  const manageApprovalProgram = getProgram('manageGreenBondApproval.py', {
    PERIOD: PERIOD,
    BOND_LENGTH: BOND_LENGTH,
    START_BUY_DATE: START_BUY_DATE,
    END_BUY_DATE: END_BUY_DATE,
    MATURITY_DATE: MATURITY_DATE,
    BOND_COUPON: BOND_COUPON,
    BOND_PRINCIPAL: BOND_PRINCIPAL,
    ...params
  });

  runtime.updateApp(addr, manageAppId, manageApprovalProgram, clearProgram, {}, {});
}

/**
 * This function funds given address with stablecoin
 */
function fundAlgo(runtime, fromAccount, toAccountAddr, amount) {
  runtime.executeTx({
    type: types.TransactionType.TransferAlgo,
    sign: types.SignType.SecretKey,
    fromAccount,
    toAccountAddr,
    amountMicroAlgos: amount,
    payFlags: { totalFee: 1000 }
  });
}

/**
 * This function funds given address with stablecoin
 */
function fundAsset(runtime, fromAccount, toAccountAddr, assetID, amount) {
  runtime.executeTx({
    type: types.TransactionType.TransferAsset,
    sign: types.SignType.SecretKey,
    fromAccount,
    toAccountAddr,
    amount,
    assetID,
    payFlags: { totalFee: 1000 }
  });
}

/**
 * Generates atomic txns to buy bond
 */
function buyBondTxns(
  noOfBonds,
  bondCost,
  bondEscrowLsig,
  bondId,
  stablecoinId,
  mainAppId,
  investorAcc,
) {
  const bondEscrowAddr = bondEscrowLsig.address();

  // Atomic Transaction
  return [
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: mainAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes('buy')]
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: bondEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: bondEscrowAddr,
      lsig: bondEscrowLsig,
      revocationTarget: bondEscrowAddr,
      recipient: investorAcc.addr,
      amount: noOfBonds,
      assetID: bondId,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: issuerAddr,
      amount: noOfBonds * bondCost,
      assetID: stablecoinId,
      payFlags: { totalFee: 1000 }
    }
  ];
}

/**
 * Generates atomic txns to trade bond
 */
function tradeTxns(
  noOfBonds,
  bondEscrowLsig,
  bondId,
  mainAppId,
  investorAcc,
) {
  const bondEscrowAddr = bondEscrowLsig.address();

  return [
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: mainAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes('trade')],
      accounts: [traderAddr]
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: bondEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: bondEscrowAddr,
      lsig: bondEscrowLsig,
      revocationTarget: investorAcc.addr,
      recipient: traderAddr,
      amount: noOfBonds,
      assetID: bondId,
      payFlags: { totalFee: 1000 }
    }
  ];
}

/**
 * Generates atomic txns to trade bond
 */
function tradeTxnsUsingLsig(
  noOfBonds,
  price,
  tradeLsig,
  bondEscrowLsig,
  bondId,
  stablecoinId,
  mainAppId,
  traderAcc,
  sellerAddr,
) {
  const bondEscrowAddr = bondEscrowLsig.address();

  return [
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: sellerAddr,
      lsig: tradeLsig,
      appId: mainAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes('trade')],
      accounts: [traderAddr],
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: sellerAddr,
      lsig: tradeLsig,
      toAccountAddr: bondEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: bondEscrowAddr,
      lsig: bondEscrowLsig,
      revocationTarget: sellerAddr,
      recipient: traderAddr,
      amount: noOfBonds,
      assetID: bondId,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: traderAcc,
      toAccountAddr: sellerAddr,
      amount: noOfBonds * price,
      assetID: stablecoinId,
      payFlags: { totalFee: 1000 }
    }
  ];
}

/**
 * Generates atomic txns to claim coupon
 */
function claimCouponTxns(
  noOfBonds,
  bondCoupon,
  stablecoinEscrowLsig,
  bondEscrowLsig,
  bondId,
  stablecoinId,
  mainAppId,
  manageAppId,
  investorAcc,
) {
  const stablecoinEscrowAddr = stablecoinEscrowLsig.address();
  const bondEscrowAddr = bondEscrowLsig.address();

  return [
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: mainAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes('coupon')],
      accounts: [bondEscrowAddr],
      foreignApps: [manageAppId],
      foreignAssets: [bondId]
    },
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: manageAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes("not_defaulted")],
      accounts: [stablecoinEscrowAddr, bondEscrowAddr],
      foreignApps: [mainAppId],
      foreignAssets: [bondId]
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: stablecoinEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: stablecoinEscrowAddr,
      lsig: stablecoinEscrowLsig,
      toAccountAddr: investorAddr,
      amount: noOfBonds * bondCoupon,
      assetID: stablecoinId,
      payFlags: { totalFee: 1000 }
    }
  ];
}

/**
 * Generates atomic txns to claim principal
 */
function claimPrincipalTxns(
  noOfBonds,
  bondPrincipal,
  stablecoinEscrowLsig,
  bondEscrowLsig,
  bondId,
  stablecoinId,
  mainAppId,
  manageAppId,
  investorAcc,
) {
  const stablecoinEscrowAddr = stablecoinEscrowLsig.address();
  const bondEscrowAddr = bondEscrowLsig.address();

  return [
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: mainAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes('sell')]
    },
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: manageAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes("not_defaulted")],
      accounts: [stablecoinEscrowAddr, bondEscrowAddr],
      foreignApps: [mainAppId],
      foreignAssets: [bondId]
    },
    {
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: bondEscrowAddr,
      lsig: bondEscrowLsig,
      revocationTarget: investorAddr,
      recipient: bondEscrowAddr,
      amount: noOfBonds,
      assetID: bondId,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: stablecoinEscrowAddr,
      lsig: stablecoinEscrowLsig,
      toAccountAddr: investorAddr,
      amount: noOfBonds * bondPrincipal,
      assetID: stablecoinId,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: bondEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: stablecoinEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
  ];
}

/**
 * Generates atomic txns to claim default
 */
function claimDefaultTxns(
  noOfBonds,
  defaultAmount,
  stablecoinEscrowLsig,
  bondEscrowLsig,
  bondId,
  stablecoinId,
  mainAppId,
  manageAppId,
  investorAcc,
) {
  const stablecoinEscrowAddr = stablecoinEscrowLsig.address();
  const bondEscrowAddr = bondEscrowLsig.address();

  return [
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: mainAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes('default')]
    },
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      appId: manageAppId,
      payFlags: { totalFee: 1000 },
      appArgs: [stringToBytes("claim_default")],
      accounts: [stablecoinEscrowAddr, bondEscrowAddr],
      foreignApps: [mainAppId],
      foreignAssets: [bondId]
    },
    {
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: bondEscrowAddr,
      lsig: bondEscrowLsig,
      revocationTarget: investorAddr,
      recipient: bondEscrowAddr,
      amount: noOfBonds,
      assetID: bondId,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: stablecoinEscrowAddr,
      lsig: stablecoinEscrowLsig,
      toAccountAddr: investorAddr,
      amount: defaultAmount,
      assetID: stablecoinId,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: bondEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: investorAcc,
      toAccountAddr: stablecoinEscrowAddr,
      amountMicroAlgos: 1000,
      payFlags: { totalFee: 1000 }
    },
  ];
}

module.exports = {
  masterAddr,
  issuerAddr,
  investorAddr,
  traderAddr,
  greenVerifierAddr,
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
  tradeTxns,
  tradeTxnsUsingLsig,
  claimCouponTxns,
  claimPrincipalTxns,
  claimDefaultTxns
};