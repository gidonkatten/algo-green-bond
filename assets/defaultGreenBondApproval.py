from pyteal import *


def contract(args):
    return Int(1)


if __name__ == "__main__":
    params = {}

    print(compileTeal(contract(params), Mode.Application, version=2))
