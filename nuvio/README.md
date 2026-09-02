# AVMirror para Nuvio

Este diretório contém um provider opcional para o Nuvio. O catálogo principal continua sendo o addon local do AVMirror, que cada usuário executa no próprio computador. O provider não cria outro catálogo e não mantém um servidor remoto.

## Addon local

Para usar catálogo, metadados e proxy HLS local, instale no Nuvio o manifesto do servidor escolhido:

```text
http://IP-DO-PC:7000/manifest.json
```

O manifesto local expõe somente a Jable.TV e usa IDs `jable:`. A página `/install` calcula o endereço correto quando é aberta no computador servidor.

## Provider opcional

O provider é instalado em **Configurações → Plugins** usando o manifesto do repositório:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

Ele exporta `getStreams(id, mediaType, season, episode)` e reconhece apenas IDs `jable:`. O provider consulta a página do vídeo no próprio dispositivo, extrai o `hlsUrl` e devolve a playlist HLS com os headers da Jable.TV. Para dispositivos que recebem desafio Cloudflare, ou para clientes que precisam de reescrita de segmentos, use o addon local com `USE_LOCAL_HLS_PROXY=true`.

## Compatibilidade

O provider usa `fetch`, Promises e APIs JavaScript básicas. Ele não usa Node.js, Express, Playwright, filesystem ou credenciais. O código evita `async/await` para manter compatibilidade com ambientes JavaScript móveis.

Use somente fontes, mídias e integrações para as quais você possui autorização e respeite os termos do serviço integrado.
