package com.telacompartilhada.nexo;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Pergunta ao servidor o que chegou para a conta, com o Nexo fora da tela.
 *
 * Com a página viva quem avisa é ela (public/app-android.js), na hora. Mas o Android congela o
 * aplicativo que saiu da tela (fora de uma chamada) em segundos, e o socket de amigos cai junto:
 * dali em diante só um trabalho agendado pelo sistema roda. O JobScheduler dá isso sem
 * dependência nova, e o menor intervalo que ele aceita é 15 minutos -- no modo de economia
 * (Doze) o Android ainda junta as rodadas nas janelas dele. É o preço de não ter um serviço de
 * push: cada Nexo é um servidor diferente, e o push do Google pede um projeto por servidor.
 *
 * O pedido leva o cookie da conta que a WebView guardou, só para a origem escolhida pela pessoa,
 * e só lê (/api/social/avisos, um GET). Sessão encerrada (401): as notificações da conta saem, e
 * a pergunta dos amigos para até a conta conectar de novo na página.
 *
 * A mesma rodada confere se o servidor distribui um APK mais novo (/api/desktop-app, público,
 * sem cookie) e avisa uma vez por versão: "Nexo 1.2.0 disponível", que baixa ao tocar. Essa parte
 * vale com ou sem conta.
 */
public class AvisosJob extends JobService {
    private static final String TAG = "NexoAvisos";
    private static final int ID = 7301;
    private static final long INTERVALO_MS = 15L * 60 * 1000;
    private static final int PRAZO_MS = 15_000;
    private static final int RESPOSTA_MAXIMA = 256 * 1024;

