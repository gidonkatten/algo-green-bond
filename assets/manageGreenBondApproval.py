import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):

    # Setup
    stablecoin_escrow_balance = AssetHolding.balance(Int(1), Int(args["STABLECOIN_ID"]))
    bond_escrow_balance = AssetHolding.balance(Int(2), Int(args["BOND_ID"]))
    sender_bond_balance = AssetHolding.balance(Int(0), Int(args["BOND_ID"]))
    bond_total = AssetParam.total(Int(0))
    coupons_payed_total = App.globalGetEx(Int(1), Bytes("TotCouponsPayed"))

    # Implementation
    global_num_bonds_in_circ = Minus(
        bond_total.value(),
        bond_escrow_balance.value()
    )
    coupon_round = If(
        Global.latest_timestamp() >= Int(args["MATURITY_DATE"]),
        Int(args["BOND_LENGTH"]),  # coupon round is max BOND_LENGTH
        If(
            Global.latest_timestamp() < Int(args["END_BUY_DATE"]),
            Int(0),  # no coupons if before start date
            Div(
                Global.latest_timestamp() - Int(args["END_BUY_DATE"]),
                Int(args["PERIOD"])
            )
        )

    )
    global_coupon_value_owed_now = Mul(
        Int(args["BOND_COUPON"]),
        Minus(  # Total number of coupons unpaid until now
            coupon_round * global_num_bonds_in_circ,
            coupons_payed_total.value()
        )
    )
    global_principal_value_owed_now = If(
        Global.latest_timestamp() >= Int(args["MATURITY_DATE"]),
        Int(args["BOND_PRINCIPAL"]) * global_num_bonds_in_circ,
        Int(0)  # 0 if not yet maturity
    )

    # Value owed across all bonds
    global_value_owed_now = global_coupon_value_owed_now + global_principal_value_owed_now

    # Can afford to pay out all money owed - stored
    has_defaulted = global_value_owed_now > stablecoin_escrow_balance.value()
    has_defaulted_stored = ScratchVar(TealType.uint64)

    # CLAIM DEFAULT: Verify stablecoin payout
    # TODO: More sophisticated payout eg if someone didn't prev claim their coupon?
    stablecoin_transfer = Eq(
        global_num_bonds_in_circ / sender_bond_balance.value(),
        stablecoin_escrow_balance.value() / Gtxn[3].asset_amount()
    )

    # HANDLE NO OP
    handle_no_op = Seq([
        Assert(
            And(
                # Txn.applications[1] == Int(args["MAIN_APP_ID"]),  # TODO: TEAL 3
                # Txn.assets[0] == Int(args["BOND_ID"]),  # TODO: TEAL 3
                Txn.accounts[1] == Addr(args["STABLECOIN_ESCROW_ADDR"]),
                Txn.accounts[2] == Addr(args["BOND_ESCROW_ADDR"])
            )
        ),
        stablecoin_escrow_balance,
        bond_escrow_balance,
        sender_bond_balance,
        bond_total,
        coupons_payed_total,
        has_defaulted_stored.store(has_defaulted),
        Cond(
            [Txn.application_args[0] == Bytes("defaulted"), has_defaulted_stored.load()],
            [Txn.application_args[0] == Bytes("not_defaulted"), Not(has_defaulted_stored.load())],
            [Txn.application_args[0] == Bytes("claim_default"), has_defaulted_stored.load() & stablecoin_transfer],
        )
    ])

    program = Cond(
        [Txn.application_id() == Int(0), Int(1)],  # on creation
        [Txn.on_completion() == OnComplete.DeleteApplication, Int(0)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Int(0)],
        [Txn.on_completion() == OnComplete.CloseOut, Int(0)],
        [Txn.on_completion() == OnComplete.OptIn, Int(0)],
        [Txn.on_completion() == OnComplete.NoOp, handle_no_op]
    )

    return program


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Application, version=2))
