package com.telacompartilhada.nexo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * As notificações de amigos: mensagem direta, convite para uma sala, pedido de amizade e pedido
 * aceito. E as da atualização (disponível, pronta, instalada), num canal à parte, que não são
 * da conta e por isso ficam fora de `limparTudo`.
 *
 * Chegam por dois caminhos, e os dois passam por aqui para não avisar a mesma coisa duas vezes:
 *   - a página (public/app-android.js), na hora, enquanto ela está viva -- o Nexo fora da tela
 *     mas ainda não congelado, ou segurado por uma chamada (ChamadaService);
 *   - o AvisosJob, a cada 15 minutos, quando o Android já congelou o aplicativo e o socket caiu.
 *
 * O que já foi avisado fica nas preferências "avisos": de cada conversa, o horário da última
 * mensagem avisada; dos pedidos, os códigos. Tudo o que vem de outra pessoa (nome, texto) entra
 * como texto puro, cortado, e os códigos passam por um molde antes de virar endereço.
 */
final class Avisos {
    private static final String CANAL_MENSAGENS = "mensagens";
    private static final String CANAL_CONVITES = "convites";
    private static final String CANAL_AMIGOS = "amigos";
    private static final String CANAL_ATUALIZACOES = "atualizacoes";
    private static final String GRUPO = "com.telacompartilhada.nexo.AMIGOS";

    static final String ACAO_AVISO = "com.telacompartilhada.nexo.AVISO";

    // Um id por categoria; a "tag" (a conversa, o pedido) separa uma notificação da outra.
    private static final int ID_MENSAGEM = 10;
    private static final int ID_CONVITE = 11;
    private static final int ID_PEDIDO = 12;
    private static final int ID_ACEITO = 13;
    // As da atualização ficam fora de `limparTudo`: não são da conta, são do aplicativo.
    private static final int ID_ATUALIZACAO = 20;
    private static final String TAG_ATUALIZACAO = "atualizacao";

    private static final int LINHAS_POR_CONVERSA = 6;

    static final Pattern CODIGO_DE_SALA = Pattern.compile("[a-z0-9_-]{4,32}");
    static final Pattern CODIGO_DE_CONTA = Pattern.compile("[A-Za-z0-9-]{1,24}");

    // As últimas linhas de cada conversa, para a notificação mostrar mais que a última. Só na
    // memória, como as conversas do servidor; o AvisosJob as refaz pelo que o servidor manda.
    private static final Map<String, ArrayDeque<Linha>> linhas = new HashMap<>();

    private static final class Linha {
        private final String texto;
        private final long em;

        Linha(String texto, long em) {
            this.texto = texto;
            this.em = em;
        }

        String texto() { return texto; }

        long em() { return em; }
    }

    private Avisos() { }

    private static SharedPreferences estado(Context contexto) {
        return contexto.getSharedPreferences("avisos", Context.MODE_PRIVATE);
    }

    private static NotificationManager gerente(Context contexto) {
        NotificationManager avisos = contexto.getSystemService(NotificationManager.class);
        if (avisos == null) return null;
        criarCanais(contexto, avisos);
        // Sem a licença (Android 13+) ou com as notificações do Nexo desligadas: nada a fazer.
        return avisos.areNotificationsEnabled() ? avisos : null;
    }

