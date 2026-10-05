const DATABASE_NAME = 'study-garden-files';
const DATABASE_VERSION = 1;
const STORE_NAME = 'lesson-files';

export type LegacyMediaRecord = { id: string; data: string };

type MediaRecord = { id: string; blob: Blob };

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  }

  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };

    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error('Could not open local lesson storage.'));
    };

    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error('Local lesson storage is blocked by another browser tab.'));
    };
  });

  return databasePromise;
}

export async function putMediaBlob(id: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ id, blob } satisfies MediaRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not save the lesson file.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Saving the lesson file was cancelled.'));
  });
}

export async function getMediaBlob(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as MediaRecord | undefined)?.blob);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not read the lesson file.'));
  });
}

export async function deleteMediaBlob(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not remove the lesson file.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Removing the lesson file was cancelled.'));
  });
}

export async function clearMediaStore(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not clear local lesson files.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Clearing local lesson files was cancelled.'));
  });
}

export async function migrateLegacyMedia(records: readonly LegacyMediaRecord[]): Promise<void> {
  for (const record of records) {
    const response = await fetch(record.data);
    if (!response.ok) throw new Error('Could not migrate an older lesson file.');
    await putMediaBlob(record.id, await response.blob());
  }
}
