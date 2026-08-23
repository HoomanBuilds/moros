import type { EncryptedWalletRecord } from "./wallet-crypto";

const DATABASE = "moros-payments";
const STORE = "encrypted-wallet";
const KEY = "primary";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("secure browser storage is unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(new Error("could not open secure browser storage"));
    request.onblocked = () => reject(new Error("secure browser storage is blocked by another tab"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onerror = () => reject(new Error("secure browser storage operation failed"));
      transaction.onabort = () => reject(new Error("secure browser storage operation was cancelled"));
      transaction.onerror = () => reject(new Error("secure browser storage operation failed"));
      transaction.oncomplete = () => resolve(request.result);
    });
  } finally {
    database.close();
  }
}

export async function loadEncryptedWallet(): Promise<EncryptedWalletRecord | null> {
  const record = await transact<EncryptedWalletRecord | undefined>("readonly", (store) => store.get(KEY));
  return record ?? null;
}

export async function saveEncryptedWallet(record: EncryptedWalletRecord): Promise<void> {
  await transact<IDBValidKey>("readwrite", (store) => store.put(record, KEY));
}

export async function deleteEncryptedWallet(): Promise<void> {
  await transact<undefined>("readwrite", (store) => store.delete(KEY));
}
