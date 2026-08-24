import type { EncryptedWalletRecord } from "./wallet-crypto";

const DATABASE = "moros-payments";
const DATABASE_VERSION = 2;
export const WALLET_STORE = "encrypted-wallet";
export const PRIVATE_PROFILE_STORE = "private-profile";
const KEY = "primary";

export function openPaymentDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("secure browser storage is unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WALLET_STORE)) request.result.createObjectStore(WALLET_STORE);
      if (!request.result.objectStoreNames.contains(PRIVATE_PROFILE_STORE)) request.result.createObjectStore(PRIVATE_PROFILE_STORE);
    };
    request.onerror = () => reject(new Error("could not open secure browser storage"));
    request.onblocked = () => reject(new Error("secure browser storage is blocked by another tab"));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function transactPaymentStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openPaymentDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
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
  const record = await transactPaymentStore<EncryptedWalletRecord | undefined>(WALLET_STORE, "readonly", (store) => store.get(KEY));
  return record ?? null;
}

export async function saveEncryptedWallet(record: EncryptedWalletRecord): Promise<void> {
  await transactPaymentStore<IDBValidKey>(WALLET_STORE, "readwrite", (store) => store.put(record, KEY));
}

export async function deleteEncryptedWallet(): Promise<void> {
  const database = await openPaymentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([WALLET_STORE, PRIVATE_PROFILE_STORE], "readwrite");
      transaction.objectStore(WALLET_STORE).delete(KEY);
      transaction.objectStore(PRIVATE_PROFILE_STORE).clear();
      transaction.onabort = () => reject(new Error("secure browser storage operation was cancelled"));
      transaction.onerror = () => reject(new Error("secure browser storage operation failed"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}
