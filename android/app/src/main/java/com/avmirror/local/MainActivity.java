package com.avmirror.local;

import android.app.*;
import android.content.*;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Build;
import android.text.format.Formatter;
import android.widget.*;

public class MainActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(32, 48, 32, 32);
    TextView title = new TextView(this); title.setText("AVMirror"); title.setTextSize(28); box.addView(title);
    WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
    String ip = Formatter.formatIpAddress(wifi.getConnectionInfo().getIpAddress());
    TextView status = new TextView(this); status.setText("Servidor LAN: ativo\nIP local: " + ip + "\nPorta: 7000"); status.setTextSize(18); box.addView(status);
    Button install = new Button(this); install.setText("Instalar no Stremio"); box.addView(install);
    install.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("stremio://127.0.0.1:7000/manifest.json"))));
    setContentView(box);
    Intent service = new Intent(this, AvmirrorService.class);
    if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
  }
}
