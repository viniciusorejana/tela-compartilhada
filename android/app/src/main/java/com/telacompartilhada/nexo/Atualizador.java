package com.telacompartilhada.nexo;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * O Nexo se atualizando sozinho, sem passar pelo navegador do celular.
 *
 * Antes, o aviso de versão nova abria o .apk no navegador: o arquivo caía em Downloads, a pessoa
 * tinha de achá-lo e tocar nele, e o navegador ainda avisava que ele "pode ser perigoso". Agora:
 *
 *   1. BAIXAR pelo DownloadManager do Android, e não por uma linha nossa: ele continua com o Nexo
 *      congelado fora da tela, mostra o progresso na gaveta e retoma depois de uma queda. O
 *      arquivo vai para a pasta do próprio Nexo (nenhuma permissão de armazenamento).
 *   2. CONFERIR antes de oferecer: é o Nexo (o mesmo pacote), é mais novo (versionCode) e foi
 *      assinado com a mesma chave. Outra chave não instala por cima, e é melhor dizer isso aqui do
 *      que deixar o instalador do Android recusar com uma mensagem genérica.
 *   3. INSTALAR pelo PackageInstaller, com o toque da pessoa ("Instalar agora"): instalar fecha o
 *      Nexo, e numa chamada isso derruba a conversa -- então nunca acontece sozinho. O Android
 *      pede, na primeira vez, que a pessoa deixe o Nexo instalar as próprias atualizações; depois,
 *      a confirmação dele (do Android 12 em diante, às vezes nem essa).
 *
 * Só baixa da origem que a pessoa escolheu, e só um .apk. O estado vai para a página
 * (public/atualizacao-app.js) com os mesmos nomes do aplicativo de mesa: pedido, baixando,
 * pronto, cancelado, falhou -- e mais permissao e instalando, que são só daqui.
 */
final class Atualizador {
    private static final String TAG = "NexoAtualizador";
    static final String ACAO_INSTALACAO = "com.telacompartilhada.nexo.INSTALACAO";
    private static final Pattern VERSAO = Pattern.compile("\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}");
    private static final long MS_ENTRE_CONSULTAS = 500;

    private static Consumer<JSONObject> ouvinte;
    private static final Handler relogio = new Handler(Looper.getMainLooper());
    private static boolean acompanhando;
    private static boolean esperandoPermissao;

    // O estado do momento. O download em si mora no DownloadManager (sobrevive ao processo); o id
    // dele e a versão ficam nas preferências "atualizacao".
    private static String estado;
    private static String versao = "";
    private static String motivo = "";
    private static long recebidos;
    private static long total;

    private Atualizador() { }

    static void definirOuvinte(Consumer<JSONObject> novo) {
        ouvinte = novo;
    }

    private static SharedPreferences guardado(Context contexto) {
        return contexto.getSharedPreferences("atualizacao", Context.MODE_PRIVATE);
    }

    /** "1.10.0" vem depois de "1.9.2". Negativo se `a` vem antes. Ilegível conta como antes de tudo. */
    static int comparar(String a, String b) {
        int[] x = partes(a), y = partes(b);
        for (int i = 0; i < 3; i++) if (x[i] != y[i]) return Integer.compare(x[i], y[i]);
        return 0;
    }

