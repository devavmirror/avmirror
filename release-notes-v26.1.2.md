# AVMirror v26.1

Esta versão adiciona launchers autoatualizáveis para Windows e Debian/Linux.

## Atualização automática

Ao iniciar, o launcher consulta o commit atual do branch `main` no GitHub. Se houver uma versão nova, baixa o código da aplicação, valida a presença de `server.js`, troca a cópia ativa e inicia o servidor atualizado. Falhas de rede não impedem o uso da última cópia local; a versão anterior permanece disponível durante a troca.

O launcher não baixa vídeos nem armazena URLs de streams. O mecanismo atualiza somente o código da aplicação, incluindo fontes, catálogo, metadados e funções do servidor.

A atualização automática pode ser desativada com `AVMIRROR_AUTO_UPDATE=false`. O intervalo de rede da verificação é limitado por `AVMIRROR_UPDATE_TIMEOUT_MS`.

## Artefatos

- Windows x64: executável, runtime Node, Chromium e aplicação inicial.
- Debian/Ubuntu amd64: pacote com runtime Node, Chromium e serviço systemd.

O executável/launcher estável só precisa ser substituído quando houver mudança no próprio mecanismo de atualização, no runtime Node ou no Chromium.
