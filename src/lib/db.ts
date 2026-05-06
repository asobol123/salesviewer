// Lightweight IndexedDB wrapper for SalesViewer
const DB_NAME = "salesviewer";
const DB_VERSION = 1;

export interface Sale {
  id: string;
  shopName: string;
  time: string;
  timestamp: number;
  barcode: string;
  price: number;
  payment: string;
  note: string;
  photoCount: number;
  sourceArchiveName: string;
  importedAt: number;
}

export interface Photo {
  id: string;
  barcode: string;
  fileName: string;
  blob: Blob;
  mimeType: string;
  importedAt: number;
  sourceArchiveName: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sales")) {
        const s = db.createObjectStore("sales", { keyPath: "id" });
        s.createIndex("barcode", "barcode", { unique: false });
        s.createIndex("timestamp", "timestamp", { unique: false });
        s.createIndex("shopName", "shopName", { unique: false });
      }
      if (!db.objectStoreNames.contains("photos")) {
        const p = db.createObjectStore("photos", { keyPath: "id" });
        p.createIndex("barcode", "barcode", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores: string[], mode: IDBTransactionMode) {
  return openDB().then((db) => db.transaction(stores, mode));
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function getAllSales(): Promise<Sale[]> {
  const t = await tx(["sales"], "readonly");
  return reqP(t.objectStore("sales").getAll());
}

export async function getAllPhotos(): Promise<Photo[]> {
  const t = await tx(["photos"], "readonly");
  return reqP(t.objectStore("photos").getAll());
}

export async function getPhotosByBarcode(barcode: string): Promise<Photo[]> {
  const t = await tx(["photos"], "readonly");
  const idx = t.objectStore("photos").index("barcode");
  return reqP(idx.getAll(IDBKeyRange.only(barcode)));
}

export async function existingBarcodes(): Promise<Set<string>> {
  const sales = await getAllSales();
  return new Set(sales.map((s) => s.barcode));
}

export async function existingPhotoBarcodes(): Promise<Set<string>> {
  const photos = await getAllPhotos();
  return new Set(photos.map((p) => p.barcode));
}

export async function addSales(sales: Sale[]) {
  if (!sales.length) return;
  const t = await tx(["sales"], "readwrite");
  const store = t.objectStore("sales");
  for (const s of sales) store.put(s);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function addPhotos(photos: Photo[]) {
  if (!photos.length) return;
  const t = await tx(["photos"], "readwrite");
  const store = t.objectStore("photos");
  for (const p of photos) store.put(p);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function updateSalePhotoCounts(barcodeCounts: Map<string, number>) {
  const t = await tx(["sales"], "readwrite");
  const store = t.objectStore("sales");
  const all = await reqP(store.getAll());
  for (const s of all as Sale[]) {
    const c = barcodeCounts.get(s.barcode);
    if (c !== undefined && c !== s.photoCount) {
      s.photoCount = c;
      store.put(s);
    }
  }
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function clearAll() {
  const t = await tx(["sales", "photos"], "readwrite");
  t.objectStore("sales").clear();
  t.objectStore("photos").clear();
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
