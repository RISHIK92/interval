"""DB-6, ADR-0011: the private content bucket, through boto3 (S3, or SeaweedFS locally
and on the VM when S3_ENDPOINT is set)."""

from typing import Any, Protocol


class S3Client(Protocol):
    """The boto3 S3 calls this adapter makes (boto3 ships no type stubs)."""

    def delete_object(self, *, Bucket: str, Key: str) -> dict[str, Any]: ...


class S3Files:
    def __init__(self, client: S3Client, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    def remove(self, key: str) -> None:
        # S3 answers a missing key with success too.
        self._client.delete_object(Bucket=self._bucket, Key=key)
