# AVMirror 26.1

Addon para **Stremio e Nuvio**, acompanhado de um provider direto para Nuvio. O projeto organiza catálogos, metadados e fontes de reprodução para conteúdos que o usuário está autorizado a acessar.

> **Versão atual: 26.1.0**

## Visão geral

O AVMirror possui dois modos de uso. No **modo direto**, Stremio ou Nuvio recebem a URL original da fonte e o player faz a reprodução diretamente no dispositivo. No **modo proxy local**, um servidor opcional executado pelo usuário reescreve playlists HLS e encaminha segmentos quando a fonte exige headers, cookies ou URLs relativas.

O Render não é requisito do modo direto. O projeto também não depende de um banco de dados central para a resolução básica. O código do provider Nuvio pode ser hospedado em um fork ou espelho Git compatível com o formato aceito pelo aplicativo.

## Cache público e fallback

O addon consulta primeiro o cache versionado no GitHub para páginas de catálogo e metadados sem parâmetros de busca. Quando não existe uma cópia válida, ele usa o scraping dinâmico do servidor configurado, normalmente o Render. URLs de vídeo, tokens e cookies não são gravados no cache porque podem expirar ou depender do endereço do usuário.

O workflow `.github/workflows/update-cache.yml` atualiza o cache a cada seis horas e também pode ser executado manualmente em **Actions → Atualizar cache AVMirror**. O endereço pode ser trocado com `CACHE_MIRROR_URL` quando o usuário preferir GitHub Pages, um CDN ou um fork próprio.

## Plataformas e recursos

| Plataforma | Componente | Comportamento padrão | Proxy HLS local |
| --- | --- | --- | --- |
| Android | Addon Nuvio + plugin | Catálogo no addon e resolução complementar no aparelho | Proxy pelo addon local |
| Windows/Linux | Addon Stremio | URLs diretas da fonte | Opcional |
| Windows/Linux | Servidor AVMirror | Catálogo, metadados e resolução | Ativável por variável |

O provider Nuvio foi construído sem Express, Playwright, filesystem ou módulos nativos do Node. Ele usa `fetch`, Promises e IDs próprios das fontes. Fontes que exigem navegador completo ou reescrita contínua de segmentos podem permanecer disponíveis somente no servidor Stremio com proxy local.

## Instalação rápida

### Stremio remoto ou modo direto

Use o manifesto público do serviço que hospeda o addon:

```text
https://SEU-ENDERECO/manifest.json
```

O manifesto também pode ser obtido na página `/install`.

### Nuvio: addon com catálogo

No Nuvio, adicione o mesmo manifesto padrão do servidor escolhido. Ele expõe catálogo, metadados e streams:

```text
https://SEU-ENDERECO/manifest.json
```

Para complementar a resolução com o provider direto, abra **Configurações → Plugins** e adicione:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

O arquivo do provider está em `nuvio/providers/avmirror.js`. O addon fornece o catálogo; o plugin é chamado para resolver fontes no próprio aparelho e devolver ao player uma URL direta. O plugin não mantém um proxy HLS contínuo. Para fontes que exigem proxy, use o addon instalado pelo endereço local do servidor.

### Servidor local opcional

O servidor local é indicado quando uma fonte não reproduz diretamente no player:

```bash
npm install
npx playwright install chromium
npm run start:local
```

Acesse `http://IP-DO-COMPUTADOR:7000/install` no dispositivo cliente. Para usar o proxy HLS local explicitamente:

```bash
LOCAL_MODE=true USE_LOCAL_HLS_PROXY=true BIND_HOST=0.0.0.0 PORT=7000 node server.js
```

Sem `USE_LOCAL_HLS_PROXY=true`, o servidor local retorna streams diretos por padrão.

## Requisitos locais

O servidor requer Node.js 20 ou superior e npm. A resolução que usa navegador requer Chromium compatível com Playwright. No Ubuntu, o Chromium do sistema também pode ser usado:

```bash
sudo apt update
sudo apt install -y chromium
unset PLAYWRIGHT_EXECUTABLE_PATH
npm run start:local
```