    /**
     * Liga a pergunta periódica (uma vez: agendar de novo não reinicia a contagem). Fica ligada
     * sempre que há um servidor escolhido; a parte dos amigos só roda com a conta.
     */
    static void agendar(Context contexto) {
        JobScheduler agenda = contexto.getSystemService(JobScheduler.class);
        if (agenda == null || agenda.getPendingJob(ID) != null) return;
        JobInfo trabalho = new JobInfo.Builder(ID, new ComponentName(contexto, AvisosJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(INTERVALO_MS)
                // Volta depois de reiniciar o celular (RECEIVE_BOOT_COMPLETED no manifesto).
                .setPersisted(true)
                .build();
        agenda.schedule(trabalho);
    }

    static void cancelar(Context contexto) {
        JobScheduler agenda = contexto.getSystemService(JobScheduler.class);
        if (agenda != null) agenda.cancel(ID);
    }

    @Override
    public boolean onStartJob(JobParameters parametros) {
        SharedPreferences preferencias = getSharedPreferences("nexo", MODE_PRIVATE);
        String endereco = preferencias.getString("endereco", null);
        String origem = endereco == null ? null : MainActivity.origemDe(Uri.parse(endereco));
        if (origem == null) return false;
        // O cookie é lido aqui, na linha principal: é onde a WebView quer ser chamada. Só com a
        // conta conectada na página alguma vez (ligada por MainActivity.ligarAvisos).
        String cookie = preferencias.getBoolean("avisosLigados", false) ? CookieManager.getInstance().getCookie(origem) : null;
        Handler principal = new Handler(Looper.getMainLooper());
        Thread trabalho = new Thread(() -> {
            try {
                conferirVersao(origem);
                if (cookie != null && !cookie.isEmpty()) perguntar(origem, cookie, principal);
            } finally {
                jobFinished(parametros, false);
            }
        }, "NexoAvisos");
        trabalho.start();
        return true;
    }

    private HttpURLConnection abrir(String endereco) throws IOException {
        HttpURLConnection conexao = (HttpURLConnection) new URL(endereco).openConnection();
        conexao.setConnectTimeout(PRAZO_MS);
        conexao.setReadTimeout(PRAZO_MS);
        conexao.setInstanceFollowRedirects(false);
        conexao.setUseCaches(false);
        conexao.setRequestProperty("Accept", "application/json");
        conexao.setRequestProperty("User-Agent", "NexoAndroid/" + BuildConfig.VERSION_NAME);
        return conexao;
    }

    // O APK que o servidor distribui (desktop-download.js, a linha "android" de versao.json).
    // Mais novo que este, e ainda não avisado: a notificação, uma vez por versão. O endereço fica
    // guardado para o toque baixar mesmo sem página aberta (Atualizador.baixarDoAviso).
    private void conferirVersao(String origem) {
        HttpURLConnection conexao = null;
        try {
            conexao = abrir(origem + "/api/desktop-app");
            if (conexao.getResponseCode() != 200) return;
            JSONArray sistemas = new JSONObject(ler(conexao.getInputStream())).optJSONArray("sistemas");
            for (int i = 0; sistemas != null && i < sistemas.length(); i++) {
                JSONObject sistema = sistemas.optJSONObject(i);
                if (sistema == null || !"android".equals(sistema.optString("chave"))) continue;
                String versao = sistema.optString("versao");
                String endereco = sistema.optString("url");
                if (!Atualizador.maisNova(versao) || Atualizador.enderecoNaOrigem(origem, endereco) == null) return;
                SharedPreferences preferencias = getSharedPreferences("nexo", MODE_PRIVATE);
                preferencias.edit().putString("atualizacaoVersao", versao).putString("atualizacaoEndereco", endereco).apply();
                // Com o Nexo à vista, o botão Atualizar da página já diz.
                if (versao.equals(preferencias.getString("versaoAvisada", null)) || MainActivity.naFrente) return;
                preferencias.edit().putString("versaoAvisada", versao).apply();
                Avisos.atualizacaoDisponivel(this, versao);
                return;
            }
        } catch (IOException | JSONException falha) {
            Log.i(TAG, "Sem resposta sobre a versão agora", falha);
        } finally {
            if (conexao != null) conexao.disconnect();
        }
    }

    private void perguntar(String origem, String cookie, Handler principal) {
        HttpURLConnection conexao = null;
        try {
            conexao = abrir(origem + "/api/social/avisos");
            conexao.setRequestProperty("Cookie", cookie);
            int status = conexao.getResponseCode();
            if (status == 401) {
                // A sessão terminou (saiu da conta noutro lugar, a senha mudou): nada mais a avisar
                // até a conta conectar de novo.
                principal.post(() -> {
                    getSharedPreferences("nexo", MODE_PRIVATE).edit().putBoolean("avisosLigados", false).apply();
                    Avisos.limparTudo(this);
                });
                return;
            }
            if (status != 200) return;
            guardarCookiesRenovados(origem, conexao.getHeaderFields(), principal);
            JSONObject resposta = new JSONObject(ler(conexao.getInputStream()));
            Avisos.doServidor(this, resposta, MainActivity.naFrente);
        } catch (IOException | JSONException falha) {
            // Sem rede, servidor fora do ar, resposta estranha: a próxima rodada tenta de novo.
            Log.i(TAG, "Sem resposta do servidor agora", falha);
        } finally {
            if (conexao != null) conexao.disconnect();
        }
    }

    // O servidor renova o prazo do cookie da sessão quando ela é usada (contas/rotas.js): a renovação
    // volta para a WebView, ou a conta sairia sozinha de quem só usa o Nexo pelas notificações.
    private static void guardarCookiesRenovados(String origem, Map<String, List<String>> cabecalhos, Handler principal) {
        for (Map.Entry<String, List<String>> cabecalho : cabecalhos.entrySet()) {
            if (cabecalho.getKey() == null || !cabecalho.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String valor : cabecalho.getValue()) {
                principal.post(() -> CookieManager.getInstance().setCookie(origem, valor));
            }
            principal.post(() -> CookieManager.getInstance().flush());
        }
    }

    private static String ler(InputStream entrada) throws IOException {
        try (InputStream fluxo = entrada; ByteArrayOutputStream saida = new ByteArrayOutputStream()) {
            byte[] pedaco = new byte[8192];
            int lidos;
            while ((lidos = fluxo.read(pedaco)) != -1) {
                saida.write(pedaco, 0, lidos);
                if (saida.size() > RESPOSTA_MAXIMA) throw new IOException("resposta grande demais");
            }
            return saida.toString(StandardCharsets.UTF_8.name());
        }
    }

    // O sistema interrompeu (a rede caiu, o tempo acabou): tenta na próxima janela.
    @Override
    public boolean onStopJob(JobParameters parametros) {
        return true;
    }
}
