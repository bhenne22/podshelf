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

**Off-host copy:** the backups still live on the same Linode. Phase G below
pulls them (and the rest of the system config) to a separate machine.

---

## Phase G — Off-host backup pull (Synology over Tailscale)

The Linode-local nightly dumps from Phase F survive a corrupted database but
not a lost VM. This phase has a separate machine **pull** the dumps over
Tailscale, so a compromise of the Linode can't reach back and wipe history
on the destination.

The example here uses a Synology DS923+ on DSM 7.2; the same shape works
for any Linux box with rsync — the only Synology-specific bits are DSM Task
Scheduler and Snapshot Replication.

**What we back up beyond the SQLite dumps:**
- `/etc/nginx/conf.d/` + `nginx.conf` — every site's reverse-proxy config
- `/etc/letsencrypt/` — ACME account key + renewal config
- `/opt/podshelf/.env` — contains `PODSHELF_ENCRYPTION_KEY`. Without this
  the SQLite backup is junk; encrypted storage credentials can't be
  decrypted. **This is the single most critical file in the backup set.**

### G.1 — Linode: stage the system config nightly

Debian/Ubuntu already ships a system `backup` user (UID 34, home
`/var/backups`). We reuse it; no `adduser` needed. Verify:

```bash
getent passwd backup
# backup:x:34:34:backup:/var/backups:/usr/sbin/nologin
```

