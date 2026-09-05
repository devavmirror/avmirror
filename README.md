# AVMirror

Addon para **Stremio e Nuvio** com servidor local multi-fonte, cache em disco e rate limiting.

> **v26.3** · Node.js ≥ 20 · Licença: ver `LICENSE`

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    Stremio / Nuvio                       │
└────────────────────────┬────────────────────────────────┘
                         │ manifest.json
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   AVMirror Server                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Catalog  │  │   Meta   │  │  Stream  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│       ▼              ▼              ▼                    │
│  ┌─────────────────────────────────────────┐            │
│  │          Unified Aggregator             │            │
│  │    (merge · dedup · normalize)          │            │
│  └──────────────────┬──────────────────────┘            │
│                     │                                   │
│  ┌──────────────────┴──────────────────────┐            │
│  │         9 Scrapers Paralelos            │            │
│  └─────────────────────────────────────────┘            │
│                                                         │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐              │
│  │  Cache  │  │  Rate    │  │  Image    │              │
│  │  Disco  │  │  Limiter │  │  Proxy    │              │
│  └─────────┘  └──────────┘  └───────────┘              │
└─────────────────────────────────────────────────────────┘
```

---

## Fontes

| Emoji | Fonte | Base URL | Gênero | Busca | Popular | Sem Censura |
|:---:|------|----------|:------:|:-----:|:-------:|:-----------:|
| 🌐 | AVMirror | jav.guru | ✅ | ✅ | ✅ | — |
| ⚡ | JavQuick | javquick.com | — | ✅ | — | — |
| 🔥 | 18Jav | 18jav.tv | ✅ | ✅ | ✅ | — |
| 🎯 | HohoJ | hohoj.tv | — | ✅ | ✅ | — |
| 🟣 | GGJav | ggjav.com | ✅ | ✅ | ✅ | ✅ |
| 🟢 | Porn87 | porn87.com | ✅ | ✅ | — | — |
| 🔴 | JAVMENU | javmenu.com | ✅ | ✅ | — | — |
| 🔵 | GoodAV17 | goodav17.com | — | ✅ | — | — |
| 🟡 | AVJoy | avjoy.me | — | ✅ | — | — |

---

## Players

| Player | Tipo | Proxy HLS | Instalação |
|--------|------|-----------|------------|
| **Stremio** | Addon remoto/local | Opcional | `/manifest.json` |
| **Nuvio** | Addon + Provider | Opcional | `/manifest.json` + plugin provider |

---

## Catálogos

| Catálogo | Descrição | Fontes ativas |
|----------|-----------|:------------:|
| **AVMirror** | Lançamentos recentes | 9 |
| **Populares** | Mais assistidos | 4+fallback |
| **Sem Censura** | Conteúdo uncensored | 1+fallback |

**Pesquisa**: por código (`ABP-123`) ou texto/actress (`hitomi tanaka`) em todas as fontes.

**Gêneros**: 50+ categorias disponíveis em tempo real.

---

## Instalação

### Stremio / Nuvio

```
http://SEU-IP:7000/manifest.json
```

### Servidor local

```bash
npm install
npm start
```

Acesse `http://localhost:7000/install` para instalação guiada.

### Variáveis de ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | `7000` | Porta HTTP |
| `BIND_HOST` | `0.0.0.0` | Interface de escuta |
| `LOCAL_MODE` | `true` | Modo local (proxy habilitado) |
| `CACHE_UPDATE_INTERVAL_MS` | `1800000` | Intervalo do cache background (30min) |
| `CACHE_CATALOG_PAGES` | `3` | Páginas cacheadas por catálogo |
| `CACHE_META_LIMIT` | `30` | Metadados cacheados |
| `RATE_LIMIT_MAX_GLOBAL` | `120` | Req/min por IP (catalog/meta/stream) |
| `RATE_LIMIT_MAX_PROXY` | `30` | Req/min por IP (image/hls) |

---

## Endpoints

| Rota | Método | Descrição |
|------|--------|-----------|
| `/manifest.json` | GET | Manifesto do addon |
| `/catalog/movie/:id.json` | GET | Catálogo (avmirror, avmirror-popular, avmirror-uncensored) |
| `/meta/movie/:id.json` | GET | Metadados detalhados |
| `/stream/movie/:id.json` | GET | Streams de reprodução |
| `/image?url=` | GET | Proxy de imagens (allowlist) |
| `/hls?url=` | GET | Proxy HLS (modo local) |
| `/health` | GET | Health check |
| `/install` | GET | Página de instalação |
| `/api/local-info` | GET | Info da rede local |

---

## Cache

### Em memória
- TTL: 15min · Max: 500 entries por scraper
- Resetado a cada reinício do servidor

### Em disco (background worker)
- Atualização automática a cada 30 min
- Fallback quando scraping live falha
- Localização: `cache/catalog/` e `cache/meta/`

### Fluxo de request

```
Request → Cache GitHub (remote) → Scraping Live → Cache Disco (fallback)
                         ↓                              ↓
                    Hit? Retorna                  Salva para próxima
```

---

## Segurança

- **Rate limiting**: 120 req/min global, 30 req/min proxy por IP
- **Image proxy**: allowlist de hosts permitidos
- **HLS proxy**: allowlist de hosts + streaming (não bufferiza)
- **CORS**: `*` (necessário para Stremio)
- **Process handlers**: `unhandledRejection` + `uncaughtException`

---

## Estrutura

```
src/
├── server.js           # Servidor Express + addon SDK
├── cache.js            # Leitura/escrita cache em disco
├── cache-worker.js     # Worker background de atualização
├── lib/
│   ├── unified.js      # Agregador multi-fonte
│   └── network.js      # Detecção de IP LAN
├── scrapers/
│   ├── avmirror.js     # 🌐 jav.guru
│   ├── javquick.js     # ⚡ javquick.com
│   ├── 18jav.js        # 🔥 18jav.tv
│   ├── hohoj.js        # 🎯 hohoj.tv
│   ├── ggjav.js        # 🟣 ggjav.com
│   ├── porn87.js       # 🟢 porn87.com
│   ├── javmenu.js      # 🔴 javmenu.com
│   ├── goodav17.js     # 🔵 goodav17.com
│   └── avjoy.js        # 🟡 avjoy.me
└── public/
    └── install.html    # Página de instalação
```

---

## Desenvolvimento

```bash
# Instalar dependências
npm install

# Iniciar com hot reload
npm run dev

# Rodar testes
npm test
```

---

## Uso responsável

Use somente com fontes e conteúdos para os quais possui autorização. Respeite os termos de serviço de cada fonte integrada.

---

## Licença

Ver `LICENSE` para termos aplicáveis.
