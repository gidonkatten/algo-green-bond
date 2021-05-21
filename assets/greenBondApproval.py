import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):
    # TODO: Verify no rekey, close out etc

    sender_bond_balance = AssetHolding.balance(Int(0), Int(args["BOND_ID"]))

    # Sender is stateless contract account (clawback)
    linked_with_bond_escrow = Gtxn[2].sender() == Addr(args["BOND_ESCROW_ADDR"])
    linked_with_stablecoin_escrow = Gtxn[3].sender() == Addr(args["STABLECOIN_ESCROW_ADDR"])

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

    # SET TRADE: arg is number of bonds willing to trade
    on_set_trade = Seq([
        App.localPut(Int(0), Bytes("trade"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # TRADE: Stateless contract account verifies everything else
    in_trade_window = Global.latest_timestamp() > Int(args["END_BUY_DATE"])
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
    # update number of bonds owner willing to trade
    # will fail with negative unit if trading too many bonds
    update_trade = App.localPut(
        Int(0),
        Bytes("trade"),
        App.localGet(Int(0), Bytes("trade")) - Gtxn[2].asset_amount()
    )
    #
    on_trade = Seq([
        Assert(And(linked_with_bond_escrow, in_trade_window)),
        has_same_num_installments,
        update_trade,
        Int(1)
    ])

    # CLAIM COUPON: Stateless contract accounts verifies everything else
    # check star rating
    coupons_payed = App.localGet(Int(0), Bytes("CouponsPayed"))
    array_slot = (coupons_payed + Int(1)) / Int(8)
    index_slot = (coupons_payed + Int(1)) % Int(8)
    array = App.globalGetEx(Int(0), Itob(array_slot))  # May need to initialise
    star_rating = GetByte(
         If(array.hasValue(), array.value(), Bytes("base16", "0x0000000000000000")),
         index_slot
    )
    penalty = Int(5) - star_rating  # TODO: How to treat star rating of 0?

    # verify transfer of USDC is correct amount
    coupon_stablecoin_transfer = Gtxn[3].asset_amount() == Mul(
        # Int(args["BOND_COUPON"]) * penalty * Int(11) / Int(10),  # Increase by 10% for every dropped star
        Int(args["BOND_COUPON"]),  # TODO: Delete for TEAL3
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
    owed_coupon = coupons_payed < coupon_round
    # Combine
    coupon_verify = And(
        # Txn.applications[1] == Int(args["MANAGE_APP_ID"]),  # TODO: TEAL 3
        coupon_stablecoin_transfer,
        owed_coupon,
        linked_with_stablecoin_escrow
    )
    # Update how many bond coupon payments locally and globally
    on_coupon = Seq([
        sender_bond_balance,
        array,
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
    is_all_bonds = Gtxn[2].asset_amount() == sender_bond_balance.value()
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
        App.localDel(Int(0), Bytes("CouponsPayed")),
        Int(1)
    ])

    # CLAIM DEFAULT: Stateless contract accounts verifies everything else
    # verify transfer of USDC is correct amount
    default_verify = And(
        is_all_bonds,
        linked_with_bond_escrow,
        linked_with_stablecoin_escrow
    )
    coupons_missed = Mul(
        sender_bond_balance.value(),
        Int(args["BOND_LENGTH"]) - App.localGet(Int(0), Bytes("CouponsPayed"))
    )
    on_default = Seq([
        sender_bond_balance,
        Assert(default_verify),
        App.localDel(Int(0), Bytes("CouponsPayed")),
        App.globalPut(
            Bytes("TotCouponsPayed"),
            App.globalGet(Bytes("TotCouponsPayed")) + coupons_missed  # as if payed coupons off
        ),
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
        [Txn.application_args[0] == Bytes("set_trade"), on_set_trade],
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
