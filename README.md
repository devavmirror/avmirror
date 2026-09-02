# AVMirror 26.1

O AVMirror é um addon descentralizado para Stremio. Cada computador executa uma instância própria do servidor, consulta a Jable.TV diretamente, resolve os players localmente e entrega catálogo, metadados e mídia ao Stremio. Não há dependência de Render, cache central, proxy remoto ou servidor compartilhado para o funcionamento do addon.

> **Modelo de execução:** o computador que executa o AVMirror é o dono do servidor, do cache em memória e do tráfego entre o Stremio e a fonte externa.

## Arquitetura local

| Componente | Responsabilidade | Onde executa |
| --- | --- | --- |
| AVMirror Local | Manifesto, catálogo, metadados, resolução do HLS e proxy opcional | Computador do usuário |
| Jable.TV | Fonte única de catálogo, páginas de detalhe e players | Internet |
| Stremio | Cliente que consulta o manifesto e reproduz o stream | Computador ou dispositivo do usuário |
| Nuvio provider | Resolver opcional para IDs `jable:` sem catálogo próprio | Dispositivo do usuário |

O servidor usa Chromium/Playwright para carregar as páginas da Jable.TV, porque o acesso HTTP simples pode receber um desafio Cloudflare. O módulo extrai o `hlsUrl` criado pela página, ignora a prévia MP4 e os URLs promocionais, e retorna a playlist HLS ao Stremio. No modo local, o proxy HLS retransmite a playlist e os segmentos pelo computador do usuário para atender clientes que não repassam corretamente os headers.

## Instalação no Stremio

Instale as dependências e inicie o servidor no computador que ficará ligado durante o uso:

```bash
npm ci
npx playwright install chromium
LOCAL_MODE=true BIND_HOST=0.0.0.0 PORT=7000 npm start
```

Abra a página abaixo no próprio computador servidor:

```text
http://127.0.0.1:7000/install
```

Para instalar o addon no Stremio do mesmo computador, use:

```text
http://127.0.0.1:7000/manifest.json
```

Para instalar em outro dispositivo da mesma rede, substitua `127.0.0.1` pelo IP LAN do computador servidor, por exemplo:

```text
http://192.168.1.50:7000/manifest.json
```

O computador e o dispositivo cliente precisam estar na mesma rede, e a porta `7000` deve estar liberada no firewall. A página `/install` mostra o endereço local calculado e cria o link de instalação `stremio://` automaticamente.

## Fonte e catálogo

O manifesto expõe somente a Jable.TV:

| Catálogo | Rota consultada |
| --- | --- |
| AVMirror — Jable.TV — Novos | `/latest-updates/` e `/latest-updates/{página}/` |
| AVMirror — Jable.TV — Populares | `/hot/` e `/hot/{página}/` |
| Pesquisa | `/search/{termo}/` |
| Gênero/tag | `/tags/{slug}/` e `/tags/{slug}/{página}/` |

Os IDs dos filmes usam o formato `jable:<base64url-da-página-de-vídeo>`. O servidor aceita somente páginas no padrão `https://jable.tv/videos/{slug}/`; IDs antigos de outras fontes são rejeitados.

## Reprodução dos players

O fluxo de reprodução é:

```text
Stremio → servidor AVMirror no computador → Jable.TV/CDN HLS
```

O servidor extrai a playlist HLS do script da página de detalhe e retorna um stream com `Referer`, `Origin` e `User-Agent` compatíveis. Com `USE_LOCAL_HLS_PROXY=true`, que é o padrão no modo local, o URL entregue ao Stremio aponta para `/hls/...` no próprio computador. O proxy reescreve as referências relativas da playlist para que os segmentos `.ts` e a chave AES-128 também passem pelo mesmo servidor local.

Se o cliente conseguir repassar headers corretamente e você preferir evitar o proxy, é possível usar:

```bash
LOCAL_MODE=true USE_LOCAL_HLS_PROXY=false BIND_HOST=0.0.0.0 PORT=7000 npm start
```

O modo direto depende do suporte do cliente Stremio a `Referer`, `Origin` e URLs HLS com tokens temporários. Para Stremio Android/TV, o proxy local é a opção recomendada.

## Nuvio opcional

O plugin em `nuvio/` não cria uma fonte adicional. Ele reconhece apenas IDs `jable:` e tenta extrair o `hlsUrl` diretamente no dispositivo que executa o Nuvio. O addon local continua sendo a opção principal quando o dispositivo não consegue passar pelo desafio do site ou não suporta os headers exigidos:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

## Desenvolvimento e testes

Os testes unitários não dependem do site externo:

```bash
npm test
node --check server.js
node --check jable.js
node --check nuvio/providers/avmirror.js
node --check scripts/start-local.js
```

Para testar o fluxo contra a fonte real, com Chromium instalado:

```bash
node scripts/test-live-sources.js
node scripts/e2e-local.js
```

O smoke test de uma instância já iniciada pode ser executado com:

```bash
node scripts/smoke-local.js
```

O cache em `cache/` é opcional e não é consultado pelo servidor local. Se for necessário gerar uma fotografia local de catálogo/metadados para diagnóstico, use:

```bash
CACHE_PAGES=1 CACHE_META_LIMIT=10 node scripts/update-cache.js
```

## Estrutura principal

| Caminho | Responsabilidade |
| --- | --- |
| `server.js` | Servidor local, manifesto, endpoints e proxy HLS |
| `jable.js` | Catálogo, metadados, resolução do player e validação da Jable.TV |
| `nuvio/manifest.json` | Manifesto do resolver opcional |
| `nuvio/providers/avmirror.js` | Resolver direto exclusivo para IDs `jable:` |
| `scripts/start-local.js` | Inicialização local e abertura da página de instalação |
| `scripts/update-cache.js` | Geração opcional de snapshot local Jable |
| `public/install.html` | Página de instalação e diagnóstico |
| `test/jable.test.js` | Testes determinísticos da integração |

## Endpoints locais

| Endpoint | Finalidade |
| --- | --- |
| `/install` | Instalação e diagnóstico do servidor local |
| `/health` | Verificação de saúde |
| `/manifest.json` | Manifesto do addon local |
| `/catalog/...` | Catálogos Jable e pesquisa |
| `/meta/...` | Metadados de um vídeo Jable |
| `/stream/...` | Streams HLS resolvidos localmente |
| `/image?url=...` | Proxy de capas da Jable.TV |
| `/hls/...` | Proxy HLS local para playlist, segmentos e chave |
| `/api/local-info` | Endereço LAN e configuração do proxy |

## Uso responsável

Use o projeto somente com fontes, mídias e integrações para as quais você possui autorização. Respeite a legislação aplicável, os termos dos serviços integrados e os direitos dos titulares do conteúdo. A fonte Jable.TV é adulta; o manifesto mantém `behaviorHints.adult: true`.

## Licença

Consulte `LICENSE` para os termos aplicáveis ao código.

## Referências

[1]: https://www.stremio.com/ "Stremio"
[2]: https://jable.tv/ "Jable.TV"
