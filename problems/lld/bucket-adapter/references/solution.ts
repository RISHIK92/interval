// The old flat key-value store: no buckets, no folders, just keys.
class LegacyStore {
  private readonly data = new Map<string, string>();

  put(key: string, value: string): void {
    this.data.set(key, value);
  }

  read(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  scan(prefix: string): string[] {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

function checkBucket(bucket: string): void {
  if (bucket === "" || bucket.includes(":")) throw new RangeError("bad bucket");
}

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

function legacy(bucket: string, key: string): string {
  return `${bucket}:${key}`;
}

// Gives the legacy store a bucket-and-key API. The encoding is the adapter's alone: an
// object lives at `<bucket>:<key>`, and a bucket never holds a `:`, so the first one
// splits them.
export class BucketAdapter {
  private readonly store = new LegacyStore();

  putObject(bucket: string, key: string, body: string): void {
    checkBucket(bucket);
    given(key);
    given(body);
    this.store.put(legacy(bucket, key), body);
  }

  objectBody(bucket: string, key: string): string | null {
    checkBucket(bucket);
    given(key);
    return this.store.read(legacy(bucket, key));
  }

  listObjects(bucket: string, prefix: string, delimiter: string): string[] {
    checkBucket(bucket);
    const found = new Set<string>();
    for (const stored of this.store.scan(legacy(bucket, prefix))) {
      const key = stored.slice(bucket.length + 1);
      // S3's common prefixes: what follows the prefix, up to its first delimiter.
      const cut = key.indexOf(delimiter, prefix.length);
      found.add(
        delimiter !== "" && cut >= 0
          ? key.slice(0, cut + delimiter.length)
          : key,
      );
    }
    return [...found].sort();
  }

  legacyKeys(): string[] {
    return this.store.scan("");
  }

  // The extension round: a copy, through the same encoding.
  copyObject(
    bucket: string,
    key: string,
    toBucket: string,
    toKey: string,
  ): boolean {
    checkBucket(bucket);
    given(key);
    checkBucket(toBucket);
    given(toKey);
    const body = this.store.read(legacy(bucket, key));
    if (body === null) return false;
    this.store.put(legacy(toBucket, toKey), body);
    return true;
  }
}
