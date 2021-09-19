import sys

from pyteal import *


def contract(app_id_arg, bond_id_arg, lv_arg):

    asset_close_to_check = Txn.asset_close_to() == Global.zero_address()
    rekey_check = Txn.rekey_to() == Global.zero_address()
    fee_check = Txn.fee() == Int(0)

    # Common fee transactions
    tx1_pay_fee_of_tx2 = And(
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[1].sender() == Gtxn[0].sender(),
        Gtxn[1].receiver() == Gtxn[2].sender(),
        Gtxn[1].amount() >= Gtxn[2].fee(),
    )
    tx4_pay_fee_of_tx2 = And(
        Gtxn[4].type_enum() == TxnType.Payment,
        Gtxn[4].sender() == Gtxn[0].sender(),
        Gtxn[4].receiver() == Gtxn[2].sender(),
        Gtxn[4].amount() >= Gtxn[2].fee(),
    )

    # Opt into bond asset
    opt_in = And(
        Txn.asset_amount() == Int(0),
        Txn.fee() <= Int(1000),
        Txn.xfer_asset() == Int(bond_id_arg),
        Txn.last_valid() < Int(lv),
        Txn.asset_sender() == Global.zero_address(),  # will be frozen later st will use clawback
        Txn.asset_close_to() == Global.zero_address()
    )

    # BUY: verify there are four transactions in atomic transfer
    # 0. call to stateful contract (verified below - linked_with_app_call)
    # 1. fee of tx2
    buy_fee_transfer = tx1_pay_fee_of_tx2
    # 2. transfer of bond from bond contract account to buyer
    buy_bond_transfer = And(
        Gtxn[2].asset_sender() == Gtxn[2].sender(),
        Gtxn[2].asset_receiver() == Gtxn[0].sender(),
    )
    # 3. transfer of USDC from buyer to issuer account (NoOfBonds * BondCost)
    buy_stablecoin_transfer = And(
        Gtxn[3].type_enum() == TxnType.AssetTransfer,
        Gtxn[3].sender() == Gtxn[0].sender(),
        Gtxn[3].asset_receiver() == Addr(args["ISSUER_ADDR"]),
        Gtxn[3].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[3].asset_amount() == (Gtxn[2].asset_amount() * Int(args["BOND_COST"]))
    )
    # Combine
    on_buy = And(
        Global.group_size() == Int(4),
        buy_bond_transfer,
        buy_fee_transfer,
        buy_stablecoin_transfer
    )

    # TRADE: verify there are at least three transactions in atomic transfer
    # NOTE: Account bond trading to is specified in account array pos 1
    # 0. call to stateful contract (verified below - linked_with_app_call)
    # 1. fee of tx2
    trade_fee_transfer = tx1_pay_fee_of_tx2
    # 2. transfer of bond from sender to account 2
    trade_bond_transfer = And(
        Gtxn[2].asset_sender() == Gtxn[0].sender(),
        Gtxn[2].asset_receiver() == Gtxn[0].accounts[1],
    )
    # 3,4,... Optional (e.g for payment when transferring bonds)
    # Combine
    on_trade = And(
        Global.group_size() >= Int(3),
        trade_bond_transfer,
        trade_fee_transfer
    )

    # CLAIM PRINCIPAL OR DEFAULT: verify there are five transactions in atomic transfer
    # 0. call to this contract (verified below)
    # 1. call to manage stateful contract (verified in stablecoin escrow)
    # 2. transfer of bond from sender to bond contract account (+ opting out)
    end_bond_transfer = And(
        Gtxn[2].asset_sender() == Gtxn[0].sender(),
        Gtxn[2].asset_receiver() == Gtxn[2].sender(),
    )
    # 3. transfer of USDC from stablecoin contract account to sender (verified in stablecoin escrow)
    # 4. fee of tx2
    end_fee_transfer1 = tx4_pay_fee_of_tx2
    # 5. fee of tx3 (verified in stablecoin escrow)
    # Combine
    on_end = And(
        Global.group_size() == Int(6),
        end_bond_transfer,
        end_fee_transfer1,
    )

    # common to all functions
    linked_with_app_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(app_id_arg)
    )
    bond_transfer = And(
        Txn.group_index() == Int(2),
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].xfer_asset() == Int(args["BOND_ID"])
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
                    [Or(Gtxn[0].application_args[0] == Bytes("sell"),
                        Gtxn[0].application_args[0] == Bytes("default")), on_end]
                )
            ])
        )
    ])


if __name__ == "__main__":
    app_id = int(sys.argv[1])
    bond_id = int(sys.argv[2])
    lv = int(sys.argv[3])

    print(compileTeal(contract(app_id, bond_id, lv), Mode.Signature, version=4))
