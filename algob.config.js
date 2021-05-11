const { mkAccounts } = require("../algo-builder/packages/algob");

let accounts = mkAccounts([
  {
    name: "master",
    addr: "A6BDLTPR4IEIZG4CCUGEXVMZSXTFO7RWNSOWHBWZL3CX2CLWTKW5FF4SE4",
    mnemonic: "own cattle female team little decorate stomach weather erode river predict drum build sponsor village image total good path corn quit urban announce able trim"
  },
  {
    name: "issuer",
    addr: "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY",
    mnemonic: "engage load empty enlist script live rookie spin half drum matter power mango bless piano board skill normal airport fabric nephew bring barrel ability aim"
  },
  {
    name: "investor",
    addr: "FCRSMPKRY5JPS4IQ2M7P4JRRIJSHRXL5S3NFTGHYP5GQD2XERNYUWEXG54",
    mnemonic: "group few acquire lab advance measure impact follow grocery behave fire say renew scare frequent draw black damp shed advance piece cancel inject abstract deliver"
  },
  {
    name: "greenVerifier",
    addr: "OF6CYTCWXXZQCIFLUBNFZJ43V5BWZAL7BBMSQRIGUYQJVM63GIJ5SPA3JE",
    mnemonic: "rose mistake rely negative offer position another teach company aspect bar tree simple gauge donate physical exclude slam prison carpet another distance curtain able gun"
  }
]);

let defaultCfg = {
  host: "http://localhost",
  port: 8080,
  token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  accounts: accounts,
};

module.exports = {
  networks: {
    default: defaultCfg
  }
};
