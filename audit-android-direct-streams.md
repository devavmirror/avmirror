# Auditoria de reprodução direta no Android

## Evidências externas

1. O SDK do Stremio registra que HLS (`m3u8`) é suportado pelos clientes Stremio; DASH (`mpd`) não tem suporte amplo. A discussão também informa que o Android usa VLC no aplicativo móvel e ExoPlayer/VLC no Android TV. Fonte: https://github.com/Stremio/stremio-addon-sdk/issues/223

2. O guia público de providers Nuvio define o objeto de stream com `name`, `title`, `url` direto (m3u8, mp4 ou mkv), `quality` e `headers` opcionais com `Referer` e `User-Agent`. Fonte: https://github.com/yoruix/nuvio-providers

## Implicação para o projeto

A estratégia para Android deve priorizar, nesta ordem, URLs diretas HLS (`.m3u8`/`master.txt`) e MP4, com headers de reprodução corretos. Iframes, páginas intermediárias, captura de navegador e DASH devem ser fallback, não o caminho principal. O provider Nuvio deve retornar apenas streams verificáveis e deduplicados, preservando `Referer` e `User-Agent` quando a CDN exigir.
