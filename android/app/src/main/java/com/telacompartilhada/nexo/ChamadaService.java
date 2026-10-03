package com.telacompartilhada.nexo;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.util.function.Consumer;

/**
 * A chamada em segundo plano.
 *
 * Sem isto, o Android trata o Nexo como qualquer aplicativo que saiu da tela: depois de alguns
 * segundos ele corta o microfone (desde o Android 9, aplicativo de fundo grava silêncio), e logo
 * depois congela o processo -- a voz da sala some e quem fala do outro lado fala sozinho. O que o
 * Android deixa fazer é declarar a chamada: um serviço em primeiro plano, do tipo "microfone" e
 * "reprodução", com uma notificação à vista enquanto ele dura. É o que todo aplicativo de chamada
 * faz, e é o que a pessoa espera ver -- "Na sala #squad · Microfone desligado", com os botões.
 *
 * Quem liga e desliga é a página da sala (public/app-android.js), que sabe quando a pessoa está
 * numa chamada; a atividade só repassa. Os botões da notificação voltam pelo mesmo caminho: o
 * serviço avisa a atividade, que avisa a página -- é lá que o microfone e a saída são de verdade.
 */
public class ChamadaService extends Service {
    private static final String TAG = "NexoChamada";
    private static final String CANAL = "chamada";
    private static final int ID_DO_AVISO = 1;

    static final String ACAO_ATUALIZAR = "com.telacompartilhada.nexo.CHAMADA_ATUALIZAR";
    static final String ACAO_MICROFONE = "com.telacompartilhada.nexo.CHAMADA_MICROFONE";
    static final String ACAO_SAIR = "com.telacompartilhada.nexo.CHAMADA_SAIR";

    // Uma chamada pode durar a tarde inteira; a trava se renova a cada atualização e, de qualquer
    // forma, não passa disto sem ninguém mexer.
    private static final long MS_DA_TRAVA = 6L * 60 * 60 * 1000;

    // A atividade que repassa os botões para a página. Mesmo processo, então uma referência basta.
    private static volatile Consumer<String> ouvinte;
    // O serviço no ar, para as mudanças chegarem sem pedir um novo início (ver `atualizar`).
    private static volatile ChamadaService noAr;

    static void definirOuvinte(Consumer<String> novo) {
        ouvinte = novo;
    }

    /** Liga o serviço, ou atualiza a notificação de um que já está ligado. */
    static void atualizar(Context contexto, String sala, boolean microfone, boolean ensurdecido) {
        // Já no ar: a mudança (o microfone, o ensurdecer) vira só uma notificação nova. Pedir outro
        // início seria pedir ao Android 12+ para começar um serviço de fora da tela -- e ele recusa
        // justamente quando a pessoa mexe no microfone com a tela apagada.
        ChamadaService atual = noAr;
        if (atual != null) {
            atual.mudar(sala, microfone, ensurdecido);
            return;
        }
        Intent pedido = new Intent(contexto, ChamadaService.class)
                .setAction(ACAO_ATUALIZAR)
                .putExtra("sala", sala)
                .putExtra("microfone", microfone)
                .putExtra("ensurdecido", ensurdecido);
        try {
            ContextCompat.startForegroundService(contexto, pedido);
        } catch (RuntimeException recusa) {
            // O Android 12+ recusa começar um serviço destes com o aplicativo fora da tela. A sala
            // continua; só não sobrevive à tela apagada até a pessoa voltar ao Nexo.
            Log.w(TAG, "O sistema não deixou segurar a chamada agora", recusa);
        }
    }

    static void parar(Context contexto) {
        // Esquecido já, e não no onDestroy: um "ligar" logo em seguida (a sala recarregando) não
        // pode cair no serviço que está saindo -- ele pede um novo.
        noAr = null;
        contexto.stopService(new Intent(contexto, ChamadaService.class));
    }

    private PowerManager.WakeLock travaDoProcessador;
    private WifiManager.WifiLock travaDoWifi;
    private String sala = "";
    private boolean microfone;
    private boolean ensurdecido;
    // Se o serviço está no ar com o tipo "microfone" (ver entrarEmPrimeiroPlano).
    private boolean comMicrofone;

    @Override
    public void onCreate() {
        super.onCreate();
        noAr = this;
    }

    private void mudar(String novaSala, boolean novoMicrofone, boolean novoEnsurdecido) {
        sala = novaSala == null ? "" : novaSala;
        microfone = novoMicrofone;
        ensurdecido = novoEnsurdecido;
        // A permissão do microfone chegou depois de a chamada começar (o primeiro toque no botão
        // Microfone): o tipo precisa ser refeito para o microfone continuar com a tela apagada. É um
        // gesto com o Nexo na tela, que é quando o Android deixa.
        if (!comMicrofone && Build.VERSION.SDK_INT >= 30 && podeGravar()) {
            entrarEmPrimeiroPlano();
            segurarTravas();
            return;
        }
        NotificationManager avisos = getSystemService(NotificationManager.class);
        if (avisos != null) avisos.notify(ID_DO_AVISO, montarAviso());
        segurarTravas();
    }

