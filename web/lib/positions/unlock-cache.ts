export type AsyncValueCache<Key, Value> = {
  getOrCreate: (key: Key, create: () => Promise<Value>) => Promise<Value>;
};

export function createAsyncValueCache<Key, Value>(): AsyncValueCache<Key, Value> {
  const values = new Map<Key, Value>();
  const pending = new Map<Key, Promise<Value>>();

  return {
    getOrCreate(key, create) {
      const value = values.get(key);
      if (value !== undefined) return Promise.resolve(value);

      const active = pending.get(key);
      if (active) return active;

      const request = Promise.resolve()
        .then(create)
        .then((created) => {
          values.set(key, created);
          return created;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, request);
      return request;
    },
  };
}
