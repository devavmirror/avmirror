# Capacidade e preparação para produção

## O que foi otimizado

O servidor agora limita o cache de imagens por quantidade e por memória total, com padrão de 120 imagens e 48 MiB. Imagens individuais acima de 4 MiB são rejeitadas. Os assets estáticos recebem cache HTTP de sete dias, e o cache de scraping pode ser limitado por `CACHE_MAX_ENTRIES`. O modo de resolução de streams via navegador permanece desabilitado por padrão para evitar abrir contextos Playwright em picos de tráfego.

## Testes locais

Os testes foram executados contra uma única instância local, com o cache do catálogo aquecido. Eles medem conexões HTTP concorrentes e não simulam 6.000 usuários reproduzindo vídeo.

| Endpoint | Concorrência | Duração | Resultado | Vazão | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/health` | 3.000 | 5 s | 11.650 respostas, 0 erros | 2.330 req/s | 2,67 s |
| `/manifest.json` | 3.000 | 5 s | 10.393 respostas, 0 erros | 2.079 req/s | 2,16 s |
| `/catalog/movie/avmirror.json` com cache | 3.000 | 5 s | 9.693 respostas, 0 erros | 1.939 req/s | 2,75 s |
| `/health` otimizado | 6.000 | 5 s | 10.512 respostas, 0 erros | 2.102 req/s | 3,84 s |

## Limites da conclusão

Os resultados confirmam que a aplicação Node é leve e responde a picos fortes sem erros no ambiente local. Eles não constituem garantia de 6.000 usuários em produção no Render Free, pois CPU, memória, banda, horas de instância, suspensão da plataforma e latência das fontes externas dependem do ambiente hospedado.

Para produção, o catálogo deve permanecer em cache, o vídeo não deve ser retransmitido pelo addon e as métricas de p95, respostas 429/5xx, memória e banda devem ser monitoradas. O teste pode ser repetido com `ENDPOINT=/catalog/movie/avmirror.json LEVELS=3000 DURATION_MS=5000 node load_test.js` depois de aquecer o catálogo.
