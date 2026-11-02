"""Valkey for match results (P3-W15-S05, ADR-0033): the relay's list calls and the
stage's read, with redis-py's connection failures raised as Python's ConnectionError so
the logic never sees the driver (ADR-0012)."""

from collections.abc import Callable
from typing import cast

import redis
from redis import exceptions as redis_errors


class RedisResults:
    def __init__(self, url: str) -> None:
        # redis-py leaves from_url's **kwargs untyped.
        self._client = redis.Redis.from_url(url)  # pyright: ignore[reportUnknownMemberType]

    def _call[T](self, call: Callable[[], T]) -> T:
        try:
            return call()
        except (redis_errors.ConnectionError, redis_errors.TimeoutError) as error:
            raise ConnectionError(str(error)) from error

    def blmove(
        self, first_list: str, second_list: str, timeout: int, src: str, dest: str
    ) -> bytes | None:
        return cast(
            bytes | None,
            self._call(
                lambda: self._client.blmove(first_list, second_list, timeout, src, dest)
            ),
        )

    def lrange(self, name: str, start: int, end: int) -> list[bytes]:
        return cast(
            list[bytes], self._call(lambda: self._client.lrange(name, start, end))
        )

    def lrem(self, name: str, count: int, value: bytes) -> int:
        # redis-py types the value as str but sends bytes as they are.
        return self._call(lambda: self._client.lrem(name, count, cast(str, value)))

    def lpush(self, name: str, *values: bytes) -> int:
        return self._call(lambda: self._client.lpush(name, *values))

    def get(self, name: str) -> bytes | None:
        return cast(bytes | None, self._call(lambda: self._client.get(name)))

    def close(self) -> None:
        self._client.close()
