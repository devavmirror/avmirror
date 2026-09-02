# AVMirror Direct para Nuvio

Este provider foi separado do addon Stremio para executar a resolução diretamente no aparelho do usuário. Ele não consulta Render, Cloudflare ou outro servidor AVMirror. O player do Nuvio baixa o manifesto/arquivo diretamente da fonte, usando os headers retornados pelo provider.

## Instalação

No Nuvio, abra **Configurações → Plugins** e adicione o manifesto:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

## Funcionamento

O provider exporta `getStreams(id, mediaType, season, episode)` e reconhece IDs próprios do catálogo AVMirror. Para `av01:<id>`, ele consulta a API da fonte diretamente e devolve o manifesto HLS original. Para IDs `avmirror:` e `javrider:`, ele tenta extrair URLs diretas `.m3u8` ou `.mp4` da página codificada no ID.

Não existe proxy HLS local neste provider. Isso reduz dependências e mantém o tráfego descentralizado, mas fontes que exigem navegador completo, cookies de sessão ou reescrita contínua de segmentos podem não funcionar no Nuvio.

## Compatibilidade

O arquivo usa `fetch`, Promises e APIs JavaScript básicas para permanecer compatível com o Hermes. Não usa Node.js, Express, Playwright, filesystem ou credenciais do projeto.

## Relação com o addon Stremio

O addon Stremio continua disponível. Agora o modo direto é o padrão quando `USE_LOCAL_HLS_PROXY` não está habilitado. Usuários que precisam do proxy HLS podem instalar e executar o servidor local com `USE_LOCAL_HLS_PROXY=true`.
