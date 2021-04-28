from pyteal import *


def contract(args):

    on_creation = Seq([
        Assert(Txn.application_args.length() == Int(8)),
        App.globalPut(Bytes("IssuerAddr"), Txn.application_args[0]),
        App.globalPut(Bytes("StartBuyDate"), Btoi(Txn.application_args[1])),
        App.globalPut(Bytes("EndBuyDate"), Btoi(Txn.application_args[2])),
        App.globalPut(Bytes("BondLength"), Btoi(Txn.application_args[3])),  # no of 6 month periods
        App.globalPut(Bytes("BondId"), Btoi(Txn.application_args[4])),
        App.globalPut(Bytes("BondCost"), Btoi(Txn.application_args[5])),
        App.globalPut(Bytes("BondCouponPaymentValue"), Btoi(Txn.application_args[6])),  # 0 if no coupon
        App.globalPut(Bytes("BondPrincipal"), Btoi(Txn.application_args[7])),
        App.globalPut(Bytes("MaturityDate"), Add(
            App.globalGet(Bytes("EndBuyDate")),
            Int(args["SIX_MONTH_PERIOD"]) * App.globalGet(Bytes("BondLength"))
        )),
        Int(1)
    ])

    on_update = Txn.sender() == Global.creator_address()  # TODO: TEAL 3
    # on_update = Int(1)

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.UpdateApplication, on_update],
    )

    return And(Global.group_size() == Int(1), program)


if __name__ == "__main__":
    params = {
        "SIX_MONTH_PERIOD": 15768000
    }
    print(compileTeal(contract(params), Mode.Application, version=3))
