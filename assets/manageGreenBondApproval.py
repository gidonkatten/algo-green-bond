import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):

    # Setup
    stablecoin_escrow_balance = AssetHolding.balance(Int(1), Int(args["STABLECOIN_ID"]))
    bond_escrow_balance = AssetHolding.balance(Int(2), Int(args["BOND_ID"]))
    bond_total = AssetParam.total(Int(0))
    coupons_payed_total = App.globalGetEx(Int(1), Bytes("TotCouponsPayed"))

    # Implementation
    num_bonds = Minus(
        bond_total.value(),
        bond_escrow_balance.value()
    )
    coupon_round = If(
        Global.latest_timestamp() > Int(args["MATURITY_DATE"]),
        Int(args["BOND_LENGTH"]),  # coupon round is max BOND_LENGTH
        Div(
            Global.latest_timestamp() - Int(args["END_BUY_DATE"]),
            Int(args["SIX_MONTH_PERIOD"])
        )
    )
    remaining_coupon_value_owed_now = Mul(
        Int(args["BOND_COUPON"]),
        Minus(
            coupon_round * num_bonds,
            coupons_payed_total.value()
        )
    )
    remaining_principal_value_owed_now = If(
        Global.latest_timestamp() > Int(args["MATURITY_DATE"]),
        Int(args["BOND_PRINCIPAL"]) * num_bonds,
        Int(0)  # 0 if not yet maturity
    )
    remaining_total_value_owed_now = remaining_coupon_value_owed_now + remaining_principal_value_owed_now
    has_defaulted = remaining_total_value_owed_now > stablecoin_escrow_balance.value()

    has_defaulted_stored = ScratchVar(TealType.uint64)
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
        bond_total,
        Assert(bond_total.hasValue()),
        coupons_payed_total,
        has_defaulted_stored.store(has_defaulted),
        Cond(
            [Txn.application_args[0] == Bytes("yes"), has_defaulted_stored.load()],
            [Txn.application_args[0] == Bytes("no"), Not(has_defaulted_stored.load())]
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
