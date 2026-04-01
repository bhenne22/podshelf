# Storage Configuration

Podshelf stores podcast audio files on external storage — either via SFTP (great for shared hosting) or S3-compatible object storage (great for cloud setups). Episode metadata is always stored in the local SQLite database.

---

## Which Storage Adapter Should I Use?

| | SFTP | S3 / Backblaze B2 |
|---|---|---|
| **Best for** | Shared hosting users | Cloud/VPS users |
| **Cost** | Included with hosting | Free tier or ~$0.006/GB/mo |
| **Setup complexity** | Low | Low-Medium |
| **Performance** | Good | Excellent (CDN-ready) |
| **Reliability** | Good | Excellent |
| **Example providers** | Dreamhost, Hostinger, cPanel hosts | Backblaze B2, AWS S3, Cloudflare R2 |

**Our recommendation:** If you're already paying for shared hosting that includes web-accessible file storage, use SFTP. It's the simplest option. If you want better performance, scalability, or already use a cloud provider, use S3.

---

## SFTP Setup

SFTP uploads files directly to your server's filesystem via SSH. The files must be in a web-accessible directory so listeners can stream them.

### Requirements

- SSH access to your hosting account
- An SSH key pair (password auth works too but isn't recommended)
- A web-accessible directory to store audio files

### Generating an SSH Key (if you don't have one)

```bash
ssh-keygen -t ed25519 -C "podshelf-upload" -f ~/.ssh/podshelf_key
# Copy the public key to your server:
ssh-copy-id -i ~/.ssh/podshelf_key.pub youruser@yourhost.example.com
```

### .env Configuration

```env
STORAGE_ADAPTER=sftp

SFTP_HOST=yourhost.example.com
SFTP_PORT=22
SFTP_USER=yourusername
SFTP_PRIVATE_KEY_PATH=/home/podshelf/.ssh/podshelf_key

# The directory on the server where audio files will be uploaded
# This must be web-accessible (inside your public_html or www)
SFTP_REMOTE_DIR=/home/yourusername/public_html/podcast/audio

# The corresponding public URL
SFTP_PUBLIC_URL_BASE=https://yourhost.example.com/podcast/audio
```

### Dreamhost-Specific Setup

1. Log into your Dreamhost panel
2. Go to **Manage Users** → click Edit on your user
3. Enable **SFTP** access
4. Add your SSH public key under **Manage SSH Keys**
5. Set `SFTP_REMOTE_DIR` to a path inside your domain's `public_html` directory

Example:
```env
SFTP_REMOTE_DIR=/home/yourdreamhostuser/yoursite.com/podcast/audio
SFTP_PUBLIC_URL_BASE=https://yoursite.com/podcast/audio
```

---

## S3 / Backblaze B2 Setup

Podshelf supports any S3-compatible storage. All uploaded files are set to `public-read` ACL for direct streaming.

### AWS S3

1. Create an S3 bucket (set public access settings to allow public reads)
2. Create an IAM user with `s3:PutObject`, `s3:GetObject`, `s3:PutObjectAcl` permissions on your bucket
3. Generate Access Key credentials

```env
STORAGE_ADAPTER=s3

# Leave S3_ENDPOINT blank for AWS
S3_ENDPOINT=
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET_NAME=my-podcast-audio
S3_PUBLIC_URL_BASE=https://my-podcast-audio.s3.us-east-1.amazonaws.com
```

### Backblaze B2 (Recommended for Cost)

Backblaze B2 is significantly cheaper than AWS S3 and is S3-compatible.

1. Create a B2 account at [backblaze.com](https://www.backblaze.com)
2. Create a **Public** bucket (Bucket Settings → Files in Bucket are: Public)
3. Create an **Application Key** with `readFiles` and `writeFiles` permissions on your bucket
4. Note your bucket's **S3 Endpoint** from the bucket details page

```env
STORAGE_ADAPTER=s3

S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_ACCESS_KEY_ID=your-b2-key-id
S3_SECRET_ACCESS_KEY=your-b2-application-key
S3_BUCKET_NAME=my-podcast-audio
S3_PUBLIC_URL_BASE=https://f004.backblazeb2.com/file/my-podcast-audio
```

The `S3_PUBLIC_URL_BASE` for B2 follows the pattern:
`https://f{accountNumber}.backblazeb2.com/file/{bucketName}`

You can find the exact URL in your B2 bucket settings under "Bucket Endpoint".

### Cloudflare R2

Cloudflare R2 has zero egress fees, making it excellent for high-traffic podcasts.

1. Create an R2 bucket in the Cloudflare dashboard
2. Connect a custom domain to the bucket (for public access)
3. Create an API token with R2 Object Read & Write permissions
4. Note your account ID for the endpoint URL

```env
STORAGE_ADAPTER=s3

S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=your-r2-access-key-id
S3_SECRET_ACCESS_KEY=your-r2-secret-access-key
S3_BUCKET_NAME=my-podcast-audio
S3_PUBLIC_URL_BASE=https://audio.yourpodcast.com
```

---

## Switching Storage Adapters

You can switch adapters at any time. Existing episode `audio_url` values in the database will not be affected — they point to wherever they were originally uploaded. Only new uploads will use the new adapter.

If you want to migrate existing files, you'll need to:
1. Copy files to the new storage location manually
2. Update `audio_url` values in the database (or re-upload from the admin)

---

## Troubleshooting

### SFTP "Authentication failed"
- Verify the private key path in `SFTP_PRIVATE_KEY_PATH` is correct and readable
- Ensure the public key is in `~/.ssh/authorized_keys` on the remote server
- Test manually: `ssh -i /path/to/key user@host`

### S3 "AccessDenied"
- Verify your IAM/API credentials are correct
- Check bucket permissions — the bucket must allow public reads for streaming to work
- For Backblaze B2: make sure the bucket is set to **Public**

### Upload returns 500 / No file
- Check that `STORAGE_ADAPTER` is set to either `sftp` or `s3` (not `SFTP` or `S3`)
- Check server logs: `npm run dev` shows detailed error output