## Configuração principal

| Variável | Finalidade | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP do servidor | `7000` |
| `BIND_HOST` | Interface de escuta | `0.0.0.0` |
| `LAN_HOST` | IP anunciado nos links LAN | Automático |
| `PUBLIC_BASE_URL` | Origem pública do addon | Detectada pelo ambiente |
| `BASE_URL` | Fonte primária do catálogo | Configurada pelo servidor |
| `LOCAL_MODE` | Habilita recursos locais | `false` |
| `USE_LOCAL_HLS_PROXY` | Ativa o proxy HLS local | `false` |
| `CACHE_MIRROR_URL` | Origem JSON do cache público | Cache GitHub do projeto |
| `CACHE_MIRROR_TIMEOUT_MS` | Tempo máximo de consulta ao cache | `4000` |
| `ENABLE_BROWSER_STREAMS` | Permite resolução com navegador | Conforme ambiente |
| `PLAYWRIGHT_EXECUTABLE_PATH` | Caminho opcional do Chromium | Automático |

Não coloque tokens, cookies, senhas ou URLs privadas no repositório. Use variáveis de ambiente e armazenamento seguro.

## Endpoints

| Endpoint | Finalidade |
| --- | --- |
| `/install` | Página de instalação e downloads |
| `/manifest.json` | Manifesto do addon Stremio |
| `/health` | Verificação de saúde |
| `/api/local-info` | Informações e links da rede local |
| `/hls` | Proxy HLS somente quando o modo local estiver ativado |
| `/cache` | Arquivos versionados de catálogo/metadados quando publicados |

## Builds de distribuição

Os scripts de distribuição são:

```bash
npm run build:win
npm run build:deb
npm run build:apk
```

O bundle Windows inclui o executável e o navegador distribuído pelo processo de build. O pacote Debian inclui o runtime e o Chromium Headless Shell quando os artefatos necessários estiverem disponíveis. O módulo Android legado não hospeda o servidor Node; para Android, a rota recomendada é o Nuvio com o provider direto.

## Testes

Execute:

```bash
npm test
node --check server.js
node --check scraper.js
node --check javrider.js
node --check nuvio/providers/avmirror.js
git diff --check
```

Os testes automatizados verificam IDs, catálogo, metadados, resolução de streams, filtros de publicidade, validações de URL e comportamentos do proxy.

## Estrutura do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `server.js` | Addon Stremio, endpoints, validações e proxy opcional |
| `scraper.js` | Catálogo, metadados e resolução da fonte principal |
| `av01.js` | Integração direta com a fonte AV01 |
| `javrider.js` | Integração com a fonte JavRider |
| `nuvio/manifest.json` | Registro do plugin scraper Nuvio |
| `nuvio/providers/avmirror.js` | Provider Nuvio sem backend obrigatório |
| `scripts/update-cache.js` | Geração determinística do cache público |
| `.github/workflows/update-cache.yml` | Atualização automática do cache |
| `public/install.html` | Página pública de instalação |
| `scripts/` | Inicialização, builds e empacotamento |
| `test/` | Testes automatizados |

## Arquitetura de atualização

O addon Stremio pode ser atualizado no servidor que o operador escolher. O provider Nuvio é carregado a partir do manifesto e pode ser distribuído por GitHub ou por um fork mantido pelo usuário. Isso evita que a reprodução direta dependa do Render. A disponibilidade das fontes externas continua sujeita às alterações, políticas e direitos de acesso de cada fonte.

## Uso responsável

Use o projeto somente com fontes, mídias e integrações para as quais você possui autorização. Não tente contornar autenticação, paywalls, bloqueios ou restrições de acesso. O operador deve respeitar a legislação aplicável, os termos dos serviços integrados e os direitos dos titulares do conteúdo.

## Licença

Consulte o arquivo `LICENSE` para os termos aplicáveis ao código do projeto.

## Referências

[1]: https://www.stremio.com/ "Stremio"
[2]: https://nuvio.tv/ "Nuvio"
[3]: https://github.com/yoruix/nuvio-providers "Exemplos públicos de providers Nuvio"
