import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):
    # TRADE
    # check call to stateful contract is "NoOp" with "trade" arg
    ssc_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["MAIN_APP_ID"]),
        Gtxn[0].on_completion() == OnComplete.NoOp,
        Gtxn[0].application_args[0] == Bytes("trade"),
    )

    # tx1 algo amount less than or equal to 1000
    fee = And(
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[1].amount() <= 1000
    )

    # verify transferring x bonds for y price
    bond = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].xfer_asset() == Int(args["BOND_ID"]),
        Gtxn[2].amount() == Tmpl.Int('TMPL_NUM_BONDS')
    )
    stablecoin = And(
        Gtxn[3].type_enum() == TxnType.Payment,
        Gtxn[3].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[3].amount() == Tmpl.Int('TMPL_STABLECOIN_PRICE')
    )

    return ssc_call & fee & bond & stablecoin


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Signature))
