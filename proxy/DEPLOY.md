# Deploy Guia: 2 CF Workers + Belmo (tudo free)

## Arquitetura

```
Stremio App
    │
    ├── CF Worker 1: avmirror-api (cache de API)
    │   ├── /manifest.json → cache 24h
    │   ├── /catalog/* → cache 5min
    │   ├── /meta/* → cache 1h
    │   └── /stream/* → cache 5min
    │
    ├── CF Worker 2: avmirror-proxy (images + HLS)
    │   ├── /proxy?url=... → images 7d
    │   └── /proxy?url=... → HLS 5min
    │
    └── Belmo Server (WebTorrent + scraping background)
        ├── /torrent/:hash.mp4 → WebTorrent streaming
        ├── /health → status
        └── Background scraper → atualiza cache em disco
```

## Passo 1: Deploy no Cloudflare Workers (free)

### 1.1 Instalar Wrangler CLI
```bash
npm install -g wrangler
```

### 1.2 Login no Cloudflare
```bash
wrangler login
```

### 1.3 Deploy Worker 1 (API)
```bash
cd proxy

# Criar o Worker
wrangler deploy -c wrangler-api.toml

# Definir ORIGIN_URL (URL do Belmo)
wrangler secret put ORIGIN_URL
# Digitar: https://avmirror-3843.onbelmo.uk
```

### 1.4 Deploy Worker 2 (Proxy)
```bash
wrangler deploy -c wrangler.toml
```

### 1.5 Configurar Stremio
No Stremio, usar a URL do Worker 1 como manifest:
```
https://avmirror-api.SEU_USERNAME.workers.dev/manifest.json
```

## Passo 2: Belmo Server (já rodando)

O Belmo server continua como está. O CF Worker faz proxy e cache.

### O que muda no Belmo:
- NADA. O server continua rodando com scraping background
- O CF Worker é quem recebe os requests do Stremio
- O CF Worker busca no Belmo quando não tem cache
- Belmo só recebe ~1100 requests/dia (cache miss)

## Passo 3: Configurar HTTPS (opcional, free)

### Opção A: Cloudflare (recomendado)
1. Comprar domínio ($10/ano) ou usar免费 .dev
2. Adicionar DNS no Cloudflare
3. Criar CNAME para cada Worker:
   - `api.seudominio.com` → `avmirror-api.SEU_USERNAME.workers.dev`
   - `proxy.seudominio.com` → `avmirror-proxy.SEU_USERNAME.workers.dev`

### Opção B: Workers.dev (free)
- `https://avmirror-api.SEU_USERNAME.workers.dev`
- `https://avmirror-proxy.SEU_USERNAME.workers.dev`

## Limites Free Tier

| Recurso | Free Limit | Uso Estimado |
|---|---|---|
| CF Requests | 100K/dia | 18-30K/dia |
| CF Cache API | 100K entradas | ~1100 entradas |
| Belmo RAM | 512MB | ~100MB |
| Belmo CPU | Shared | Background scraping |

## Monitoramento

### Health Check
```bash
# Belmo
curl https://avmirror-3843.onbelmo.uk/health

# CF Worker
curl https://avmirror-api.SEU_USERNAME.workers.dev/manifest.json
```

### Logs
```bash
# CF Worker logs
wrangler tail -c wrangler-api.toml

# Belmo logs
# Ver no Render dashboard
```

## Troubleshooting

### CF Worker retorna 502
- Verificar se ORIGIN_URL está correto
- Verificar se Belmo está rodando
- Verificar CORS headers

### Cache não funciona
- Verificar Cache API quota no dashboard
- TTL muito curto → aumentar CACHE_TTL

### Belmo com muitos requests
- Aumentar cache TTL no CF Worker
- Verificar se background scraper está rodando
