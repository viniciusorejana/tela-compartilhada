package com.telacompartilhada.nexo;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.ContextCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * O Nexo para Android: a MESMA sala do navegador, numa WebView. Como no aplicativo de mesa
 * (app/main.js), a interface não é copiada para cá -- a janela carrega o servidor que a pessoa
 * escolheu. Uma interface só, um lugar para manter.
 *
 * O que o aplicativo acrescenta ao navegador do celular é o que o navegador não consegue: a
 * chamada continuar com a tela apagada ou com outro aplicativo na frente (ChamadaService).
 *
 * Segurança, nas mesmas regras do Electron: a sala é conteúdo REMOTO. A ponte com o aplicativo
 * (nexoAndroid) só existe na origem que a pessoa escolheu -- digitada na tela de endereço, nunca
 * pedida por uma página --, microfone e câmera só são dados a essa origem, e qualquer outro
 * destino abre no navegador do celular, longe da ponte.
 */
public class MainActivity extends Activity {
    // A tela de endereço vem dos assets, servida como https por um domínio reservado à WebView
    // (WebViewAssetLoader). Por file:// ela seria uma origem opaca, sem ponte possível.
    private static final String ORIGEM_LOCAL = "https://appassets.androidplatform.net";
    private static final String PAGINA_DE_ENDERECO = ORIGEM_LOCAL + "/assets/endereco.html";
    static final String ACAO_TROCAR_SERVIDOR = "com.telacompartilhada.nexo.TROCAR_SERVIDOR";

    private static final int PEDIDO_DE_MIDIA = 1;
    private static final int PEDIDO_DE_ARQUIVO = 2;
    private static final int PEDIDO_DE_AVISOS = 3;
    // Uma página nova que não confirma a chamada neste tempo não é uma sala: o serviço sai.
    private static final long MS_PARA_CONFIRMAR_A_CHAMADA = 30_000;

    private WebView web;
    private SharedPreferences preferencias;
    private WebViewAssetLoader assets;
    // A única origem em que a janela pode ficar, e a única que fala com o aplicativo.
    private String origemDaSala;
    // O endereço sendo aberto agora. Só vira configuração se a página carregar.
    private String enderecoPendente;
    // Por onde a página recebe os botões da notificação. Vem com a primeira mensagem dela.
    private JavaScriptReplyProxy respostaDaSala;
    private PermissionRequest pedidoDeMidia;
    private ValueCallback<Uri[]> escolhaDeArquivo;
    private boolean emChamada;
    private boolean chamadaConfirmada;
    private boolean pedindoAvisos;
    private final Handler relogio = new Handler(Looper.getMainLooper());
    private final Runnable conferirChamada = () -> { if (!chamadaConfirmada) pararChamada(); };

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        preferencias = getSharedPreferences("nexo", MODE_PRIVATE);

