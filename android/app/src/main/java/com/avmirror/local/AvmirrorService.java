package com.avmirror.local;

import android.app.*;
import android.content.*;
import android.os.IBinder;
import androidx.annotation.Nullable;
import com.janeasystems.rn_nodejs_mobile_android.NodeJS;

public class AvmirrorService extends Service {
  private static final int ID = 7000;
  @Override public void onCreate() {
    super.onCreate();
    String channel = "avmirror-server";
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (android.os.Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(channel, "AVMirror", NotificationManager.IMPORTANCE_LOW));
    Notification n = new Notification.Builder(this, channel).setContentTitle("AVMirror ativo").setContentText("Servidor LAN escutando na porta 7000").setSmallIcon(android.R.drawable.ic_media_play).setOngoing(true).build();
    startForeground(ID, n);
    NodeJS.startNodeProject(getApplicationContext());
  }
  @Override public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }
  @Override public void onDestroy() { NodeJS.stopNodeProject(); super.onDestroy(); }
  @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
