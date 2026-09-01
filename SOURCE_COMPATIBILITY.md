# Compatibilidade das fontes

## Escopo

Teste realizado em uma instância local do AVMirror, sem alteração ou mascaramento de IP. Foram consultados os sete catálogos configurados e um item real de cada catálogo. O endpoint do addon retornou streams sem URL `/hls` do Render. Em seguida, a playlist foi solicitada diretamente ao domínio da fonte com os tokens oficiais gerados pelo fluxo atual e referers compatíveis.

## Resultados

| Catálogo | Endpoint do addon | Fonte direta | Playlist HLS | Observação |
| --- | ---: | ---: | ---: | --- |
| AVMirror — Jav.guru — Novos | 200 | 403 | Não confirmada | MaxStream bloqueou a requisição direta |
| AVMirror — Jav.guru — Populares | 200 | 403 | Não confirmada | MaxStream bloqueou a requisição direta |
| AVMirror — Jav.guru — Por atriz | 200 | 403 | Não confirmada | MaxStream bloqueou a requisição direta |
| AVMirror — AV01 — Novos | 200 | 200 | Confirmada | Token oficial `access_token` funcionou |
| AVMirror — AV01 — Populares | 200 | 200 | Confirmada | Token oficial `access_token` funcionou |
| AVMirror — JavRider — Novos | 200 | 200 | Confirmada | Playlist direta acessível |
| AVMirror — JavRider — Populares | 200 | 200 | Confirmada | Playlist direta acessível |

## Garantia de não retransmissão

A função de montagem de streams preserva as URLs HTTPS externas e inclui somente cabeçalhos de reprodução no item enviado ao cliente. A rota `/hls` responde `410 Gone`. Não foi encontrada URL de vídeo apontando para o Render nas respostas testadas.

## Caso MaxStream

As três entradas Jav.guru retornaram URL direta, mas o domínio MaxStream respondeu `403 Forbidden` ao ambiente de teste, inclusive com os referers compatíveis utilizados pelo fluxo atual. Não foi encontrado no projeto um token oficial adicional fornecido por essa fonte. Sem documentação ou credencial autorizada do provedor, o comportamento correto é manter a fonte no catálogo e registrar a indisponibilidade, sem inventar token ou tentar contornar a proteção.
