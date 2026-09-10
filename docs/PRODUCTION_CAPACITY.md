# Capacidade e operação — AVMirror 26.1.0

## Arquitetura de reprodução

O servidor entrega o catálogo exclusivamente pela fonte AVMirror/Nova. Quando o usuário abre um item AVMirror, o resolvedor consulta as demais fontes configuradas e reúne os streams disponíveis. Todos os streams de vídeo passam pela rota `/hls`, que preserva `Referer`, `User-Agent`, `Origin`, cookies e requisições `Range`. HLS, MP4 e segmentos são retransmitidos sem transcodificação.

## Limite de banda

A variável `MAX_STREAM_MBPS` limita cada sessão de reprodução. O padrão é `8`, isto é, oito megabits por segundo por vídeo. Para uma instância de 512 MB, recomenda-se iniciar com `5` e aumentar somente após observar banda, CPU, memória e erros:

| Configuração | Uso recomendado |
| --- | --- |
| `MAX_STREAM_MBPS=5` | Instâncias pequenas e maior quantidade de usuários |
| `MAX_STREAM_MBPS=8` | Qualidade média/alta com margem moderada |
| `MAX_STREAM_MBPS=0` | Sem limite; não recomendado em plano pequeno |

O limitador atua por sessão e não cria largura de banda adicional. O número real de usuários depende principalmente do bitrate dos vídeos e do limite de saída da hospedagem.

## Estimativa para 512 MB

Como referência operacional, considere 10–15 usuários reproduzindo simultaneamente com vídeos de bitrate médio. Cinco a dez usuários são uma margem conservadora quando a banda da hospedagem é desconhecida. O addon não transcodifica, portanto o consumo de RAM por stream é baixo; banda de saída, CPU de rede e limites da plataforma são os gargalos predominantes.

## Métricas

`/health` retorna a versão, tempo de atividade, streams ativos, requisições de mídia, erros do proxy, bytes contabilizados, limite configurado e estatísticas do motor de torrents. As métricas são intencionalmente agregadas e não incluem URLs, tokens ou cookies.

## Segurança do proxy

A rota aceita somente URLs HTTPS aprovadas pelo allow-list ou por hosts que tenham sido retornados por um scraper durante a resolução. O proxy rejeita localhost, redes privadas, endereços link-local e hosts públicos que resolvam para endereços privados. Limites de requisição, tamanho de imagens e cache permanecem ativos.

## Testes

Execute:

```bash
npm ci
npm test
node --check src/server.js
node --check nuvio/providers/avmirror.js
MAX_STREAM_MBPS=5 npm start
```

Os testes de integração verificam o manifesto 26.1.0, o contrato do health check, os catálogos movie-only e a rejeição de upstream privado. Testes de carga HTTP não equivalem a um teste de reprodução real; devem ser realizados com streams autorizados e métricas de banda da hospedagem.
