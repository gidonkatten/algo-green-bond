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

    # Current coupon round, 0 if none and BOND_LENGTH if finished - stored
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
    coupon_round_stored = ScratchVar(TealType.uint64)

    # Implementation
    global_num_bonds_in_circ = Minus(
        bond_total.value(),
        bond_escrow_balance.value()
    )
    global_coupon_value_owed_now = Mul(
        Int(args["BOND_COUPON"]),
        Minus(  # Total number of coupons unpaid until now
            coupon_round_stored.load() * global_num_bonds_in_circ,
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

    # RATE
    round_passed = Btoi(Txn.application_args[1])
    round_passed_stored = ScratchVar(TealType.uint64)
    rating_passed = Btoi(Txn.application_args[2])
    rating_passed_stored = ScratchVar(TealType.uint64)
    # Verify round passed: 0 is 'Use of Proceeds', 1-BOND_LENGTH for coupon reporting
    verify_round_passed = Or(
        And(
            Global.latest_timestamp() < Int(args["START_BUY_DATE"]),
            round_passed_stored.load() == Int(0)
        ),
        And(
            Global.latest_timestamp() >= Int(args["END_BUY_DATE"]),
            Global.latest_timestamp() < Int(args["MATURITY_DATE"]),
            round_passed_stored.load() == (coupon_round_stored.load() + Int(1))
        )
    )
    # Verify rating passed: 1-5 stars
    verify_rating_passed = And(
        rating_passed_stored.load() >= Int(1),
        rating_passed_stored.load() <= Int(5)
    )
    # Combine
    rate_verify = And(
        verify_round_passed,
        verify_rating_passed,
        Txn.sender() == Addr(args["GREEN_VERIFIER_ADDR"])
    )
    # Can fit 8 single byte ints in global state value
    array_slot = round_passed_stored.load() / Int(8)
    index_slot = round_passed_stored.load() % Int(8)
    array = App.globalGetEx(Int(0), Itob(array_slot))  # Initialise if needed
    # Update
    on_rate = Seq([
        round_passed_stored.store(round_passed),
        rating_passed_stored.store(rating_passed),
        Assert(rate_verify),
        array,
        App.globalPut(
            Itob(array_slot),
            SetByte(
                If(array.hasValue(), array.value(), Bytes("base16", "0x0000000000000000")),
                index_slot,
                rating_passed_stored.load()
            )
        ),
        Return(Int(1))
    ])

    # HANDLE NO OP
    handle_no_op = Seq([
        coupon_round_stored.store(coupon_round),
        # If(Txn.application_args[0] == Bytes("rate"), on_rate),  # TODO: TEAL 3
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
            [Txn.application_args[0] == Bytes("claim_default"), has_defaulted_stored.load() & stablecoin_transfer]
        )
    ])

    program = Cond(
        [Txn.application_id() == Int(0), Int(1)],  # on creation
        [Txn.on_completion() == OnComplete.DeleteApplication, Int(0)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Int(0)],
        [Txn.on_completion() == OnComplete.CloseOut, Int(0)],
        [Txn.on_completion() == OnComplete.OptIn, Int(0)],
        [Int(1), handle_no_op]
    )

    return program


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Application, version=2))
