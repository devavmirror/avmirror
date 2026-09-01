# AVMirror para Android

O módulo usa o **WebView/Chromium fornecido pelo Android** dentro de um `Foreground Service`. O WebView permanece invisível e pode resolver páginas de players dinâmicos sem exigir que o usuário instale Chrome ou outro navegador. A ponte `AVMirrorBridge` registra URLs de mídia detectadas para a futura integração com o resolvedor do addon.

O projeto Node é copiado para `app/src/main/assets/nodejs-project` durante o build, mas o APK WebView atual não inicia um runtime Node embutido. O servidor Node continua sendo executado no PC/Ubuntu pelo pacote local até que um runtime Node Android compatível seja integrado.

Requisitos: Android SDK 35, JDK 17 e Gradle 8.9+. Gere o APK com `npm run build:apk`. Em Android 13+, conceda a permissão de notificações para preservar a notificação persistente do serviço.
