# Getting Started with Podshelf

Welcome to Podshelf — a self-hosted podcast publishing platform designed for hobbyists who want to own their feed, own their files, and skip the middleman.

This guide walks you through everything you need to go from zero to publishing your first episode.

---

## What You Need

Podshelf is designed to run on modest infrastructure. You'll need:

1. **A server or VPS** to run Podshelf (even a $5/mo VPS works, or a Raspberry Pi on your local network)
   - Node.js 18+ is required
   - 512MB RAM is plenty for small shows
2. **Audio file hosting** — one of:
   - **SFTP access** to a web-accessible directory (shared hosting like Dreamhost, Hostinger, etc.)
   - **S3-compatible storage** (AWS S3, Backblaze B2, Cloudflare R2)
3. A domain or subdomain where your podcast site will live

---

## Quick Start (5 Commands)

```bash
# 1. Clone the repo
git clone https://github.com/your-repo/podshelf.git
cd podshelf

# 2. Install dependencies
npm install

# 3. Copy and configure your environment
cp .env.example .env
# Edit .env with your favorite editor

# 4. Start in development mode
npm run dev

# 5. Open the admin
open http://localhost:3000/admin
```

That's it. Your podcast site is at `http://localhost:3000` and the RSS feed is at `http://localhost:3000/feed.xml`.

---

## Configuring Your Environment

Open `.env` and fill in at minimum:

```env
# Where your database lives (auto-created)
DATABASE_PATH=./data/podshelf.db

# The public URL of your site (used in RSS feed links)
SITE_URL=https://yourpodcast.example.com

# Choose how audio files are stored: sftp or s3
STORAGE_ADAPTER=sftp

# Protect the /admin area
ADMIN_PASSWORD=pickasecurepassword
```

Then fill in your storage settings. See [storage.md](./storage.md) for details.

---

## Running on Dreamhost (Shared Hosting)

Dreamhost and similar shared hosts are a great fit — you get SFTP access out of the box for audio file storage. For running Podshelf itself, you have options:

### Option A: Dreamhost VPS or Cloud (Recommended)

Dreamhost VPS plans support Node.js. Set up Node 18 and run Podshelf as a background process using PM2:

```bash
npm install -g pm2
npm run build
pm2 start .output/server/index.mjs --name podshelf
pm2 save
pm2 startup
```

Set up an Nginx or Apache reverse proxy to forward requests to port 3000.

### Option B: Separate $5/mo VPS + Dreamhost for File Storage

Run Podshelf on any cheap VPS (DigitalOcean, Hetzner, Linode). Use your Dreamhost account just for audio file hosting via SFTP.

Configure `.env`:
```env
STORAGE_ADAPTER=sftp
SFTP_HOST=yoursite.dreamhost.com
SFTP_USER=yourusername
SFTP_PRIVATE_KEY_PATH=/home/deploy/.ssh/id_rsa
SFTP_REMOTE_DIR=/home/yourusername/yoursite.com/podcast/audio
SFTP_PUBLIC_URL_BASE=https://yoursite.dreamhost.com/podcast/audio
```

Make sure the `SFTP_REMOTE_DIR` corresponds to a publicly web-accessible path.

---

## First Episode Workflow

### Step 1: Configure Your Show

1. Go to `/admin/settings`
2. Fill in: Show Title, Description, Author, Email, Cover Art URL, Category
3. Save

### Step 2: Upload an Episode

1. Go to `/admin/episodes/new`
2. Enter the episode title
3. Upload your MP3 file — Podshelf will handle the upload to your storage
4. Write (or paste) your show notes in the Description field
5. Set Episode Number and Season (optional)
6. Click **Save & Publish** (or Save Draft first, then publish when ready)

### Step 3: Submit to Podcast Directories

Once you have at least one published episode, submit your RSS feed to:

- **Apple Podcasts**: [podcastsconnect.apple.com](https://podcastsconnect.apple.com)
- **Spotify**: [podcasters.spotify.com](https://podcasters.spotify.com)
- **Google Podcasts** (via Spotify): submit there too
- **Overcast, Pocket Casts**: they'll pick it up automatically from Apple

Your RSS feed URL is: `https://yourpodcast.example.com/feed.xml`

---

## Production Deployment

For production, build the app first:

```bash
npm run build
```

This creates a `.output/` directory. Run the server:

```bash
node .output/server/index.mjs
```

Or with PM2 for process management:

```bash
pm2 start .output/server/index.mjs --name podshelf
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name yourpodcast.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then set up SSL with Let's Encrypt:
```bash
sudo certbot --nginx -d yourpodcast.example.com
```

---

## Backing Up Your Data

Everything important is in two places:
1. `./data/podshelf.db` — your SQLite database (episode metadata, settings)
2. Your audio files on SFTP/S3

Back up the database daily:

```bash
# Add to crontab (crontab -e)
0 2 * * * cp /path/to/podshelf/data/podshelf.db /path/to/backups/podshelf-$(date +\%Y\%m\%d).db
```

---

## Updating Podshelf

```bash
git pull
npm install
npm run build
pm2 restart podshelf
```

The SQLite schema uses `CREATE TABLE IF NOT EXISTS`, so existing data is safe on update.
