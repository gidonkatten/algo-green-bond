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
    reserve = App.globalGetEx(Int(1), Bytes("Reserve"))

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
    num_bonds_in_circ = bond_total.value() - bond_escrow_balance.value()
    # If claiming default then need to add additional coupon (if any) to owed amount
    coupon_rounds_claimed = App.globalGetEx(Int(1), Bytes("CouponsPayed"))
    coupon_array_slot = (coupon_rounds_claimed.value() + Int(1)) / Int(8)
    coupon_index_slot = (coupon_rounds_claimed.value() + Int(1)) % Int(8)
    coupon_array = App.globalGetEx(Int(0), Itob(coupon_array_slot))  # Initialise if needed
    coupon_star_rating = GetByte(
        If(coupon_array.hasValue(), coupon_array.value(), Bytes("base16", "0x0000000000000000")),
        coupon_index_slot
    )
    coupon_star_rating_stored = ScratchVar(TealType.uint64)
    multiplier = Cond(
        [coupon_star_rating_stored.load() == Int(5), Int(10000)],
        [coupon_star_rating_stored.load() == Int(4), Int(11000)],
        [coupon_star_rating_stored.load() == Int(3), Int(12100)],
        [coupon_star_rating_stored.load() == Int(2), Int(13310)],
        [coupon_star_rating_stored.load() == Int(1), Int(14641)],
        [coupon_star_rating_stored.load() == Int(0), Int(10000)]  # TODO: How to treat star rating of 0?
    )
    # Only has defaulted if either:
    #   there is a coupon to claim and coupon_owed + reserve > stablecoin_escrow_balance
    #   have claimed all coupons and principal_owed + reserve > stablecoin_escrow_balance
    coupon_owed = Seq([
        coupon_rounds_claimed,
        coupon_array,
        coupon_star_rating_stored.store(coupon_star_rating),
        If(
            And(
                Txn.application_args[0] == Bytes("claim_default"),
                coupon_round_stored.load() > coupon_rounds_claimed.value()  # there are unclaimed coupons
            ),
            Int(args["BOND_COUPON"]) * multiplier * num_bonds_in_circ,  # add value of one additional coupon
            Int(0)  # no additional money owed
        )
    ])
    principal_owed = If(
        And(
            Txn.application_args[0] == Bytes("claim_default"),
            Global.latest_timestamp() >= Int(args["MATURITY_DATE"]),
            Or(
                Int(args["BOND_LENGTH"]) == coupon_rounds_claimed.value(),
                Int(args["BOND_COUPON"]) == Int(0)
            )
        ),
        Int(args["BOND_PRINCIPAL"]) * num_bonds_in_circ,
        Int(0)  # no additional money owed
    )

    # Value owed across all bonds
    global_value_owed_now = reserve.value() + coupon_owed + principal_owed
    # Can afford to pay out all money owed - stored
    has_defaulted = global_value_owed_now > stablecoin_escrow_balance.value()
    has_defaulted_stored = ScratchVar(TealType.uint64)

    # CLAIM DEFAULT: Verify stablecoin payout
    # split remaining funds excluding 'reserve' which is unclaimed coupons amount
    stablecoin_transfer = Eq(
        Gtxn[3].asset_amount(),
        Div(
            (stablecoin_escrow_balance.value() - reserve.value()) * sender_bond_balance.value(),
            num_bonds_in_circ
        )
    )

    # RATE
    rating_passed = Btoi(Txn.application_args[1])
    rating_passed_stored = ScratchVar(TealType.uint64)
    # round: 0 is 'Use of Proceeds', 1-BOND_LENGTH for coupon reporting
    round_passed = Cond(
        [Global.latest_timestamp() < Int(args["START_BUY_DATE"]), Int(0)],
        [
            And(
                Global.latest_timestamp() >= Int(args["END_BUY_DATE"]),
                Global.latest_timestamp() < Int(args["MATURITY_DATE"])
            ),
            coupon_round + Int(1)
        ]
    )
    round_passed_stored = ScratchVar(TealType.uint64)
    # Verify rating passed: 1-5 stars
    verify_rating_passed = And(
        rating_passed_stored.load() >= Int(1),
        rating_passed_stored.load() <= Int(5)
    )
    # Combine
    rate_verify = And(
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
        If(Txn.application_args[0] == Bytes("rate"), on_rate),
        Assert(
            And(
                Txn.accounts[1] == Addr(args["STABLECOIN_ESCROW_ADDR"]),
                Txn.accounts[2] == Addr(args["BOND_ESCROW_ADDR"]),
                Txn.applications[1] == Int(args["MAIN_APP_ID"]),
                Txn.assets[0] == Int(args["BOND_ID"])
            )
        ),
        stablecoin_escrow_balance,
        bond_escrow_balance,
        sender_bond_balance,
        bond_total,
        reserve,
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

    print(compileTeal(contract(params), Mode.Application, version=4))
