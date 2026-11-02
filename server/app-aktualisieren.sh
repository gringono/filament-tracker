#!/usr/bin/env bash
# ---------------------------------------------------------------
# Filament-Tracker auf dem PocketBase-Server installieren/aktualisieren
# ---------------------------------------------------------------
# Lädt die App von GitHub Pages in /opt/pocketbase/pb_public und die
# Datenbank-Migration nach /opt/pocketbase/pb_migrations, dann Neustart.
#
# Aufruf in der Konsole des PocketBase-Containers:
#   curl -fsSL <GITHUB-URL>/server/app-aktualisieren.sh | bash -s -- <GITHUB-URL>
# Beispiel:
#   curl -fsSL https://name.github.io/filament/server/app-aktualisieren.sh | bash -s -- https://name.github.io/filament
# ---------------------------------------------------------------
set -euo pipefail

GITHUB_URL="${1:?Bitte die GitHub-Adresse der App angeben, z.B. https://name.github.io/filament}"
GITHUB_URL="${GITHUB_URL%/}"
PB=/opt/pocketbase

echo "App wird von $GITHUB_URL geladen ..."
mkdir -p "$PB/pb_public/vendor" "$PB/pb_migrations"

# app.js = fertig übersetzter App-Code; vendor/ = React und QR-Scanner lokal (schneller Start, kein Internet nötig)
for f in index.html app.js sw.js manifest.json icon-192.png icon-512.png \
         vendor/react.production.min.js vendor/react-dom.production.min.js vendor/html5-qrcode.min.js; do
  # erst in eine Zwischendatei, damit bei einem Fehler die alte Version erhalten bleibt
  curl -fsSL "$GITHUB_URL/$f" -o "$PB/pb_public/$f.neu"
  mv "$PB/pb_public/$f.neu" "$PB/pb_public/$f"
  echo "  ✓ $f"
done

MIG=1793500000_filament_tracker.js
curl -fsSL "$GITHUB_URL/server/pb_migrations/$MIG" -o "$PB/pb_migrations/$MIG.neu"
mv "$PB/pb_migrations/$MIG.neu" "$PB/pb_migrations/$MIG"
echo "  ✓ Datenbank-Migration"

echo "PocketBase wird neu gestartet ..."
systemctl restart pocketbase
sleep 2
if systemctl is-active --quiet pocketbase; then
  IP=$(hostname -I | awk '{print $1}')
  echo "Fertig. App: http://$IP:8080"
else
  echo "PocketBase läuft nicht – Fehler in /opt/pocketbase/errors.log ansehen:"
  tail -n 20 "$PB/errors.log" || true
  exit 1
fi
