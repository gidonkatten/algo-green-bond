from pyteal import *
from utils.params import params


def contract(args):
    # TODO: Verify no rekey, close out etc

    # Common fee transactions
    tx2_pay_fee_of_tx1 = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].sender() == Gtxn[0].sender(),
        Gtxn[2].receiver() == Gtxn[1].sender(),
        Gtxn[2].amount() >= Gtxn[1].fee(),
    )
    tx3_pay_fee_of_tx1 = And(
        Gtxn[3].type_enum() == TxnType.Payment,
        Gtxn[3].sender() == Gtxn[0].sender(),
        Gtxn[3].receiver() == Gtxn[1].sender(),
        Gtxn[3].amount() >= Gtxn[1].fee(),
    )

    opt_in = And(
        Txn.asset_amount() == Int(0),
        Txn.fee() <= Int(1000),
        Txn.xfer_asset() == Int(args["BOND_ID"]),
        Txn.last_valid() < Int(args["LV"]),
        Txn.asset_sender() == Global.zero_address(),  # will be frozen later st will use clawback
        Txn.asset_close_to() == Global.zero_address()
    )

    # BUY: verify there are four transactions in atomic transfer
    # 0. call to stateful contract (verified below - linked_with_app_call)
    # 1. transfer of bond from bond contract account to buyer
    buy_bond_transfer = And(
        Gtxn[1].asset_sender() == Gtxn[1].sender(),
        Gtxn[1].asset_receiver() == Gtxn[0].sender(),
    )
    # 2. fee of tx1
    buy_fee_transfer = tx2_pay_fee_of_tx1
    # 3. transfer of USDC from buyer to issuer account (NoOfBonds * BondCost)
    buy_stablecoin_transfer = And(
        Gtxn[3].type_enum() == TxnType.AssetTransfer,
        Gtxn[3].sender() == Gtxn[0].sender(),
        Gtxn[3].asset_receiver() == Addr(args["ISSUER_ADDR"]),
        Gtxn[3].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[3].asset_amount() == (Gtxn[1].asset_amount() * Int(args["BOND_COST"]))
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
    # 1. transfer of bond from sender to account 2
    trade_bond_transfer = And(
        Gtxn[1].asset_sender() == Gtxn[0].sender(),
        Gtxn[1].asset_receiver() == Gtxn[0].accounts[1],
    )
    # 2. fee of tx1
    trade_fee_transfer = tx2_pay_fee_of_tx1
    # 3,4,... Optional (e.g for payment when transferring bonds)
    # Combine
    on_trade = And(
        Global.group_size() >= Int(3),
        trade_bond_transfer,
        trade_fee_transfer
    )

    # CLAIM PRINCIPAL: verify there are five transactions in atomic transfer
    # 0. call to this contract (verified below)
    # 1. transfer of bond from sender to bond contract account (+ opting out)
    principal_bond_transfer = And(
        Gtxn[1].asset_sender() == Gtxn[0].sender(),
        Gtxn[1].asset_receiver() == Gtxn[1].sender(),
        Gtxn[1].asset_close_to() == Gtxn[1].sender()
    )
    # 2. transfer of USDC from stablecoin contract account to sender (verified in stablecoin escrow)
    # 3. fee of tx1
    principal_fee_transfer1 = tx3_pay_fee_of_tx1
    # 4. fee of tx2 (verified in stablecoin escrow)
    # Combine
    on_principal = And(
        Global.group_size() == Int(5),
        principal_bond_transfer,
        principal_fee_transfer1,
    )

    # common to all functions
    linked_with_app_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["MAIN_APP_ID"])
    )
    bond_transfer = And(
        Txn.group_index() == Int(1),
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].xfer_asset() == Int(args["BOND_ID"])
    )

    # Since asset transfer, cannot have rekey
    # Other transactions in group (if any) checked in stateful contract call
    return And(
        Txn.type_enum() == TxnType.AssetTransfer,
        If(
            Global.group_size() == Int(1),
            opt_in,
            Seq([
                Assert(And(linked_with_app_call, bond_transfer)),
                Cond(
                    [Gtxn[0].application_args[0] == Bytes("buy"), on_buy],
                    [Gtxn[0].application_args[0] == Bytes("trade"), on_trade],
                    [Gtxn[0].application_args[0] == Bytes("sell"), on_principal]
                )
            ])
        )
    )


if __name__ == "__main__":
    print(compileTeal(contract(params), Mode.Signature, version=2))
