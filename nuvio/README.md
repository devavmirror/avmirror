# AVMirror para Nuvio

O AVMirror para Nuvio possui **duas camadas complementares**. O **addon** fornece catálogo, metadados e streams unificados. O **plugin scraper** consulta primeiro o endpoint do addon e mantém um fallback direto para itens AVMirror.

## 1. Addon com catálogo

O addon usa o manifesto padrão compatível com Nuvio e Stremio. Ele expõe os recursos `catalog`, `meta` e `stream`, incluindo catálogos AVMirror.

Para instalar o catálogo no Nuvio, adicione o endereço do manifesto do servidor escolhido:

```text
https://SEU-ENDERECO/manifest.json
```

Para usar o servidor pessoal:

```text
http://IP-DO-PC:7000/manifest.json
```

A página `/install` calcula o endereço correto quando é aberta pelo computador local. O proxy universal de mídia fica ativo por padrão e atende HLS, MP4, headers, cookies e requisições `Range`.

## 2. Plugin scraper complementar

O plugin é instalado em **Configurações → Plugins** usando o manifesto do repositório:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

Ele não cria um segundo catálogo. Sua função é resolver streams para itens que já foram encontrados pelo catálogo do Nuvio ou pelo addon AVMirror. Ele exporta `getStreams(id, mediaType, season, episode)` e reconhece IDs `avmirror:`.

Para IDs codificados `avmirror:`, ele consulta o endpoint unificado do addon e, se necessário, tenta extrair URLs `.m3u8` ou `.mp4` da página correspondente.

## Como as duas camadas trabalham juntas

```text
Addon AVMirror → catálogo e metadados → usuário escolhe um título
                                           ↓
Plugin scraper → consulta o endpoint unificado do addon
                                           ↓
Addon AVMirror → AVMirror/Nova + fontes secundárias do item
```

O proxy é mantido pelo addon, não pelo sandbox JavaScript do Nuvio. Por isso, o provider retorna preferencialmente os streams do endpoint unificado, permitindo que fontes com headers, cookies ou playlists reescritas usem o mesmo fluxo compatível dos players Stremio.

## Compatibilidade

O provider usa `fetch`, Promises e APIs JavaScript básicas. Ele não usa Node.js, Express, Playwright, filesystem ou credenciais do projeto. O código evita `async/await` para compatibilidade com o ambiente Hermes documentado para scrapers Nuvio.

Fontes que exigem navegador completo podem continuar indisponíveis quando o provedor externo não entrega um stream autorizado. O addon registra erros e mantém as demais fontes do item disponíveis.

## Atualizações

O manifesto e o plugin hospedados no GitHub são atualizados quando o repositório recebe novas versões. O Nuvio pode fazer novo carregamento do manifesto conforme o comportamento da versão instalada do aplicativo. Um fork próprio permite manter as fontes e alterações sob controle do usuário.