The default `nologin` shell will break rsync over SSH ("protocol version
mismatch — is your shell clean?") because nologin prints a refusal banner
that corrupts the rsync stream. Switch to `/bin/sh`; the forced command +
`restrict` options in `authorized_keys` are what actually sandbox the user,
not the shell.

```bash
sudo usermod -s /bin/sh backup
```

Let the `backup` group read the existing podshelf dumps (the
`g+s` keeps new files inheriting the group):

```bash
sudo chgrp -R backup /var/backups/podshelf
sudo chmod -R g+rX,o-rwx /var/backups/podshelf
sudo chmod g+s /var/backups/podshelf
```

Install the staging script and its nightly cron (lives in the repo at
`scripts/linode-config-snapshot.sh` — runs `git pull` first if needed):

```bash
sudo install -m 0755 -o root -g root \
  /opt/podshelf/scripts/linode-config-snapshot.sh \
  /usr/local/bin/linode-config-snapshot.sh

echo '19 3 * * * root /usr/local/bin/linode-config-snapshot.sh >/dev/null 2>&1' \
  | sudo tee /etc/cron.d/linode-config-snapshot

# Run it once to verify
sudo /usr/local/bin/linode-config-snapshot.sh
sudo ls -la /var/backups/linode-config/
```

The cron runs at 03:19, two minutes after the Phase F podshelf-backup.sh
cron, so the same night's `.db.gz` is in place when the staging fires.

### G.2 — Linode: install the puller's SSH key with an rrsync sandbox

Generate the keypair on the **destination** machine (Synology, here):

```bash
# On the Synology
sudo -i
mkdir -p /root/.ssh && chmod 700 /root/.ssh
ssh-keygen -t ed25519 -f /root/.ssh/linode-backup -N "" -C "synology-backup-pull"
cat /root/.ssh/linode-backup.pub
```

Back on the Linode, install the public key in `/var/backups/.ssh/` (the
`backup` user's home) with an `rrsync` forced command that chroots reads to
`/var/backups`:

```bash
sudo install -d -m 0700 -o backup -g backup /var/backups/.ssh

# Confirm rrsync's path; on Ubuntu 24.04 it's /usr/bin/rrsync (shipped with
# the rsync package, despite earlier rumors that it was dropped).
which rrsync || dpkg -L rsync | grep rrsync

sudo tee /var/backups/.ssh/authorized_keys >/dev/null <<'EOF'
command="/usr/bin/rrsync -ro /var/backups",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,restrict <PASTE_PUBKEY_HERE>
EOF
sudo chown backup:backup /var/backups/.ssh/authorized_keys
sudo chmod 600 /var/backups/.ssh/authorized_keys
```

Replace `<PASTE_PUBKEY_HERE>` with the line you copied from the Synology.
The `restrict` keyword denies port forwarding, agent forwarding, X11, etc.
by default; the explicit `no-…` options are belt-and-suspenders for older
sshd versions.

### G.3 — Synology: pull script + DSM Task Scheduler

DSM doesn't wire Tailscale's MagicDNS into the system resolver — `nslookup
linode-reverse-proxy.tail-XXXX.ts.net` returns `NXDOMAIN` because DSM
queries the LAN router. **Use the Tailscale IP directly**, found via
`tailscale status | grep <linode-name>`. Tailscale IPs are stable per-node
across reboots and reinstalls; they only change if you delete and re-auth
the machine.

```bash
# On the Synology, as root (sudo -i first; sudo cat > /file doesn't work
# because the redirect runs unprivileged)
mkdir -p /volume1/Backups/linode/{podshelf,config}
mkdir -p /volume1/Backups/logs

cat > /usr/local/bin/linode-pull.sh <<'EOF'
#!/bin/sh
set -eu
TS_HOST="100.x.y.z"            # Tailscale IP of the Linode
KEY=/root/.ssh/linode-backup
LOG=/volume1/Backups/logs/linode-pull-$(date -u +%Y%m%d).log
DEST=/volume1/Backups/linode

exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) starting pull ==="

# rrsync is chrooted to /var/backups, so source paths are relative to that.
rsync -avz --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  "backup@$TS_HOST:podshelf/"      "$DEST/podshelf/"

rsync -avz --delete -e "ssh -i $KEY" \
  "backup@$TS_HOST:linode-config/" "$DEST/config/"

echo "=== $(date -u +%FT%TZ) done ==="
EOF
chmod +x /usr/local/bin/linode-pull.sh

# Test
/usr/local/bin/linode-pull.sh
tail /volume1/Backups/logs/linode-pull-*.log
ls -lh /volume1/Backups/linode/podshelf/ /volume1/Backups/linode/config/
```

> Watch out for `/volume1/Backups` (capital B) — Linux paths are case-sensitive.

In DSM UI: **Control Panel → Task Scheduler → Create → Scheduled Task →
User-defined script**. Set User to `root`, schedule daily at 04:30 (after
the Linode's 03:17 podshelf dump and 03:19 config snapshot), command
`/usr/local/bin/linode-pull.sh`. Under Notifications, enable "Send run
details by email" → "Only when the script terminates abnormally" so you
only get pinged on failures.

### G.4 — Versioning: Snapshot Replication on the destination

A single mirror only protects against host loss, not "I corrupted the DB
last night and the bad backup overwrote the good one." Enable
**Snapshot Replication** on the `Backups` shared folder (DSM →
Snapshot Replication → Snapshots → Settings) — daily snapshots, retain
something like 7 daily + 4 weekly + 6 monthly. That's your point-in-time
recovery.

### G.5 — Disaster recovery rehearsal

Worth knowing the restore path before you need it:

1. Provision a fresh Ubuntu host (anywhere — new Linode, Mac mini VM).
2. Run Phases A–E from this doc to install Node, the app, and systemd.
3. Restore `linode-config/podshelf/.env` to `/opt/podshelf/.env` (mode 600,
   owned by podshelf). **Without the original `PODSHELF_ENCRYPTION_KEY`
   here the SQLite backup can't decrypt storage credentials.**
4. Pick the most recent `podshelf/podshelf-YYYYMMDD-HHMMSS.db.gz`,
   `gunzip` it, drop into `/opt/podshelf/data/podshelf.db`, chown
   `podshelf:podshelf`.
5. Restore `linode-config/letsencrypt/` to `/etc/letsencrypt/` and
   `linode-config/nginx/` to `/etc/nginx/`. `nginx -t && systemctl reload nginx`.
6. `systemctl start podshelf`. Sign in. Whole rebuild ≈ 15 minutes.

### G.6 — Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Could not resolve hostname linode-reverse-proxy` on Synology | MagicDNS isn't in DSM's resolver; use the Tailscale IP. |
| `protocol version mismatch -- is your shell clean?` | Remote user's login shell is printing output. Almost always `/usr/sbin/nologin`. Switch to `/bin/sh`. |
| `Permission denied` writing the script with `sudo cat > /file` | Redirect runs unprivileged before sudo elevates. Use `sudo -i` then heredoc, or `sudo tee /file <<'EOF' … EOF`. |
| Pull succeeds but `podshelf/` directory is empty on Synology | `backup` group can't read `/var/backups/podshelf/`. Re-run the chgrp/chmod from G.1. |

---

## Smoke test

From your laptop:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://podshelf.<your-domain>/login
curl -sSL -o /dev/null -w "%{http_code}\n" https://podshelf.<your-domain>/
```

`/login` returns 200 directly. `/` returns 302 to `/login` when not
authenticated (the second command follows the redirect with `-L` and
also returns 200). Then sign in via the browser with the user
`npm run create-admin` set up.

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

> **Always prefix `git`, `npm`, etc. with `sudo -u podshelf` when in
> `/opt/podshelf`.** If you ever run those as root, the new files end up
> owned by root and the next `sudo -u podshelf npm ci` fails with `EACCES
> rmdir node_modules/...` because the podshelf user can't delete root-owned
> directories. We've hit this three times. Fix:
> ```bash
> sudo chown -R podshelf:podshelf /opt/podshelf
> ```
> Then re-run the deploy.

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
