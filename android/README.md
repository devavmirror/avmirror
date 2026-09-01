# AVMirror para Android

O módulo usa `nodejs-mobile-android` para iniciar o servidor Node em um **Foreground Service**. O projeto Node deve ser copiado para `app/src/main/assets/nodejs-project` durante o build (o script de build faz isso automaticamente). O servidor é iniciado com `LOCAL_MODE=true`, `BIND_HOST=0.0.0.0` e `PORT=7000`.

Requisitos: Android Studio/SDK 35, JDK 17 e Gradle 8.9+. Gere o APK com `npm run build:apk`. Em Android 13+, conceda a permissão de notificações para preservar a notificação persistente do serviço.
