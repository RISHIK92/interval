from __future__ import annotations


class LegacyStore:
    """The old flat key-value store: no buckets, no folders, just keys."""

    def __init__(self) -> None:
        self._data: dict[str, str] = {}

    def put(self, key: str, value: str) -> None:
        self._data[key] = value

    def read(self, key: str) -> str | None:
        return self._data.get(key)

    def scan(self, prefix: str) -> list[str]:
        return sorted(key for key in self._data if key.startswith(prefix))


def _bucket(bucket: str) -> None:
    if bucket == "" or ":" in bucket:
        raise ValueError("bad bucket")


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class BucketAdapter:
    """Gives the legacy store a bucket-and-key API. The encoding is the adapter's alone:
    an object lives at `<bucket>:<key>`, and a bucket never holds a `:`, so the first one
    splits them."""

    def __init__(self) -> None:
        self._store = LegacyStore()

    def putObject(self, bucket: str, key: str, body: str) -> None:
        _bucket(bucket)
        _given(key)
        _given(body)
        self._store.put(_legacy(bucket, key), body)

    def objectBody(self, bucket: str, key: str) -> str | None:
        _bucket(bucket)
        _given(key)
        return self._store.read(_legacy(bucket, key))

    def listObjects(self, bucket: str, prefix: str, delimiter: str) -> list[str]:
        _bucket(bucket)
        found: set[str] = set()
        for legacy in self._store.scan(_legacy(bucket, prefix)):
            key = legacy[len(bucket) + 1 :]
            # S3's common prefixes: what follows the prefix, up to its first delimiter.
            cut = key.find(delimiter, len(prefix))
            if delimiter and cut >= 0:
                key = key[: cut + len(delimiter)]
            found.add(key)
        return sorted(found)

    def legacyKeys(self) -> list[str]:
        return self._store.scan("")

    # The extension round: a copy, through the same encoding.
    def copyObject(self, bucket: str, key: str, toBucket: str, toKey: str) -> bool:
        _bucket(bucket)
        _given(key)
        _bucket(toBucket)
        _given(toKey)
        body = self._store.read(_legacy(bucket, key))
        if body is None:
            return False
        self._store.put(_legacy(toBucket, toKey), body)
        return True


def _legacy(bucket: str, key: str) -> str:
    return f"{bucket}:{key}"
