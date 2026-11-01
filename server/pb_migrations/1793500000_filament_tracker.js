/// <reference path="../pb_data/types.d.ts" />
// Filament-Tracker: Tabellen anlegen.
// Liegt in /opt/pocketbase/pb_migrations und wird beim Start von PocketBase
// automatisch einmal ausgeführt.
//
// Alle Regeln sind "" = jeder im Heimnetz darf lesen und schreiben (kein Login in der App).
// Den Server deshalb NICHT ins Internet freigeben.

const offen = {
  listRule: "",
  viewRule: "",
  createRule: "",
  updateRule: "",
  deleteRule: "",
};

function tabelle(name, fields, indexes) {
  return new Collection(Object.assign({ type: "base", name: name, fields: fields, indexes: indexes || [] }, offen));
}

migrate((app) => {
  // Ein Datensatz pro Filament; "daten" enthält das komplette Filament-Objekt der App
  app.save(tabelle("filamente", [
    { type: "text", name: "app_id", required: true, max: 50 },
    { type: "json", name: "daten", maxSize: 1048576 },
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ], [
    "CREATE UNIQUE INDEX idx_filamente_app_id ON filamente (app_id)",
  ]));

  // Gemeinsame Einstellungen aller Geräte (Drucker, eigene Materialien, Lagerorte)
  app.save(tabelle("einstellungen", [
    { type: "text", name: "name", required: true, max: 50 },
    { type: "json", name: "daten", maxSize: 1048576 },
    { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
  ], [
    "CREATE UNIQUE INDEX idx_einstellungen_name ON einstellungen (name)",
  ]));

  // Messungen der Spulenwaage (Etappe 2): Waage meldet Spulen-ID + Filamentgewicht
  app.save(tabelle("messungen", [
    { type: "text", name: "spool_id", required: true, max: 50 },
    { type: "number", name: "gramm" },
    { type: "autodate", name: "created", onCreate: true, onUpdate: false },
  ], [
    "CREATE INDEX idx_messungen_spool ON messungen (spool_id)",
  ]));
}, (app) => {
  for (const name of ["messungen", "einstellungen", "filamente"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (e) {
      // Tabelle existiert nicht – nichts zu tun
    }
  }
});
