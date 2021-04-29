from pyteal import *
import time


def contract(args):
    # TODO: Verify no rekey, close out etc

    sender_bond_balance = AssetHolding.balance(Int(0), Int(args["BOND_ID"]))

    # Used for DEFAULT, CLAIM COUPON and CLAIM PRINCIPAL
    stablecoin_escrow_balance = AssetHolding.balance(Int(1), Int(args["STABLECOIN_ID"]))
    coupon_round = If(
        Global.latest_timestamp() > Int(args["MATURITY_DATE"]),
        Int(args["BOND_LENGTH"]),  # coupon round has max BOND_LENGTH
        Div(
            Global.latest_timestamp() - Int(args["END_BUY_DATE"]),
            Int(args["SIX_MONTH_PERIOD"])
        )
    )
    remaining_coupon_value_owed_now = Mul(
        Int(args["BOND_COUPON"]),
        Minus(
            coupon_round * App.globalGet(Bytes("NoOfBonds")),
            App.globalGet(Bytes("TotalBondCouponPayments"))
        )
    )
    remaining_principal_value_owed_now = If(
        Global.latest_timestamp() > Int(args["MATURITY_DATE"]),
        Int(args["BOND_PRINCIPAL"]) * App.globalGet(Bytes("NoOfBonds")),
        Int(0)  # 0 if not yet maturity
    )
    remaining_total_value_owed_now = remaining_coupon_value_owed_now + remaining_principal_value_owed_now
    has_defaulted = remaining_total_value_owed_now > stablecoin_escrow_balance.value()

    # Common fee transactions
    tx1_pay_fee_of_tx2 = And(
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[1].sender() == Txn.sender(),
        Gtxn[1].receiver() == Gtxn[2].sender(),
        Gtxn[1].amount() >= Gtxn[2].fee(),
    )
    tx2_pay_fee_of_tx1 = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].sender() == Txn.sender(),
        Gtxn[2].receiver() == Gtxn[1].sender(),
        Gtxn[2].amount() >= Gtxn[1].fee(),
    )
    tx3_pay_fee_of_tx1 = And(
        Gtxn[3].type_enum() == TxnType.Payment,
        Gtxn[3].sender() == Txn.sender(),
        Gtxn[3].receiver() == Gtxn[1].sender(),
        Gtxn[3].amount() >= Gtxn[1].fee(),
    )
    tx4_pay_fee_of_tx2 = And(
        Gtxn[4].type_enum() == TxnType.Payment,
        Gtxn[4].sender() == Txn.sender(),
        Gtxn[4].receiver() == Gtxn[2].sender(),
        Gtxn[4].amount() >= Gtxn[2].fee(),
    )

    # TODO
    on_closeout = Int(0)

    # Approve if only transaction in group
    on_opt_in = Seq([
        Assert(Global.group_size() == Int(1)),
        Int(1)
    ])

    # BUY: Stateless contract account verifies everything
    linked_with_bond_escrow = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Gtxn[1].sender(),  # Sender is stateless contract account (clawback)
        Gtxn[1].asset_receiver() == Txn.sender(),
        Gtxn[1].xfer_asset() == Int(args["BOND_ID"])
    )
    # verify in buy period
    in_buy_period = And(
        Global.latest_timestamp() >= Int(args["START_BUY_DATE"]),
        Global.latest_timestamp() <= Int(args["END_BUY_DATE"])
    )
    # Update how many bonds in circulation
    on_buy = Seq([
        Assert(linked_with_bond_escrow & in_buy_period),
        App.globalPut(
            Bytes("NoOfBonds"),
            App.globalGet(Bytes("NoOfBonds")) + Gtxn[1].asset_amount()
        ),
        Int(1)
    ])

    # TRADE: verify there are at least three transactions in atomic transfer
    # NOTE: Account bond trading to is specified in account array pos 1
    # 0. call to this contract (verified below)
    # 1. transfer of bond from sender to account 2
    trade_bond_transfer = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Txn.sender(),
        Gtxn[1].asset_receiver() == Txn.accounts[1],
        Int(args["BOND_ID"]) == Gtxn[1].xfer_asset()
    )
    # 2. transfer of algos from sender to bond contract account (fee of tx1)
    trade_fee_transfer = tx2_pay_fee_of_tx1
    # 3,4,... Optional (e.g for payment when transferring bonds)
    in_trade_window = And(
        Global.latest_timestamp() > Int(args["END_BUY_DATE"]),
        Global.latest_timestamp() < Int(args["MATURITY_DATE"]),
    )
    # Combine
    trade_verify = And(
        Global.group_size() >= Int(3),
        trade_bond_transfer,
        trade_fee_transfer,
        in_trade_window
    )
    # if receiver of bond already is an owner
    # then: verify receiver has same number of coupon payments as sender
    # else: set receiver's NoOfBondCouponPayments to the sender's NoOfBondCouponPayments
    receiver_bond_balance = AssetHolding.balance(Int(1), Int(args["BOND_ID"]))
    has_same_num_installments = Seq([
        receiver_bond_balance,
        If(
            receiver_bond_balance.value() > Int(0),
            Assert(
                App.localGet(Int(0), Bytes("NoOfBondCouponPayments")) ==
                App.localGet(Int(1), Bytes("NoOfBondCouponPayments"))
            ),
            App.localPut(
                Int(1),
                Bytes("NoOfBondCouponPayments"),
                App.localGet(Int(0), Bytes("NoOfBondCouponPayments"))
            )
        )
    ])
    #
    on_trade = Seq([
        Assert(trade_verify),
        has_same_num_installments,
        Int(1)
    ])

    # CLAIM COUPON: verify there are three transactions in atomic transfer
    # NOTE: StablecoinEscrow account is specified in account array pos 1
    # 0. call to this contract (verified below)
    # 1. transfer of algos from buyer to stablecoin contract account (fee of tx2)
    claim_coupon_fee_transfer = tx1_pay_fee_of_tx2
    # 2. transfer of USDC from stablecoin contract account to owner
    claim_coupon_stablecoin_transfer = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].sender() == Bytes(args["STABLECOIN_ESCROW_ADDR"]),
        Gtxn[2].asset_receiver() == Txn.sender(),
        Gtxn[2].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[2].asset_amount() == Mul(
            Int(args["BOND_COUPON"]),
            sender_bond_balance.value()
        )
    )
    # verify have not already claimed coupon:
    owed_coupon = App.localGet(Int(0), Bytes("NoOfBondCouponPayments")) < coupon_round
    # verify coupon exists
    has_coupon = Int(args["BOND_COUPON"]) > Int(0)
    # Combine
    claim_coupon_verify = And(
        Global.group_size() == Int(3),
        claim_coupon_fee_transfer,
        claim_coupon_stablecoin_transfer,
        owed_coupon,
        has_coupon,
    )
    # Update how many bond coupon payments locally and globally
    on_claim_coupon = Seq([
        stablecoin_escrow_balance,
        Assert(Bytes(args["STABLECOIN_ESCROW_ADDR"]) == Txn.accounts[1]),
        Assert(Not(has_defaulted)),
        sender_bond_balance,
        Assert(claim_coupon_verify),
        App.localPut(
            Int(0),
            Bytes("NoOfBondCouponPayments"),
            App.localGet(Int(0), Bytes("NoOfBondCouponPayments")) + Int(1)
        ),
        App.globalPut(
            Bytes("TotalBondCouponPayments"),
            App.globalGet(Bytes("TotalBondCouponPayments")) + sender_bond_balance.value()
        ),
        Int(1)
    ])

    # CLAIM PRINCIPAL: verify there are four transactions in atomic transfer
    # NOTE: StablecoinEscrow account is specified in account array pos 1
    # 0. call to this contract (verified below)
    # 1. transfer of bond from sender to bond contract account (all bonds owned + opting out)
    claim_principal_bond_transfer = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Txn.sender(),
        Gtxn[1].asset_receiver() == Gtxn[1].sender(),
        Gtxn[1].xfer_asset() == Int(args["BOND_ID"]),
        Gtxn[1].asset_amount() == sender_bond_balance.value(),
        Gtxn[1].asset_close_to() == Gtxn[1].sender()
    )
    # 2. transfer of USDC from stablecoin contract account to sender (NoOfBonds * BOND_PRINCIPAL)
    claim_principal_stablecoin_transfer = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].sender() == Bytes(args["STABLECOIN_ESCROW_ADDR"]),
        Gtxn[2].asset_receiver() == Txn.sender(),
        Gtxn[2].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[2].asset_amount() == (Gtxn[1].asset_amount() * Int(args["BOND_PRINCIPAL"]))
    )
    # 3. transfer of algos from sender to contract account (fee of tx1)
    claim_principal_fee_transfer1 = tx3_pay_fee_of_tx1
    # 4. transfer of algos from sender to contract account (fee of tx2)
    claim_principal_fee_transfer2 = tx4_pay_fee_of_tx2
    # verify have collected all coupon payments or no coupons exists
    collected_all_coupons = Or(
        Int(args["BOND_LENGTH"]) == App.localGet(Int(0), Bytes("NoOfBondCouponPayments")),
        Int(args["BOND_COUPON"]) == Int(0)
    )
    # Combine
    claim_principal_verify = And(
        Global.group_size() == Int(5),
        claim_principal_bond_transfer,
        claim_principal_stablecoin_transfer,
        claim_principal_fee_transfer1,
        claim_principal_fee_transfer2,
        collected_all_coupons,
        Global.latest_timestamp() >= Int(args["MATURITY_DATE"])
    )
    #
    on_claim_principal = Seq([
        stablecoin_escrow_balance,
        Assert(Bytes(args["STABLECOIN_ESCROW_ADDR"]) == Txn.accounts[1]),
        Assert(Not(has_defaulted)),
        sender_bond_balance,
        Assert(claim_principal_verify),
        App.globalPut(
            Bytes("NoOfBonds"),
            App.globalGet(Bytes("NoOfBonds")) - Gtxn[1].asset_amount()
        ),
        Int(1)
    ])

    # CLAIM DEFAULT: verify there are four transactions in atomic transfer
    # NOTE: StablecoinEscrow account is specified in account array pos 1
    # 0. call to this contract (verified below)
    # 1. transfer of bond from sender to bond contract account (all bonds owned + opting out)
    claim_default_bond_transfer = claim_principal_bond_transfer
    # 2. transfer of USDC from stablecoin contract account to sender (proportional to what they are owed)
    claim_default_stablecoin_transfer = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].sender() == Bytes(args["STABLECOIN_ESCROW_ADDR"]),
        Gtxn[2].asset_receiver() == Txn.sender(),
        Gtxn[2].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[2].asset_amount() == Int(1)  # TODO
    )
    # 3. transfer of algos from sender to contract account (fee of tx1)
    claim_default_fee_transfer1 = tx3_pay_fee_of_tx1
    # 4. transfer of algos from sender to contract account (fee of tx2)
    claim_default_fee_transfer2 = tx4_pay_fee_of_tx2
    # Combine
    claim_default_verify = And(
        Global.group_size() == Int(5),
        claim_default_bond_transfer,
        claim_default_stablecoin_transfer,
        claim_default_fee_transfer1,
        claim_default_fee_transfer2,
        Global.latest_timestamp() >= Int(args["MATURITY_DATE"])
    )
    #
    on_claim_default = Seq([
        stablecoin_escrow_balance,
        Assert(Bytes(args["STABLECOIN_ESCROW_ADDR"]) == Txn.accounts[1]),
        Assert(has_defaulted),
        sender_bond_balance,
        Assert(claim_default_verify),
        App.globalPut(
            Bytes("NoOfBonds"),
            App.globalGet(Bytes("NoOfBonds")) - Gtxn[1].asset_amount()
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
        [Txn.application_args[0] == Bytes("trade"), on_trade],
        [Txn.application_args[0] == Bytes("claim_coupon"), on_claim_coupon],
        [Txn.application_args[0] == Bytes("claim_principal"), on_claim_principal]
        # [Txn.application_args[0] == Bytes("claim_default"), on_claim_default]
    )

    # Ensure call to contract is first (in atomic group)
    return And(Txn.group_index() == Int(0), program)


if __name__ == "__main__":
    SIX_MONTH_PERIOD = 15768000
    BOND_LENGTH = 2  # no of 6 month periods ie 1 year

    START_BUY_DATE = round(time.time())
    END_BUY_DATE = round(time.time()) + 1000
    MATURITY_DATE = END_BUY_DATE + (SIX_MONTH_PERIOD * BOND_LENGTH)

    params = {
        "BOND_ID": 1,
        "STABLECOIN_ID": 2,
        "SIX_MONTH_PERIOD": SIX_MONTH_PERIOD,
        "BOND_LENGTH": BOND_LENGTH,
        "START_BUY_DATE": START_BUY_DATE,
        "END_BUY_DATE": END_BUY_DATE,
        "MATURITY_DATE": MATURITY_DATE,
        "STABLECOIN_ESCROW_ADDR": "CEKMFPU2TIYHSWDAAMH7X2YW7QNQ535L2T5EMLSRL4KWJV2YM6Q6LSC56E",
        "ISSUER_ADDR": "EMO2JEPSRWNAJGR62S75GQ4ICOKVNI46AYRERZPJOWYUFEYEZJ6BU5GMXY",
        "BOND_COST": 50000000,  # $50.000000
        "BOND_COUPON": 2500000,  # $2.500000 every 6 months for the BOND_LENGTH
        "BOND_PRINCIPAL": 100000000,  # $100.000000
    }
    print(compileTeal(contract(params), Mode.Application, version=3))
