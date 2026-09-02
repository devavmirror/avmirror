# AVMirror 26.1

O AVMirror é uma solução multiplataforma para catálogo e reprodução de fontes autorizadas. O projeto separa o servidor local do Stremio, o addon de catálogo do Nuvio e o plugin opcional de resolução direta.

> **Versão do aplicativo: 26.1**

## 1. Arquitetura em uma visão

| Ambiente | Componente principal | Função | Proxy |
| --- | --- | --- | --- |
| Windows/Linux + Stremio | **AVMirror Local** | Catálogo, metadados, resolução e servidor local | HLS local por padrão |
| Nuvio | **Addon de catálogo** | Catálogo, metadados e posters | Não transporta vídeo por si só |
| Nuvio | **Plugin resolver** | Resolução complementar diretamente no aparelho | URL direta no dispositivo |
| GitHub | **Cache público** | Catálogo e metadados versionados | Não armazena vídeos |
| Render | **Fallback online** | Scraping dinâmico quando não há cache | Proxy de vídeo desativado |

O Render não é necessário para o servidor local. No modo direto, o player acessa a fonte original. No modo local, o proxy HLS retransmite somente pelo computador do usuário.

## 2. Stremio — AVMirror Local

O servidor local é o modo principal para Stremio em Windows e Linux. Instale o programa correspondente à sua plataforma, inicie-o e adicione ao Stremio:

```text
http://IP-DO-COMPUTADOR:7000/manifest.json
```

O manifesto local aparece como **AVMirror Local** e usa o identificador técnico `com.avmirror.addon.local`. O proxy HLS local é usado por padrão para que o Stremio Android consiga reproduzir manifests assinados, segmentos e fontes que exigem headers. Para forçar URLs diretas, defina `USE_LOCAL_HLS_PROXY=false`.

Para iniciar o servidor local com o proxy HLS — comportamento padrão:

```bash
LOCAL_MODE=true \
BIND_HOST=0.0.0.0 \
PORT=7000 \
node server.js
```

A configuração equivalente, explícita, é:

```bash
LOCAL_MODE=true \
USE_LOCAL_HLS_PROXY=true \
BIND_HOST=0.0.0.0 \
PORT=7000 \
node server.js
```

Para forçar URLs diretas no servidor local, use `USE_LOCAL_HLS_PROXY=false`.

A página de configuração fica disponível em:

```text
http://IP-DO-COMPUTADOR:7000/install
```

## 3. Nuvio — addon de catálogo

O addon padrão é compatível com Nuvio e Stremio e expõe os recursos `catalog`, `meta` e `stream`. Ele contém catálogos AVMirror/Jav.guru, AV01 e JavRider.

No Nuvio, instale o manifesto do servidor escolhido:

```text
https://SEU-ENDERECO/manifest.json
```

Para usar um servidor pessoal:

```text
http://IP-DO-COMPUTADOR:7000/manifest.json
```

No modo online, o manifesto usa o identificador `com.avmirror.addon`. No modo local, usa `com.avmirror.addon.local`, permitindo diferenciar as duas instalações.

## 4. Nuvio — plugin resolver

