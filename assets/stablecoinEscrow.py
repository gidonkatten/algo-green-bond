from pyteal import *
from utils.params import params

def contract(args):
    # TODO: Verify no rekey, close out etc

    asset_close_to_check = Txn.asset_close_to() == Global.zero_address()
    clawback_check = Txn.asset_sender() == Global.zero_address()

    # Common fee transactions
    tx1_pay_fee_of_tx2 = And(
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[1].sender() == Gtxn[0].sender(),
        Gtxn[1].receiver() == Gtxn[2].sender(),
        Gtxn[1].amount() >= Gtxn[2].fee(),
    )
    tx5_pay_fee_of_tx2 = And(
        Gtxn[5].type_enum() == TxnType.Payment,
        Gtxn[5].sender() == Gtxn[0].sender(),
        Gtxn[5].receiver() == Gtxn[2].sender(),
        Gtxn[5].amount() >= Gtxn[2].fee(),
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
    # 1. fee of tx2
    coupon_fee_transfer = tx1_pay_fee_of_tx2
    # 2. transfer of USDC from stablecoin contract account (verified below - stablecoin_transfer) to owner
    coupon_stablecoin_transfer = Gtxn[2].asset_receiver() == Gtxn[0].sender()
    # 3. call to manage stateful contract (verified below - linked_with_manage_app_call)
    # verify coupon exists
    has_coupon = Int(args["BOND_COUPON"]) > Int(0)
    # Combine
    on_coupon = And(
        Global.group_size() == Int(4),
        coupon_fee_transfer,
        coupon_stablecoin_transfer,
        has_coupon
    )

    # CLAIM PRINCIPAL: verify there are five transactions in atomic transfer
    # 0. call to stateful contract (verified below - linked_with_app_call)
    # 1. transfer of bond (verified in bond escrow)
    # 2. transfer of USDC from stablecoin contract account (verified below - stablecoin_transfer)
    #       to sender (NoOfBonds * BOND_PRINCIPAL)
    principal_stablecoin_transfer = And(
        Gtxn[2].asset_receiver() == Gtxn[0].sender(),
        Gtxn[2].asset_amount() == (Gtxn[1].asset_amount() * Int(args["BOND_PRINCIPAL"]))
    )
    # 3. call to manage stateful contract (verified below - linked_with_manage_app_call)
    # 4. fee of tx1 (verified in bond escrow)
    # 5. fee of tx2
    principal_fee_transfer2 = tx5_pay_fee_of_tx2
    # Combine
    on_principal = And(
        Global.group_size() == Int(6),
        principal_stablecoin_transfer,
        principal_fee_transfer2
    )

    # common to all functions
    linked_with_app_call = And(
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["MAIN_APP_ID"])
    )
    linked_with_manage_app_call = And(
        Gtxn[3].type_enum() == TxnType.ApplicationCall,
        Gtxn[3].application_id() == Int(args["MANAGE_APP_ID"]),
        Gtxn[3].application_args[0] == Bytes("not_defaulted")
    )
    stablecoin_transfer = And(
        Txn.group_index() == Int(2),
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].xfer_asset() == Int(args["STABLECOIN_ID"])
    )

    # Since asset transfer, cannot have rekey or close-to
    # Other transactions in group (if any) checked in stateful contract call
    return And(
        Txn.type_enum() == TxnType.AssetTransfer,
        asset_close_to_check,
        clawback_check,
        If(
            Global.group_size() == Int(1),
            opt_in,
            Seq([
                Assert(And(linked_with_app_call, linked_with_manage_app_call, stablecoin_transfer)),
                Cond(
                    [Gtxn[0].application_args[0] == Bytes("coupon"), on_coupon],
                    [Gtxn[0].application_args[0] == Bytes("sell"), on_principal]
                )
            ])
        )
    )


if __name__ == "__main__":
    print(compileTeal(contract(params), Mode.Signature, version=2))
