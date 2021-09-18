import sys

from pyteal import *
from utils.params import params
from utils.utils import parseArgs


def contract(args):

    sender_bond_balance = AssetHolding.balance(Int(0), Int(args["BOND_ID"]))

    # Sender is stateless contract account (clawback)
    linked_with_bond_escrow = Gtxn[2].sender() == Addr(args["BOND_ESCROW_ADDR"])
    linked_with_stablecoin_escrow = Gtxn[3].sender() == Addr(args["STABLECOIN_ESCROW_ADDR"])

    # Approve if do not own any bonds
    on_closeout = Seq([
        sender_bond_balance,
        sender_bond_balance.value() == Int(0)
    ])

    # Approve if only transaction in group
    on_opt_in = Seq([
        Assert(Global.group_size() == Int(1)),
        Int(1)
    ])

    # SET TRADE: arg is number of bonds willing to trade
    on_set_trade = Seq([
        App.localPut(Int(0), Bytes("Trade"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # FREEZE: one address - 0 is frozen and non 0 is not
    on_freeze = Seq([
        Assert(Txn.sender() == Addr(args["FINANCIAL_REGULATOR_ADDR"])),
        App.localPut(Int(1), Bytes("Frozen"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # FREEZE_ALL: everyone - 0 is frozen and non 0 is not
    on_freeze_all = Seq([
        Assert(Txn.sender() == Addr(args["FINANCIAL_REGULATOR_ADDR"])),
        App.globalPut(Bytes("Frozen"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # BUY: Stateless contract account verifies everything else
    # verify in buy period
    in_buy_period = And(
        Global.latest_timestamp() >= Int(args["START_BUY_DATE"]),
        Global.latest_timestamp() <= Int(args["END_BUY_DATE"])
    )
    #
    on_buy = linked_with_bond_escrow & in_buy_period

    # TRADE: Stateless contract account verifies everything else
    in_trade_window = Global.latest_timestamp() > Int(args["END_BUY_DATE"])
    receiver_approved = App.localGet(Int(1), Bytes("Frozen")) > Int(0)
    # if receiver of bond already is an owner
    # then: verify receiver has same number of coupon payments as sender
    # else: set receiver's CouponsPaid to the sender's CouponsPaid
    receiver_bond_balance = AssetHolding.balance(Int(1), Int(args["BOND_ID"]))
    has_same_num_installments = Seq([
        receiver_bond_balance,
        If(
            receiver_bond_balance.value() > Int(0),
            Assert(
                App.localGet(Int(0), Bytes("CouponsPaid")) ==
                App.localGet(Int(1), Bytes("CouponsPaid"))
            ),
            App.localPut(
                Int(1),
                Bytes("CouponsPaid"),
                App.localGet(Int(0), Bytes("CouponsPaid"))
            )
        )
    ])
    # update number of bonds owner willing to trade
    # will fail with negative unit if trading too many bonds
    update_trade = App.localPut(
        Int(0),
        Bytes("Trade"),
        App.localGet(Int(0), Bytes("Trade")) - Gtxn[2].asset_amount()
    )
    #
    on_trade = Seq([
        Assert(And(linked_with_bond_escrow, in_trade_window, receiver_approved)),
        has_same_num_installments,
        update_trade,
        Int(1)
    ])

    # CLAIM COUPON: Stateless contract accounts verifies everything else
    # check star rating
    coupons_paid = App.localGet(Int(0), Bytes("CouponsPaid"))
    array_slot = (coupons_paid + Int(1)) / Int(8)
    index_slot = (coupons_paid + Int(1)) % Int(8)
    array = App.globalGetEx(Int(1), Itob(array_slot))  # May need to initialise
    star_rating = GetByte(
         If(array.hasValue(), array.value(), Bytes("base16", "0x0000000000000000")),
         index_slot
    )
    star_rating_stored = ScratchVar(TealType.uint64)
    multiplier = Cond(
        [star_rating_stored.load() == Int(5), Int(10000)],
        [star_rating_stored.load() == Int(4), Int(11000)],
        [star_rating_stored.load() == Int(3), Int(12100)],
        [star_rating_stored.load() == Int(2), Int(13310)],
        [star_rating_stored.load() == Int(1), Int(14641)],
        [star_rating_stored.load() == Int(0), Int(10000)]  # TODO: How to treat star rating of 0?
    )

    # verify transfer of USDC is correct amount
    coupon_val = Div(Int(args["BOND_COUPON"]) * multiplier, Int(10000))
    coupon_val_stored = ScratchVar(TealType.uint64)
    coupon_stablecoin_transfer = coupon_val_stored.load() * sender_bond_balance.value()
    coupon_stablecoin_transfer_stored = ScratchVar(TealType.uint64)
    has_paid_coupons = Gtxn[3].asset_amount() == coupon_stablecoin_transfer_stored.load()
    # verify have not already claimed coupon - fail with neg unit if before end buy date:
    coupon_round = If(
        Global.latest_timestamp() >= Int(args["MATURITY_DATE"]),
        Int(args["BOND_LENGTH"]),  # coupon round is max BOND_LENGTH
        Div(
            Global.latest_timestamp() - Int(args["END_BUY_DATE"]),
            Int(args["PERIOD"])
        )
    )
    owed_coupon = coupons_paid < coupon_round
    # Combine
    coupon_verify = And(
        Txn.accounts[1] == Addr(args["BOND_ESCROW_ADDR"]),
        Txn.applications[1] == Int(args["MANAGE_APP_ID"]),
        Txn.assets[0] == Int(args["BOND_ID"]),
        has_paid_coupons,
        owed_coupon,
        linked_with_stablecoin_escrow
    )
    # Update local coupons paid
    update_local_cp = App.localPut(
        Int(0),
        Bytes("CouponsPaid"),
        App.localGet(Int(0), Bytes("CouponsPaid")) + Int(1)
    )
    # If claiming coupon for first time then update global coupons paid and reserve
    bond_escrow_balance = AssetHolding.balance(Int(1), Int(args["BOND_ID"]))
    bond_total = AssetParam.total(Int(0))
    num_bonds_in_circ = bond_total.value() - bond_escrow_balance.value()
    new_coupon_update = If(
        App.localGet(Int(0), Bytes("CouponsPaid")) > App.globalGet(Bytes("CouponsPaid")),
        Seq([
            App.globalPut(
                Bytes("CouponsPaid"),
                App.globalGet(Bytes("CouponsPaid")) + Int(1)
            ),
            App.globalPut(
                Bytes("Reserve"),
                App.globalGet(Bytes("Reserve")) + num_bonds_in_circ * coupon_val_stored.load()
            )
        ])

    )
    # subtract money claimed from reserve amount
    sub_reserve = App.globalPut(
        Bytes("Reserve"),
        App.globalGet(Bytes("Reserve")) - coupon_stablecoin_transfer_stored.load()
    )
    #
    on_coupon = Seq([
        array,
        star_rating_stored.store(star_rating),
        sender_bond_balance,
        coupon_val_stored.store(coupon_val),
        coupon_stablecoin_transfer_stored.store(coupon_stablecoin_transfer),
        bond_escrow_balance,
        bond_total,
        Assert(coupon_verify),
        update_local_cp,
        new_coupon_update,
        sub_reserve,
        Int(1)
    ])

    # CLAIM PRINCIPAL: Stateless contract accounts verifies everything else
    # verify claiming principal for all bonds owned
    is_all_bonds = Gtxn[2].asset_amount() == sender_bond_balance.value()
    # verify have collected all coupon payments or no coupons exists
    collected_all_coupons = Or(
        Int(args["BOND_LENGTH"]) == App.localGet(Int(0), Bytes("CouponsPaid")),
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
        App.localDel(Int(0), Bytes("CouponsPaid")),
        Int(1)
    ])

    # CLAIM DEFAULT: Stateless contract accounts verifies everything else
    # verify have collected all coupons available
    collected_available_coupons = App.localGet(Int(0), Bytes("CouponsPaid")) == App.globalGet(Bytes("CouponsPaid"))
    # combine
    default_verify = And(
        collected_available_coupons,
        is_all_bonds,
        linked_with_bond_escrow,
        linked_with_stablecoin_escrow
    )
    on_default = Seq([
        sender_bond_balance,
        Assert(default_verify),
        App.localDel(Int(0), Bytes("CouponsPaid")),
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
        [Txn.application_args[0] == Bytes("set_trade"), on_set_trade],
        [Txn.application_args[0] == Bytes("freeze"), on_freeze],
        [Txn.application_args[0] == Bytes("freeze_all"), on_freeze_all],
        [Int(1), Seq([
            Assert(And(
                App.globalGet(Bytes("Frozen")) > Int(0),
                App.localGet(Int(0), Bytes("Frozen")) > Int(0),
            )),
            Cond(
                [Txn.application_args[0] == Bytes("buy"), on_buy],
                [Txn.application_args[0] == Bytes("trade"), on_trade],
                [Txn.application_args[0] == Bytes("coupon"), on_coupon],
                [Txn.application_args[0] == Bytes("sell"), on_principal],
                [Txn.application_args[0] == Bytes("default"), on_default]
            )
        ])]
    )

    # Ensure call to contract is first (in atomic group)
    return And(Txn.group_index() == Int(0), program)


if __name__ == "__main__":
    # Overwrite params if sys.argv[1] is passed
    if len(sys.argv) > 1:
        params = parseArgs(sys.argv[1], params)

    print(compileTeal(contract(params), Mode.Application, version=4))
