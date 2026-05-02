# Storage Configuration

Each podcast has its own storage adapter — SFTP or S3-compatible. Credentials
are encrypted at rest in the SQLite database with AES-256-GCM, using your
`PODSHELF_ENCRYPTION_KEY`. There are **no SFTP/S3 environment variables** —
everything is configured per-podcast in the admin UI under the **Storage**
tab.

---

## SFTP vs S3

| | SFTP | S3 / B2 / R2 |
|---|---|---|
| **Best for** | Existing shared hosting (Dreamhost, etc.) | New cloud-only setups |
| **Cost** | Often included with hosting | Pennies per GB/mo |
| **Setup** | Generate a key, paste it in | Bucket + access key |
| **CDN-friendly** | No (your hosting bandwidth) | Yes |

If your podcast already lives on a shared host with public web directories,
SFTP is the path of least resistance — Podshelf uploads files to the same
folder your existing site serves audio from.

---

## SFTP setup

### Generate a dedicated key

Don't reuse your main personal key. Generate a fresh keypair just for
Podshelf:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/podshelf -C "podshelf"
# Press Enter twice for an empty passphrase. Podshelf will store the key
# encrypted with your PODSHELF_ENCRYPTION_KEY in any case.
```

That gives you `~/.ssh/podshelf` (private) and `~/.ssh/podshelf.pub` (public).

### Install the public key on your host

```bash
ssh-copy-id -i ~/.ssh/podshelf.pub <user>@<host>
# Verify:
ssh -i ~/.ssh/podshelf <user>@<host>
```

When that logs you in without a password, you're good.

**DreamHost note:** their shared hosting doesn't have a "Public SSH Key" field
in the panel for shell users. SSH in with password and create
`~/.ssh/authorized_keys` manually — `ssh-copy-id` does this for you.

### Fill out the Storage form

In the admin: pick the podcast → **Storage** → switch to SFTP:

| Field | Value |
|---|---|
| Host | e.g. `iad1-shared-e1-33.dreamhost.com` |
| Port | `22` |
| Username | your SFTP/SSH username |
| Auth method | Private key (recommended) |
| Private key | paste the entire contents of `~/.ssh/podshelf` (including BEGIN/END lines) |
| Passphrase | only if your key is encrypted (otherwise leave blank) |
| Remote directory | absolute path on the server, e.g. `/home/user/yoursite.com/podcast/audio` — must be web-accessible |
| Public URL Base | the URL that maps to that directory, e.g. `https://yoursite.com/podcast/audio` |

Click **Test Connection** before Save. The test connects, lists the remote
directory, and shows the first 10 entries — confirms credentials work and
that you pointed at the right folder. Then Save.

The Save action overwrites the encrypted blob with the credentials in the
form. You can leave the private key field blank on subsequent edits to keep
the existing one in place.

---

## S3 / B2 / R2 setup

Podshelf supports any S3-compatible storage. Files are uploaded with
`public-read` ACL.

### Backblaze B2

1. Create a **public** B2 bucket
2. Create an Application Key with `readFiles` and `writeFiles` on that bucket
3. Note your bucket's S3 endpoint from the bucket details page

Fill out the Storage form with **S3** selected:

| Field | Value |
|---|---|
| Endpoint | e.g. `https://s3.us-west-004.backblazeb2.com` |
| Region | matches your endpoint, e.g. `us-west-004` |
| Access Key ID | from B2 Application Key |
| Secret Access Key | from B2 Application Key |
| Bucket Name | your bucket |
| Public URL Base | `https://f004.backblazeb2.com/file/<bucket-name>` |

### AWS S3

| Field | Value |
|---|---|
| Endpoint | (leave blank) |
| Region | e.g. `us-east-1` |
| Access Key ID | from IAM |
| Secret Access Key | from IAM |
| Bucket Name | your bucket |
| Public URL Base | `https://<bucket>.s3.<region>.amazonaws.com` |

The IAM user needs `s3:PutObject`, `s3:GetObject`, `s3:PutObjectAcl` on the
bucket. The bucket itself must allow public reads.

### Cloudflare R2

| Field | Value |
|---|---|
| Endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| Region | `auto` |
| Access Key ID | from R2 API token |
| Secret Access Key | from R2 API token |
| Bucket Name | your bucket |
| Public URL Base | the public URL of the bucket (typically a custom domain you connect to R2) |

Same Test Connection step. The S3 test lists the first 10 objects in the
bucket so you can confirm credentials and bucket name are correct.

---

## Switching adapters

You can flip between SFTP and S3 freely. Existing episodes' `audio_url`
fields continue to point at wherever they were originally uploaded — only
new uploads go through the new adapter. To migrate existing audio, copy the
files manually and edit the `audio_url` on each episode.

---

## Troubleshooting

**SFTP test fails with "All configured authentication methods failed"** —
the server rejected your key. Almost always:
1. Public key not actually installed on the server (check `~/.ssh/authorized_keys`)
2. `~/.ssh` permissions wrong (must be `700`; `authorized_keys` must be `600`)
3. Wrong username

Run `ssh -v -i ~/.ssh/podshelf <user>@<host>` from your laptop to confirm
the key works *outside* of Podshelf before debugging anything in Podshelf.

**SFTP test fails with "Cannot parse privateKey"** — the textarea contents
got mangled (extra whitespace, smart quotes). Re-copy directly from the file
with `cat ~/.ssh/podshelf | pbcopy`.

**S3 test fails with `AccessDenied`** — IAM/API key doesn't have the right
permissions on the bucket, OR the bucket isn't public (B2: set Files in Bucket
to Public; AWS: bucket policy must allow `s3:GetObject` to `*`).

**Upload returns 500 with no useful message** — check `journalctl -u podshelf`
(or `npm run dev` output in dev) for the actual error.
