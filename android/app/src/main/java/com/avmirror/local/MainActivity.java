package com.avmirror.local;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.format.Formatter;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
  private EditText serverUrl;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(32, 48, 32, 32);

    TextView title = new TextView(this);
    title.setText("AVMirror");
    title.setTextSize(28);
    box.addView(title);

    String ip = "não disponível";
    try {
      WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
      if (wifi != null && wifi.getConnectionInfo() != null) ip = Formatter.formatIpAddress(wifi.getConnectionInfo().getIpAddress());
    } catch (RuntimeException ignored) { }

    TextView status = new TextView(this);
    status.setText("Servidor Android: WebView ativo\nIP deste aparelho: " + ip + "\n\nO servidor AVMirror deve estar rodando no PC/Ubuntu.");
    status.setTextSize(16);
    box.addView(status);

    TextView label = new TextView(this);
    label.setText("Endereço do servidor Windows/Linux:");
    label.setPadding(0, 28, 0, 4);
    box.addView(label);

    serverUrl = new EditText(this);
    serverUrl.setSingleLine(true);
    serverUrl.setHint("http://192.168.1.100:7000");
    serverUrl.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    serverUrl.setText("http://");
    box.addView(serverUrl);

    Button install = new Button(this);
    install.setText("Verificar e instalar no Stremio");
    box.addView(install);
    install.setOnClickListener(v -> verifyAndOpenStremio(install));

    TextView help = new TextView(this);
    help.setText("Use o IP do computador que executa o AVMirror, não o IP deste celular.");
    help.setTextSize(13);
    help.setPadding(0, 12, 0, 0);
    box.addView(help);

    setContentView(box);
    Intent service = new Intent(this, AvmirrorService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
  }

  private void verifyAndOpenStremio(Button button) {
    String base = serverUrl.getText().toString().trim();
    if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
    if (!base.startsWith("http://") && !base.startsWith("https://")) base = "http://" + base;
    final String target = base;
    button.setEnabled(false);
    button.setText("Verificando servidor...");
    new Thread(() -> {
      boolean ok = false;
      try {
        HttpURLConnection connection = (HttpURLConnection) new URL(target + "/health").openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setRequestMethod("GET");
        ok = connection.getResponseCode() >= 200 && connection.getResponseCode() < 300;
        connection.disconnect();
      } catch (Exception ignored) { }
      final boolean available = ok;
      runOnUiThread(() -> {
        button.setEnabled(true);
        button.setText("Verificar e instalar no Stremio");
        if (!available) {
          Toast.makeText(this, "Servidor não encontrado em " + target + ". Verifique o IP e a rede Wi-Fi.", Toast.LENGTH_LONG).show();
          return;
        }
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("stremio://" + Uri.parse(target).getAuthority() + "/manifest.json")));
        } catch (Exception error) {
          Toast.makeText(this, "Stremio não está instalado neste aparelho.", Toast.LENGTH_LONG).show();
        }
      });
    }).start();
  }
}
