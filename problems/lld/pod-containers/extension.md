# Pods and containers: sidecars (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The cluster injects sidecars: helper containers that every new pod gets automatically.

- `sidecar(container, image)`: from now on, every pod that `createPod` creates also gets
  a container named `<pod>-<container>` (the pod's name, a hyphen and `container`)
  running `image`, owned by that pod like any other. Pods that already exist don't get
  it. A second sidecar with the same `container` fails, and so does an empty `container`
  or `image`.
- With several sidecars, a new pod gets all of them.
- If any of a new pod's sidecar names is already taken by an existing container,
  `createPod` fails and creates nothing: neither the pod nor any of its sidecars.
- Sidecar containers count in `removePod`, `podOf` and `images` like any other.
