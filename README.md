# AVMirror 26.1.0

Addon para **Stremio e Nuvio** com servidor Node.js, catálogo AVMirror/Nova, metadados persistentes e agregação de streams. A versão técnica usada pelo manifesto é `26.1.0`, enquanto a versão de release exibida ao usuário é `26.1.0`.

O projeto possui uma única linha de desenvolvimento: **AVMirror 26.1.0**. O ambiente oficialmente documentado para desenvolvimento local é **Linux x86_64**, com Node.js 20 ou superior.

O release `26.1.0` está consolidado em um único commit no branch `main`. Ele inclui a correção do player HTTP, a reprodução torrent P2P direta, diagnóstico separado das fontes externas e uma suíte local de testes determinística.

## O que o projeto faz

O catálogo principal, a pesquisa e as categorias usam somente AVMirror/Nova. Quando o usuário abre uma obra, o agregador procura streams equivalentes nas fontes secundárias e combina os resultados sem duplicações.

O servidor também fornece um proxy universal para HLS, MP4 e segmentos. O proxy preserva headers, cookies e requisições `Range`, reescreve playlists HLS, repete requisições transitórias e aplica o limite configurável de banda por sessão. Para fontes torrent, o addon retorna `infoHash` e `sources` ao cliente Stremio para reprodução **P2P direta**; os bytes do torrent não passam pelo servidor.

## Fontes integradas

| Fonte | Tipo | Função |
| --- | --- | --- |
| AVMirror / Nova | HTTP | Catálogo principal, metadados e streams |
| JavQuick / Orange | HTTP | Stream secundário |
| HohoJ / Grape | HTTP | Stream secundário |
| GGJav / Strawberry | HTTP | Stream secundário |
| JAVMENU / Cherry | HTTP | Stream secundário |
| GoodAV17 / Pineapple | HTTP | Stream secundário |
| AVJoy / Mango | HTTP | Stream secundário |
| MissAV / Lemon | HTTP | Stream secundário |
| iJavTorrent / Watermelon | Torrent | Magnets via magnet links |
| ProjectJav / Blueberry | Torrent | Magnets via magnet links |
| FFJav / Kiwi | Torrent | Arquivo .torrent → infoHash |
| SukebeiNyaa / Sashimi | Torrent | Magnets via Nyaa |
| Nyaa / Nyaa | Torrent | Indexador Nyaa regular |
| BTDig / Guava | Torrent | Magnets via BTDig |
| Tokyo Toshokan / Tokyo | Torrent | Magnets via Tokyo Toshokan |
| JavDB / Olive | Torrent | Magnets via JavDB |
| 0Magnet / Peach | Torrent | Indexador público JAV/Asian; magnets e trackers |
| YourBittorrent / Mango | Torrent | Busca de magnets por código JAV |

São **18 fontes no total**: 8 fontes HTTP e 10 fontes torrent. Cada stream torrent recebe até **25 trackers públicos** e uma origem DHT, no mesmo modelo de descoberta P2P usado pelo Torrentio.

As fontes torrent são consultadas como fallback P2P direto. Os resultados válidos são deduplicados por `infoHash`; antes da seleção, o addon envia um `announce` curto aos trackers e usa a disponibilidade atual de peers quando houver resposta. Se os trackers não responderem, usa o número de seeds informado pelo indexador como fallback. O Stremio recebe somente dois players por item: um HTTP e um torrent P2P, sendo exibido como torrent o melhor swarm conhecido. Os demais hashes válidos ficam registrados internamente para fallback, sem criar botões adicionais. O addon não baixa nem retransmite bytes torrent.

O **AVSubtitles** é usado como fonte especializada de legendas JAV. Para cada código encontrado no stream atual, o addon procura legendas em inglês e espanhol, extrai o SRT fornecido pela fonte, converte-o para WebVTT e o anexa ao mesmo stream HTTP ou torrent por meio do campo `subtitles` do Stremio. A fonte não substitui o vídeo nem abre um player externo.

## Catálogos e pesquisa

O manifesto oferece os catálogos Recentes, Populares, Sem Censura, Censurado, Gêneros, Tags e Atrizes. A pesquisa por código, título ou atriz continua restrita ao AVMirror/Nova. A pesquisa de atriz usa aliases, filmografia, paginação e combinação com gênero ou tag.

Os posters usam uma rota estável baseada no ID da obra para evitar capas cinzas na biblioteca e no histórico. Os metadados retornam `name` e `title` para compatibilidade com interfaces Stremio e Nuvio.

## Instalação no Stremio e Nuvio

Manifesto público do addon:

```text
https://avmirror-3843.onbelmo.uk/manifest.json
```

Provider complementar do Nuvio:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

O provider do Nuvio resolve primeiro o endpoint unificado do addon. O addon principal continua sendo responsável pelo catálogo, metadados e streams.

## Desenvolvimento local no Linux

Requisitos:

- Linux x86_64;
- Node.js 20 ou superior;
- npm;
- Git.

Clone e instalação:

```bash
git clone https://github.com/devavmirror/avmirror.git
cd avmirror
npm ci
```

Inicie o servidor local:

```bash
npm run start:local
```

O servidor escuta por padrão em `0.0.0.0:7000`. Para testar no mesmo computador, abra:

```text
http://localhost:7000/install
```

Para testar a partir de outro dispositivo na mesma rede, use o endereço exibido por `/api/local-info` ou o IP Linux do computador:

```text
http://IP-DO-LINUX:7000/manifest.json
```

Modo de desenvolvimento com reinício automático:

```bash
npm run dev
```

## Testes locais para desenvolvedores

Execute a suíte completa:

```bash
npm test
```

`npm test` executa os testes unitários e a integração local sem depender da disponibilidade das fontes externas. Para executar os testes de rede e os fluxos e2e, use separadamente:

