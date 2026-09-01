# Assistir JAV no Stremio e Nuvio

Addon independente para **Stremio** e **Nuvio**, desenvolvido para organizar catálogos e disponibilizar uma experiência de reprodução integrada para conteúdos que o usuário esteja autorizado a acessar.

> **Versão atual: 26.1**

## Visão geral

O projeto disponibiliza um serviço HTTP compatível com o ecossistema de addons do Stremio. A instalação é feita por meio de um manifesto público, enquanto a aplicação mantém a lógica de catálogo, metadados, capas e reprodução concentrada no servidor.

A página de instalação foi projetada para exibir somente as informações necessárias ao usuário final. Detalhes operacionais, credenciais, tokens, endereços internos e regras específicas de integração não são apresentados na interface pública.

## Principais recursos

| Recurso | Descrição |
| --- | --- |
| Instalação direta | Gera um link compatível com a instalação do addon no Stremio. |
| Instalação manual | Exibe o endereço do manifesto para cópia e inclusão em aplicativos compatíveis. |
| Apoio ao projeto | Exibe uma ação informativa nas páginas de detalhes e um destaque na página de instalação; o link de doação será configurado posteriormente. |
| Catálogo e pesquisa | Oferece navegação por catálogos e suporte a pesquisa conforme a disponibilidade das fontes autorizadas. |
| Metadados e capas | Normaliza informações de título, descrição, categorias e imagens para o cliente. |
| Reprodução integrada | Retorna streams compatíveis com o player do aplicativo, sem expor detalhes de implementação na página pública. |
| Proteções de acesso | Valida hosts, protocolos e formatos permitidos antes de encaminhar recursos. |

## Requisitos

Para executar o projeto localmente, é necessário ter **Node.js 20 ou superior**, npm e, quando a resolução dinâmica estiver habilitada, o navegador Chromium gerenciado pelo Playwright. Para implantação conteinerizada, o projeto inclui um `Dockerfile` preparado para o ambiente de execução.

## Execução local

```bash
npm install
npx playwright install chromium
npm run start:local
```

No modo local, o servidor escuta somente em `127.0.0.1:7000`. O Stremio recebe URLs HLS locais (`http://127.0.0.1:7000/hls?...`) e o dispositivo faz o proxy da playlist e dos segmentos diretamente para o player. O tráfego de vídeo não passa pelo Render.

Por padrão, o serviço escuta na porta `7000`. Para iniciar em modo de desenvolvimento com reinicialização automática, utilize:

```bash
npm run dev
```

Depois de iniciar em modo local, instale no Stremio usando `stremio://127.0.0.1:7000/manifest.json` ou abra a página de instalação local. Os principais endereços são:

| Endpoint | Finalidade |
| --- | --- |
| `http://localhost:7000/install` | Página pública de instalação. |
| `http://localhost:7000/manifest.json` | Manifesto do addon. |
| `http://localhost:7000/health` | Verificação de disponibilidade do serviço. |

## Configuração por ambiente

A aplicação aceita configurações por variáveis de ambiente. Em produção, defina os valores no painel do provedor de hospedagem ou no mecanismo de secrets utilizado pela sua infraestrutura; não grave credenciais diretamente no código ou no repositório.

| Variável | Finalidade | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP do serviço. | `7000` |
| `PUBLIC_BASE_URL` | URL pública usada para montar links do manifesto e dos recursos proxificados. | Detectada pelo ambiente de hospedagem |
| `BASE_URL` | Fonte primária configurável para o catálogo. | Definida pelo servidor |
| `RENDER_EXTERNAL_URL` | URL pública fornecida automaticamente pelo Render. | Opcional |
| `RENDER_EXTERNAL_HOSTNAME` | Host público fornecido automaticamente pelo Render. | Opcional |
| `IMAGE_TIMEOUT_MS` | Tempo limite das requisições de imagens. | `12000` |
| `IMAGE_MAX_BYTES` | Tamanho máximo aceito por imagem proxificada. | `4194304` |
| `IMAGE_CACHE_MAX_ENTRIES` | Quantidade máxima de imagens mantidas em memória. | `120` |
| `IMAGE_CACHE_MAX_BYTES` | Tamanho total máximo do cache de imagens em memória. | `50331648` |
| `CACHE_MAX_ENTRIES` | Quantidade máxima de respostas de scraping mantidas em memória. | `500` |
| `ENABLE_BROWSER_STREAMS` | Permite habilitar resolução dinâmica quando necessária. | Desabilitada por padrão |
| `LOCAL_MODE` | Ativa o proxy HLS local e vincula o servidor a `127.0.0.1`. | `false` |
| `BIND_HOST` | Interface de escuta HTTP. | `127.0.0.1` em modo local; `0.0.0.0` remotamente |
| `VIDEO_PROXY` | Legado; não habilita proxy no Render. | Desativado remotamente |

