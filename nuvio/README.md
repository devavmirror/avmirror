# AVMirror para Nuvio

O AVMirror para Nuvio possui **duas camadas complementares**. O **addon** fornece catálogo, metadados e streams. O **plugin scraper** resolve fontes diretamente no aparelho quando o Nuvio consulta um item do catálogo.

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

A página `/install` calcula o endereço correto quando é aberta pelo computador local. O addon local pode retornar URLs diretas ou usar o proxy HLS local quando `USE_LOCAL_HLS_PROXY=true` estiver ativo.

## 2. Plugin scraper complementar

O plugin é instalado em **Configurações → Plugins** usando o manifesto do repositório:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

Ele não cria um segundo catálogo. Sua função é ser uma fonte complementar para itens que já foram encontrados pelo catálogo do Nuvio ou pelo addon AVMirror. Ele exporta `getStreams(id, mediaType, season, episode)` e reconhece IDs `avmirror:`.

Para IDs codificados `avmirror:`, ele tenta extrair URLs diretas `.m3u8` ou `.mp4` da página correspondente.

## Como as duas camadas trabalham juntas

```text
Addon AVMirror → catálogo e metadados → usuário escolhe um título
                                           ↓
Plugin scraper → tenta resolver uma fonte diretamente no aparelho
                                           ↓
Addon local opcional → proxy HLS quando a fonte exige reescrita ou headers especiais
```

O plugin não consegue transformar uma URL direta em proxy HLS por conta própria. O sandbox do Nuvio executa JavaScript no aparelho, mas não mantém um servidor HTTP contínuo para retransmitir segmentos. Quando uma fonte exige proxy, instale o servidor local e use o manifesto local do addon com `USE_LOCAL_HLS_PROXY=true`.

## Compatibilidade

O provider usa `fetch`, Promises e APIs JavaScript básicas. Ele não usa Node.js, Express, Playwright, filesystem ou credenciais do projeto. O código evita `async/await` para compatibilidade com o ambiente Hermes documentado para scrapers Nuvio.

Fontes que exigem navegador completo, cookies de sessão ou reescrita contínua de segmentos podem não funcionar no plugin direto. Nessas situações, o addon local com proxy HLS é a alternativa apropriada.

## Atualizações

O manifesto e o plugin hospedados no GitHub são atualizados quando o repositório recebe novas versões. O Nuvio pode fazer novo carregamento do manifesto conforme o comportamento da versão instalada do aplicativo. Um fork próprio permite manter as fontes e alterações sob controle do usuário.
