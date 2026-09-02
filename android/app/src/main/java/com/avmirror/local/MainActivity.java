package com.avmirror.local;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.format.Formatter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
  private EditText serverUrl;
  private TextView discoveryStatus;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(32, 48, 32, 32);

    TextView title = new TextView(this);
    title.setText("AVMirror");
    title.setTextSize(28);
    box.addView(title);

    String ip = deviceIp();
    TextView status = new TextView(this);
    status.setText("Servidor AVMirror: Windows/Linux\nIP deste aparelho: " + ip + "\n\nO servidor precisa estar ligado na mesma rede Wi-Fi.");
    status.setTextSize(16);
    box.addView(status);

    serverUrl = new EditText(this);
    serverUrl.setSingleLine(true);
    serverUrl.setHint("http://192.168.1.100:7000");
    serverUrl.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    serverUrl.setText("http://");
    box.addView(serverUrl);

    Button discover = new Button(this);
    discover.setText("Detectar servidor automaticamente");
    box.addView(discover);
    discover.setOnClickListener(v -> discoverServer(discover));

    Button install = new Button(this);
    install.setText("Verificar e instalar no Stremio");
    box.addView(install);
    install.setOnClickListener(v -> verifyAndOpenStremio(install));

    discoveryStatus = new TextView(this);
    discoveryStatus.setTextSize(13);
    discoveryStatus.setPadding(0, 12, 0, 0);
    box.addView(discoveryStatus);

    TextView help = new TextView(this);
    help.setText("A detecção procura o AVMirror nos dispositivos da mesma sub-rede. Se não encontrar, informe o IP do computador manualmente.");
    help.setTextSize(13);
    help.setPadding(0, 8, 0, 0);
    box.addView(help);

    setContentView(box);
    Intent service = new Intent(this, AvmirrorService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
    discoverServer(discover);
  }

  private String deviceIp() {
    try {
      WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
      if (wifi != null && wifi.getConnectionInfo() != null) return Formatter.formatIpAddress(wifi.getConnectionInfo().getIpAddress());
    } catch (RuntimeException ignored) { }
    return "não disponível";
  }

  private void discoverServer(Button button) {
    String ip = deviceIp();
    String[] octets = ip.split("\\.");
    if (octets.length != 4 || "não disponível".equals(ip)) {
      discoveryStatus.setText("Não foi possível identificar a rede Wi-Fi.");
      return;
    }
    button.setEnabled(false);
    button.setText("Procurando na rede...");
    discoveryStatus.setText("Verificando servidores na sub-rede...");
    new Thread(() -> {
      String found = scanSubnet(octets[0] + "." + octets[1] + "." + octets[2] + ".", ip);
      runOnUiThread(() -> {
        button.setEnabled(true);
        button.setText("Detectar servidor automaticamente");
        if (found != null) {
          serverUrl.setText(found);
          discoveryStatus.setText("Servidor encontrado: " + found);
          Toast.makeText(this, "AVMirror encontrado na rede.", Toast.LENGTH_SHORT).show();
        } else {
          discoveryStatus.setText("Nenhum servidor encontrado. Verifique se o AVMirror está aberto e se a porta 7000 está liberada.");
        }
      });
    }).start();
  }

  private String scanSubnet(String prefix, String ownIp) {
    ExecutorService pool = Executors.newFixedThreadPool(24);
    ExecutorCompletionService<String> completed = new ExecutorCompletionService<>(pool);
    int submitted = 0;
    for (int host = 1; host <= 254; host++) {
      String candidate = prefix + host;
      if (!candidate.equals(ownIp)) {
        submitted++;
        completed.submit(() -> isServer(candidate) ? "http://" + candidate + ":7000" : null);
      }
    }
    try {
      for (int i = 0; i < submitted; i++) {
        Future<String> result = completed.poll(5, TimeUnit.SECONDS);
        if (result == null) break;
        String value = result.get();
        if (value != null) return value;
      }
    } catch (Exception ignored) { }
    finally { pool.shutdownNow(); }
    return null;
  }

  private boolean isServer(String host) {
    try {
      HttpURLConnection connection = (HttpURLConnection) new URL("http://" + host + ":7000/health").openConnection();
      connection.setConnectTimeout(350);
      connection.setReadTimeout(500);
      connection.setRequestMethod("GET");
      int code = connection.getResponseCode();
      connection.disconnect();
      return code >= 200 && code < 300;
    } catch (Exception ignored) { return false; }
  }

  private void verifyAndOpenStremio(Button button) {
    String base = serverUrl.getText().toString().trim();
    if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
    if (!base.startsWith("http://") && !base.startsWith("https://")) base = "http://" + base;
    final String target = base;
    button.setEnabled(false);
    button.setText("Verificando servidor...");
    new Thread(() -> {
      boolean ok = isServerUrl(target);
      runOnUiThread(() -> {
        button.setEnabled(true);
        button.setText("Verificar e instalar no Stremio");
        if (!ok) {
          Toast.makeText(this, "Servidor não encontrado em " + target + ".", Toast.LENGTH_LONG).show();
          return;
        }
        try {
          String authority = Uri.parse(target).getAuthority();
          startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("stremio://" + authority + "/manifest.json")));
        } catch (Exception error) {
          Toast.makeText(this, "Stremio não está instalado neste aparelho.", Toast.LENGTH_LONG).show();
        }
      });
    }).start();
  }

  private boolean isServerUrl(String target) {
    try {
      HttpURLConnection connection = (HttpURLConnection) new URL(target + "/health").openConnection();
      connection.setConnectTimeout(5000);
      connection.setReadTimeout(5000);
      connection.setRequestMethod("GET");
      int code = connection.getResponseCode();
      connection.disconnect();
      return code >= 200 && code < 300;
    } catch (Exception ignored) { return false; }
  }
}