    private static void criarCanais(Context contexto, NotificationManager avisos) {
        if (avisos.getNotificationChannel(CANAL_MENSAGENS) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL_MENSAGENS, contexto.getString(R.string.canal_mensagens), NotificationManager.IMPORTANCE_HIGH);
            canal.setDescription(contexto.getString(R.string.canal_mensagens_descricao));
            avisos.createNotificationChannel(canal);
        }
        if (avisos.getNotificationChannel(CANAL_CONVITES) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL_CONVITES, contexto.getString(R.string.canal_convites), NotificationManager.IMPORTANCE_HIGH);
            canal.setDescription(contexto.getString(R.string.canal_convites_descricao));
            avisos.createNotificationChannel(canal);
        }
        if (avisos.getNotificationChannel(CANAL_AMIGOS) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL_AMIGOS, contexto.getString(R.string.canal_amigos), NotificationManager.IMPORTANCE_DEFAULT);
            canal.setDescription(contexto.getString(R.string.canal_amigos_descricao));
            avisos.createNotificationChannel(canal);
        }
        // Baixo: versão nova é para ver na gaveta, e não para tocar no meio de outra coisa.
        if (avisos.getNotificationChannel(CANAL_ATUALIZACOES) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL_ATUALIZACOES, contexto.getString(R.string.canal_atualizacoes), NotificationManager.IMPORTANCE_LOW);
            canal.setDescription(contexto.getString(R.string.canal_atualizacoes_descricao));
            canal.setShowBadge(false);
            avisos.createNotificationChannel(canal);
        }
    }

    private static String curto(String texto, int maximo) {
        String limpo = texto == null ? "" : texto.replaceAll("\\s+", " ").trim();
        return limpo.length() > maximo ? limpo.substring(0, maximo - 1) + "…" : limpo;
    }

    // ------------------------------------------------------------------ o toque

    /** O que tocar faz: abrir a atividade, que repassa à página (ou abre o endereço certo). */
    private static PendingIntent toque(Context contexto, String chave, String acao, String com, String sala, String codigo) {
        Intent pedido = new Intent(contexto, MainActivity.class)
                .setAction(ACAO_AVISO)
                // O endereço só separa um PendingIntent do outro; ninguém o abre.
                .setData(Uri.parse("nexo-aviso://" + Uri.encode(chave) + "/" + acao))
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("acao", acao);
        if (com != null) pedido.putExtra("com", com);
        if (sala != null) pedido.putExtra("sala", sala);
        if (codigo != null) pedido.putExtra("codigo", codigo);
        return PendingIntent.getActivity(contexto, 0, pedido, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** O caminho a abrir quando não há página viva para receber o toque. Null: só trazer à frente. */
    static String caminhoDoToque(Intent pedido) {
        String acao = pedido.getStringExtra("acao");
        String com = pedido.getStringExtra("com");
        String sala = pedido.getStringExtra("sala");
        if ("abrir".equals(acao) && com != null && CODIGO_DE_CONTA.matcher(com).matches()) return "/?conversa=" + Uri.encode(com);
        if ("entrar".equals(acao) && sala != null && CODIGO_DE_SALA.matcher(sala).matches()) return "/" + sala + "/sala";
        // Aceitar um pedido pelo endereço seria aceitar sem a página perguntar: leva aos pedidos.
        if ("aceitar".equals(acao) || "pedidos".equals(acao)) return "/?secao=pedidos";
        return null;
    }

    private static NotificationCompat.Builder base(Context contexto, String canal) {
        return new NotificationCompat.Builder(contexto, canal)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setColor(ContextCompat.getColor(contexto, R.color.destaque))
                .setAutoCancel(true)
                .setGroup(GRUPO);
    }

    // ------------------------------------------------------------------ mensagens

    /** Uma mensagem nova, vinda da página. Devolve false se já tinha sido avisada. */
    static synchronized boolean mensagem(Context contexto, String com, String nome, String texto, boolean imagem, long em) {
        if (!aindaNaoAvisada(contexto, com, em)) return false;
        synchronized (linhas) {
            ArrayDeque<Linha> lista = linhas.computeIfAbsent(com, chave -> new ArrayDeque<>());
            lista.addLast(new Linha(textoDaMensagem(contexto, texto, imagem), em));
            while (lista.size() > LINHAS_POR_CONVERSA) lista.removeFirst();
        }
        mostrarConversa(contexto, com, nome);
        return true;
    }

    private static String textoDaMensagem(Context contexto, String texto, boolean imagem) {
        String limpo = curto(texto, 200);
        if (!imagem) return limpo;
        return limpo.isEmpty() ? contexto.getString(R.string.aviso_imagem) : contexto.getString(R.string.aviso_imagem) + " · " + limpo;
    }

    private static boolean aindaNaoAvisada(Context contexto, String com, long em) {
        SharedPreferences prefs = estado(contexto);
        String chave = "em:" + com;
        if (em <= prefs.getLong(chave, 0)) return false;
        Set<String> abertas = new HashSet<>(prefs.getStringSet("conversas", new HashSet<>()));
        abertas.add(com);
        prefs.edit().putLong(chave, em).putStringSet("conversas", abertas).apply();
        return true;
    }

    private static void mostrarConversa(Context contexto, String com, String nome) {
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return;
        List<Linha> copia;
        synchronized (linhas) {
            ArrayDeque<Linha> lista = linhas.get(com);
            copia = lista == null ? new ArrayList<>() : new ArrayList<>(lista);
        }
        if (copia.isEmpty()) return;
        String quem = curto(nome, 60);
        Person eu = new Person.Builder().setName(contexto.getString(R.string.aviso_voce)).build();
        Person outro = new Person.Builder().setName(quem).setKey(com).build();
        NotificationCompat.MessagingStyle estilo = new NotificationCompat.MessagingStyle(eu);
        for (Linha linha : copia) estilo.addMessage(linha.texto(), linha.em(), outro);
        Linha ultima = copia.get(copia.size() - 1);
        Notification aviso = base(contexto, CANAL_MENSAGENS)
                .setStyle(estilo)
                .setContentTitle(quem)
                .setContentText(ultima.texto())
                .setWhen(ultima.em())
                .setShowWhen(true)
                .setNumber(copia.size())
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(toque(contexto, "conversa:" + com, "abrir", com, null, null))
                .addAction(0, contexto.getString(R.string.aviso_responder), toque(contexto, "conversa:" + com, "abrir", com, null, null))
                .build();
        avisos.notify("conversa:" + com, ID_MENSAGEM, aviso);
    }

    // ------------------------------------------------------------------ convites

    static synchronized boolean convite(Context contexto, String com, String nome, String sala, long em) {
        if (!CODIGO_DE_SALA.matcher(sala).matches() || !aindaNaoAvisada(contexto, com, em)) return false;
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return true;
        String quem = curto(nome, 60);
        Notification aviso = base(contexto, CANAL_CONVITES)
                .setContentTitle(contexto.getString(R.string.aviso_convite_titulo, quem))
                .setContentText(contexto.getString(R.string.aviso_convite_texto, sala))
                .setWhen(em)
                .setShowWhen(true)
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(toque(contexto, "convite:" + com, "abrir", com, null, null))
                .addAction(0, contexto.getString(R.string.aviso_entrar), toque(contexto, "convite:" + com, "entrar", com, sala, null))
                .addAction(0, contexto.getString(R.string.aviso_responder), toque(contexto, "convite:" + com, "abrir", com, null, null))
                .build();
        avisos.notify("convite:" + com, ID_CONVITE, aviso);
        return true;
    }

    // ------------------------------------------------------------------ amizade

    static synchronized void pedido(Context contexto, String codigo, String nome) {
        SharedPreferences prefs = estado(contexto);
        Set<String> avisados = new HashSet<>(prefs.getStringSet("pedidos", new HashSet<>()));
        if (!avisados.add(codigo)) return;
        prefs.edit().putStringSet("pedidos", avisados).apply();
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return;
        String quem = curto(nome, 60);
        Notification aviso = base(contexto, CANAL_AMIGOS)
                .setContentTitle(contexto.getString(R.string.aviso_pedido_titulo, quem))
                .setContentText(contexto.getString(R.string.aviso_pedido_texto))
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(toque(contexto, "pedido:" + codigo, "pedidos", null, null, codigo))
                .addAction(0, contexto.getString(R.string.aviso_aceitar), toque(contexto, "pedido:" + codigo, "aceitar", null, null, codigo))
                .build();
        avisos.notify("pedido:" + codigo, ID_PEDIDO, aviso);
    }

    /** Os pedidos que ainda esperam: os outros já foram respondidos, e a notificação deles sai. */
    static synchronized void pedidosPendentes(Context contexto, Set<String> pendentes) {
        SharedPreferences prefs = estado(contexto);
        Set<String> avisados = new HashSet<>(prefs.getStringSet("pedidos", new HashSet<>()));
        NotificationManager avisos = contexto.getSystemService(NotificationManager.class);
        boolean mudou = false;
        for (String codigo : new ArrayList<>(avisados)) {
            if (pendentes.contains(codigo)) continue;
            avisados.remove(codigo);
            mudou = true;
            if (avisos != null) avisos.cancel("pedido:" + codigo, ID_PEDIDO);
        }
        if (mudou) prefs.edit().putStringSet("pedidos", avisados).apply();
    }

    static void aceito(Context contexto, String codigo, String nome) {
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return;
        // O pedido virou amizade: a notificação do pedido (se era dele) não serve mais.
        avisos.cancel("pedido:" + codigo, ID_PEDIDO);
        Notification aviso = base(contexto, CANAL_AMIGOS)
                .setContentTitle(contexto.getString(R.string.aviso_aceito_titulo, curto(nome, 60)))
                .setContentText(contexto.getString(R.string.aviso_aceito_texto))
                .setCategory(NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(toque(contexto, "aceito:" + codigo, "abrir", codigo, null, null))
                .build();
        avisos.notify("aceito:" + codigo, ID_ACEITO, aviso);
    }

    // ------------------------------------------------------------------ atualização

    /** "Nexo X disponível", do AvisosJob. Tocar começa o download (Atualizador). */
    static void atualizacaoDisponivel(Context contexto, String versao) {
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return;
        PendingIntent atualizar = toque(contexto, TAG_ATUALIZACAO, "atualizar", null, null, null);
        Notification aviso = base(contexto, CANAL_ATUALIZACOES)
                .setGroup(null)
                .setContentTitle(contexto.getString(R.string.aviso_atualizacao_titulo, versao))
                .setContentText(contexto.getString(R.string.aviso_atualizacao_texto, BuildConfig.VERSION_NAME))
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setContentIntent(atualizar)
                .addAction(0, contexto.getString(R.string.aviso_atualizacao_baixar), atualizar)
                .build();
        avisos.notify(TAG_ATUALIZACAO, ID_ATUALIZACAO, aviso);
    }

    /** O download terminou com o Nexo fora da tela. Tocar instala (a pessoa pediu o download). */
    static void atualizacaoPronta(Context contexto, String versao) {
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return;
        PendingIntent instalar = toque(contexto, TAG_ATUALIZACAO, "instalar", null, null, null);
        Notification aviso = base(contexto, CANAL_ATUALIZACOES)
                .setGroup(null)
                .setContentTitle(contexto.getString(R.string.aviso_atualizacao_pronta_titulo, versao))
                .setContentText(contexto.getString(R.string.aviso_atualizacao_pronta_texto))
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setContentIntent(instalar)
                .addAction(0, contexto.getString(R.string.aviso_atualizacao_instalar), instalar)
                .build();
        avisos.notify(TAG_ATUALIZACAO, ID_ATUALIZACAO, aviso);
    }

    /** A versão nova entrou: o Android fechou o Nexo para trocá-lo, e este é o caminho de volta. */
    static void atualizado(Context contexto) {
        NotificationManager avisos = gerente(contexto);
        if (avisos == null) return;
        PendingIntent abrir = PendingIntent.getActivity(contexto, 0,
                new Intent(contexto, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification aviso = base(contexto, CANAL_ATUALIZACOES)
                .setGroup(null)
                .setContentTitle(contexto.getString(R.string.aviso_atualizado_titulo, BuildConfig.VERSION_NAME))
                .setContentText(contexto.getString(R.string.aviso_atualizado_texto))
                .setContentIntent(abrir)
                .build();
        avisos.notify(TAG_ATUALIZACAO, ID_ATUALIZACAO, aviso);
    }

    static void tirarAtualizacao(Context contexto) {
        NotificationManager avisos = contexto.getSystemService(NotificationManager.class);
        if (avisos != null) avisos.cancel(TAG_ATUALIZACAO, ID_ATUALIZACAO);
    }

    // ------------------------------------------------------------------ limpar

    /** "conversa:CODIGO" lida, ou "pedido:CODIGO" respondido. */
    static synchronized void lido(Context contexto, String chave) {
        NotificationManager avisos = contexto.getSystemService(NotificationManager.class);
        if (chave.startsWith("conversa:")) {
            String com = chave.substring("conversa:".length());
            synchronized (linhas) { linhas.remove(com); }
            SharedPreferences prefs = estado(contexto);
            Set<String> abertas = new HashSet<>(prefs.getStringSet("conversas", new HashSet<>()));
            if (abertas.remove(com)) prefs.edit().putStringSet("conversas", abertas).apply();
            if (avisos != null) {
                avisos.cancel(chave, ID_MENSAGEM);
                avisos.cancel("convite:" + com, ID_CONVITE);
            }
        } else if (chave.startsWith("pedido:") && avisos != null) {
            avisos.cancel(chave, ID_PEDIDO);
        }
    }

    /** A conta saiu deste aparelho: nada dela fica na gaveta nem nas preferências. */
    static synchronized void limparTudo(Context contexto) {
        synchronized (linhas) { linhas.clear(); }
        estado(contexto).edit().clear().apply();
        NotificationManager avisos = contexto.getSystemService(NotificationManager.class);
        if (avisos == null) return;
        for (android.service.notification.StatusBarNotification aviso : avisos.getActiveNotifications()) {
            if (aviso.getTag() != null && aviso.getId() >= ID_MENSAGEM && aviso.getId() <= ID_ACEITO) avisos.cancel(aviso.getTag(), aviso.getId());
        }
    }

    // ------------------------------------------------------------------ o que o servidor diz

    /**
     * A resposta de /api/social/avisos (social.js, `avisosPara`), pelo AvisosJob. Com o Nexo na
     * frente nada toca -- a página já mostra --, mas o que chegou fica marcado como avisado.
     */
    static synchronized void doServidor(Context contexto, JSONObject resposta, boolean naFrente) {
        boolean naoIncomodar = resposta.optBoolean("naoIncomodar");
        JSONArray conversas = resposta.optJSONArray("conversas");
        Set<String> comNovidade = new HashSet<>();
        if (conversas != null) {
            for (int i = 0; i < conversas.length(); i++) {
                JSONObject conversa = conversas.optJSONObject(i);
                if (conversa == null) continue;
                String com = conversa.optString("com");
                if (!CODIGO_DE_CONTA.matcher(com).matches()) continue;
                comNovidade.add(com);
                conversaDoServidor(contexto, com, conversa.optString("nome", com), conversa.optJSONArray("mensagens"), naFrente, naoIncomodar);
            }
        }
        // O que estava na gaveta e o servidor diz que já foi lido (no computador, noutra aba): sai.
        Set<String> abertas = new HashSet<>(estado(contexto).getStringSet("conversas", new HashSet<>()));
        for (String com : abertas) if (!comNovidade.contains(com)) lido(contexto, "conversa:" + com);

        JSONArray pedidos = resposta.optJSONArray("pedidos");
        Set<String> pendentes = new HashSet<>();
        if (pedidos != null) {
            for (int i = 0; i < pedidos.length(); i++) {
                JSONObject pedido = pedidos.optJSONObject(i);
                if (pedido == null) continue;
                String codigo = pedido.optString("codigo");
                if (!CODIGO_DE_CONTA.matcher(codigo).matches()) continue;
                pendentes.add(codigo);
                if (naFrente) marcarPedido(contexto, codigo);
                else pedido(contexto, codigo, pedido.optString("nome", codigo));
            }
        }
        pedidosPendentes(contexto, pendentes);
    }

    private static void marcarPedido(Context contexto, String codigo) {
        SharedPreferences prefs = estado(contexto);
        Set<String> avisados = new HashSet<>(prefs.getStringSet("pedidos", new HashSet<>()));
        if (avisados.add(codigo)) prefs.edit().putStringSet("pedidos", avisados).apply();
    }

    private static void conversaDoServidor(Context contexto, String com, String nome, JSONArray mensagens, boolean naFrente, boolean naoIncomodar) {
        if (mensagens == null || mensagens.length() == 0) return;
        long jaAvisada = estado(contexto).getLong("em:" + com, 0);
        long maisNova = 0;
        JSONObject convite = null;
        List<Linha> lista = new ArrayList<>();
        for (int i = 0; i < mensagens.length(); i++) {
            JSONObject m = mensagens.optJSONObject(i);
            if (m == null) continue;
            long em = m.optLong("em");
            maisNova = Math.max(maisNova, em);
            if ("convite".equals(m.optString("tipo"))) {
                if (em > jaAvisada) convite = m;
                continue;
            }
            lista.add(new Linha(textoDaMensagem(contexto, m.optString("texto"), m.optBoolean("imagem")), em));
        }
        // Nada novo desde o último aviso: a notificação que está lá continua como está.
        if (maisNova <= jaAvisada) return;
        if (naFrente) {
            aindaNaoAvisada(contexto, com, maisNova);
            return;
        }
        if (convite != null) convite(contexto, com, nome, convite.optString("sala"), convite.optLong("em"));
        boolean temTextoNovo = false;
        for (Linha linha : lista) if (linha.em() > jaAvisada) temTextoNovo = true;
        aindaNaoAvisada(contexto, com, maisNova);
        if (!temTextoNovo || naoIncomodar) return;
        synchronized (linhas) {
            ArrayDeque<Linha> fila = new ArrayDeque<>(lista);
            while (fila.size() > LINHAS_POR_CONVERSA) fila.removeFirst();
            linhas.put(com, fila);
        }
        mostrarConversa(contexto, com, nome);
    }
}
