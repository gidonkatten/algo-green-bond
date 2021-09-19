from pyteal import *


@Subroutine(TealType.uint64)
def get_rating_round(time):
    time_stored = ScratchVar(TealType.uint64)
    # Error if past maturity date
    return Seq([
        time_stored.store(time),
        Cond(
            [time_stored.load() < App.globalGet(Bytes("end_buy_date")), Int(0)],
            [
                time_stored.load() <= App.globalGet(Bytes("maturity_date")),
                Div(
                    time_stored.load() - App.globalGet(Bytes("end_buy_date")),
                    App.globalGet(Bytes("period"))
                ) + Int(1)
            ]
        )
    ])


@Subroutine(TealType.uint64)
def get_coupon_rounds(time):
    time_stored = ScratchVar(TealType.uint64)
    return Seq([
        time_stored.store(time),
        Cond(
            [time_stored.load() < App.globalGet(Bytes("end_buy_date")), Int(0)],
            [time_stored.load() > App.globalGet(Bytes("maturity_date")), App.globalGet(Bytes("bond_length"))],
            [
                Int(1),  # must be between end_buy_date and maturity_date
                Div(
                    time_stored.load() - App.globalGet(Bytes("end_buy_date")),
                    App.globalGet(Bytes("period"))
                )
            ]
        )
    ])


@Subroutine(TealType.uint64)
def get_multiplier(rating):
    rating_stored = ScratchVar(TealType.uint64)
    return Seq([
        rating_stored.store(rating),
        Cond(
            [rating_stored.load() == Int(5), Int(10000)],
            [rating_stored.load() == Int(4), Int(11000)],
            [rating_stored.load() == Int(3), Int(12100)],
            [rating_stored.load() == Int(2), Int(13310)],
            [rating_stored.load() == Int(1), Int(14641)],
            [rating_stored.load() == Int(0), Int(10000)]  # TODO: How to treat star rating of 0?
        )
    ])


