import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):

    asset_close_to_check = Txn.asset_close_to() == Global.zero_address()
    rekey_check = Txn.rekey_to() == Global.zero_address()
    clawback_check = Txn.asset_sender() == Global.zero_address()

    # Common fee transactions
    tx2_pay_fee_of_tx3 = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].sender() == Gtxn[0].sender(),
        Gtxn[2].receiver() == Gtxn[3].sender(),
        Gtxn[2].amount() >= Gtxn[3].fee(),
    )
    tx5_pay_fee_of_tx3 = And(
        Gtxn[5].type_enum() == TxnType.Payment,
        Gtxn[5].sender() == Gtxn[0].sender(),
        Gtxn[5].receiver() == Gtxn[3].sender(),
        Gtxn[5].amount() >= Gtxn[3].fee(),
    )

    # Opt into stablecoin asset
    opt_in = And(
        Txn.asset_amount() == Int(0),
        Txn.fee() <= Int(1000),
        Txn.xfer_asset() == Int(args["STABLECOIN_ID"]),
        Txn.last_valid() < Int(args["LV"])
    )

    # CLAIM COUPON: verify there are four transactions in atomic transfer
    # 0. call to main stateful contract (verified below - linked_with_app_call)
    # 1. call to manage stateful contract (verified below - linked_with_manage_app_call)
    # 2. fee of tx3
    coupon_fee_transfer = tx2_pay_fee_of_tx3
    # 3. transfer of USDC from stablecoin contract account (verified below - stablecoin_transfer)
    #       to sender (amount verified in main stateful contract)
    coupon_stablecoin_transfer = Gtxn[3].asset_receiver() == Gtxn[0].sender()
    # verify coupon exists
    has_coupon = Int(args["BOND_COUPON"]) > Int(0)
    # Combine
    on_coupon = And(
        Global.group_size() == Int(4),
        coupon_fee_transfer,
        coupon_stablecoin_transfer,
        has_coupon,
        Gtxn[1].application_args[0] == Bytes("not_defaulted")
    )

    # CLAIM PRINCIPAL: verify there are five transactions in atomic transfer
    # 0. call to stateful contract (verified below - linked_with_app_call)
    # 1. call to manage stateful contract (verified below - linked_with_manage_app_call)
    # 2. transfer of bond (verified in bond escrow)
    # 3. transfer of USDC from stablecoin contract account (verified below - stablecoin_transfer)
    #       to sender (NoOfBonds * BOND_PRINCIPAL)
    principal_stablecoin_transfer = And(
        Gtxn[3].asset_receiver() == Gtxn[0].sender(),
        Gtxn[3].asset_amount() == (Gtxn[2].asset_amount() * Int(args["BOND_PRINCIPAL"]))
    )
    # 4. fee of tx2 (verified in bond escrow)
    # 5. fee of tx3
    principal_fee_transfer2 = tx5_pay_fee_of_tx3
    # Combine
    on_principal = And(
        Global.group_size() == Int(6),
        principal_stablecoin_transfer,
        principal_fee_transfer2,
        Gtxn[1].application_args[0] == Bytes("not_defaulted")
    )

    # CLAIM DEFAULT: verify there are five transactions in atomic transfer
    # 0. call to stateful contract (verified below - linked_with_app_call)
    # 1. call to manage stateful contract (verified below - linked_with_manage_app_call)
    # 2. transfer of bond (verified in bond escrow)
    # 3. transfer of USDC from stablecoin contract account (verified below - stablecoin_transfer)
    #       to sender (amount verified in manage stateful contract)
    # 4. fee of tx2 (verified in bond escrow)
    # 5. fee of tx3
    default_fee_transfer2 = tx5_pay_fee_of_tx3
    on_default = And(
        Global.group_size() == Int(6),
        default_fee_transfer2,
        Gtxn[1].application_args[0] == Bytes("claim_default")
    )

    # common to all functions
    linked_with_app_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["MAIN_APP_ID"])
    )
    linked_with_manage_app_call = And(
        Gtxn[1].type_enum() == TxnType.ApplicationCall,
        Gtxn[1].application_id() == Int(args["MANAGE_APP_ID"]),
    )
    stablecoin_transfer = And(
        Txn.group_index() == Int(3),
        Gtxn[3].type_enum() == TxnType.AssetTransfer,
        Gtxn[3].xfer_asset() == Int(args["STABLECOIN_ID"])
    )

    # Since asset transfer, cannot have rekey or close-to
    # Other transactions in group (if any) checked in stateful contract call
    return And(
        Txn.type_enum() == TxnType.AssetTransfer,
        asset_close_to_check,
        rekey_check,
        clawback_check,
        If(
            Global.group_size() == Int(1),
            opt_in,
            Seq([
                Assert(And(linked_with_app_call, linked_with_manage_app_call, stablecoin_transfer)),
                Cond(
                    [Gtxn[0].application_args[0] == Bytes("coupon"), on_coupon],
                    [Gtxn[0].application_args[0] == Bytes("sell"), on_principal],
                    [Gtxn[0].application_args[0] == Bytes("default"), on_default]
                )
            ])
        )
    )


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Signature, version=2))
