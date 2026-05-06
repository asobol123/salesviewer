import JSZip from "jszip";
import Papa from "papaparse";
import {
  addPhotos,
  addSales,
  existingBarcodes,
  existingPhotoBarcodes,
  updateSalePhotoCounts,
  type Photo,
  type Sale,
} from "./db";

export interface ImportResult {
  importedSales: number;
  duplicateSales: number;
  importedPhotos: number;
  duplicatePhotos: number;
  warnings: number;
  shops: string[];
  dateFrom?: number;
  dateTo?: number;
  archiveName: string;
}

const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function normKey(k: string) {
  return k.trim().toLowerCase();
}

function parseNum(v: string): number {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/\s/g, "");
  // German decimal: replace "." thousand sep then comma decimal
  if (s.includes(",") && s.includes(".")) {
    return parseFloat(s.replace(/\./g, "").replace(",", "."));
  }
  if (s.includes(",")) return parseFloat(s.replace(",", "."));
  return parseFloat(s);
}

function parseTime(v: string): number | null {
  if (!v) return null;
  const s = v.trim();
  // Try ISO
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  // Try DD.MM.YYYY HH:MM[:SS]
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T]?(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?/);
  if (m) {
    d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0),
    );
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

function getField(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function detectDelimiter(text: string): string {
  const head = text.split("\n").slice(0, 5).join("\n");
  const semi = (head.match(/;/g) || []).length;
  const comma = (head.match(/,/g) || []).length;
  return semi >= comma ? ";" : ",";
}

function extractBarcodeFromName(name: string): string {
  const base = name.split("/").pop() || name;
  const noExt = base.replace(IMG_EXT, "");
  // strip trailing _digit(s)
  return noExt.replace(/_\d+$/, "").trim();
}

export async function importZip(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);

  // Find first CSV
  let csvEntry: JSZip.JSZipObject | null = null;
  const imgEntries: JSZip.JSZipObject[] = [];
  zip.forEach((_path, entry) => {
    if (entry.dir) return;
    const name = entry.name;
    if (!csvEntry && /\.csv$/i.test(name)) csvEntry = entry;
    if (IMG_EXT.test(name)) imgEntries.push(entry);
  });

  if (!csvEntry) throw new Error("Keine CSV-Datei im Archiv gefunden.");

  let csvText = await (csvEntry as JSZip.JSZipObject).async("string");
  if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);

  const delimiter = detectDelimiter(csvText);
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const result: ImportResult = {
    importedSales: 0,
    duplicateSales: 0,
    importedPhotos: 0,
    duplicatePhotos: 0,
    warnings: 0,
    shops: [],
    archiveName: file.name,
  };

  const existing = await existingBarcodes();
  const existingPhotos = await existingPhotoBarcodes();
  const newSales: Sale[] = [];
  const seenInBatch = new Set<string>();
  const shopSet = new Set<string>();
  let minTs = Infinity;
  let maxTs = -Infinity;
  const now = Date.now();

  for (const raw of parsed.data) {
    if (!raw) continue;
    // build case-insensitive map
    const row: Record<string, string> = {};
    for (const k of Object.keys(raw)) row[normKey(k)] = (raw as any)[k];

    const shopName = getField(row, "shopname").trim();
    const timeStr = getField(row, "time").trim();
    const barcode = getField(row, "barcode").trim();
    const priceStr = getField(row, "price").trim();
    const payment = getField(row, "payment").trim();
    const note = getField(row, "note").trim();

    if (!shopName || !barcode || !timeStr || !priceStr || !payment) {
      result.warnings++;
      continue;
    }

    const ts = parseTime(timeStr);
    if (ts === null) result.warnings++;

    if (existing.has(barcode) || seenInBatch.has(barcode)) {
      result.duplicateSales++;
      continue;
    }
    seenInBatch.add(barcode);

    const price = parseNum(priceStr);
    const finalTs = ts ?? now;
    if (ts !== null) {
      if (finalTs < minTs) minTs = finalTs;
      if (finalTs > maxTs) maxTs = finalTs;
    }
    shopSet.add(shopName);

    newSales.push({
      id: `${barcode}__${finalTs}`,
      shopName,
      time: timeStr,
      timestamp: finalTs,
      barcode,
      price: isNaN(price) ? 0 : price,
      payment,
      note,
      photoCount: 0,
      sourceArchiveName: file.name,
      importedAt: now,
    });
  }

  // Photos: skip barcodes that already have photos in DB
  // Also skip barcodes seen in this batch (deduplicate by full filename within zip)
  const photosToAdd: Photo[] = [];
  const skippedBarcodes = new Set<string>();
  const addedPhotoBarcodes = new Map<string, number>();
  const seenFiles = new Set<string>();

  for (const entry of imgEntries) {
    const barcode = extractBarcodeFromName(entry.name);
    if (!barcode) continue;
    if (existingPhotos.has(barcode)) {
      if (!skippedBarcodes.has(barcode)) {
        skippedBarcodes.add(barcode);
      }
      result.duplicatePhotos++;
      continue;
    }
    const fileName = entry.name.split("/").pop() || entry.name;
    if (seenFiles.has(fileName + barcode)) {
      result.duplicatePhotos++;
      continue;
    }
    seenFiles.add(fileName + barcode);

    const ext = (fileName.match(IMG_EXT)?.[1] || "jpg").toLowerCase();
    const blob = await entry.async("blob");
    const mimeType = MIME[ext] || "image/jpeg";
    photosToAdd.push({
      id: `${barcode}__${fileName}`,
      barcode,
      fileName,
      blob: blob.type ? blob : new Blob([blob], { type: mimeType }),
      mimeType,
      importedAt: now,
      sourceArchiveName: file.name,
    });
    addedPhotoBarcodes.set(barcode, (addedPhotoBarcodes.get(barcode) || 0) + 1);
    result.importedPhotos++;
  }

  // Set photoCount for new sales
  for (const s of newSales) {
    s.photoCount = addedPhotoBarcodes.get(s.barcode) || 0;
  }

  await addSales(newSales);
  await addPhotos(photosToAdd);
  // also update existing sales whose barcode got new photos (rare since barcode is unique)
  if (addedPhotoBarcodes.size) await updateSalePhotoCounts(addedPhotoBarcodes);

  result.importedSales = newSales.length;
  result.shops = Array.from(shopSet);
  if (minTs !== Infinity) result.dateFrom = minTs;
  if (maxTs !== -Infinity) result.dateTo = maxTs;

  return result;
}

export async function exportBackup(): Promise<Blob> {
  const { getAllSales, getAllPhotos } = await import("./db");
  const zip = new JSZip();
  const sales = await getAllSales();
  const photos = await getAllPhotos();

  const headers = [
    "shopName",
    "time",
    "barcode",
    "price",
    "payment",
    "note",
  ];
  const rows = [headers.join(";")];
  for (const s of sales) {
    const v = [
      s.shopName,
      s.time,
      s.barcode,
      String(s.price).replace(".", ","),
      s.payment,
      s.note || "",
    ].map((x) => {
      const str = String(x ?? "");
      return /[;"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    });
    rows.push(v.join(";"));
  }
  zip.file("sales.csv", "\ufeff" + rows.join("\n"));
  const folder = zip.folder("photos")!;
  for (const p of photos) {
    folder.file(p.fileName, p.blob);
  }
  return zip.generateAsync({ type: "blob" });
}
