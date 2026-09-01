# Notas de capacidade e disponibilidade

## Render Free

Fonte: https://render.com/docs/free

A documentação oficial informa que serviços web Free entram em suspensão após 15 minutos sem tráfego de entrada. A página também recomenda não usar instâncias Free para aplicações de produção e descreve limitações de uso incluído e recursos da instância.

## UptimeRobot

Fonte: https://uptimerobot.com/

A página oficial informa que o plano Free realiza verificações a cada 5 minutos e oferece até 50 monitores. O monitor pode consultar endpoints HTTP(S), como `/health`.

## Interpretação

Um monitor UptimeRobot consultando cada instância a cada 5 minutos gera tráfego de entrada suficiente para evitar o critério de inatividade do Render, mas não transforma o plano Free em uma garantia de disponibilidade 24/7 nem aumenta CPU, memória, horas incluídas ou capacidade de processamento.
