from __future__ import annotations


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("names and images are not empty")


class _Pod:
    """A pod owns its containers: they are created inside it and go with it."""

    def __init__(self) -> None:
        self.containers: dict[str, str] = {}


class PodRegistry:
    def __init__(self) -> None:
        self._pods: dict[str, _Pod] = {}
        self._pod_of: dict[str, str] = {}
        self._sidecars: dict[str, str] = {}

    def createPod(self, pod: str) -> None:
        _named(pod)
        if pod in self._pods:
            raise ValueError("pod already exists")
        injected = {f"{pod}-{name}": image for name, image in self._sidecars.items()}
        if any(name in self._pod_of for name in injected):
            raise ValueError("a sidecar's name is taken")
        self._pods[pod] = _Pod()
        for name, image in injected.items():
            self._place(pod, name, image)

    def _place(self, pod: str, container: str, image: str) -> None:
        self._pods[pod].containers[container] = image
        self._pod_of[container] = pod

    def addContainer(self, pod: str, container: str, image: str) -> bool:
        _named(pod, container, image)
        if pod not in self._pods or container in self._pod_of:
            return False
        self._place(pod, container, image)
        return True

    def removePod(self, pod: str) -> int:
        _named(pod)
        owned = self._pods.pop(pod, None)
        if owned is None:
            raise ValueError("unknown pod")
        for container in owned.containers:
            del self._pod_of[container]
        return len(owned.containers)

    def podOf(self, container: str) -> str | None:
        _named(container)
        return self._pod_of.get(container)

    def images(self) -> list[str]:
        return sorted({image for pod in self._pods.values() for image in pod.containers.values()})

    # The extension round: containers injected into every pod created afterwards.
    def sidecar(self, container: str, image: str) -> None:
        _named(container, image)
        if container in self._sidecars:
            raise ValueError("sidecar already registered")
        self._sidecars[container] = image
