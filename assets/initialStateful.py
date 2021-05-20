from pyteal import *


def contract(args):

    # on_creation = Int(1)  # TODO: TEAL 3
    on_creation = Seq([
        App.globalPut(Bytes("CreatorAddr"), Txn.sender()),
        Int(1)
    ])

    # on_update = Txn.sender() == Global.creator_address()  # TODO: TEAL 3
    on_update = Txn.sender() == App.globalGet(Bytes("CreatorAddr"))

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.UpdateApplication, on_update],
    )

    return And(Global.group_size() == Int(1), program)


if __name__ == "__main__":
    params = {}

    print(compileTeal(contract(params), Mode.Application, version=2))