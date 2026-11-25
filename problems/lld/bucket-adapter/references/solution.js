"use strict";

// The old flat key-value store: no buckets, no folders, just keys.
class LegacyStore {
  #data = new Map();

  put(key, value) {
    this.#data.set(key, value);
  }

  read(key) {
    return this.#data.get(key) ?? null;
  }

  scan(prefix) {
    return [...this.#data.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
  }
}

function checkBucket(bucket) {
  if (bucket === "" || bucket.includes(":")) throw new RangeError("bad bucket");
}

function given(value) {
  if (value === "") throw new RangeError("empty");
}

function legacy(bucket, key) {
  return `${bucket}:${key}`;
}

// Gives the legacy store a bucket-and-key API. The encoding is the adapter's alone: an
// object lives at `<bucket>:<key>`, and a bucket never holds a `:`, so the first one
// splits them.
class BucketAdapter {
  #store = new LegacyStore();

  putObject(bucket, key, body) {
    checkBucket(bucket);
    given(key);
    given(body);
    this.#store.put(legacy(bucket, key), body);
  }

  objectBody(bucket, key) {
    checkBucket(bucket);
    given(key);
    return this.#store.read(legacy(bucket, key));
  }

  listObjects(bucket, prefix, delimiter) {
    checkBucket(bucket);
    const found = new Set();
    for (const stored of this.#store.scan(legacy(bucket, prefix))) {
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

  legacyKeys() {
    return this.#store.scan("");
  }

  // The extension round: a copy, through the same encoding.
  copyObject(bucket, key, toBucket, toKey) {
    checkBucket(bucket);
    given(key);
    checkBucket(toBucket);
    given(toKey);
    const body = this.#store.read(legacy(bucket, key));
    if (body === null) return false;
    this.#store.put(legacy(toBucket, toKey), body);
    return true;
  }
}

module.exports = { BucketAdapter };
