import sys

from pyteal import *


def contract(app_id_arg, bond_id_arg, lv_arg):

    asset_close_to_check = Txn.asset_close_to() == Global.zero_address()
    rekey_check = Txn.rekey_to() == Global.zero_address()
    fee_check = Txn.fee() == Int(0)

    # Opt into bond asset
    opt_in = And(
        Txn.asset_amount() == Int(0),
        Txn.fee() <= Int(1000),
        Txn.xfer_asset() == Int(bond_id_arg),
        Txn.last_valid() < Int(lv),
        Txn.asset_sender() == Global.zero_address(),  # will be frozen later st will use clawback
        Txn.asset_close_to() == Global.zero_address()
    )

    # BUY
    on_buy = Global.group_size() == Int(3)

    # TRADE
    on_trade = Global.group_size() >= Int(2)

    # CLAIM PRINCIPAL OR DEFAULT
    on_end = Global.group_size() == Int(3)

    # common to all functions
    linked_with_app_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(app_id_arg)
    )
    bond_transfer = And(
        Txn.group_index() == Int(1),
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].xfer_asset() == Int(bond_id_arg)
    )

    # Since asset transfer, cannot have rekey
    # Other transactions in group (if any) checked in stateful contract call
    return Seq([
        Assert(Txn.type_enum() == TxnType.AssetTransfer),
        Assert(asset_close_to_check),
        Assert(rekey_check),
        If(
            Global.group_size() == Int(1),
            opt_in,
            Seq([
                Assert(fee_check),
                Assert(linked_with_app_call),
                Assert(bond_transfer),
                Cond(
                    [Gtxn[0].application_args[0] == Bytes("buy"), on_buy],
                    [Gtxn[0].application_args[0] == Bytes("trade"), on_trade],
                    [
                        Or(
                            Gtxn[0].application_args[0] == Bytes("sell"),
                            Gtxn[0].application_args[0] == Bytes("default")
                        ),
                        on_end
                    ]
                )
            ])
        )
    ])


if __name__ == "__main__":
    app_id = int(sys.argv[1])
    bond_id = int(sys.argv[2])
    lv = int(sys.argv[3])

    print(compileTeal(contract(app_id, bond_id, lv), Mode.Signature, version=4))
