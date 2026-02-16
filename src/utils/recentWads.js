import {
  RECENT_WAD_DB_NAME,
  RECENT_WAD_STORE_NAME,
  RECENT_WAD_DB_VERSION,
  MAX_RECENT_WADS,
} from "../constants";

export function getRecentWadId({ name, size, lastModified }) {
  return `${String(name ?? "")}:${Number(size ?? 0)}:${Number(lastModified ?? 0)}`;
}

export function sanitizeRecentWadEntry(entry) {
  return {
    id: String(entry?.id ?? ""),
    name: String(entry?.name ?? "unknown.wad"),
    size: Number(entry?.size ?? 0),
    loadedAt: Number(entry?.loadedAt ?? 0),
    iconPreviewUrl:
      typeof entry?.iconPreviewUrl === "string" && entry.iconPreviewUrl.length > 0
        ? entry.iconPreviewUrl
        : null,
  };
}

export function sortRecentWads(entries = []) {
  return [...entries].sort((left, right) => (right.loadedAt ?? 0) - (left.loadedAt ?? 0));
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

export function isIndexedDbAvailable() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

export async function openRecentWadDatabase() {
  if (!isIndexedDbAvailable()) {
    return null;
  }

  const request = window.indexedDB.open(RECENT_WAD_DB_NAME, RECENT_WAD_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(RECENT_WAD_STORE_NAME)) {
      db.createObjectStore(RECENT_WAD_STORE_NAME, { keyPath: "id" });
    }
  };

  return requestToPromise(request);
}

export async function listRecentWads() {
  const db = await openRecentWadDatabase();
  if (!db) {
    return [];
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readonly");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    const rows = await requestToPromise(store.getAll());
    await transactionToPromise(transaction);

    return sortRecentWads(rows.map((row) => sanitizeRecentWadEntry(row))).slice(0, MAX_RECENT_WADS);
  } finally {
    db.close();
  }
}

export async function saveRecentWad(file, options = {}) {
  if (!file || !isIndexedDbAvailable()) {
    return [];
  }

  if (typeof Blob !== "undefined" && !(file instanceof Blob)) {
    return listRecentWads();
  }

  const id = getRecentWadId(file);
  const db = await openRecentWadDatabase();
  if (!db) {
    return [];
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readwrite");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    const rows = await requestToPromise(store.getAll());
    const now = Date.now();
    const previewUrl =
      typeof options.iconPreviewUrl === "string" && options.iconPreviewUrl.length > 0
        ? options.iconPreviewUrl
        : null;

    const nextRows = [
      {
        id,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        loadedAt: now,
        blob: file,
        iconPreviewUrl: previewUrl,
      },
      ...sortRecentWads(rows.filter((row) => row.id !== id)),
    ].slice(0, MAX_RECENT_WADS);

    store.clear();
    for (const row of nextRows) {
      store.put(row);
    }

    await transactionToPromise(transaction);
    return nextRows.map((row) => sanitizeRecentWadEntry(row));
  } finally {
    db.close();
  }
}

export async function getRecentWad(id) {
  if (!id || !isIndexedDbAvailable()) {
    return null;
  }

  const db = await openRecentWadDatabase();
  if (!db) {
    return null;
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readonly");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    const row = await requestToPromise(store.get(id));
    await transactionToPromise(transaction);
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function clearRecentWads() {
  const db = await openRecentWadDatabase();
  if (!db) {
    return;
  }

  try {
    const transaction = db.transaction(RECENT_WAD_STORE_NAME, "readwrite");
    const store = transaction.objectStore(RECENT_WAD_STORE_NAME);
    store.clear();
    await transactionToPromise(transaction);
  } finally {
    db.close();
  }
}
