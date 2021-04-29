from pyteal import *
import base64
import sys
import algosdk


def contract(args):
    # TODO: Verify no rekey, close out etc

    # Common fee transactions
    tx2_pay_fee_of_tx1 = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].sender() == Gtxn[0].sender(),
        Gtxn[2].receiver() == Gtxn[1].sender(),
        Gtxn[2].amount() >= Gtxn[1].fee(),
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
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Gtxn[1].sender(),
        Gtxn[1].asset_receiver() == Gtxn[0].sender(),
        Gtxn[1].xfer_asset() == Int(args["BOND_ID"])
    )
    # 2. transfer of algos from buyer to bond contract account (fee of tx1)
    buy_fee_transfer = tx2_pay_fee_of_tx1
    # 3. transfer of USDC from buyer to issuer account (NoOfBonds * BondCost)
    buy_stablecoin_transfer = And(
        Gtxn[3].type_enum() == TxnType.AssetTransfer,
        Gtxn[3].sender() == Gtxn[0].sender(),
        Gtxn[3].asset_receiver() == Bytes("base32", args["ISSUER_ADDR"]),
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

    # CLAIM PRINCIPAL
    on_claim_principal = Int(0)

    # verify call is linked to stateful contract
    linked_with_app_call = And(
        Txn.group_index() == Int(1),
        Gtxn[0].type_enum() == TxnType.ApplicationCall,
        Gtxn[0].application_id() == Int(args["APP_ID"])
    )

    # Since asset transfer, cannot have rekey
    # Other transactions in group (if any) checked in stateful contract call
    return And(
        Txn.type_enum() == TxnType.AssetTransfer,
        If(
            Global.group_size() == Int(1),
            opt_in,
            Seq([
                Assert(linked_with_app_call),
                Cond(
                    [Gtxn[0].application_args[0] == Bytes("buy"), on_buy],
                    [Gtxn[0].application_args[0] == Bytes("sell"), on_claim_principal]
                )
            ])
        )
    )


if __name__ == "__main__":
    ISSUER_ADDR = base64.b32encode(algosdk.encoding.decode_address(
        "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY"
    )).decode()

    params = {
        "LV": 1500,
        "APP_ID": 12,
        "STABLECOIN_ID": 2,
        "BOND_ID": 1,
        "ISSUER_ADDR": ISSUER_ADDR,
        "BOND_COST": 50000000,  # $50.000000
        "BOND_PRINCIPAL": 100000000,  # $100.000000
    }

    print(compileTeal(contract(params), Mode.Signature, version=3))