    @Override
    public int onStartCommand(Intent pedido, int flags, int idDoPedido) {
        String acao = pedido != null ? pedido.getAction() : null;
        if (ACAO_MICROFONE.equals(acao) || ACAO_SAIR.equals(acao)) {
            Consumer<String> atual = ouvinte;
            if (atual != null) atual.accept(ACAO_MICROFONE.equals(acao) ? "alternar-microfone" : "sair");
            // Sem atividade não há sala para mexer: a notificação é um resto, e sai.
            else stopSelf();
            return START_NOT_STICKY;
        }
        if (pedido != null) {
            String pedida = pedido.getStringExtra("sala");
            sala = pedida != null ? pedida : "";
            microfone = pedido.getBooleanExtra("microfone", false);
            ensurdecido = pedido.getBooleanExtra("ensurdecido", false);
        }
        if (!entrarEmPrimeiroPlano()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        segurarTravas();
        // Morto pelo sistema, não volta sozinho: sem a página, não haveria chamada para segurar.
        return START_NOT_STICKY;
    }

    private boolean podeGravar() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    // "Microfone" só com a permissão dada: o Android 14 recusa o tipo sem ela. A reprodução vale
    // sempre -- quem só ouve também quer ouvir com a tela apagada. Os tipos existem do Android 10
    // (reprodução) e 11 (microfone) em diante; antes disso o ServiceCompat os ignora, e o serviço
    // em primeiro plano sozinho já segura o microfone.
    @SuppressLint("InlinedApi")
    private boolean entrarEmPrimeiroPlano() {
        criarCanal();
        boolean pedirMicrofone = Build.VERSION.SDK_INT >= 30 && podeGravar();
        int tipos = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        if (pedirMicrofone) tipos |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        try {
            ServiceCompat.startForeground(this, ID_DO_AVISO, montarAviso(), tipos);
            comMicrofone = pedirMicrofone;
            return true;
        } catch (RuntimeException recusa) {
            // O microfone de fundo é o que o sistema mais recusa (a permissão "durante o uso").
            // Sem ele, pelo menos o som da sala continua.
            Log.w(TAG, "Sem o tipo microfone; seguindo só com o som", recusa);
            try {
                ServiceCompat.startForeground(this, ID_DO_AVISO, montarAviso(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                comMicrofone = false;
                return true;
            } catch (RuntimeException outra) {
                Log.w(TAG, "O sistema recusou segurar a chamada", outra);
                return false;
            }
        }
    }

    private void criarCanal() {
        NotificationManager avisos = getSystemService(NotificationManager.class);
        if (avisos == null || avisos.getNotificationChannel(CANAL) != null) return;
        // Baixo: a notificação existe para ser vista na gaveta, e não para tocar nem pular na tela.
        NotificationChannel canal = new NotificationChannel(CANAL, getString(R.string.canal_chamada), NotificationManager.IMPORTANCE_LOW);
        canal.setDescription(getString(R.string.canal_chamada_descricao));
        canal.setShowBadge(false);
        avisos.createNotificationChannel(canal);
    }

    private Notification montarAviso() {
        int imutavel = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent abrir = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), imutavel);
        PendingIntent alternarMicrofone = PendingIntent.getService(this, 1,
                new Intent(this, ChamadaService.class).setAction(ACAO_MICROFONE), imutavel);
        PendingIntent sair = PendingIntent.getService(this, 2,
                new Intent(this, ChamadaService.class).setAction(ACAO_SAIR), imutavel);

        String titulo = sala.isEmpty() ? getString(R.string.chamada_titulo) : getString(R.string.chamada_titulo_sala, sala);
        String texto = ensurdecido ? getString(R.string.chamada_ensurdecido)
                : microfone ? getString(R.string.chamada_microfone_ligado) : getString(R.string.chamada_microfone_desligado);

        NotificationCompat.Builder aviso = new NotificationCompat.Builder(this, CANAL)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setColor(ContextCompat.getColor(this, R.color.destaque))
                .setContentTitle(titulo)
                .setContentText(texto)
                .setContentIntent(abrir)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        // Ligar o microfone de fora do aplicativo só funciona com a permissão já dada: sem ela o
        // Android não mostra a pergunta com o Nexo fora da tela, e o botão não faria nada.
        if (microfone || podeGravar()) {
            aviso.addAction(0, getString(microfone ? R.string.chamada_desligar_microfone : R.string.chamada_ligar_microfone), alternarMicrofone);
        }
        aviso.addAction(0, getString(R.string.chamada_sair), sair);
        return aviso.build();
    }

    // O processador acordado e o Wi-Fi sem economia: com a tela apagada, o Android dorme a rede
    // entre um pacote e outro, e a voz chega aos solavancos.
    private void segurarTravas() {
        if (travaDoProcessador == null) {
            PowerManager energia = getSystemService(PowerManager.class);
            if (energia != null) {
                travaDoProcessador = energia.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nexo:chamada");
                travaDoProcessador.setReferenceCounted(false);
            }
        }
        if (travaDoProcessador != null) travaDoProcessador.acquire(MS_DA_TRAVA);
        if (travaDoWifi == null) {
            WifiManager wifi = getApplicationContext().getSystemService(WifiManager.class);
            if (wifi != null) {
                @SuppressWarnings("deprecation")
                int modo = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                travaDoWifi = wifi.createWifiLock(modo, "Nexo:chamada");
                travaDoWifi.setReferenceCounted(false);
                travaDoWifi.acquire();
            }
        }
    }

    private void soltarTravas() {
        if (travaDoProcessador != null && travaDoProcessador.isHeld()) travaDoProcessador.release();
        if (travaDoWifi != null && travaDoWifi.isHeld()) travaDoWifi.release();
        travaDoProcessador = null;
        travaDoWifi = null;
    }

    // Tirar o Nexo da lista de recentes é encerrar: a atividade (e a sala com ela) já foi.
    @Override
    public void onTaskRemoved(Intent raiz) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (noAr == this) noAr = null;
        soltarTravas();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent pedido) {
        return null;
    }
}
