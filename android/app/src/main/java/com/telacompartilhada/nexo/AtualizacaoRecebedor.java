package com.telacompartilhada.nexo;

import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

/**
 * O que o Android responde sobre a atualização (Atualizador.java).
 *
 *   - Do instalador: "falta a pessoa confirmar" (a janela de confirmação, que este receptor abre),
 *     ou o resultado. Este receptor não é exportado: só a intenção que o Atualizador entregou ao
 *     instalador chega aqui, então a confirmação que ele abre é sempre a do sistema.
 *   - MY_PACKAGE_REPLACED: a versão nova entrou. O Android fecha o Nexo para trocá-lo e não o
 *     abre de novo; a notificação "Nexo atualizado" é o caminho de volta, a um toque.
 */
public class AtualizacaoRecebedor extends BroadcastReceiver {
    private static final String TAG = "NexoAtualizador";

    @Override
    public void onReceive(Context contexto, Intent pedido) {
        String acao = pedido.getAction();
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(acao)) {
            Atualizador.depoisDeInstalar(contexto);
            Avisos.atualizado(contexto);
            // A pergunta periódica continua agendada, mas um trabalho persistido pode ter sido
            // descartado na troca: agendar de novo não reinicia a contagem.
            AvisosJob.agendar(contexto);
            return;
        }
        if (!Atualizador.ACAO_INSTALACAO.equals(acao)) return;
        int situacao = pedido.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (situacao == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmar = confirmacao(pedido);
            if (confirmar == null) {
                Atualizador.resultadoDaInstalacao(contexto, PackageInstaller.STATUS_FAILURE, null);
                return;
            }
            try {
                contexto.startActivity(confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException | SecurityException recusa) {
                Log.w(TAG, "A confirmação do instalador não abriu", recusa);
                Atualizador.resultadoDaInstalacao(contexto, PackageInstaller.STATUS_FAILURE, null);
            }
            return;
        }
        Atualizador.resultadoDaInstalacao(contexto, situacao, pedido.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmacao(Intent pedido) {
        return Build.VERSION.SDK_INT >= 33 ? pedido.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : pedido.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
