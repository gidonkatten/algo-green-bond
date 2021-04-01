export ADDR_CREATOR="YOURACCOUNTIDENTIFIERGOESHERE"

export TEAL_APPROVAL_PROG="approval_program.teal"
export TEAL_CLEAR_PROG="clear_state_program.teal"

export GLOBAL_BYTESLICES=0
export GLOBAL_INTS=1
export LOCAL_BYTESLICES=0
export LOCAL_INTS=0

goal app create --creator $ADDR_CREATOR \
                --approval-prog $TEAL_APPROVAL_PROG \
                --clear-prog $TEAL_CLEAR_PROG \
                --global-byteslices $GLOBAL_BYTESLICES \
                --global-ints $GLOBAL_INTS \
                --local-byteslices $LOCAL_BYTESLICES \
                --local-ints $LOCAL_INTS 