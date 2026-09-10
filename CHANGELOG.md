# Changelog

## 26.1.0

- **YourBittorrent (Mango)**: nova fonte de torrents com API pública gratuita, 15.500+ torrents JAV indexados, melhor seeders médios (7.4) e 100% de sucesso.
- **Sistema de prioridade dinâmica**: fontes torrent são reordenadas automaticamente por performance (sucesso + seeders). Score exposto no `/health` em `sourceScores`.
- **Proxy Cloudflare Worker atualado**: `btdig.com`, `tokyo-tosho.net`, `16mag.net` adicionados ao `ALLOWED_HOSTS`. Timeout de 25s. Cache desabilitado para HTML. Cooldown de 5min para sites que retornam 403.
- **Browser headers completos**: `Sec-Ch-Ua`, `Accept-Language`, `Accept-Encoding`, `Cache-Control`, `Referer` em todas as requisições via `browserFetch()`.
- **Proxy com cooldown por host**: sites que retornam 403 são ignorados por 5 minutos, evitando requisições desperdiçadas.
- Adicionado iJavTorrent como provedor de torrent de fallback. Ele expõe magnets para reprodução pelo player torrent do Stremio, sem alterar o catálogo principal do AVMirror, e é consultado quando o código da obra coincide.
- A busca do iJavTorrent agora usa o endpoint de pesquisa do site, normaliza códigos com ou sem hífen e retorna todos os magnets encontrados na página da obra.

- Padronização da versão em todo o projeto.
- Catálogo, pesquisa e categorias restritos à fonte AVMirror/Nova.
- Resolução de streams secundários somente após abertura de um item AVMirror.
- Proxy universal para HLS, MP4 e segmentos.
- Preservação de headers, cookies e requisições `Range`.
- Limite configurável por sessão com `MAX_STREAM_MBPS`.
- Cache curto e deduplicação da resolução de streams.
- Provider Nuvio alinhado ao endpoint unificado do addon.
- Métricas agregadas no `/health`.
- Proteção contra upstreams privados e endereços de rede interna.
- Documentação de capacidade, implantação e operação atualizada.
- Testes de integração para health check, manifesto, catálogo e SSRF.
- Cache de catálogos atualizado automaticamente por GitHub Actions, com fallback online.
- Catálogos separados para recentes, populares, censurado, sem censura, gêneros, tags e atrizes.
- Pesquisa de atriz direcionada à página de filmografia, incluindo aliases como “Hitomi Tanaka” → “Hitomi”.
- Ordenação de Populares corrigida para visualizações, evitando repetir automaticamente os lançamentos recentes.
- Match de filtros por interseção: atriz + gênero, atriz + tag, texto + gênero e texto + tag.
- Fallback reforçado para CDNs instáveis: novas tentativas com backoff para HTTP 404, 502, 526 e outros erros transitórios.
- Resolução repetida e deduplicada para Ember, Luna, Jade e Crimson, permitindo que URLs rotativas substituam endpoints expirados.
- Posters agora usam uma rota estável por ID do item, evitando capas cinzas na biblioteca e no histórico quando a URL original expira.
- Metadados recuperam o poster do card de catálogo quando a página detalhada da fonte não fornece `og:image`.
- Busca por atriz reconhece nomes abreviados exibidos pelo índice, como “Hitomi” para “Hitomi Tanaka”, mantendo a paginação completa.
- Busca por atriz agora combina globalmente aliases e páginas duplicadas da mesma atriz, como nomes invertidos, deduplica as obras e preserva a paginação.
- Metadados passam a usar a logo oficial do addon no campo `logo`, enquanto o poster continua sendo individual por obra.
