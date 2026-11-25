> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a container can only ever be created inside a pod, where should its data live so that removing the pod can't leave it behind?

## Approach

Keep each pod's containers inside the pod itself (container name to image), so removing the pod takes them with it. Uniqueness is across pods, so keep one more map from container name to pod name and update it in the same place you add or remove a container; it answers `podOf` and the "name taken" check. `removePod` walks the pod's own containers to drop them from that index before returning how many there were. `images` collects every pod's images into a set and sorts it.

## Code sketch

```text
class PodRegistry
  pods: map pod -> map container -> image
  podByContainer: map container -> pod

  createPod(pod)
    // TODO: fail on empty or existing pod
  addContainer(pod, container, image) -> bool
    // TODO: fail on empty strings
    // TODO: false when pod unknown or container taken
    // TODO: pods[pod][container] = image; podByContainer[container] = pod
  removePod(pod) -> int
    // TODO: fail when unknown
    // TODO: drop each of its containers from podByContainer
    // TODO: remove the pod; return how many it held
  podOf(container) -> optional
    // TODO: podByContainer[container] or null
  images() -> list
    // TODO: every image once, sorted
```