    private static int[] partes(String versao) {
        if (versao == null || !VERSAO.matcher(versao).matches()) return new int[]{-1, -1, -1};
        String[] p = versao.split("\\.");
        return new int[]{Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2])};
    }

    static boolean maisNova(String versaoDoServidor) {
        return VERSAO.matcher(versaoDoServidor == null ? "" : versaoDoServidor).matches() && comparar(versaoDoServidor, BuildConfig.VERSION_NAME) > 0;
    }

    // ------------------------------------------------------------------ o estado

    private static void mudar(String novo, String novoMotivo) {
        estado = novo;
        motivo = novoMotivo == null ? "" : novoMotivo;
        avisar();
    }

    private static void avisar() {
        Consumer<JSONObject> atual = ouvinte;
        if (atual != null) atual.accept(estadoEmJson());
    }

    private static JSONObject estadoEmJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("tipo", "atualizacao").put("estado", estado == null ? JSONObject.NULL : estado).put("versao", versao)
                    .put("recebidos", recebidos).put("total", total).put("motivo", motivo);
        } catch (JSONException impossivel) {
            // Chaves e valores fixos: não acontece.
        }
        return json;
    }

    /** Para a página que acabou de abrir (ou de recarregar) e quer saber onde as coisas estão. */
    static JSONObject estadoAtual(Context contexto) {
        if (estado == null) restaurar(contexto);
        return estadoEmJson();
    }

    // O processo morreu no meio (o Android o encerrou com o Nexo fora da tela): o download
    // continuou no DownloadManager, e o que ele diz é o estado.
    private static void restaurar(Context contexto) {
        SharedPreferences prefs = guardado(contexto);
        long id = prefs.getLong("id", -1);
        if (id < 0) return;
        versao = prefs.getString("versao", "");
        if (!maisNova(versao)) {
            esquecer(contexto);
            return;
        }
        estado = "pedido";
        consultar(contexto);
    }

    // ------------------------------------------------------------------ baixar

    /**
     * Começa (ou retoma a conversa sobre) o download. `endereco` é o que o servidor anuncia --
     * "/downloads/Nexo.apk" --, e só vale na origem escolhida.
     */
    static void baixar(Context contexto, String origem, String endereco, String versaoNova) {
        if (estado == null) restaurar(contexto);
        if (!maisNova(versaoNova)) {
            // A página achou que havia versão nova, mas não há (ou é esta mesma).
            versao = "";
            mudar("cancelado", null);
            return;
        }
        if (versaoNova.equals(versao) && ("pedido".equals(estado) || "baixando".equals(estado) || "pronto".equals(estado) || "instalando".equals(estado))) {
            avisar();
            if (!"pronto".equals(estado)) acompanhar(contexto);
            return;
        }
        Uri arquivo = enderecoNaOrigem(origem, endereco);
        if (arquivo == null) {
            versao = versaoNova;
            mudar("falhou", contexto.getString(R.string.atualizacao_endereco_invalido));
            return;
        }
        DownloadManager downloads = contexto.getSystemService(DownloadManager.class);
        if (downloads == null) return;
        cancelarDownload(contexto);
        apagarArquivos(contexto);
        DownloadManager.Request pedido = new DownloadManager.Request(arquivo)
                .setTitle(contexto.getString(R.string.atualizacao_baixando, versaoNova))
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(contexto, Environment.DIRECTORY_DOWNLOADS, "Nexo-" + versaoNova + ".apk");
        long id;
        try {
            id = downloads.enqueue(pedido);
        } catch (RuntimeException recusa) {
            Log.w(TAG, "O DownloadManager recusou", recusa);
            versao = versaoNova;
            mudar("falhou", contexto.getString(R.string.atualizacao_sem_download));
            return;
        }
        guardado(contexto).edit().putLong("id", id).putString("versao", versaoNova).apply();
        versao = versaoNova;
        recebidos = 0;
        total = 0;
        mudar("pedido", null);
        acompanhar(contexto);
    }

    /** O que a notificação "Nexo X disponível" guardou (AvisosJob), tocada sem página para pedir. */
    static void baixarDoAviso(Context contexto, String origem) {
        SharedPreferences prefs = contexto.getSharedPreferences("nexo", Context.MODE_PRIVATE);
        String versaoNova = prefs.getString("atualizacaoVersao", null);
        String endereco = prefs.getString("atualizacaoEndereco", null);
        if (origem == null || versaoNova == null || endereco == null) return;
        baixar(contexto, origem, endereco, versaoNova);
    }

    static Uri enderecoNaOrigem(String origem, String endereco) {
        if (origem == null || endereco == null || endereco.isEmpty()) return null;
        Uri uri = endereco.startsWith("/") && !endereco.startsWith("//") ? Uri.parse(origem + endereco) : Uri.parse(endereco);
        String caminho = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.ROOT);
        if (!origem.equals(MainActivity.origemDe(uri)) || !caminho.endsWith(".apk")) return null;
        return uri;
    }

    private static void acompanhar(Context contexto) {
        if (acompanhando) return;
        acompanhando = true;
        Context app = contexto.getApplicationContext();
        relogio.post(new Runnable() {
            @Override
            public void run() {
                consultar(app);
                if ("pedido".equals(estado) || "baixando".equals(estado)) relogio.postDelayed(this, MS_ENTRE_CONSULTAS);
                else acompanhando = false;
            }
        });
    }

    private static void consultar(Context contexto) {
        long id = guardado(contexto).getLong("id", -1);
        DownloadManager downloads = contexto.getSystemService(DownloadManager.class);
        if (id < 0 || downloads == null) return;
        try (Cursor linha = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (linha == null || !linha.moveToFirst()) {
                // Cancelado pela notificação do próprio DownloadManager.
                esquecer(contexto);
                mudar("cancelado", null);
                return;
            }
            int situacao = linha.getInt(linha.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long agora = linha.getLong(linha.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long tamanho = linha.getLong(linha.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            if (situacao == DownloadManager.STATUS_SUCCESSFUL) {
                recebidos = agora;
                total = Math.max(tamanho, agora);
                terminou(contexto);
            } else if (situacao == DownloadManager.STATUS_FAILED) {
                esquecer(contexto);
                mudar("falhou", contexto.getString(R.string.atualizacao_conexao));
            } else {
                boolean mudou = agora != recebidos || tamanho != total || (agora > 0 && "pedido".equals(estado));
                recebidos = agora;
                total = Math.max(tamanho, 0);
                if (agora > 0) estado = "baixando";
                if (mudou) avisar();
            }
        } catch (RuntimeException falha) {
            Log.w(TAG, "Não deu para consultar o download", falha);
        }
    }

    private static void terminou(Context contexto) {
        File apk = arquivoBaixado(contexto);
        String problema = apk == null ? contexto.getString(R.string.atualizacao_conexao) : conferir(contexto, apk);
        if (problema != null) {
            esquecer(contexto);
            mudar("falhou", problema);
            return;
        }
        if (!"pronto".equals(estado)) {
            mudar("pronto", null);
            // Com o Nexo fora da tela, a página não mostra: a gaveta mostra.
            if (!MainActivity.naFrente) Avisos.atualizacaoPronta(contexto, versao);
        }
    }

    private static File arquivoBaixado(Context contexto) {
        File pasta = contexto.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File apk = pasta == null ? null : new File(pasta, "Nexo-" + versao + ".apk");
        return apk != null && apk.isFile() ? apk : null;
    }

    // ------------------------------------------------------------------ conferir

    /** Null: pode instalar. Senão, o motivo, para a página dizer. */
    @SuppressWarnings("deprecation")
    private static String conferir(Context contexto, File apk) {
        PackageManager pacotes = contexto.getPackageManager();
        int pedir = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo novo = pacotes.getPackageArchiveInfo(apk.getAbsolutePath(), pedir);
        if (novo == null) return contexto.getString(R.string.atualizacao_arquivo_invalido);
        if (!contexto.getPackageName().equals(novo.packageName)) return contexto.getString(R.string.atualizacao_outro_aplicativo);
        PackageInfo atual;
        try {
            atual = pacotes.getPackageInfo(contexto.getPackageName(), pedir);
        } catch (PackageManager.NameNotFoundException impossivel) {
            return contexto.getString(R.string.atualizacao_arquivo_invalido);
        }
        long versaoNova = Build.VERSION.SDK_INT >= 28 ? novo.getLongVersionCode() : novo.versionCode;
        long versaoAtual = Build.VERSION.SDK_INT >= 28 ? atual.getLongVersionCode() : atual.versionCode;
        if (versaoNova <= versaoAtual) return contexto.getString(R.string.atualizacao_nao_e_mais_nova);
        Set<String> chavesNovas = assinaturas(novo);
        Set<String> chavesAtuais = assinaturas(atual);
        // Sem como ler (um Android que não devolve as do arquivo), o instalador confere por nós.
        if (!chavesNovas.isEmpty() && !chavesAtuais.isEmpty() && !chavesNovas.equals(chavesAtuais)) {
            return contexto.getString(R.string.atualizacao_outra_chave);
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> assinaturas(PackageInfo pacote) {
        Signature[] lista = null;
        if (Build.VERSION.SDK_INT >= 28) {
            SigningInfo info = pacote.signingInfo;
            if (info != null) lista = info.hasMultipleSigners() ? info.getApkContentsSigners() : info.getSigningCertificateHistory();
            // Com rotação de chave, o histórico tem a antiga e a nova; a que assina hoje é a última.
            if (lista != null && info != null && !info.hasMultipleSigners() && lista.length > 1) lista = new Signature[]{lista[lista.length - 1]};
        } else {
            lista = pacote.signatures;
        }
        Set<String> chaves = new HashSet<>();
        if (lista != null) for (Signature assinatura : lista) chaves.add(assinatura.toCharsString());
        return chaves;
    }

    // ------------------------------------------------------------------ instalar

    /** "Instalar agora", da página ou da notificação: sempre um toque da pessoa. */
    static void instalar(Activity atividade) {
        if (estado == null) restaurar(atividade);
        if (!"pronto".equals(estado) && !"permissao".equals(estado)) {
            avisar();
            return;
        }
        File apk = arquivoBaixado(atividade);
        if (apk == null) {
            esquecer(atividade);
            mudar("falhou", atividade.getString(R.string.atualizacao_conexao));
            return;
        }
        // Uma vez: o Android quer que a pessoa diga que o Nexo pode instalar o que baixou.
        if (!atividade.getPackageManager().canRequestPackageInstalls()) {
            esperandoPermissao = true;
            mudar("permissao", null);
            try {
                atividade.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + atividade.getPackageName())));
            } catch (ActivityNotFoundException semTela) {
                esperandoPermissao = false;
                mudar("falhou", atividade.getString(R.string.atualizacao_sem_permissao));
            }
            return;
        }
        mudar("instalando", null);
        Context app = atividade.getApplicationContext();
        new Thread(() -> {
            String problema = entregarAoInstalador(app, apk);
            if (problema != null) relogio.post(() -> mudar("falhou", problema));
        }, "NexoInstalar").start();
    }

    /** A pessoa voltou das configurações: com a permissão dada, a instalação continua sozinha. */
    static void retomar(Activity atividade) {
        if (estado == null) restaurar(atividade);
        if (esperandoPermissao) {
            esperandoPermissao = false;
            if (atividade.getPackageManager().canRequestPackageInstalls()) instalar(atividade);
            else mudar("pronto", null);
            return;
        }
        if ("pedido".equals(estado) || "baixando".equals(estado)) acompanhar(atividade);
        else if ("instalando".equals(estado)) mudar("pronto", null);
    }

    @SuppressLint("InlinedApi")
    private static String entregarAoInstalador(Context contexto, File apk) {
        PackageInstaller instalador = contexto.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams parametros = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        parametros.setAppPackageName(contexto.getPackageName());
        parametros.setSize(apk.length());
        // Do Android 12 em diante, quem instalou o Nexo da última vez pode atualizá-lo sem a
        // confirmação; quando o sistema não deixa, ele simplesmente pergunta.
        if (Build.VERSION.SDK_INT >= 31) parametros.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int sessao;
        try {
            sessao = instalador.createSession(parametros);
            try (PackageInstaller.Session aberta = instalador.openSession(sessao)) {
                try (InputStream entrada = new FileInputStream(apk); OutputStream saida = aberta.openWrite("nexo.apk", 0, apk.length())) {
                    byte[] pedaco = new byte[64 * 1024];
                    int lidos;
                    while ((lidos = entrada.read(pedaco)) != -1) saida.write(pedaco, 0, lidos);
                    aberta.fsync(saida);
                }
                // MUTABLE: o instalador preenche o resultado nesta intenção. Ela só volta para o
                // nosso receptor, que não é exportado.
                PendingIntent resultado = PendingIntent.getBroadcast(contexto, 3,
                        new Intent(contexto, AtualizacaoRecebedor.class).setAction(ACAO_INSTALACAO),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                aberta.commit(resultado.getIntentSender());
            }
            return null;
        } catch (IOException | RuntimeException falha) {
            Log.w(TAG, "O instalador não aceitou o arquivo", falha);
            return contexto.getString(R.string.atualizacao_instalador_recusou);
        }
    }

    /** O que o instalador respondeu (AtualizacaoRecebedor), fora a confirmação. */
    static void resultadoDaInstalacao(Context contexto, int situacao, String mensagem) {
        if (situacao == PackageInstaller.STATUS_SUCCESS) return; // o Nexo já está sendo trocado
        // A pessoa disse não na confirmação: o arquivo continua pronto para outra vez.
        if (situacao == PackageInstaller.STATUS_FAILURE_ABORTED) {
            mudar("pronto", null);
            return;
        }
        String motivoDoSistema = situacao == PackageInstaller.STATUS_FAILURE_CONFLICT || situacao == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                ? contexto.getString(R.string.atualizacao_outra_chave)
                : situacao == PackageInstaller.STATUS_FAILURE_STORAGE ? contexto.getString(R.string.atualizacao_sem_espaco)
                : contexto.getString(R.string.atualizacao_instalador_recusou) + (mensagem == null ? "" : " (" + mensagem + ")");
        mudar("falhou", motivoDoSistema);
    }

    // ------------------------------------------------------------------ cancelar e limpar

    static void cancelar(Context contexto) {
        cancelarDownload(contexto);
        apagarArquivos(contexto);
        esquecer(contexto);
        mudar("cancelado", null);
    }

    private static void cancelarDownload(Context contexto) {
        long id = guardado(contexto).getLong("id", -1);
        DownloadManager downloads = contexto.getSystemService(DownloadManager.class);
        if (id >= 0 && downloads != null) downloads.remove(id);
    }

    private static void esquecer(Context contexto) {
        guardado(contexto).edit().clear().apply();
    }

    private static void apagarArquivos(Context contexto) {
        File pasta = contexto.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File[] antigos = pasta == null ? null : pasta.listFiles((dir, nome) -> nome.startsWith("Nexo-") && nome.endsWith(".apk"));
        if (antigos == null) return;
        for (File antigo : antigos) {
            if (!antigo.delete()) Log.i(TAG, "Ficou para trás: " + antigo.getName());
        }
    }

    /** A versão nova já está instalada (o recebedor de MY_PACKAGE_REPLACED): o .apk não serve mais. */
    static void depoisDeInstalar(Context contexto) {
        apagarArquivos(contexto);
        esquecer(contexto);
        estado = null;
    }
}