Os valores reais de produção devem permanecer fora do controle de versão. O arquivo `.env` não deve ser publicado, e qualquer token temporário deve ser tratado como segredo operacional.

## Reprodução de vídeo

Em implantação no Render, o AVMirror não retransmite vídeo: os handlers preservam as URLs HTTPS originais e `/hls` responde `410 Gone`. Em execução local com `LOCAL_MODE=true`, o servidor do próprio dispositivo pode fazer o proxy HLS para resolver playlists, segmentos e cabeçalhos exigidos pela fonte. Nesse caso, o tráfego de vídeo permanece entre a fonte, o dispositivo e o Stremio; o Render não participa da reprodução.

## Docker

Para construir e executar a imagem localmente:

```bash
docker build -t assistir-jav-stremio-nuvio .
docker run --rm -p 7000:7000 assistir-jav-stremio-nuvio
```

A imagem fixa as dependências necessárias para manter a compatibilidade entre o Playwright e o Chromium. Em ambientes com restrições de recursos, recomenda-se validar a inicialização do navegador e acompanhar os logs do serviço durante o primeiro deploy.

## Implantação no Render

O repositório contém `render.yaml` e `Dockerfile`. No Render, crie um serviço a partir do Blueprint do repositório e configure as variáveis públicas e secretas no painel da plataforma. Após a implantação, valide a saúde do serviço acessando `/health` e confirme a instalação por `/install`.

A URL final deve ser usada apenas depois que o serviço estiver disponível. O manifesto estará no caminho `/manifest.json` da mesma origem pública.

## Testes

Execute a suíte automatizada com:

```bash
npm test
```

Antes de abrir uma alteração, verifique também a sintaxe dos arquivos JavaScript e confirme que nenhum segredo, token real, cookie, senha ou credencial foi incluído no diff:

```bash
node --check server.js
node --check scraper.js
git diff --check
git diff -- . ':!package-lock.json'
```

## Segurança e uso autorizado

O addon não deve ser utilizado para acessar, redistribuir ou retransmitir material sem autorização. As fontes configuradas precisam ser legítimas e compatíveis com os direitos de uso do operador e do usuário.

Não inclua chaves, tokens, cookies de sessão, credenciais ou URLs privadas em arquivos versionados, logs ou capturas de tela. Use variáveis de ambiente e o armazenamento seguro disponibilizado pelo provedor de hospedagem. Caso uma fonte exija autenticação ou imponha restrições de acesso, interrompa a integração em vez de tentar contorná-las.

## Estrutura do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `server.js` | Inicialização do servidor, manifesto, endpoints e validações. |
| `scraper.js` | Catálogo, metadados e resolução da fonte principal. |
| `av01.js` | Integração de catálogo e metadados da fonte correspondente. |
| `javrider.js` | Integração de catálogo e metadados da fonte correspondente. |
| `public/install.html` | Interface pública de instalação, sem informações operacionais sensíveis, com destaque de apoio ao projeto. |
| `test/` | Testes automatizados das integrações e transformações. |
| `Dockerfile` | Imagem de execução para implantação. |
| `render.yaml` | Configuração declarativa do serviço no Render. |

## Licença e responsabilidade

Este repositório é fornecido conforme os termos definidos pelo mantenedor. O operador é responsável por configurar fontes autorizadas, proteger variáveis de ambiente e cumprir a legislação aplicável, os termos de uso dos serviços integrados e os direitos dos titulares do conteúdo.

**Versão do projeto: 26.1**
