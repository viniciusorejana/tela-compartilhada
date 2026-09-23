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
