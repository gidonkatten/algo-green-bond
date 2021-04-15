from pyteal import *


def contract(args):
    asset_close_to_check = Txn.asset_close_to() == Global.zero_address()

    # Only used for opt-in as bonds will be frozen and transferred via clawback
    clawback_check = Txn.asset_sender() == Global.zero_address()

    opt_in = And(
        Txn.asset_amount() == Int(0),
        Txn.fee() <= Int(1000),
        Txn.xfer_asset() == Int(args["BOND_ID"]),
        Txn.last_valid() < Int(args["LV"]),
        clawback_check
    )

    # Transaction fee checked
    bond_transfer = And(
        Txn.group_index() == Int(1),
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["APP_ID"])
    )

    # Since asset transfer, cannot have rekey or close-to
    # Other transactions in group (if any) checked in stateful contract call
    return And(
        Txn.type_enum() == TxnType.AssetTransfer,
        asset_close_to_check,
        Cond(
            [Global.group_size() == Int(1), opt_in],
            [Global.group_size() >= Int(3), bond_transfer],
        )
    )


if __name__ == "__main__":
    params = {
        "BOND_ID": 1,
        "LV": 1500,
        "APP_ID": 3
    }

    print(compileTeal(contract(params), Mode.Signature, version=2))