        FrameLayout raiz = new FrameLayout(this);
        raiz.setBackgroundColor(ContextCompat.getColor(this, R.color.fundo));
        web = new WebView(this);
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.fundo));
        raiz.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(raiz);
        respeitarAsBarrasDoSistema(raiz);
        configurarWebView();
        ChamadaService.definirOuvinte(acao -> runOnUiThread(() -> repassarParaASala(acao)));
        registrarVoltar();

        String salvo = preferencias.getString("endereco", null);
        if (ACAO_TROCAR_SERVIDOR.equals(getIntent().getAction()) || salvo == null) mostrarTelaDeEndereco(null, salvo);
        else irPara(salvo);
    }

    @Override
    protected void onNewIntent(Intent pedido) {
        super.onNewIntent(pedido);
        setIntent(pedido);
        // O atalho do ícone. A notificação só traz a sala de volta para a frente.
        if (ACAO_TROCAR_SERVIDOR.equals(pedido.getAction())) mostrarTelaDeEndereco(null, preferencias.getString("endereco", null));
    }

    // Do Android 15 em diante a página desenha por baixo das barras do sistema (e do teclado). O
    // espaço delas vira margem; abaixo do 15 a própria janela já desconta.
    private void respeitarAsBarrasDoSistema(FrameLayout raiz) {
        if (Build.VERSION.SDK_INT < 35) return;
        raiz.setOnApplyWindowInsetsListener((vista, recortes) -> {
            Insets barras = recortes.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            vista.setPadding(barras.left, barras.top, barras.right, barras.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configurarWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        // A voz da sala toca sem esperar um toque: quem entra numa chamada já pediu para ouvir.
        ajustes.setMediaPlaybackRequiresUserGesture(false);
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(false);
        // window.open e target=_blank chegam em onCreateWindow, que os manda para o navegador.
        ajustes.setSupportMultipleWindows(true);
        ajustes.setJavaScriptCanOpenWindowsAutomatically(true);
        // É por aqui que a página sabe que está no aplicativo, e qual versão dele (app-android.js).
        ajustes.setUserAgentString(ajustes.getUserAgentString() + " NexoAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        // O processo que desenha a página continua importante com o Nexo fora da tela: sem isto o
        // Android o mata primeiro quando falta memória, e a chamada vai junto.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new Navegacao());
        web.setWebChromeClient(new Cromo());
        // Baixar um arquivo da sala (uma imagem do chat, os dados da conta) é com o navegador.
        web.setDownloadListener((url, agente, disposicao, tipo, tamanho) -> abrirFora(Uri.parse(url)));

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "nexoEndereco", Collections.singleton(ORIGEM_LOCAL), this::aoMensagemDoEndereco);
        }
    }

    // ------------------------------------------------------------------ endereço e origem

    /** "https://host[:porta]", sem a porta padrão: é a forma que a WebView usa para comparar. */
    static String origemDe(Uri uri) {
        if (uri == null || uri.getHost() == null) return null;
        String esquema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!esquema.equals("http") && !esquema.equals("https")) return null;
        int porta = uri.getPort();
        boolean padrao = porta == -1 || (esquema.equals("http") && porta == 80) || (esquema.equals("https") && porta == 443);
        return esquema + "://" + uri.getHost().toLowerCase(Locale.ROOT) + (padrao ? "" : ":" + porta);
    }

    private void irPara(String endereco) {
        String origem = origemDe(Uri.parse(endereco));
        if (origem == null) {
            mostrarTelaDeEndereco("endereço inválido", endereco);
            return;
        }
        enderecoPendente = endereco;
        origemDaSala = origem;
        ligarPonte(origem);
        web.loadUrl(endereco);
    }

    // A ponte nasce presa à origem escolhida. Trocar de servidor desfaz a antiga antes: uma
    // página do servidor anterior não pode continuar falando com o aplicativo.
    private void ligarPonte(String origem) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.removeWebMessageListener(web, "nexoAndroid");
        respostaDaSala = null;
        WebViewCompat.addWebMessageListener(web, "nexoAndroid", Collections.singleton(origem), this::aoMensagemDaSala);
    }

    private void mostrarTelaDeEndereco(String erro, String anterior) {
        enderecoPendente = null;
        pararChamada();
        Uri.Builder pagina = Uri.parse(PAGINA_DE_ENDERECO).buildUpon();
        if (erro != null) pagina.appendQueryParameter("erro", erro);
        if (anterior != null) pagina.appendQueryParameter("anterior", anterior);
        web.loadUrl(pagina.build().toString());
    }

    // A resposta (JavaScriptReplyProxy) só chega por um WebMessageListener, que só existe quando o
    // recurso existe: a conferência que o lint pede já aconteceu ao ligar a ponte.
    @SuppressLint("RequiresFeature")
    private void aoMensagemDoEndereco(WebView vista, WebMessageCompat mensagem, Uri origem, boolean principal, JavaScriptReplyProxy resposta) {
        if (!principal || mensagem.getData() == null || !ORIGEM_LOCAL.equals(origemDe(origem))) return;
        try {
            JSONObject pedido = new JSONObject(mensagem.getData());
            if (!"endereco".equals(pedido.optString("tipo"))) return;
            String valor = pedido.optString("valor").trim();
            if (origemDe(Uri.parse(valor)) == null) {
                resposta.postMessage("{\"tipo\":\"endereco\",\"ok\":false}");
                return;
            }
            irPara(valor);
        } catch (JSONException ignorada) {
            // Mensagem fora do formato: a tela de endereço é nossa, então isso não acontece.
        }
    }

    // ------------------------------------------------------------------ a chamada

    private void aoMensagemDaSala(WebView vista, WebMessageCompat mensagem, Uri origem, boolean principal, JavaScriptReplyProxy resposta) {
        if (!principal || mensagem.getData() == null || origemDaSala == null || !origemDaSala.equals(origemDe(origem))) return;
        respostaDaSala = resposta;
        try {
            JSONObject pedido = new JSONObject(mensagem.getData());
            if (!"chamada".equals(pedido.optString("tipo"))) return;
            if (pedido.optBoolean("ativa")) iniciarChamada(pedido.optString("sala"), pedido.optBoolean("microfone"), pedido.optBoolean("ensurdecido"));
            else pararChamada();
        } catch (JSONException ignorada) {
            // Uma página que fala outra coisa não liga nem desliga nada.
        }
    }

    private void iniciarChamada(String sala, boolean microfone, boolean ensurdecido) {
        emChamada = true;
        chamadaConfirmada = true;
        relogio.removeCallbacks(conferirChamada);
        pedirPermissaoDeAvisos();
        // O código da sala vai para o título da notificação: só o que um código de sala tem.
        String limpa = sala.replaceAll("[^A-Za-z0-9_-]", "");
        ChamadaService.atualizar(this, limpa.length() > 32 ? limpa.substring(0, 32) : limpa, microfone, ensurdecido);
    }

    private void pararChamada() {
        relogio.removeCallbacks(conferirChamada);
        if (!emChamada) return;
        emChamada = false;
        ChamadaService.parar(this);
    }

    // Os botões da notificação, para a página: é lá que o microfone e a saída são de verdade.
    @SuppressLint("RequiresFeature")
    private void repassarParaASala(String acao) {
        if (respostaDaSala == null) {
            if ("sair".equals(acao)) pararChamada();
            return;
        }
        try {
            respostaDaSala.postMessage(new JSONObject().put("tipo", acao).toString());
        } catch (JSONException | IllegalStateException ignorada) {
            // A página já foi embora; a próxima avisa de novo.
        }
    }

    // O Android 13 pede licença para a notificação, e sem ela a chamada continua -- só não
    // aparece na gaveta. Pedida uma vez, quando a primeira chamada começa, e não ao abrir.
    private void pedirPermissaoDeAvisos() {
        if (Build.VERSION.SDK_INT < 33 || pedindoAvisos || pedidoDeMidia != null || preferencias.getBoolean("avisosPedidos", false)) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        pedindoAvisos = true;
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PEDIDO_DE_AVISOS);
    }

    // ------------------------------------------------------------------ microfone e câmera

    private boolean tem(String permissao) {
        return checkSelfPermission(permissao) == PackageManager.PERMISSION_GRANTED;
    }

    private void decidirPermissao(PermissionRequest pedido) {
        if (origemDaSala == null || !origemDaSala.equals(origemDe(pedido.getOrigin()))) {
            pedido.deny();
            return;
        }
        List<String> faltam = new ArrayList<>();
        for (String recurso : pedido.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(recurso) && !tem(Manifest.permission.RECORD_AUDIO)) faltam.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(recurso) && !tem(Manifest.permission.CAMERA)) faltam.add(Manifest.permission.CAMERA);
        }
        if (faltam.isEmpty()) {
            concederOQueOSistemaDeu(pedido);
            return;
        }
        if (pedidoDeMidia != null) pedidoDeMidia.deny();
        pedidoDeMidia = pedido;
        requestPermissions(faltam.toArray(new String[0]), PEDIDO_DE_MIDIA);
    }

    // Só o que o Android deu: microfone sem câmera é uma resposta válida, e a sala lida com ela.
    private void concederOQueOSistemaDeu(PermissionRequest pedido) {
        List<String> concedidos = new ArrayList<>();
        for (String recurso : pedido.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(recurso) && tem(Manifest.permission.RECORD_AUDIO)) concedidos.add(recurso);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(recurso) && tem(Manifest.permission.CAMERA)) concedidos.add(recurso);
        }
        if (concedidos.isEmpty()) pedido.deny();
        else pedido.grant(concedidos.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permissoes, int[] respostas) {
        super.onRequestPermissionsResult(codigo, permissoes, respostas);
        if (codigo == PEDIDO_DE_MIDIA && pedidoDeMidia != null) {
            concederOQueOSistemaDeu(pedidoDeMidia);
            pedidoDeMidia = null;
        } else if (codigo == PEDIDO_DE_AVISOS) {
            pedindoAvisos = false;
            preferencias.edit().putBoolean("avisosPedidos", true).apply();
        }
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, Intent dados) {
        if (codigo == PEDIDO_DE_ARQUIVO && escolhaDeArquivo != null) {
            escolhaDeArquivo.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, dados));
            escolhaDeArquivo = null;
            return;
        }
        super.onActivityResult(codigo, resultado, dados);
    }

    // ------------------------------------------------------------------ fora do Nexo

    private void abrirFora(Uri endereco) {
        String esquema = endereco.getScheme() == null ? "" : endereco.getScheme().toLowerCase(Locale.ROOT);
        if (!esquema.equals("http") && !esquema.equals("https") && !esquema.equals("mailto")) {
            Toast.makeText(this, R.string.link_nao_abre, Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, endereco).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException semAplicativo) {
            Toast.makeText(this, R.string.link_sem_aplicativo, Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ voltar

    private void registrarVoltar() {
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::voltar);
        }
    }

    // Só abaixo do Android 13: dali em diante o voltar chega pelo OnBackInvokedCallback acima, e
    // este método nem é chamado -- por isso o aviso do lint não se aplica aqui.
    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        voltar();
    }

    // Numa chamada, voltar guarda o Nexo como o botão de início: sair da sala é o botão Sair, e
    // um gesto de voltar no lugar errado não pode derrubar a conversa de todo mundo.
    private void voltar() {
        if (emChamada) {
            moveTaskToBack(true);
            return;
        }
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        ChamadaService.definirOuvinte(null);
        pararChamada();
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }

    // Sem onPause/onResume da WebView, de propósito: pausá-la ao sair da tela congelaria os
    // temporizadores da página -- e com eles a conexão da sala.

    // ------------------------------------------------------------------ a navegação

    private class Navegacao extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView vista, WebResourceRequest pedido) {
            return assets.shouldInterceptRequest(pedido.getUrl());
        }

        // A janela fica na origem da sala (e na tela de endereço). Qualquer outro destino abre no
        // navegador do celular, como os links do chat já abrem no aplicativo de mesa.
        @Override
        public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
            if (!pedido.isForMainFrame()) return false;
            String origem = origemDe(pedido.getUrl());
            if (ORIGEM_LOCAL.equals(origem)) return false;
            if (origem != null && origem.equals(origemDaSala)) return false;
            // O endereço escolhido pode redirecionar ao abrir (http para https, o domínio com
            // "www"): enquanto ele está sendo aberto, o redirecionamento segue.
            if (origem != null && enderecoPendente != null && pedido.isRedirect()) return false;
            abrirFora(pedido.getUrl());
            return true;
        }

        @Override
        public void onPageStarted(WebView vista, String url, Bitmap icone) {
            respostaDaSala = null;
            // A página que tinha a chamada saiu de cena. Se a nova for a sala de novo (um F5), ela
            // confirma; se não confirmar, o serviço sai.
            chamadaConfirmada = false;
            relogio.removeCallbacks(conferirChamada);
            if (emChamada) relogio.postDelayed(conferirChamada, MS_PARA_CONFIRMAR_A_CHAMADA);
        }

        @Override
        public void onPageFinished(WebView vista, String url) {
            String origem = origemDe(Uri.parse(url));
            if (enderecoPendente == null || origem == null || ORIGEM_LOCAL.equals(origem)) return;
            // Carregou de verdade: agora sim o endereço vira configuração. Guardar antes prendia a
            // pessoa num servidor fora do ar.
            preferencias.edit().putString("endereco", enderecoPendente).apply();
            enderecoPendente = null;
            // Chegou noutra origem (o redirecionamento): a ponte vai para ela, e a página recarrega
            // para recebê-la -- a ponte só entra em páginas abertas depois de ligada.
            if (!origem.equals(origemDaSala)) {
                origemDaSala = origem;
                ligarPonte(origem);
                vista.reload();
            }
        }

        @Override
        public void onReceivedError(WebView vista, WebResourceRequest pedido, WebResourceError erro) {
            if (!pedido.isForMainFrame()) return;
            String tentado = enderecoPendente != null ? enderecoPendente : pedido.getUrl().toString();
            // O endereço anterior continua guardado: o servidor pode só estar fora do ar agora.
            mostrarTelaDeEndereco(erro.getDescription() + " (" + erro.getErrorCode() + ")", tentado);
        }

        // O processo da página morreu (falta de memória, quase sempre). Sem isto o aplicativo
        // inteiro cai junto; assim a atividade renasce e abre o servidor de novo.
        @Override
        public boolean onRenderProcessGone(WebView vista, RenderProcessGoneDetail detalhe) {
            pararChamada();
            recreate();
            return true;
        }
    }

    private class Cromo extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest pedido) {
            runOnUiThread(() -> decidirPermissao(pedido));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest pedido) {
            if (pedido == pedidoDeMidia) pedidoDeMidia = null;
        }

        // O "Enviar som" da mesa, a foto do perfil, a imagem do chat.
        @Override
        public boolean onShowFileChooser(WebView vista, ValueCallback<Uri[]> retorno, FileChooserParams parametros) {
            if (escolhaDeArquivo != null) escolhaDeArquivo.onReceiveValue(null);
            escolhaDeArquivo = retorno;
            try {
                startActivityForResult(parametros.createIntent(), PEDIDO_DE_ARQUIVO);
                return true;
            } catch (ActivityNotFoundException semSeletor) {
                escolhaDeArquivo = null;
                return false;
            }
        }

        // window.open e target=_blank: o endereço chega numa WebView descartável, que só serve
        // para descobri-lo e mandá-lo para o navegador.
        @Override
        public boolean onCreateWindow(WebView vista, boolean dialogo, boolean gesto, Message resultado) {
            WebView descartavel = new WebView(MainActivity.this);
            descartavel.setWebViewClient(new WebViewClient() {
                private boolean aberto;

                private void abrirUmaVez(WebView quem, Uri destino) {
                    if (aberto) return;
                    aberto = true;
                    quem.stopLoading();
                    abrirFora(destino);
                    quem.post(quem::destroy);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView quem, WebResourceRequest pedido) {
                    abrirUmaVez(quem, pedido.getUrl());
                    return true;
                }

                @Override
                public void onPageStarted(WebView quem, String url, Bitmap icone) {
                    abrirUmaVez(quem, Uri.parse(url));
                }

                // A descartável não guarda nada: se o processo dela cair, ela só some.
                @Override
                public boolean onRenderProcessGone(WebView quem, RenderProcessGoneDetail detalhe) {
                    quem.destroy();
                    return true;
                }
            });
            ((WebView.WebViewTransport) resultado.obj).setWebView(descartavel);
            resultado.sendToTarget();
            return true;
        }

        // Sem isto a WebView desenha um botão de play cinza em todo <video> antes do primeiro
        // quadro -- nos quadradinhos da sala, que nunca tiveram play nenhum.
        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }
}
