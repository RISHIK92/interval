# Infrastructure stack builder: tearing down (extension round)

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Preview stacks are deleted at the end of the day, and deleting a database while a service
still uses it breaks the service's last requests.

- `destroyPlan()`: every resource, written as in `plan()`, in an order that destroys each
  one only after everything that depends on it. Among the resources that could come next,
  the one whose name is smallest by character code goes first.
  - Destroying doesn't need any properties, so it works whatever `validate()` says. An
    empty stack gives an empty list.

For example, for the stack in the statement's example, `destroyPlan()` returns
`["balancer shop/store-lb", "service shop/store-app", "bucket shop/assets",
"database shop/store-db"]`.