O plugin é opcional e não cria um segundo catálogo. Ele complementa o addon de catálogo e tenta resolver streams diretamente no aparelho:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/nuvio/manifest.json
```

Instalação: **Nuvio → Configurações → Plugins**.

O provider exporta `getStreams(id, mediaType, season, episode)` e reconhece IDs `av01:`, `avmirror:` e `javrider:`. Para AV01, ele gera o token e consulta a fonte no próprio dispositivo. Para as outras fontes, tenta extrair URLs diretas `.m3u8` e `.mp4`.

O plugin usa `fetch`, Promises e APIs JavaScript básicas. Ele não usa Node.js, Express, Playwright, filesystem ou credenciais. Fontes que exigem navegador completo, cookies persistentes ou reescrita contínua podem exigir o addon local com proxy.

## 5. Proxy HLS local para Stremio Android

Quando uma fonte não funciona diretamente no player, use o servidor local. O celular e o computador precisam estar na mesma rede Wi‑Fi; o proxy roda no computador e o Stremio acessa o manifesto pelo IP local:

```bash
LOCAL_MODE=true \
USE_LOCAL_HLS_PROXY=true \
BIND_HOST=0.0.0.0 \
PORT=7000 \
node server.js
```

Fluxo:

```text
Stremio/Nuvio → AVMirror Local → proxy HLS no PC → fonte original
```

O servidor remoto não retransmite vídeo. A rota `/hls` é usada somente no modo local quando `USE_LOCAL_HLS_PROXY` está ativo — por padrão, quando `LOCAL_MODE=true`. O plugin Nuvio permanece separado e tenta resolver streams diretamente no próprio aparelho.

## 6. Cache GitHub e fallback do Render

O servidor consulta primeiro o cache público para páginas de catálogo e metadados sem busca ou filtro. O cache fica em `cache/` e não contém vídeos, tokens ou URLs temporárias.

Se a cópia não existir, estiver indisponível ou não for adequada à consulta, o servidor usa o scraping dinâmico configurado. Por padrão, o espelho é:

```text
https://raw.githubusercontent.com/devavmirror/avmirror/main/cache
```

A origem pode ser alterada com `CACHE_MIRROR_URL`. O workflow `.github/workflows/update-cache.yml` atualiza o cache a cada seis horas e também pode ser iniciado manualmente no GitHub Actions.

## 7. Downloads 26.1

- [Windows x64 — AVMirror Local 26.1](https://github.com/devavmirror/avmirror/releases/download/v26.1/avmirror-windows_26.1-autoupdate.zip)
- [Ubuntu/Debian amd64 — AVMirror Local 26.1](https://github.com/devavmirror/avmirror/releases/download/v26.1/avmirror-linux_26.1_amd64.deb)
- [Checksums SHA-256](https://github.com/devavmirror/avmirror/releases/download/v26.1/SHA256SUMS-v26.1.txt)

O bundle Windows inclui launcher, runtime Node, Chromium e aplicação inicial. O pacote Linux inclui serviço systemd, runtime Node, Chromium e atalho **AVMirror Local** no menu de aplicativos.

## 8. Atualização automática

Os dois programas verificam o commit atual do branch `main` ao iniciar. Quando há código novo, o launcher baixa a aplicação, valida `server.js`, troca a cópia ativa e inicia o servidor atualizado. Falhas de rede preservam a última cópia funcional.

O mecanismo atualiza fontes, catálogo, metadados e funções do servidor sem novo empacotamento. Um novo bundle só é necessário quando mudar o launcher, o runtime Node, o Chromium ou a arquitetura do sistema.

Para desativar:

```bash
AVMIRROR_AUTO_UPDATE=false
```

## 9. Instalação e diagnóstico

No Windows, extraia o ZIP e execute o launcher. No Ubuntu/Debian:

```bash
sudo apt install ./avmirror-linux_26.1_amd64.deb
```

Verifique o servidor:

```bash
curl http://127.0.0.1:7000/health
```

Verifique o serviço Linux:

```bash
systemctl status avmirror
```

O cliente e o computador servidor devem estar na mesma rede quando o manifesto local for usado. Libere a porta `7000` no firewall se necessário.

## 10. Endpoints

| Endpoint | Finalidade |
| --- | --- |
| `/install` | Página de instalação, diagnóstico e downloads |
| `/manifest.json` | Manifesto do addon |
| `/catalog/...` | Catálogo e busca |
| `/meta/...` | Metadados |
| `/stream/...` | Resolução de streams |
| `/health` | Saúde do servidor |
| `/api/local-info` | IP, modo e proxy ativos |
| `/hls` | Proxy HLS local para o Stremio Android |

## 11. Estrutura do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `server.js` | Addon, endpoints, resolução e proxy local |
| `scraper.js` | Catálogo e fontes Jav.guru |
| `av01.js` | Catálogo, metadados e streams AV01 |
| `javrider.js` | Catálogo, metadados e streams JavRider |
| `nuvio/manifest.json` | Manifesto do plugin Nuvio |
| `nuvio/providers/avmirror.js` | Resolver Nuvio direto |
| `scripts/auto-update.js` | Launcher autoatualizável |
| `scripts/update-cache.js` | Geração do cache público |
| `.github/workflows/update-cache.yml` | Atualização automática do cache |
| `public/install.html` | Página de instalação |
| `packaging/` | Serviço e lançador Linux |

## 12. Testes

```bash
npm test
node --check server.js
node --check nuvio/providers/avmirror.js
node --check scripts/auto-update.js
npm run cache:update
```

Os testes verificam catálogo, metadados, resolução, validação de URLs, proxy HLS, manifesto Nuvio e comportamento do cache. Testes live dependem da disponibilidade das fontes externas.

## Uso responsável

Use o projeto somente com fontes, mídias e integrações para as quais você possui autorização. Respeite a legislação aplicável, os termos dos serviços integrados e os direitos dos titulares do conteúdo.

## Licença

Consulte `LICENSE` para os termos aplicáveis ao código.

## Referências

[1]: https://www.stremio.com/ "Stremio"
[2]: https://nuvio.tv/ "Nuvio"
[3]: https://github.com/yoruix/nuvio-providers "Exemplos públicos de providers Nuvio"
