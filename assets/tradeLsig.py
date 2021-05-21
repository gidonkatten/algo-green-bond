import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):
    # NOTE: Lsig will remain valid until expiry

    # TRADE
    # check call to stateful contract is "NoOp" with "trade" arg
    ssc_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["MAIN_APP_ID"]),
        Gtxn[0].on_completion() == OnComplete.NoOp,
        Gtxn[0].application_args[0] == Bytes("trade"),
        Gtxn[0].fee() <= Int(1000)
    )

    # tx1 algo amount less than or equal to 1000
    fee = And(
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[1].amount() <= Int(1000),
        Gtxn[1].fee() <= Int(1000)
    )

    # max bonds being traded verified in ssc call
    # verify bond transfer and expiry date
    bond = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].xfer_asset() == Int(args["BOND_ID"]),
        Gtxn[2].last_valid() < Int(args["LV"])
    )
    # verify transferring x bonds for y price
    stablecoin = And(
        Gtxn[3].type_enum() == TxnType.AssetTransfer,
        Gtxn[3].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[3].asset_amount() == (Int(args["TRADE_PRICE"]) * Gtxn[2].asset_amount())
    )

    return ssc_call & fee & bond & stablecoin


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Signature, version=2))
