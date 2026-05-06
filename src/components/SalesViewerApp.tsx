import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearAll,
  getAllPhotos,
  getAllSales,
  getPhotosByBarcode,
  type Photo,
  type Sale,
} from "@/lib/db";
import { dShort, dt, eur, num } from "@/lib/format";
import { exportBackup, importZip, type ImportResult } from "@/lib/import";

type Period = "day" | "week" | "month" | "custom";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function rangeFor(period: Period, from: string, to: string): [number, number] {
  const now = new Date();
  if (period === "day") return [startOfDay(now).getTime(), endOfDay(now).getTime()];
  if (period === "week") {
    const s = startOfDay(now);
    s.setDate(s.getDate() - 6);
    return [s.getTime(), endOfDay(now).getTime()];
  }
  if (period === "month") {
    const s = startOfDay(now);
    s.setDate(s.getDate() - 29);
    return [s.getTime(), endOfDay(now).getTime()];
  }
  const f = from ? startOfDay(new Date(from)).getTime() : 0;
  const t = to ? endOfDay(new Date(to)).getTime() : Date.now();
  return [f, t];
}

export default function SalesViewerApp() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [period, setPeriod] = useState<Period>(
    (localStorage.getItem("sv_period") as Period) || "month",
  );
  const [from, setFrom] = useState(localStorage.getItem("sv_from") || "");
  const [to, setTo] = useState(localStorage.getItem("sv_to") || "");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set());
  const [galleryBarcode, setGalleryBarcode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setSales(await getAllSales());
    setPhotos(await getAllPhotos());
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    localStorage.setItem("sv_period", period);
    localStorage.setItem("sv_from", from);
    localStorage.setItem("sv_to", to);
  }, [period, from, to]);

  const [rangeFrom, rangeTo] = useMemo(
    () => rangeFor(period, from, to),
    [period, from, to],
  );

  const filtered = useMemo(
    () => sales.filter((s) => s.timestamp >= rangeFrom && s.timestamp <= rangeTo),
    [sales, rangeFrom, rangeTo],
  );

  const stats = useMemo(() => {
    const total = filtered.reduce((a, s) => a + s.price, 0);
    const karte = filtered
      .filter((s) => /karte/i.test(s.payment))
      .reduce((a, s) => a + s.price, 0);
    const bar = filtered
      .filter((s) => /bar/i.test(s.payment))
      .reduce((a, s) => a + s.price, 0);
    const shopSet = new Set(filtered.map((s) => s.shopName));
    const photoCount = filtered.reduce((a, s) => a + (s.photoCount || 0), 0);
    return {
      sold: filtered.length,
      total,
      karte,
      bar,
      shops: shopSet.size,
      photos: photoCount,
      avg: filtered.length ? total / filtered.length : 0,
    };
  }, [filtered]);

  const byShop = useMemo(() => {
    const map = new Map<string, Sale[]>();
    for (const s of filtered) {
      if (!map.has(s.shopName)) map.set(s.shopName, []);
      map.get(s.shopName)!.push(s);
    }
    return Array.from(map.entries())
      .map(([name, items]) => {
        const total = items.reduce((a, s) => a + s.price, 0);
        const karte = items.filter((s) => /karte/i.test(s.payment)).reduce((a, s) => a + s.price, 0);
        const bar = items.filter((s) => /bar/i.test(s.payment)).reduce((a, s) => a + s.price, 0);
        const ph = items.reduce((a, s) => a + (s.photoCount || 0), 0);
        return { name, items, total, karte, bar, photos: ph };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const photoSizeMb = useMemo(
    () => photos.reduce((a, p) => a + (p.blob?.size || 0), 0) / (1024 * 1024),
    [photos],
  );

  const lastImport = useMemo(() => {
    if (!sales.length) return null;
    return Math.max(...sales.map((s) => s.importedAt));
  }, [sales]);

  const handleFile = async (file: File) => {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const r = await importZip(file);
      setImportResult(r);
      await reload();
    } catch (e: any) {
      setImportError(e?.message || "Fehler beim Import");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleShop = (name: string) => {
    const ns = new Set(expandedShops);
    if (ns.has(name)) ns.delete(name);
    else ns.add(name);
    setExpandedShops(ns);
  };

  const doExport = async () => {
    const blob = await exportBackup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const d = new Date().toISOString().slice(0, 10);
    a.download = `salesviewer_backup_${d}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doDelete = async () => {
    await clearAll();
    setConfirmDelete(false);
    await reload();
    setImportResult(null);
  };

  return (
    <div className="min-h-screen pb-12">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h2l.4 2M7 13h10l4-8H5.4" />
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="17" cy="20" r="1.5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold leading-tight">SalesViewer</h1>
            <p className="text-xs text-muted-foreground leading-tight truncate">
              Verkaufsübersicht & Auswertung
            </p>
          </div>
          <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-medium text-primary">
            {photoSizeMb > 200 ? "Speicher fast voll" : sales.length ? "Daten gespeichert" : "Offline bereit"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {/* Upload card */}
        <section className="card">
          <h2 className="card-title">Archiv hochladen</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Archiv vom Verkäufer hochladen (.zip)
          </p>
          <label className="block cursor-pointer rounded-xl border-2 border-dashed border-border bg-secondary/40 px-4 py-6 text-center transition hover:border-primary/60 hover:bg-primary-soft/40">
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="sr-only"
              disabled={importing}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <div className="text-sm font-medium">
              {importing ? "Importiere..." : "ZIP-Datei auswählen"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Tippen, um Archiv zu wählen
            </div>
          </label>

          {importError && (
            <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {importError}
            </div>
          )}

          {importResult && (
            <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
              <div className="font-semibold mb-1">Import abgeschlossen</div>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>Importiert: <b className="text-foreground">{importResult.importedSales}</b></li>
                <li>Übersprungen wegen Duplikat: <b className="text-foreground">{importResult.duplicateSales}</b></li>
                <li>Fotos importiert: <b className="text-foreground">{importResult.importedPhotos}</b></li>
                <li>Fotos übersprungen: <b className="text-foreground">{importResult.duplicatePhotos}</b></li>
                {importResult.warnings > 0 && (
                  <li>Zeilen mit Warnungen: <b className="text-foreground">{importResult.warnings}</b></li>
                )}
                {importResult.shops.length > 0 && (
                  <li>Shops: <b className="text-foreground">{importResult.shops.join(", ")}</b></li>
                )}
                {importResult.dateFrom && importResult.dateTo && (
                  <li>
                    Zeitraum: <b className="text-foreground">{dShort(importResult.dateFrom)} – {dShort(importResult.dateTo)}</b>
                  </li>
                )}
              </ul>
            </div>
          )}
        </section>

        {/* Period + Overview */}
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="card-title mb-0">Übersicht</h2>
          </div>
          <div className="mb-3">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Zeitraum</div>
            <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-secondary p-1">
              {(["day", "week", "month", "custom"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                    period === p
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  {p === "day" ? "Tag" : p === "week" ? "Woche" : p === "month" ? "Monat" : "Eigen"}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground">
                  Von
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Bis
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatCard label="Verkauft" value={num(stats.sold)} />
            <StatCard label="Umsatz" value={eur(stats.total)} accent />
            <StatCard label="Karte" value={eur(stats.karte)} />
            <StatCard label="Bar" value={eur(stats.bar)} />
            <StatCard label="Shops" value={num(stats.shops)} />
            <StatCard label="Fotos" value={num(stats.photos)} />
          </div>
        </section>

        {/* Per-shop */}
        <section className="card">
          <h2 className="card-title">Nach Shop</h2>
          {byShop.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Verkäufe im gewählten Zeitraum.</p>
          ) : (
            <div className="space-y-2">
              {byShop.map((shop) => {
                const isOpen = expandedShops.has(shop.name);
                return (
                  <div key={shop.name} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button
                      onClick={() => toggleShop(shop.name)}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-secondary/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{shop.name}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>Verkauft: <b className="text-foreground">{num(shop.items.length)}</b></span>
                          <span>Umsatz: <b className="text-foreground">{eur(shop.total)}</b></span>
                          <span>Karte: <b className="text-foreground">{eur(shop.karte)}</b></span>
                          <span>Bar: <b className="text-foreground">{eur(shop.bar)}</b></span>
                          <span>Fotos: <b className="text-foreground">{num(shop.photos)}</b></span>
                        </div>
                      </div>
                      <span
                        className="text-muted-foreground transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                      >
                        ›
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-border bg-secondary/30 p-2">
                        <ShopSalesTable
                          items={shop.items}
                          onPhotos={(b) => setGalleryBarcode(b)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Storage / Settings */}
        <section className="card">
          <h2 className="card-title">Status</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Info label="Verkäufe" value={num(sales.length)} />
            <Info label="Fotos" value={num(photos.length)} />
            <Info label="Fotogröße" value={`${photoSizeMb.toFixed(1)} MB`} />
            <Info label="Letzter Import" value={lastImport ? dt(lastImport) : "—"} />
          </div>
          {photoSizeMb > 200 && (
            <div className="mt-3 rounded-lg bg-warning/15 px-3 py-2 text-xs text-foreground">
              Viele Fotos gespeichert. Bitte regelmäßig Daten exportieren oder alte Daten löschen.
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={doExport}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground active:scale-[0.98]"
            >
              Daten exportieren
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
            >
              Alle Daten löschen
            </button>
          </div>
        </section>
      </main>

      {galleryBarcode && (
        <Gallery barcode={galleryBarcode} onClose={() => setGalleryBarcode(null)} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md">
            <h3 className="card-title">Alle Daten löschen?</h3>
            <p className="text-sm text-muted-foreground">
              Alle importierten Verkäufe und Fotos werden von diesem Gerät entfernt.
              Bitte zuerst ein Backup erstellen.
            </p>
            <div className="mt-4 grid gap-2">
              <button
                onClick={async () => {
                  await doExport();
                }}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium"
              >
                Backup erstellen
              </button>
              <button
                onClick={doDelete}
                className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground"
              >
                Endgültig löschen
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-border p-3 ${
        accent ? "bg-primary-soft" : "bg-card"
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function ShopSalesTable({
  items,
  onPhotos,
}: {
  items: Sale[];
  onPhotos: (barcode: string) => void;
}) {
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
  return (
    <div className="space-y-1.5">
      {sorted.map((s) => (
        <div key={s.id} className="rounded-lg bg-card p-2.5 text-sm shadow-sm">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-mono text-xs text-muted-foreground">{s.barcode}</div>
            <div className="font-semibold">{eur(s.price)}</div>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>{dt(s.timestamp)}</span>
            <span>·</span>
            <span>{s.payment}</span>
          </div>
          {s.note && (
            <div className="mt-1 rounded bg-secondary/70 px-2 py-1 text-xs">
              <span className="text-muted-foreground">Kommentar: </span>
              {s.note}
            </div>
          )}
          <div className="mt-1.5">
            {s.photoCount > 0 ? (
              <button
                onClick={() => onPhotos(s.barcode)}
                className="rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary"
              >
                Fotos anzeigen ({s.photoCount})
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">Keine Fotos</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Gallery({ barcode, onClose }: { barcode: string; onClose: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [idx, setIdx] = useState(0);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    getPhotosByBarcode(barcode).then((p) => {
      if (!active) return;
      setPhotos(p);
      const us = p.map((ph) => URL.createObjectURL(ph.blob));
      setUrls(us);
    });
    return () => {
      active = false;
    };
  }, [barcode]);

  useEffect(() => {
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.length]);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black/90"
      onClick={onClose}
    >
      <div className="flex items-center justify-between p-3 text-white">
        <div className="font-mono text-sm">{barcode}</div>
        <button
          onClick={onClose}
          className="rounded-full bg-white/15 px-3 py-1 text-sm"
        >
          Schließen
        </button>
      </div>
      <div
        className="flex-1 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {urls.length === 0 ? (
          <div className="text-white/70">Keine Fotos</div>
        ) : (
          <img
            src={urls[idx]}
            alt={barcode}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        )}
      </div>
      {urls.length > 1 && (
        <div className="flex items-center justify-between gap-2 p-3 text-white">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i - 1 + urls.length) % urls.length);
            }}
            className="rounded-full bg-white/15 px-4 py-2"
          >
            ‹
          </button>
          <div className="text-sm">
            {idx + 1} / {urls.length}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i + 1) % urls.length);
            }}
            className="rounded-full bg-white/15 px-4 py-2"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
