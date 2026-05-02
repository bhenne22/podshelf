# Production Deployment

This is the runbook used to deploy Podshelf to a Linux VPS behind nginx. The
canonical reference instance is `podshelf.hennemo.com` on a Linode VPS
(Ubuntu 24.04 LTS, behind Cloudflare).

The shape is generic enough for any Debian/Ubuntu host with an existing
nginx reverse-proxy.

---

## What you need

- An always-on Linux server (1GB RAM is plenty)
- A domain with DNS pointed at the server
- A TLS certificate for the hostname (Let's Encrypt or Cloudflare Origin Cert)
- nginx already installed (the runbook only adds a single server block)
- Root or sudo access for the install steps

---

## Phase A — DNS & TLS

1. Add an A/AAAA record for `podshelf.<your-domain>` → server IP.
2. If you're using Cloudflare in front, set TLS mode to **Full (Strict)** so
   end-to-end TLS works.
3. Ensure a valid certificate covers `podshelf.<your-domain>` on the origin.
   The sample setup below assumes a wildcard at
   `/etc/letsencrypt/live/<domain>/`. If you don't have one, run
   `certbot --nginx -d podshelf.<your-domain>` after the nginx config in
   Phase D.

---

## Phase B — Install Node, create app user, build

Run as root (or with `sudo` per command):

```bash
# Node 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs build-essential python3

# Verify
node -v && npm -v   # expect v20.x and 10.x

# System user that owns the app (no login)
useradd --system --shell /bin/bash --create-home --home-dir /opt/podshelf podshelf

# Clone the repo into /opt/podshelf
sudo -u podshelf bash -lc '
  rm -rf /opt/podshelf/.bash_logout /opt/podshelf/.bashrc /opt/podshelf/.profile
  git clone https://github.com/bhenne22/podshelf.git /tmp/ps
  shopt -s dotglob
  mv /tmp/ps/* /opt/podshelf/
  rm -rf /tmp/ps
'

# Install + build
sudo -u podshelf bash -lc 'cd /opt/podshelf && npm ci && npm run build'

# Data dir for the SQLite file
sudo -u podshelf bash -lc 'mkdir -p /opt/podshelf/data'
```

---

## Phase C — Environment + first admin

```bash
# Generate fresh secrets
SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

cat > /opt/podshelf/.env <<EOF
DATABASE_PATH=/opt/podshelf/data/podshelf.db
NUXT_SECRET_KEY=$SECRET_KEY
PODSHELF_ENCRYPTION_KEY=$ENCRYPTION_KEY
SITE_URL=https://podshelf.<your-domain>
EOF

chown podshelf:podshelf /opt/podshelf/.env
chmod 600 /opt/podshelf/.env

# Create the first admin user
sudo -u podshelf bash -lc 'cd /opt/podshelf && set -a && . ./.env && set +a && npm run create-admin'
```

The `chmod 600` matters — the encryption key sitting on disk is what protects
SFTP/S3 credentials in the database, so don't let it leak to other users on
the box.

---

## Phase D — systemd service

```bash
cat > /etc/systemd/system/podshelf.service <<'EOF'
[Unit]
Description=Podshelf
After=network.target

[Service]
Type=simple
User=podshelf
Group=podshelf
WorkingDirectory=/opt/podshelf
EnvironmentFile=/opt/podshelf/.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node /opt/podshelf/.output/server/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/opt/podshelf/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now podshelf
sleep 2
systemctl status podshelf --no-pager
curl -sS -o /dev/null -w "local 3000: %{http_code}\n" http://127.0.0.1:3000/
# Expect: active (running) + status 302
```

The hardening flags (`ProtectSystem=full`, `ProtectHome=read-only`,
`ReadWritePaths=/opt/podshelf/data`, `NoNewPrivileges=true`) lock the unit
down so a compromised app can't write outside `data/`.

---

## Phase E — nginx reverse proxy

Adjust the cert paths to your actual cert location.

```bash
cat > /etc/nginx/conf.d/podshelf.<your-domain>.conf <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name podshelf.<your-domain>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name podshelf.<your-domain>;

    ssl_certificate     /etc/letsencrypt/live/<your-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domain>/privkey.pem;

    # Audio uploads can be up to 500 MB; allow some multipart headroom
    client_max_body_size 600M;

    # Slow SFTP/S3 uploads can take a while
    proxy_read_timeout    300s;
    proxy_send_timeout    300s;
    proxy_connect_timeout 30s;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
EOF

nginx -t && systemctl reload nginx
```

`client_max_body_size` matters — Podshelf accepts up to 500 MB audio uploads
plus multipart envelope overhead, so 600M is a safe ceiling.

`proxy_set_header X-Forwarded-For` is what the download tracker hashes for
the IAB-style 24h dedup. With Cloudflare in front, X-Forwarded-For will
contain the real client IP first followed by the CF edge IP — which is what
we want.

---

## Phase F — Nightly backups

The SQLite DB is the only piece of unique state. Audio files and
auto-generated builds can be regenerated; episode metadata, users, API keys,
encrypted storage credentials, and download history cannot.

```bash
mkdir -p /var/backups/podshelf
chown podshelf:podshelf /var/backups/podshelf

cat > /usr/local/bin/podshelf-backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
cd /tmp

DB=/opt/podshelf/data/podshelf.db
DEST=/var/backups/podshelf
STAMP=$(date -u +%Y%m%d-%H%M%S)
TMP="$DEST/podshelf-$STAMP.db"

# Online consistent backup (works while the app is running, WAL-safe)
sqlite3 "$DB" ".backup '$TMP'"
gzip -9 "$TMP"

# Keep 30 days of nightly snapshots
find "$DEST" -name 'podshelf-*.db.gz' -mtime +30 -delete
EOF

chmod +x /usr/local/bin/podshelf-backup.sh
apt install -y sqlite3

cat > /etc/cron.d/podshelf-backup <<'EOF'
17 3 * * * podshelf /usr/local/bin/podshelf-backup.sh >/dev/null 2>&1
EOF

# Verify
sudo -u podshelf /usr/local/bin/podshelf-backup.sh
ls -lh /var/backups/podshelf/
```

**Off-host copy:** the backups still live on the same Linode. For real
durability, add a second cron line that rsyncs `/var/backups/podshelf/` to a
different host (your Mac mini, B2, S3, wherever).

---

## Smoke test

From your laptop:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://podshelf.<your-domain>/
curl -sS -o /dev/null -w "%{http_code}\n" https://podshelf.<your-domain>/admin/login
```

Both should return 200 (with `/` going through 302→/admin→/admin/login). Then
sign in via the browser with the user `npm run create-admin` set up.

---

## Routine operations

### Deploy a new version

```bash
cd /opt/podshelf
sudo -u podshelf git pull
sudo -u podshelf npm ci
sudo -u podshelf npm run build
systemctl restart podshelf
journalctl -u podshelf -n 30 --no-pager   # verify clean start
```

The DB migration runner adds new columns automatically on startup, so most
upgrades don't need any manual schema work.

### Rotate `NUXT_SECRET_KEY`

Edit `/opt/podshelf/.env`, replace the key, `systemctl restart podshelf`. All
existing sessions are invalidated; users have to log in again.

### Rotate `PODSHELF_ENCRYPTION_KEY`

Don't, unless you're prepared to wipe stored storage credentials and GitHub
PATs and re-enter them. The current crypto util has no key-rotation path —
it just decrypts with whatever key is in the env. If you need to rotate,
plan a maintenance window: shut down, decrypt all blobs with the old key,
re-encrypt with the new key, swap the env var, restart.

### Reset / add an admin

```bash
sudo -u podshelf bash -lc 'cd /opt/podshelf && set -a && . ./.env && set +a && npm run create-admin'
```

If the email already exists, the password is reset and the account promoted
to admin.

### Logs

```bash
journalctl -u podshelf -f          # follow
journalctl -u podshelf -n 200      # last 200 lines
journalctl -u podshelf --since "2 hours ago"
```

nginx access logs typically at `/var/log/nginx/access.log`; the tracker
download events show up there as `GET /track/...` redirects.
