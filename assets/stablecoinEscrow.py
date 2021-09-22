import sys

from pyteal import *


def contract(app_id_arg, stablecoin_id_arg, lv_arg):

    asset_close_to_check = Txn.asset_close_to() == Global.zero_address()
    rekey_check = Txn.rekey_to() == Global.zero_address()
    clawback_check = Txn.asset_sender() == Global.zero_address()
    fee_check = Txn.fee() == Int(0)

    def stablecoin_transfer(txn_no) -> NaryExpr:
        return And(
            Txn.group_index() == Int(txn_no),
            Gtxn[txn_no].type_enum() == TxnType.AssetTransfer,
            Gtxn[txn_no].xfer_asset() == Int(stablecoin_id_arg)
        )

    # Opt into stablecoin asset
    opt_in = And(
        Txn.asset_amount() == Int(0),
        Txn.fee() <= Int(1000),
        Txn.xfer_asset() == Int(stablecoin_id_arg),
        Txn.last_valid() < Int(lv_arg)
    )

    # CLAIM COUPON
    on_coupon = And(Global.group_size() == Int(2), stablecoin_transfer(1))

    # CLAIM PRINCIPAL
    on_principal = And(Global.group_size() == Int(3), stablecoin_transfer(2))

    # CLAIM DEFAULT
    on_default = And(Global.group_size() == Int(3), stablecoin_transfer(2))

    # common to all functions
    linked_with_app_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(app_id_arg)
    )

    # Since asset transfer, cannot have rekey or close-to
    # Other transactions in group (if any) checked in stateful contract call
    return Seq([
        Assert(Txn.type_enum() == TxnType.AssetTransfer),
        Assert(asset_close_to_check),
        Assert(rekey_check),
        Assert(clawback_check),
        If(
            Global.group_size() == Int(1),
            opt_in,
            Seq([
                Assert(fee_check),
                Assert(linked_with_app_call),
                Cond(
                    [Gtxn[0].application_args[0] == Bytes("coupon"), on_coupon],
                    [Gtxn[0].application_args[0] == Bytes("sell"), on_principal],
                    [Gtxn[0].application_args[0] == Bytes("default"), on_default]
                )
            ])
        )
    ])


if __name__ == "__main__":
    app_id = int(sys.argv[1])
    stablecoin_id = int(sys.argv[2])
    lv = int(sys.argv[3])

    print(compileTeal(contract(app_id, stablecoin_id, lv), Mode.Signature, version=4))
