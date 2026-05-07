#!/bin/bash
# Stages host system config + Podshelf secrets into /var/backups/linode-config/
# so the unprivileged `backup` user (used by the off-host pull job) can read
# them without sudo or root SSH.
#
# Run nightly as root via /etc/cron.d/linode-config-snapshot. The destination
# pulls /var/backups/linode-config/ + /var/backups/podshelf/ on a later
# schedule (see docs/deployment.md, Phase G).
#
# What we stage and why:
#   - /etc/nginx/conf.d/ + nginx.conf  → reverse-proxy configs for every site
#   - /etc/letsencrypt/                → ACME account key + renewal config (cert
#                                        files renew themselves, but rebuilding
#                                        the account from scratch is annoying)
#   - /opt/podshelf/.env               → contains PODSHELF_ENCRYPTION_KEY; the
#                                        SQLite backup is unrecoverable without it
set -euo pipefail

DEST=/var/backups/linode-config

install -d -m 0750 -o backup -g backup "$DEST"

# nginx
install -d -m 0750 -o backup -g backup "$DEST/nginx" "$DEST/nginx/conf.d"
rsync -a --delete /etc/nginx/conf.d/ "$DEST/nginx/conf.d/"
install -m 0640 -o backup -g backup /etc/nginx/nginx.conf "$DEST/nginx/nginx.conf"
chown -R backup:backup "$DEST/nginx"

# Let's Encrypt — sensitive (private keys), keep tight.
install -d -m 0700 -o backup -g backup "$DEST/letsencrypt"
rsync -a --delete /etc/letsencrypt/ "$DEST/letsencrypt/"
chown -R backup:backup "$DEST/letsencrypt"
chmod -R u=rwX,go= "$DEST/letsencrypt"

# Podshelf .env — single most critical file. Without it the DB blob is junk.
install -d -m 0700 -o backup -g backup "$DEST/podshelf"
install -m 0600 -o backup -g backup /opt/podshelf/.env "$DEST/podshelf/.env"
