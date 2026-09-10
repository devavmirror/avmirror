# AVMirror Proxy Relay

Deploy this on Vercel (free) to relay requests from Belmo to Cloudflare-protected sites.

## Deploy

1. Install Vercel CLI: `npm i -g vercel`
2. `cd proxy && vercel --prod`
3. Copy the URL (e.g. `https://your-proxy.vercel.app`)
4. Set env var on Belmo: `PROXY_URL=https://your-proxy.vercel.app`

## How it works

The proxy accepts GET requests with a `url` query parameter and relays them.
Only whitelisted domains are allowed (rdse.lol, javmenu.com, etc.).