```bash
npm run test:external
npm run test:sources
```

Valide sintaxe e alterações antes de criar um commit:

```bash
node --check src/server.js
node --check src/lib/unified.js
node --check src/scrapers/ijavtorrent.js
node --check nuvio/providers/avmirror.js
git diff --check
```

Teste as fontes reais, quando a rede estiver disponível:

```bash
npm run test:sources
```

Teste o fluxo de endpoints localmente:

```bash
npm run test:e2e
```

Os testes unitários validam a extração de URLs HLS/MP4, headers de reprodução, normalização de `infoHash`, trackers e proteção contra anúncios. Os testes de integração validam manifesto, health check, proxy, proteção contra endereços privados e a desativação da retransmissão torrent HTTP. Os testes externos validam magnets e fontes reais quando a rede e os sites de origem estiverem disponíveis.

## Configuração

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `7000` | Porta HTTP |
| `BIND_HOST` | `0.0.0.0` | Interface de escuta |
| `PUBLIC_BASE_URL` | Detectada | URL pública usada nos links retornados |
| `BASE_URL` | `https://jav.guru` | Fonte AVMirror/Nova |
| `HLS_PROXY` | Ativo | Proxy universal de mídia; use `0` para desativar |
| `MAX_STREAM_MBPS` | `8` | Limite de banda por sessão |
| `CACHE_TTL_MS` | `900000` | TTL do cache dos scrapers |
| `CACHE_MAX_ENTRIES` | `500` | Limite do cache em memória |
| `IMAGE_CACHE_MAX_BYTES` | `50331648` | Limite do cache de imagens |

Exemplo de execução local com limite menor:

```bash
MAX_STREAM_MBPS=5 npm run start:local
```

## Endpoints principais

| Endpoint | Finalidade |
| --- | --- |
| `/manifest.json` | Manifesto Stremio/Nuvio |
| `/catalog/movie/:id.json` | Catálogos AVMirror |
| `/meta/movie/:id.json` | Metadados persistentes |
| `/stream/movie/:id.json` | Streams de vídeo (HTTP) e torrents |
| `/subtitle/avsubtitles/:subid/:revid` | Proxy controlado de legendas SRT/WebVTT para os streams atuais |
| `/hls?url=` | Proxy HLS/MP4 com headers, Range, retry e throttle |
| Torrents | `infoHash` e trackers enviados diretamente ao cliente Stremio; nenhum byte torrent passa pelo servidor |
| `/image?url=` | Proxy de posters permitido |
| `/poster/:id.jpg` | Poster estável por ID |
| `/health` | Versão, saúde e métricas |
| `/api/local-info` | Endereços para instalação na rede local |
| `/install` | Página de instalação guiada |

## Cache e automação

O workflow `.github/workflows/update-catalog-cache.yml` atualiza periodicamente os catálogos AVMirror sem filtros em `data/catalog/`. O cache contém dados de catálogo e posters, nunca tokens, cookies ou vídeos. Pesquisa, atriz, gênero e tag continuam consultando a fonte ao vivo quando necessário.

## Estrutura do projeto

```text
src/server.js                 Servidor Express e handlers Stremio
src/lib/unified.js            Agregador de fontes e matching por código
src/lib/catalog-cache.js      Leitura do cache de catálogos
src/lib/proxy-fetch.js        Proxy para requisições de scrapers
src/lib/background-scraper.js Atualização periódica de catálogos
src/scrapers/avmirror.js      Catálogo e metadados AVMirror/Nova
src/scrapers/javquick.js      Stream HTTP secundário
src/scrapers/hohoj.js         Stream HTTP secundário
src/scrapers/ggjav.js         Stream HTTP secundário
src/scrapers/javmenu.js       Stream HTTP secundário
src/scrapers/goodav17.js      Stream HTTP secundário
src/scrapers/avjoy.js         Stream HTTP secundário
src/scrapers/missav.js        Stream HTTP secundário
src/scrapers/ijavtorrent.js   Torrent magnets
src/scrapers/projectjav.js    Torrent magnets
src/scrapers/ffjav.js         Torrent .torrent → infoHash
src/scrapers/sukebeinyaa.js   Torrent magnets (Nyaa)
src/scrapers/btdig.js         Torrent magnets (BTDig)
src/scrapers/tokyo-tosho.js   Torrent magnets (Tokyo Toshokan)
src/scrapers/javdb.js         Torrent magnets (JavDB)
src/scrapers/zeromagnet.js    Peach — indexador público JAV/Asian e magnets
src/scrapers/avsubtitles.js   Legendas JAV SRT em inglês e espanhol
test/                         Testes unitários, integração e fontes reais
nuvio/providers/avmirror.js   Provider complementar do Nuvio
.github/workflows/             Atualização automática de catálogos
data/catalog/                 Cache versionado de catálogos
```

## Segurança e uso responsável

O servidor aplica rate limiting, validação de URLs, bloqueio de redes privadas e allowlists para mídia e imagens. Use somente fontes, mídias e integrações para as quais exista autorização. Não tente contornar autenticação, paywalls, bloqueios ou restrições de acesso.

## Licença

Consulte o arquivo `LICENSE` para os termos aplicáveis.

## Release

A release atual é `26.1.0`, com manifesto técnico `26.1.0`. O repositório mantém a release consolidada no branch `main` e a tag Git `v26.1.0`.

[Repositório GitHub]: https://github.com/devavmirror/avmirror
[Manifesto público]: https://avmirror-3843.onbelmo.uk/manifest.json
[Provider Nuvio]: https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
[Node.js]: https://nodejs.org/
[Stremio]: https://www.stremio.com/
[Nuvio]: https://nuvio.app/
