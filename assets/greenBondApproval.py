import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):
    # TODO: Verify no rekey, close out etc

    sender_bond_balance = AssetHolding.balance(Int(0), Int(args["BOND_ID"]))

    # Sender is stateless contract account (clawback)
    linked_with_bond_escrow = Gtxn[1].sender() == Addr(args["BOND_ESCROW_ADDR"])
    linked_with_stablecoin_escrow = Gtxn[2].sender() == Addr(args["STABLECOIN_ESCROW_ADDR"])

    # TODO
    on_closeout = Int(0)

    # Approve if only transaction in group
    on_opt_in = Seq([
        Assert(Global.group_size() == Int(1)),
        Int(1)
    ])

    # BUY: Stateless contract account verifies everything else
    # verify in buy period
    in_buy_period = And(
        Global.latest_timestamp() >= Int(args["START_BUY_DATE"]),
        Global.latest_timestamp() <= Int(args["END_BUY_DATE"])
    )
    #
    on_buy = And(linked_with_bond_escrow, in_buy_period)

    # TRADE: Stateless contract account verifies everything else
    in_trade_window = And(
        Global.latest_timestamp() > Int(args["END_BUY_DATE"]),
        Global.latest_timestamp() < Int(args["MATURITY_DATE"]),
    )
    # if receiver of bond already is an owner
    # then: verify receiver has same number of coupon payments as sender
    # else: set receiver's CouponsPayed to the sender's CouponsPayed
    receiver_bond_balance = AssetHolding.balance(Int(1), Int(args["BOND_ID"]))
    has_same_num_installments = Seq([
        receiver_bond_balance,
        If(
            receiver_bond_balance.value() > Int(0),
            Assert(
                App.localGet(Int(0), Bytes("CouponsPayed")) ==
                App.localGet(Int(1), Bytes("CouponsPayed"))
            ),
            App.localPut(
                Int(1),
                Bytes("CouponsPayed"),
                App.localGet(Int(0), Bytes("CouponsPayed"))
            )
        )
    ])
    #
    on_trade = Seq([
        Assert(And(linked_with_bond_escrow, in_trade_window)),
        has_same_num_installments,
        Int(1)
    ])

    # CLAIM COUPON: Stateless contract accounts verifies everything else
    # verify transfer of USDC is correct amount
    coupon_stablecoin_transfer = Gtxn[2].asset_amount() == Mul(
        Int(args["BOND_COUPON"]),
        sender_bond_balance.value()
    )
    # verify have not already claimed coupon:
    coupon_round = If(
        Global.latest_timestamp() > Int(args["MATURITY_DATE"]),
        Int(args["BOND_LENGTH"]),  # coupon round is max BOND_LENGTH
        Div(
            Global.latest_timestamp() - Int(args["END_BUY_DATE"]),
            Int(args["PERIOD"])
        )
    )
    owed_coupon = App.localGet(Int(0), Bytes("CouponsPayed")) < coupon_round
    # Combine
    coupon_verify = And(
        coupon_stablecoin_transfer,
        owed_coupon,
        linked_with_stablecoin_escrow
    )
    # Update how many bond coupon payments locally and globally
    on_coupon = Seq([
        sender_bond_balance,
        Assert(coupon_verify),
        App.localPut(
            Int(0),
            Bytes("CouponsPayed"),
            App.localGet(Int(0), Bytes("CouponsPayed")) + Int(1)
        ),
        App.globalPut(
            Bytes("TotCouponsPayed"),
            App.globalGet(Bytes("TotCouponsPayed")) + sender_bond_balance.value()
        ),
        Int(1)
    ])

    # CLAIM PRINCIPAL: Stateless contract accounts verifies everything else
    # verify claiming principal for all bonds owned
    is_all_bonds = Gtxn[1].asset_amount() == sender_bond_balance.value()
    # verify have collected all coupon payments or no coupons exists
    collected_all_coupons = Or(
        Int(args["BOND_LENGTH"]) == App.localGet(Int(0), Bytes("CouponsPayed")),
        Int(args["BOND_COUPON"]) == Int(0)
    )
    # Combine
    principal_verify = And(
        is_all_bonds,
        collected_all_coupons,
        linked_with_bond_escrow,
        linked_with_stablecoin_escrow,
        Global.latest_timestamp() >= Int(args["MATURITY_DATE"])
    )
    #
    on_principal = Seq([
        sender_bond_balance,
        Assert(principal_verify),
        Int(1)
    ])

    # CLAIM DEFAULT: Stateless contract accounts verifies everything else
    on_default = Seq([
        Int(1)
    ])

    # Can ignore creation since this program is used in update transaction
    # Fail on DeleteApplication and UpdateApplication
    # Else jump to corresponding handler
    program = Cond(
        [Txn.on_completion() == OnComplete.DeleteApplication, Int(0)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Int(0)],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_opt_in],
        [Txn.application_args[0] == Bytes("buy"), on_buy],
        [Txn.application_args[0] == Bytes("trade"), on_trade],
        [Txn.application_args[0] == Bytes("coupon"), on_coupon],
        [Txn.application_args[0] == Bytes("sell"), on_principal],
        [Txn.application_args[0] == Bytes("default"), on_default]
    )

    # Ensure call to contract is first (in atomic group)
    return And(Txn.group_index() == Int(0), program)


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Application, version=2))
