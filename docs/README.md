# AVMirror 26.1.0 — documentação técnica

O AVMirror 26.1.0 é um addon para Stremio e Nuvio executado como servidor Node.js. O catálogo principal e os metadados são fornecidos por AVMirror/Nova. As sete fontes de vídeo secundárias e as quatro fontes torrent são consultadas somente durante a resolução de streams do item selecionado.

A versão técnica do manifesto é `26.1.0`. O release está consolidado em um único commit chamado `26.1.0` no branch `main`, com a tag `v26.1.0`. O ambiente de desenvolvimento documentado é Linux x86_64 com Node.js 20 ou superior.

## Execução local

```bash
git clone https://github.com/devavmirror/avmirror.git
cd avmirror
npm ci
npm run start:local
```

A instalação guiada fica em `http://localhost:7000/install`. Para outro dispositivo da rede, use `http://IP-DO-LINUX:7000/manifest.json`.

Para desenvolvimento com reinício automático:

```bash
npm run dev
```

## Testes

```bash
npm test
npm run test:external
node --check src/server.js
node --check src/lib/unified.js
node --check src/scrapers/ijavtorrent.js
node --check nuvio/providers/avmirror.js
git diff --check
```

Os testes unitários e de integração local não dependem dos sites externos. Os testes de fonte e e2e usam a rede e podem depender da disponibilidade dos sites externos:

```bash
npm run test:sources
npm run test:e2e
```

## Reprodução

A rota `/hls` funciona como proxy universal para HLS, MP4 e segmentos. Ela preserva `Referer`, `User-Agent`, `Origin`, cookies e requisições `Range`, reescreve playlists HLS, repete respostas transitórias e limita a banda por sessão com `MAX_STREAM_MBPS`. Não há transcodificação.

Streams torrent são entregues ao cliente com `infoHash` e `sources` para reprodução **P2P direta**. O servidor não baixa nem retransmite os bytes do torrent; a reprodução depende do suporte WebTorrent do cliente Stremio.

## Configuração

| Variável | Finalidade | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP | `7000` |
| `BIND_HOST` | Interface de escuta | `0.0.0.0` |
| `PUBLIC_BASE_URL` | URL anunciada nos streams | Detectada/configurada |
| `BASE_URL` | Fonte AVMirror/Nova | `https://jav.guru` |
| `HLS_PROXY` | Ativa ou desativa o proxy | Ativo |
| `MAX_STREAM_MBPS` | Limite por sessão | `8` |
| `CACHE_TTL_MS` | TTL dos scrapers | `900000` |
| `CACHE_MAX_ENTRIES` | Entradas máximas de cache | `500` |
| `IMAGE_CACHE_MAX_BYTES` | Tamanho máximo do cache de imagens | `50331648` |
| `TORRENT_TIMEOUT_MS` | Timeout para conexão de torrent | `45000` |
| `TORRENT_MAX_ACTIVE` | Máximo de torrents ativos simultâneos | `3` |
| `TORRENT_STALE_MS` | Tempo para limpar torrents inativos | `300000` |

## Catálogo persistente

O workflow `.github/workflows/update-catalog-cache.yml` atualiza os catálogos AVMirror sem filtros em `data/catalog/`. O cache contém apenas dados de catálogo e posters. Não são salvos vídeos, tokens ou cookies temporários. Pesquisa por código, título, atriz, gênero e tag usa a fonte ao vivo quando necessário.

## Endpoints

| Endpoint | Finalidade |
| --- | --- |
| `/manifest.json` | Manifesto Stremio/Nuvio 26.1.0 |
| `/catalog/...` | Catálogos Recentes, Populares, Censurado, Sem Censura, Gêneros, Tags e Atrizes |
| `/meta/...` | Metadados com `name`, `title`, poster estável e logo do addon |
| `/stream/...` | Streams secundários (HTTP) e torrents |
| `/hls` | Proxy HLS/MP4 com headers, Range, retry e throttle |
| Torrents | `infoHash` e trackers são enviados diretamente ao cliente Stremio; nenhum byte torrent passa pelo servidor |
| `/poster/:id.jpg` | Poster persistente por ID |
| `/health` | Saúde, release e métricas |
| `/api/local-info` | Endereços locais de instalação |

## Nuvio

O addon principal fornece catálogo, metadados e streams. O provider complementar está em `nuvio/providers/avmirror.js` e consulta primeiro o endpoint unificado público. O manifesto do provider é `nuvio/manifest.json`.

## Operação e segurança

O servidor aplica rate limiting, validação de URLs, bloqueio de endereços privados e allowlists de mídia e imagens. Variáveis com tokens, cookies ou credenciais nunca devem ser commitadas. Utilize somente fontes e conteúdos para os quais exista autorização.

[Repositório GitHub]: https://github.com/devavmirror/avmirror
[Manifesto público]: https://avmirror-3843.onbelmo.uk/manifest.json
[Provider Nuvio]: https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
