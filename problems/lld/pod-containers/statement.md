# Pods and containers

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the registry of a cluster's pods. A pod owns its containers: a container is created
inside one pod, lives as long as that pod does, and goes when the pod is removed. A
container never exists without a pod, and never moves to another one.

Container names are unique across the whole registry, not only within a pod. A removed
container's name is free again.

- `PodRegistry()`: starts with no pods.
- `createPod(pod)`: creates a pod with no containers. A pod name already in use fails.
- `addContainer(pod, container, image)`: creates a container in the pod, running `image`,
  and returns true. It returns false and changes nothing when no pod has that name, or
  when a container with that name already exists in any pod.
- `removePod(pod)`: removes the pod and every container in it, and returns how many
  containers went with it. An unknown pod fails.
- `podOf(container)`: the name of the pod the container is in, or null when no container
  has that name.
- `images()`: the images of every existing container, each image once, sorted in
  ascending order by character code (`"B"` before `"a"`); an empty list with no
  containers.

Pod and container names are separate: a pod and a container may share a name. An empty
pod, container or image fails in every call, and a call that fails changes nothing. Names
and images are printable ASCII and case-sensitive, and there are at most 10^4 calls.
