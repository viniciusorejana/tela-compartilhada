// A lista de downloads é construída a partir do que EXISTE no servidor, e nunca escrita à
// mão no HTML.
//
// O motivo é que cada sistema é compilado num lugar diferente: o Windows aqui, e o macOS e o
// Linux onde houver macOS e Linux (o electron-builder não gera .dmg no Windows). Um botão
// fixo no HTML prometeria um arquivo que pode não ter sido construído ainda -- e um link de
// download que responde 503 é pior do que um link que não aparece.
(() => {
  const acao = document.querySelector('.download-action');
  const label = document.getElementById('desktopBuild');
  if (!acao || !label) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  // Qual botão vem primeiro. `userAgentData.platform` é o caminho novo; `navigator.platform`
  // ainda responde em todo lugar e basta para uma ordenação -- errar aqui não esconde nada de
  // ninguém, só põe o botão provável em segundo lugar.
  function sistemaProvavel() {
    const texto = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    if (/mac|iphone|ipad/.test(texto)) return 'mac';
    if (/linux|android|x11/.test(texto)) return 'linux';
    if (/win/.test(texto)) return 'windows';
    return null;
  }

  const megabytes = bytes => (bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

  // ---------- O download acompanhado ----------
  //
  // O link de download entregava o arquivo ao navegador, e o navegador não diz nada à página:
  // noventa megabytes descendo sem sinal nenhum na tela pareciam um clique que não pegou, e a
  // pessoa clicava de novo. Aqui a página baixa sozinha, com o progresso num aviso no canto, e
  // entrega o arquivo pronto ao navegador no fim -- que salva como sempre salvou.
  //
  // Onde não dá para acompanhar (navegador sem leitura em partes, sem o aviso carregado), o
  // clique segue o caminho antigo, e nada se perde.
  const podeAcompanhar = () => Boolean(window.NexoToast && window.ReadableStream && window.Blob && window.URL?.createObjectURL);
  let emCurso = null;

  function nomeDoArquivo(resposta, url) {
    const cabecalho = resposta.headers.get('content-disposition') || '';
    const declarado = /filename\*=UTF-8''([^;]+)/i.exec(cabecalho)?.[1] || /filename="?([^";]+)"?/i.exec(cabecalho)?.[1];
    let nome = declarado || url.split('/').pop() || 'Nexo';
    try { nome = decodeURIComponent(nome); } catch (_) { /* fica como veio */ }
    return nome.replace(/[\\/:*?"<>|]/g, '_');
  }

  function entregarAoNavegador(arquivo, nome) {
    const endereco = URL.createObjectURL(arquivo);
    const salvar = document.createElement('a');
    salvar.href = endereco;
    salvar.download = nome;
    salvar.hidden = true;
    document.body.append(salvar);
    salvar.click();
    salvar.remove();
    // O navegador copia o arquivo antes de soltar o endereço; um minuto sobra.
    setTimeout(() => URL.revokeObjectURL(endereco), 60000);
  }

  async function baixarComProgresso(sistema) {
    // Um download por vez: o segundo clique pisca o aviso que já está na tela, em vez de
    // começar outra cópia dos mesmos noventa megabytes.
    if (emCurso && !emCurso.toast.fechado) {
      emCurso.toast.elemento.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260 });
      return;
    }
    const nomeDoSistema = sistema.nome.replace(' x64', '');
    const controle = new AbortController();
    const toast = NexoToast.mostrar({
      titulo: `Baixando o Nexo para ${nomeDoSistema}`, detalhe: 'Conectando ao servidor…', icone: 'download', progresso: null,
      aoCancelar: () => controle.abort(), rotuloCancelar: 'Cancelar o download'
    });
    emCurso = { toast };
    try {
      const resposta = await fetch(sistema.url, { signal: controle.signal });
      if (!resposta.ok) {
        const motivo = (await resposta.text().catch(() => '')).trim().slice(0, 200);
        throw new Error(motivo || `O servidor respondeu ${resposta.status}.`);
      }
      if (!resposta.body) { toast.fechar(); location.href = sistema.url; return; }
      const total = Number(resposta.headers.get('content-length')) || sistema.size || 0;
      const nome = nomeDoArquivo(resposta, sistema.url);
      const leitor = resposta.body.getReader();
      const velocidade = NexoToast.medidorDeVelocidade();
      const pedacos = [];
      let recebidos = 0;
      let ultimoDesenho = 0;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        pedacos.push(value);
        recebidos += value.byteLength;
        const bytesPorSegundo = velocidade(recebidos);
        // Dez desenhos por segundo bastam ao olho; um por pedaço seriam centenas.
        if (performance.now() - ultimoDesenho > 100) {
          ultimoDesenho = performance.now();
          toast.atualizar({
            titulo: total ? `Baixando o Nexo · ${Math.floor((recebidos / total) * 100)}%` : 'Baixando o Nexo',
            detalhe: NexoToast.descreverProgresso({ recebidos, total, bytesPorSegundo }),
            progresso: total ? recebidos / total : null
          });
        }
      }
      entregarAoNavegador(new Blob(pedacos, { type: 'application/octet-stream' }), nome);
      toast.atualizar({
        titulo: 'Download concluído', icone: 'ok', tom: 'ok', progresso: 1, aoCancelar: null,
        detalhe: `${nome} · ${megabytes(recebidos)} MB. Abra o arquivo e informe o endereço deste site.`,
        fecharEm: 12000
      });
    } catch (erro) {
      if (controle.signal.aborted) {
        toast.atualizar({ titulo: 'Download cancelado', detalhe: 'Nada foi salvo.', icone: 'erro', tom: '', progresso: false, aoCancelar: null, fecharEm: 4000 });
        return;
      }
      toast.atualizar({
        titulo: 'O download parou', detalhe: erro.message || 'A conexão caiu no meio do caminho.', icone: 'erro', tom: 'erro', progresso: false, aoCancelar: null,
        acoes: [
          { rotulo: 'Tentar de novo', principal: true, fazer: () => setTimeout(() => baixarComProgresso(sistema), 0) },
          // O caminho antigo continua valendo: o navegador baixa sozinho e retoma se cair.
          { rotulo: 'Baixar pelo navegador', fazer: () => { location.href = sistema.url; } }
        ]
      });
    }
  }

  function desenhar(sistemas) {
    const provavel = sistemaProvavel();
    const ordenados = [...sistemas].sort((a, b) => (b.chave === provavel) - (a.chave === provavel));
    acao.textContent = '';
    ordenados.forEach((sistema, indice) => {
      const link = document.createElement('a');
      // O primeiro é o botão cheio; os outros ficam discretos. Três botões iguais fariam a
      // pessoa ler os três para achar o dela.
      link.className = indice === 0 ? 'download-button' : 'download-button secundario';
      // O id fica no botão principal, onde ele sempre esteve: é por ele que o teste de
      // navegador e qualquer link externo alcançam "o download deste sistema".
      if (indice === 0) link.id = 'desktopDownload';
      link.href = sistema.url;
      link.setAttribute('download', '');
      link.textContent = `Baixar para ${sistema.nome.replace(' x64', '')} `;
      const extensao = document.createElement('span');
      extensao.textContent = sistema.tipo;
      link.append(extensao);
      link.addEventListener('click', evento => {
        // Ctrl/Shift/clique do meio continuam sendo do navegador: quem pediu "abrir em outra
        // aba" ou "salvar como" escolheu o caminho dele.
        if (evento.button || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
        if (!podeAcompanhar()) return;
        evento.preventDefault();
        baixarComProgresso(sistema);
      });
      acao.append(link);
    });
    acao.append(label);
    const primeiro = ordenados[0];
    const outros = ordenados.length - 1;
    // A versão aparece quando o build a anotou (app/escrever-versao.js): é o número que o
    // aplicativo aberto compara para dizer que existe um mais novo.
    label.textContent = `${primeiro.nome}${primeiro.versao ? ` · versão ${primeiro.versao}` : ''} · ${megabytes(primeiro.size)} MB · build de ${new Date(primeiro.builtAt).toLocaleDateString('pt-BR')}`
      + (outros === 1 ? ' · e mais um sistema abaixo' : outros > 1 ? ` · e mais ${outros} sistemas abaixo` : '');
  }

  fetch('/api/desktop-app', { cache: 'no-store', signal: controller.signal })
    .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
    .then(build => {
      const sistemas = Array.isArray(build.sistemas) ? build.sistemas : [];
      if (sistemas.length) return desenhar(sistemas);
      // Nenhum build pronto: o link sai de cena em vez de prometer um arquivo que não existe.
      acao.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); });
      label.textContent = 'Download ainda indisponível. Você pode usar o navegador — ele faz tudo, menos isolar o áudio de um programa.';
    })
    .catch(() => { label.textContent = 'Não foi possível consultar as builds. Tente o download.'; })
    .finally(() => clearTimeout(timer));
})();
