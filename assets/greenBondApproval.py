from pyteal import *


def contract(args):
    # Verify 8 args passed and store them
    on_creation = Seq([
        App.globalPut(Bytes("Creator"), Txn.sender()),
        Assert(Txn.application_args.length() == Int(8)),
        App.globalPut(Bytes("StartBuyDate"), Btoi(Txn.application_args[0])),
        App.globalPut(Bytes("EndBuyDate"), Btoi(Txn.application_args[1])),
        App.globalPut(Bytes("MaturityDate"), Btoi(Txn.application_args[2])),
        App.globalPut(Bytes("BondID"), Btoi(Txn.application_args[3])),
        App.globalPut(Bytes("BondCost"), Btoi(Txn.application_args[4])),
        App.globalPut(Bytes("BondCouponPaymentValue"), Btoi(Txn.application_args[5])),
        App.globalPut(Bytes("BondCouponInstallments"), Btoi(Txn.application_args[6])),
        App.globalPut(Bytes("BondPrincipal"), Btoi(Txn.application_args[7])),
        Int(1)
    ])

    # TODO
    on_closeout = Int(0)

    # Approve if only transaction in group
    on_opt_in = Seq([
        Assert(Global.group_size() == Int(1)),
        Int(1)
    ])

    # If before start date then can set the stablecoin contract account address
    on_set_stablecoin_escrow = Seq([
        Assert(Global.latest_timestamp() <= App.globalGet(Bytes("StartBuyDate"))),
        App.globalPut(Bytes("StablecoinEscrowAddr"), Txn.application_args[1]),
        Int(1)
    ])

    # BUY: verify there are four transactions in atomic transfer
    # 0. call to this contract (verified below)
    # 1. transfer of bond from bond contract account to buyer
    buy_bond_transfer = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Gtxn[1].sender(),
        Gtxn[1].asset_receiver() == Txn.sender(),
        Gtxn[1].xfer_asset() == App.globalGet(Bytes("BondID"))
    )
    # 2. transfer of algos from buyer to bond contract account (fee of tx1)
    buy_fee_transfer = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].sender() == Txn.sender(),
        Gtxn[2].receiver() == Gtxn[1].sender(),
        Gtxn[2].amount() >= Gtxn[1].fee(),
    )
    # 3. transfer of USDC from buyer to stablecoin contract account (NoOfBonds * BondCost)
    buy_stablecoin_transfer = And(
        Gtxn[3].type_enum() == TxnType.AssetTransfer,
        Gtxn[3].sender() == Txn.sender(),
        Gtxn[3].asset_receiver() == App.globalGet(Bytes("StablecoinEscrowAddr")),  # TODO: Update receiver addr
        Gtxn[3].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[3].asset_amount() == Mul(Gtxn[1].asset_amount(), App.globalGet(Bytes("BondCost")))
    )
    # verify in buy period
    in_buy_period = And(
        Global.latest_timestamp() >= App.globalGet(Bytes("StartBuyDate")),
        Global.latest_timestamp() <= App.globalGet(Bytes("EndBuyDate"))

    )
    # Combine
    buy_verify = And(
        Global.group_size() == Int(4),
        buy_bond_transfer,
        buy_fee_transfer,
        buy_stablecoin_transfer,
        in_buy_period
    )
    # Update how many bonds owned in account
    on_buy = Seq([
        Assert(buy_verify),
        App.localPut(
            Int(0),
            Bytes("NoOfBondsOwned"),
            Add(App.localGet(Int(0), Bytes("NoOfBondsOwned")), Gtxn[1].asset_amount())
        ),
        Int(1)
    ])

    # TRADE: verify there are at least three transactions in atomic transfer
    # 0. call to this contract (verified below)
    # 1. transfer of bond from sender to account 2
    trade_bond_transfer = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Txn.sender(),
        Gtxn[1].asset_receiver() == Txn.accounts[1],
        App.globalGet(Bytes("BondID")) == Gtxn[1].xfer_asset()
    )
    # 2. transfer of algos from sender to bond contract account (fee of tx1)
    trade_fee_transfer = And(
        Gtxn[2].type_enum() == TxnType.Payment,
        Gtxn[2].sender() == Txn.sender(),
        Gtxn[2].receiver() == Gtxn[1].sender(),
        Gtxn[2].amount() >= Gtxn[1].fee(),
    )
    # 3,4,... Optional (e.g for payment when transferring bonds)
    # TODO: verify both parties have collected same number of coupon installments
    # Combine
    trade_verify = And(
        Global.group_size() >= Int(3),
        trade_bond_transfer,
        trade_fee_transfer,
    )
    # Update how many bonds owned in each account
    on_trade = Seq([
        Assert(trade_verify),
        App.localPut(
            Int(0),
            Bytes("NoOfBondsOwned"),
            Minus(App.localGet(Int(0), Bytes("NoOfBondsOwned")), Gtxn[1].asset_amount())
        ),
        App.localPut(
            Int(1),
            Bytes("NoOfBondsOwned"),
            Add(App.localGet(Int(1), Bytes("NoOfBondsOwned")), Gtxn[1].asset_amount())
        ),
        Int(1)
    ])

    # CLAIM COUPON: verify there are three transactions in atomic transfer
    # 0. call to this contract (verified below)
    # 1. transfer of algos from buyer to stablecoin contract account (fee of tx2)
    claim_coupon_fee_transfer = And(
        Gtxn[1].type_enum() == TxnType.Payment,
        Gtxn[1].sender() == Txn.sender(),
        Gtxn[1].receiver() == App.globalGet(Bytes("StablecoinEscrowAddr")),
        Gtxn[1].amount() >= Gtxn[2].fee(),
    )
    # 2. transfer of USDC from stablecoin contract account to owner
    claim_coupon_stablecoin_transfer = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].sender() == App.globalGet(Bytes("StablecoinEscrowAddr")),
        Gtxn[2].asset_receiver() == Txn.sender(),
        Gtxn[2].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[2].asset_amount() == Mul(
            App.globalGet(Bytes("BondCouponPaymentValue")),
            App.localGet(Int(0), Bytes("NoOfBondsOwned"))
        )
    )
    # verify (Local.NoOfBondCouponPayments + 1) <= Global.BondCouponInstallments
    new_num_installments_payed = ScratchVar(TealType.uint64)
    has_not_exceeded_installments = new_num_installments_payed.load() <= \
                                    App.globalGet(Bytes("BondCouponInstallments"))
    #  verify that the installment time has passed (b <= c):
    # a = (MaturityDate - EndBuyDate) / Global.BondCouponInstallments
    # b = EndBuyDate + (a * (Local.NoOfBondCouponPayments + 1))
    # c = CurrentTime
    after_installment_date = Global.latest_timestamp() >= Add(
        App.globalGet(Bytes("EndBuyDate")),
        Mul(
            Div(
                Minus(
                    App.globalGet(Bytes("MaturityDate")),
                    App.globalGet(Bytes("EndBuyDate"))
                ),
                App.globalGet(Bytes("BondCouponInstallments"))
            ),
            new_num_installments_payed.load()
        )
    )
    # Combine
    claim_coupon_verify = And(
        Global.group_size() == Int(3),
        claim_coupon_fee_transfer,
        claim_coupon_stablecoin_transfer,
        has_not_exceeded_installments,
        after_installment_date
    )
    # Update how many bond coupon payments
    on_claim_coupon = Seq([
        new_num_installments_payed.store(
            Add(App.localGet(Int(0), Bytes("NoOfBondCouponPayments")), Int(1))
        ),
        Assert(claim_coupon_verify),
        App.localPut(
            Int(0),
            Bytes("NoOfBondCouponPayments"),
            new_num_installments_payed.load()
        ),
        Int(1)
    ])

    # CLAIM PRINCIPAL: verify there are four transactions in atomic transfer
    # 0. call to this contract (verified below)
    # 1. transfer of bond from sender to bond contract account (all bonds owned + opting out)
    claim_principal_bond_transfer = And(
        Gtxn[1].type_enum() == TxnType.AssetTransfer,
        Gtxn[1].asset_sender() == Txn.sender(),
        Gtxn[1].asset_receiver() == Gtxn[1].sender(),
        Gtxn[1].xfer_asset() == App.globalGet(Bytes("BondID")),
        Gtxn[1].asset_amount() == App.localGet(Int(0), Bytes("NoOfBondsOwned")),
        Gtxn[1].asset_close_to() == Gtxn[1].sender()
    )
    # 2. transfer of USDC from stablecoin contract account to sender (NoOfBonds * BondPrincipal)
    claim_principal_stablecoin_transfer = And(
        Gtxn[2].type_enum() == TxnType.AssetTransfer,
        Gtxn[2].sender() == App.globalGet(Bytes("StablecoinEscrowAddr")),
        Gtxn[2].asset_receiver() == Txn.sender(),
        Gtxn[2].xfer_asset() == Int(args["STABLECOIN_ID"]),
        Gtxn[2].asset_amount() == Mul(Gtxn[1].asset_amount(), App.globalGet(Bytes("BondPrincipal")))
    )
    # 3. transfer of algos from sender to contract account (fee of tx1)
    claim_principal_fee_transfer1 = And(
        Gtxn[3].type_enum() == TxnType.Payment,
        Gtxn[3].sender() == Txn.sender(),
        Gtxn[3].receiver() == Gtxn[1].sender(),
        Gtxn[3].amount() >= Gtxn[1].fee(),
    )
    # 4. transfer of algos from sender to contract account (fee of tx2)
    claim_principal_fee_transfer2 = And(
        Gtxn[4].type_enum() == TxnType.Payment,
        Gtxn[4].sender() == Txn.sender(),
        Gtxn[4].receiver() == Gtxn[2].sender(),
        Gtxn[4].amount() >= Gtxn[2].fee(),
    )
    # verify have collected all coupon payments
    collected_all_coupons = App.globalGet(Bytes("BondCouponInstallments")) == \
                            App.localGet(Int(0), Bytes("NoOfBondCouponPayments"))
    # Combine
    claim_principal_verify = And(
        Global.group_size() == Int(5),
        claim_principal_bond_transfer,
        claim_principal_stablecoin_transfer,
        claim_principal_fee_transfer1,
        claim_principal_fee_transfer2,
        collected_all_coupons,
        Global.latest_timestamp() >= App.globalGet(Bytes("MaturityDate")),
    )
    # Update how many bonds owned in account
    on_claim_principal = Seq([
        Assert(claim_principal_verify),
        App.localPut(
            Int(0),
            Bytes("NoOfBondsOwned"),
            Int(0)
        ),
        Int(1)
    ])

    # Fail on DeleteApplication and UpdateApplication
    # Else jump to corresponding handler
    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, Int(0)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Int(0)],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_opt_in],
        [Txn.application_args[0] == Bytes("set_stablecoin_escrow"), on_set_stablecoin_escrow],
        [Txn.application_args[0] == Bytes("buy"), on_buy],
        [Txn.application_args[0] == Bytes("trade"), on_trade],
        [Txn.application_args[0] == Bytes("claim_coupon"), on_claim_coupon],
        [Txn.application_args[0] == Bytes("claim_principal"), on_claim_principal]
    )

    # Ensure call to contract is first (in atomic group)
    return And(Txn.group_index() == Int(0), program)


if __name__ == "__main__":
    params = {
        "STABLECOIN_ID": 2
    }
    print(compileTeal(contract(params), Mode.Application))  # For Stateful contract, use Mode.Application