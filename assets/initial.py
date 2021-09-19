from pyteal import *


def contract(args):

    on_creation = Seq([
        # store timings
        App.globalPut(Bytes("start_buy_date"), Btoi(Txn.application_args[0])),
        App.globalPut(Bytes("end_buy_date"), Btoi(Txn.application_args[1])),
        App.globalPut(Bytes("maturity_date"), Btoi(Txn.application_args[2])),
        # verify timings
        Assert(App.globalGet(Bytes("start_buy_date")) < App.globalGet(Bytes("end_buy_date"))),
        Assert(App.globalGet(Bytes("end_buy_date")) < App.globalGet(Bytes("maturity_date"))),
        # store bond params
        App.globalPut(Bytes("bond_id"), Btoi(Txn.application_args[3])),
        App.globalPut(Bytes("bond_coupon"), Btoi(Txn.application_args[4])),
        App.globalPut(Bytes("bond_principal"), Btoi(Txn.application_args[5])),
        App.globalPut(Bytes("bond_length"), Btoi(Txn.application_args[6])),
        App.globalPut(Bytes("bond_cost"), Btoi(Txn.application_args[7])),
        # verify bond params
        Assert(App.globalGet(Bytes("bond_length")) <= Int(100)),
        # store addresses
        App.globalPut(Bytes("issuer_addr"), Txn.application_args[8]),
        App.globalPut(Bytes("financial_regulator_addr"), Txn.application_args[9]),
        App.globalPut(Bytes("green_verifier_addr"), Txn.application_args[10]),
        # initialise an array with 100 bytes for 100 integer elements
        App.globalPut(
            Bytes("ratings"),
            Bytes("base16", "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000")
        ),
        Int(1)
    ])

    on_update = Seq([
        Assert(Txn.sender() == Global.creator_address()),
        App.globalPut(Bytes("stablecoin_escrow_addr"), Txn.application_args[0]),
        App.globalPut(Bytes("bond_escrow_addr"), Txn.application_args[1]),
        Int(1)
    ])

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.UpdateApplication, on_update],
    )

    return And(Global.group_size() == Int(1), program)


if __name__ == "__main__":
    params = {}

    print(compileTeal(contract(params), Mode.Application, version=4))