def contract():

    # GLOBAL STATE

    # ADDRESSES
    # stablecoin_escrow_addr
    # bond_escrow_addr
    # issuer_addr
    # financial_regulator_addr
    # green_verifier_addr

    # TIMINGS
    # start_buy_date
    # end_buy_date
    # maturity_date

    # BOND
    # bond_id
    # bond_coupon
    # bond_principal
    # bond_length - how many coupon rounds there are
    # bond_cost - cost in primary market
    # frozen - is all accounts frozen (0 is frozen and non 0 is not)
    # coupons_paid - the maximum local coupons_paid across all investors (used for bond defaults)

    # OTHER
    # reserve - amount of stablecoin reserved in escrow that will be used to fund coupons (used for bond defaults)
    # ratings - an array of green ratings (length 100)
    # time - used for demo to speed up time

    # LOCAL STATE
    # trade - number of bonds account willing to trade
    # frozen - is account frozen (0 is frozen and non 0 is not)
    # coupons_paid - the number of collected coupon rounds by an account

    sender_bond_balance = AssetHolding.balance(Int(0), App.globalGet(Bytes("bond_id")))
    bond_escrow_balance = AssetHolding.balance(Int(1), App.globalGet(Bytes("bond_id")))
    stablecoin_escrow_balance = AssetHolding.balance(Int(2), App.globalGet(Bytes("stablecoin_id")))
    bond_total = AssetParam.total(App.globalGet(Bytes("bond_id")))
    num_bonds_in_circ = bond_total.value() - bond_escrow_balance.value()

    # link with escrow
    linked_with_bond_escrow = Gtxn[1].sender() == App.globalGet(Bytes("bond_escrow_addr"))
    linked_with_stablecoin_escrow = Gtxn[2].sender() == App.globalGet(Bytes("stablecoin_escrow_addr"))

    # time
    maybe_time = App.globalGetEx(Int(0), Bytes("time"))
    time = If(
        maybe_time.hasValue(),
        maybe_time.value(),
        Global.latest_timestamp()
    )

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

    # ADVANCE TIME: arg is new time
    new_time = Btoi(Txn.application_args[1])
    on_advance_time = Seq([
        Assert(Global.group_size() == Int(1)),
        # time must be advancing
        maybe_time,
        If(
            maybe_time.hasValue(),
            Assert(new_time > maybe_time.value()),
            Assert(new_time > Global.latest_timestamp())
        ),
        # update time
        App.globalPut(Bytes("time"), new_time),
        Int(1)
    ])

    # SET TRADE: arg is number of bonds willing to trade
    on_set_trade = Seq([
        Assert(Global.group_size() == Int(1)),
        App.localPut(Int(0), Bytes("trade"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # FREEZE: one address - 0 is frozen and non 0 is not
    on_freeze = Seq([
        Assert(Global.group_size() == Int(1)),
        Assert(Txn.sender() == App.globalGet(Bytes("financial_regulator_addr"))),
        App.localPut(Int(1), Bytes("frozen"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # FREEZE_ALL: everyone - 0 is frozen and non 0 is not
    on_freeze_all = Seq([
        Assert(Global.group_size() == Int(1)),
        Assert(Txn.sender() == App.globalGet(Bytes("financial_regulator_addr"))),
        App.globalPut(Bytes("frozen"), Btoi(Txn.application_args[1])),
        Int(1)
    ])

    # RATE
    rating_passed = Btoi(Txn.application_args[1])
    verify_rating_passed = And(rating_passed >= Int(1), rating_passed <= Int(5))
    # Update
    on_rate = Seq([
        Assert(Global.group_size() == Int(1)),
        maybe_time,
        Assert(verify_rating_passed),
        Assert(Txn.sender() == App.globalGet(Bytes("green_verifier_addr"))),
        App.globalPut(
            Bytes("ratings"),
            SetByte(
                App.globalGet(Bytes("ratings")),
                get_rating_round(time),
                rating_passed
            )
        ),
        Int(1)
    ])

    # BUY: 3 txns
    # tx1: transfer of bond from bond escrow to buyer
    buy_bond_transfer = And(
        linked_with_bond_escrow,
        Gtxn[1].asset_sender() == Gtxn[1].sender(),  # clawback from itself
        Gtxn[1].asset_receiver() == Gtxn[0].sender(),
    )
    # tx2: transfer of USDC from buyer to issuer account (NoOfBonds * BondCost)
    buy_stablecoin_transfer = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].sender() == Gtxn[0].sender(),
        Gtxn[2].asset_receiver() == App.globalGet(Bytes("issuer_addr")),
        Gtxn[2].xfer_asset() == App.globalGet(Bytes("stablecoin_id")),
        Gtxn[2].asset_amount() == (Gtxn[1].asset_amount() * App.globalGet(Bytes("bond_cost")))
    )
    # verify in buy period
    in_buy_period = And(
        time >= App.globalGet(Bytes("start_buy_date")),
        time <= App.globalGet(Bytes("end_buy_date"))
    )
    on_buy = Seq([
        Assert(Global.group_size() == Int(3)),
        maybe_time,
        # tx0 - call to this app
        Assert(buy_bond_transfer),  # tx1
        Assert(buy_stablecoin_transfer),  # tx2
        Assert(in_buy_period),
        Int(1)
    ])

    # TRADE: 2+ txns
    # tx1. transfer of bond from sender to account 2
    trade_bond_transfer = And(
        linked_with_bond_escrow,
        Gtxn[1].asset_sender() == Gtxn[0].sender(),
        Gtxn[1].asset_receiver() == Gtxn[0].accounts[1],
    )
    in_trade_window = time > App.globalGet(Bytes("end_buy_date"))
    receiver_approved = App.localGet(Int(1), Bytes("frozen"))
    # if receiver of bond already is an owner
    # then: verify receiver has same number of coupon payments as sender
    # else: set receiver's coupons_paid to the sender's coupons_paid
    receiver_bond_balance = AssetHolding.balance(Int(1), App.globalGet(Bytes("bond_id")))
    has_same_num_installments = Seq([
        receiver_bond_balance,
        If(
            receiver_bond_balance.value() > Int(0),
            Assert(
                App.localGet(Int(0), Bytes("coupons_paid")) ==
                App.localGet(Int(1), Bytes("coupons_paid"))
            ),
            App.localPut(
                Int(1),
                Bytes("coupons_paid"),
                App.localGet(Int(0), Bytes("coupons_paid"))
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
        Assert(Global.group_size() >= Int(2)),
        maybe_time,
        # tx0 - call to this app
        Assert(trade_bond_transfer),  # tx1
        # tx 2,3,... Optional (e.g for payment when transferring bonds)
        Assert(in_trade_window),
        Assert(receiver_approved),
        has_same_num_installments,
        update_trade,
        Int(1)
    ])

    # CLAIM COUPON: Stateless contract accounts verifies everything else
    # check star rating
    coupons_paid = App.localGet(Int(0), Bytes("coupons_paid"))
    star_rating = GetByte(App.globalGet(Bytes("ratings")), coupons_paid + Int(1))
    multiplier = get_multiplier(star_rating)
    # verify transfer of USDC is correct amount
    coupon_val = Div(App.globalGet(Bytes("bond_coupon")) * multiplier, Int(10000))
    coupon_val_stored = ScratchVar(TealType.uint64)
    coupon_stablecoin_transfer = coupon_val_stored.load() * sender_bond_balance.value()
    coupon_stablecoin_transfer_stored = ScratchVar(TealType.uint64)
    # Update local coupons paid
    update_local_cp = App.localPut(
        Int(0),
        Bytes("coupons_paid"),
        App.localGet(Int(0), Bytes("coupons_paid")) + Int(1)
    )
    # If claiming coupon for first time then update global coupons paid and reserve and verify has not defaulted
    new_coupon_update = If(
        App.localGet(Int(0), Bytes("coupons_paid")) > App.globalGet(Bytes("coupons_paid")),
        Seq([
            App.globalPut(
                Bytes("coupons_paid"),
                App.globalGet(Bytes("coupons_paid")) + Int(1)
            ),
            App.globalPut(
                Bytes("reserve"),
                App.globalGet(Bytes("reserve")) + num_bonds_in_circ * coupon_val_stored.load()
            ),
            # can afford to pay new coupon round
            stablecoin_escrow_balance,
            Assert(App.globalGet(Bytes("reserve")) <= stablecoin_escrow_balance.value())
        ])

    )
    # subtract money claimed from reserve amount
    sub_reserve = App.globalPut(
        Bytes("reserve"),
        App.globalGet(Bytes("reserve")) - coupon_stablecoin_transfer_stored.load()
    )
    #
    on_coupon = Seq([
        Assert(Global.group_size() == Int(2)),
        # setup
        maybe_time,
        Assert(Txn.accounts[1] == App.globalGet(Bytes("bond_escrow_addr"))),
        Assert(Txn.accounts[2] == App.globalGet(Bytes("stablecoin_escrow_addr"))),
        bond_total,
        sender_bond_balance,
        bond_escrow_balance,
        coupon_val_stored.store(coupon_val),
        coupon_stablecoin_transfer_stored.store(coupon_stablecoin_transfer),
        # tx0 - call to this app
        # tx1 - coupon stablecoin transfer from escrow to caller
        Assert(linked_with_stablecoin_escrow),
        Assert(Gtxn[1].asset_receiver() == Gtxn[0].sender()),
        Assert(Gtxn[1].asset_amount() == coupon_stablecoin_transfer_stored.load()),
        # owed coupon
        Assert(coupons_paid < get_coupon_rounds(time)),
        # update + check if defaulted
        update_local_cp,
        new_coupon_update,
        sub_reserve,
        Int(1)
    ])

    # CLAIM PRINCIPAL: Stateless contract accounts verifies everything else
    collected_all_coupons = Or(
        App.globalGet(Bytes("bond_length")) == App.localGet(Int(0), Bytes("coupons_paid")),
        App.globalGet(Bytes("bond_coupon")) == Int(0)
    )
    on_principal_owed = App.globalGet(Bytes("reserve")) + (num_bonds_in_circ * App.globalGet(Bytes("bond_principal")))
    #
    on_principal = Seq([
        Assert(Global.group_size() == Int(3)),
        maybe_time,
        Assert(time >= App.globalGet(Bytes("maturity_date"))),
        # setup
        Assert(Txn.accounts[1] == App.globalGet(Bytes("bond_escrow_addr"))),
        Assert(Txn.accounts[2] == App.globalGet(Bytes("stablecoin_escrow_addr"))),
        bond_total,
        sender_bond_balance,
        bond_escrow_balance,
        # tx0 - call to this app
        # tx1 - bond transfer from caller to escrow
        Assert(linked_with_bond_escrow),
        Assert(Gtxn[1].asset_sender() == Gtxn[0].sender()),
        Assert(Gtxn[1].asset_receiver() == Gtxn[1].sender()),
        Assert(Gtxn[1].asset_amount() == sender_bond_balance.value()),  # verify claiming principal for all bonds owned
        # tx2 - principal stablecoin transfer from escrow to caller
        Assert(linked_with_stablecoin_escrow),
        Assert(Gtxn[2].asset_receiver() == Gtxn[0].sender()),
        Assert(Gtxn[2].asset_amount() == (Gtxn[1].asset_amount() * App.globalGet(Bytes("bond_principal")))),
        # verify have collected all coupon payments or no coupons exists
        Assert(collected_all_coupons),
        # verify has not defaulted
        stablecoin_escrow_balance,
        Assert(on_principal_owed <= stablecoin_escrow_balance.value()),
        # update local state
        App.localDel(Int(0), Bytes("coupons_paid")),
        Int(1)
    ])

    # CLAIM DEFAULT: Stateless contract accounts verifies everything else
    stablecoin_transfer = Eq(
        Gtxn[2].asset_amount(),
        Div(
            (stablecoin_escrow_balance.value() - App.globalGet(Bytes("reserve"))) * sender_bond_balance.value(),
            num_bonds_in_circ
        )
    )
    on_default_owed = App.globalGet(Bytes("reserve")) + If(
        time >= App.globalGet(Bytes("maturity_date")),
        num_bonds_in_circ * App.globalGet(Bytes("bond_principal")),
        Int(0)
    )
    #
    on_default = Seq([
        Assert(Global.group_size() == Int(3)),
        # setup
        maybe_time,
        Assert(Txn.accounts[1] == App.globalGet(Bytes("bond_escrow_addr"))),
        Assert(Txn.accounts[2] == App.globalGet(Bytes("stablecoin_escrow_addr"))),
        bond_total,
        sender_bond_balance,
        bond_escrow_balance,
        # tx0 - call to this app
        # tx1 - bond transfer from caller to escrow
        Assert(linked_with_bond_escrow),
        Assert(Gtxn[1].asset_sender() == Gtxn[0].sender()),
        Assert(Gtxn[1].asset_receiver() == Gtxn[1].sender()),
        Assert(Gtxn[1].asset_amount() == sender_bond_balance.value()),  # verify claiming principal for all bonds owned
        # tx2 - principal stablecoin transfer from escrow to caller
        stablecoin_escrow_balance,
        Assert(linked_with_stablecoin_escrow),
        Assert(Gtxn[2].asset_receiver() == Gtxn[0].sender()),
        Assert(stablecoin_transfer),
        # verify have collected all coupons available
        Assert(App.localGet(Int(0), Bytes("coupons_paid")) == App.globalGet(Bytes("coupons_paid"))),
        # verify has defaulted
        Assert(on_default_owed > stablecoin_escrow_balance.value()),
        # update local state
        App.localDel(Int(0), Bytes("coupons_paid")),
        Int(1)
    ])

    # Can ignore creation since this program is used in update transaction
    # Fail on DeleteApplication and UpdateApplication
    # Else jump to corresponding handler
    program = Cond(
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_opt_in],
        [
            Txn.on_completion() == OnComplete.NoOp,
            Cond(
                [Txn.application_args[0] == Bytes("advance_time"), on_advance_time],
                [Txn.application_args[0] == Bytes("set_trade"), on_set_trade],
                [Txn.application_args[0] == Bytes("freeze"), on_freeze],
                [Txn.application_args[0] == Bytes("freeze_all"), on_freeze_all],
                [Txn.application_args[0] == Bytes("rate"), on_rate],
                [
                    Int(1),
                    Seq([
                        Assert(App.globalGet(Bytes("frozen")) > Int(0)),
                        Assert(App.localGet(Int(0), Bytes("frozen")) > Int(0)),
                        Cond(
                            [Txn.application_args[0] == Bytes("buy"), on_buy],
                            [Txn.application_args[0] == Bytes("trade"), on_trade],
                            [Txn.application_args[0] == Bytes("coupon"), on_coupon],
                            [Txn.application_args[0] == Bytes("sell"), on_principal],
                            [Txn.application_args[0] == Bytes("default"), on_default]
                        )
                    ])
                ]
            )
        ],
    )

    # Ensure call to contract is first (in atomic group)
    return And(Txn.group_index() == Int(0), program)


if __name__ == "__main__":
    print(compileTeal(contract(), Mode.Application, version=4))
