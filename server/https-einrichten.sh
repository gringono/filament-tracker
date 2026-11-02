#!/usr/bin/env bash
# ---------------------------------------------------------------
# HTTPS für den Filament-Tracker im Heimnetz einrichten (einmalig)
# ---------------------------------------------------------------
# Installiert Caddy im PocketBase-Container. Caddy stellt sich selbst ein
# Zertifikat aus ("eigene Zertifizierungsstelle") und leitet https://<IP>
# an PocketBase (Port 8080) weiter. Port 8080 bleibt unverändert – die
# Spulenwaage sendet weiterhin dorthin.
#
# Damit iPhone/PC dem Zertifikat vertrauen, wird das Stammzertifikat unter
#   http://<IP>:8080/heimnetz-zertifikat.crt
# bereitgestellt und muss dort einmal installiert werden.
#
# Aufruf in der Konsole des PocketBase-Containers:
#   curl -fsSL <GITHUB-URL>/server/https-einrichten.sh | bash
# ---------------------------------------------------------------
set -euo pipefail

IP=$(hostname -I | awk '{print $1}')
[ -n "$IP" ] || { echo "Keine IP-Adresse gefunden."; exit 1; }
echo "HTTPS wird für https://$IP eingerichtet ..."

if ! command -v caddy >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq caddy
fi
echo "  ✓ Caddy installiert ($(caddy version | awk '{print $1}'))"

cat > /etc/caddy/Caddyfile <<EOF
# Filament-Tracker: HTTPS im Heimnetz (eingerichtet mit https-einrichten.sh)
{
	# Zertifikate selbst ausstellen, nicht im Internet anfragen
	local_certs
	skip_install_trust
	# Aufruf per IP-Adresse (ohne Namen) bekommt dieses Zertifikat
	default_sni $IP
}

https://$IP {
	tls internal
	reverse_proxy 127.0.0.1:8080
}
EOF
echo "  ✓ Konfiguration geschrieben"

systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl restart caddy

# Stammzertifikat abwarten (entsteht beim ersten Start)
ROOT=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
for i in $(seq 1 20); do [ -f "$ROOT" ] && break; sleep 1; done
if [ ! -f "$ROOT" ]; then
  echo "Stammzertifikat wurde nicht erstellt – Caddy-Protokoll:"
  journalctl -u caddy -n 20 --no-pager || true
  exit 1
fi
cp "$ROOT" /opt/pocketbase/pb_public/heimnetz-zertifikat.crt
echo "  ✓ Zertifikat bereitgestellt"

if curl -fsk "https://$IP/api/health" >/dev/null; then
  echo ""
  echo "Fertig."
  echo "  1. Zertifikat aufs iPhone:  http://$IP:8080/heimnetz-zertifikat.crt"
  echo "  2. App danach öffnen:       https://$IP"
else
  echo "HTTPS antwortet nicht – Caddy-Protokoll:"
  journalctl -u caddy -n 20 --no-pager || true
  exit 1
fi
