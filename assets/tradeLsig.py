import sys

from pyteal import *


def contract(app_id_arg, stablecoin_id_arg, bond_id_arg, lv_arg, trade_price_arg):
    # NOTE: Lsig will remain valid until expiry

    # TRADE
    # check call to stateful contract is "NoOp" with "trade" arg
    ssc_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(app_id_arg),
        Gtxn[0].on_completion() == OnComplete.NoOp,
        Gtxn[0].application_args[0] == Bytes("trade"),
        Gtxn[0].fee() <= Int(1000),
        Gtxn[0].rekey_to() == Global.zero_address()
    )

    fee = Txn.fee() <= Int(1000)

    # max bonds being traded verified in ssc call
    # verify bond transfer and expiry date
    bond = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].xfer_asset() == Int(bond_id_arg),
        Gtxn[1].last_valid() < Int(lv_arg),
    )
    # verify transferring x bonds for y price
    stablecoin = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].xfer_asset() == Int(stablecoin_id_arg),
        Gtxn[2].asset_amount() == (Int(trade_price_arg) * Gtxn[1].asset_amount()),
        Gtxn[2].rekey_to() == Global.zero_address(),
        Gtxn[2].asset_close_to() == Global.zero_address()
    )

    return ssc_call & fee & bond & stablecoin


if __name__ == "__main__":
    app_id = int(sys.argv[1])
    stablecoin_id = int(sys.argv[2])
    bond_id = int(sys.argv[2])
    lv = int(sys.argv[4])
    trade_price = int(sys.argv[5])

    print(compileTeal(contract(app_id, stablecoin_id, bond_id, lv, trade_price), Mode.Signature, version=4))
