/* Os rostos que reagem à voz: quem fala pula, quem está quieto fica apagado.
 *
 * Um desenhista só, para dois lugares: a página que vai para dentro do OBS (obs.js) e a prévia
 * do Estúdio (estudio.js). A prévia tem de ser exatamente o que o OBS vai mostrar -- ajustar o
 * tamanho olhando um desenho que não é o de verdade seria ajustar no escuro.
 *
 * Quem decide QUEM fala é quem usa o desenhista: o OBS mede o áudio de cada pessoa, e a prévia
 * sorteia. Aqui só se desenha.
 *
 * As imagens vêm da configuração de quem usa o Estúdio (a imagem "parado" e a "falando" de cada
 * pessoa); sem elas, a foto do perfil; sem foto, a cor e as iniciais, como na sala. Mudo e
 * ensurdecido têm imagem própria se quem monta a cena quiser: ela cobre as outras enquanto o
 * estado dura. Sem ela, o rosto de sempre, apagado.
 */
(function (root) {
  const endereco = id => (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? `/api/imagem/${id}` : null);
  const ESTADOS = ['parado', 'falando', 'mudo', 'ensurdecido'];

  // De onde vêm as imagens de uma pessoa (estudio.js, `origemDasImagens`): 'pessoa', 'minhas' ou
  // 'nenhuma'. Também usada pelo painel do Estúdio, para marcar a escolha que está valendo.
  function origemDasImagens(escolhidas, rosto) {
    const temRosto = Boolean(rosto && ESTADOS.some(estado => endereco(rosto[estado])));
    const escolha = escolhidas?.usar;
    if (['pessoa', 'minhas', 'nenhuma'].includes(escolha) && (escolha !== 'pessoa' || temRosto)) return escolha;
    if (ESTADOS.some(estado => endereco(escolhidas?.[estado]))) return 'minhas';
    return temRosto ? 'pessoa' : 'nenhuma';
  }

  function criar(raiz) {
    raiz.classList.add('reativo');
    let config = { estilo: {}, pessoas: {} };
    const rostos = new Map();   // identidade -> { el, corpo, nome, imagens, pessoa, assinatura }
    const falando = new Set();
    const mudos = new Set();
    const ensurdecidos = new Set();

    function aplicarEstilo() {
      const e = config.estilo || {};
      raiz.style.setProperty('--tamanho', `${e.tamanho || 160}px`);
      raiz.style.setProperty('--espaco', `${e.espaco ?? 24}px`);
      raiz.style.setProperty('--apagado', String(1 - (e.apagar ?? 45) / 100));
      raiz.style.setProperty('--nome-escala', String((e.tamanhoDoNome || 100) / 100));
      raiz.dataset.efeito = e.efeito || 'pulo';
      raiz.dataset.formato = e.formato || 'circulo';
      raiz.dataset.direcao = e.direcao || 'linha';
      raiz.dataset.alinhar = e.alinhar || 'centro';
      raiz.classList.toggle('com-nomes', e.nomes !== false);
      raiz.classList.toggle('so-quem-fala', e.soQuemFala === true);
      raiz.classList.toggle('sem-mudos', e.mostrarMudos === false);
      raiz.classList.toggle('com-anel', e.anel !== false);
    }

    // As imagens da pessoa. De onde elas vêm é a escolha de quem monta a cena: as que a própria
    // pessoa escolheu para o rosto dela (perfil.rosto), as que ele anexou para ela, ou nenhuma --
    // e sem escolha, o que existir, nessa ordem: as dele, as dela, nenhuma. A mesma regra de
    // `origemDasImagens`, em estudio.js; aqui ela roda no OBS e na prévia.
    //
    // "Falando" sem imagem própria repete a de "parado": o efeito (pulo, pulso, brilho) é o que
    // diz que ela está falando. Mudo e ensurdecido não repetem nada: sem imagem, vale o rosto de
    // sempre.
    function imagensDe(pessoa) {
      const escolhidas = config.pessoas?.[pessoa.chave] || {};
      const fonte = { pessoa: pessoa.perfil?.rosto || {}, minhas: escolhidas, nenhuma: {} }[origemDasImagens(escolhidas, pessoa.perfil?.rosto)];
      const parado = endereco(fonte.parado);
      const falandoImg = endereco(fonte.falando);
      return { parado: parado || falandoImg, falando: falandoImg || parado, mudo: endereco(fonte.mudo), ensurdecido: endereco(fonte.ensurdecido) };
    }

    // Qual imagem de estado cobre o rosto agora. Ensurdecida sem imagem própria usa a de muda --
    // quem ensurdece no Nexo fecha o microfone junto --, e muda sem imagem fica com o rosto
    // apagado de sempre.
    function pintarEstado(id) {
      const rosto = rostos.get(id);
      if (!rosto) return;
      const imagens = rosto.imagens || {};
      const surdo = ensurdecidos.has(id);
      const qual = surdo && imagens.ensurdecido ? 'ensurdecido' : (surdo || mudos.has(id)) && imagens.mudo ? 'mudo' : '';
      if (qual) rosto.el.dataset.imagem = qual; else delete rosto.el.dataset.imagem;
      rosto.el.classList.toggle('mudo', mudos.has(id) || surdo);
      rosto.el.classList.toggle('ensurdecido', surdo);
    }

    function montar(pessoa) {
      const el = document.createElement('figure');
      el.className = 'rosto';
      el.dataset.id = pessoa.identidade;
      const corpo = document.createElement('div');
      corpo.className = 'rosto-corpo';
      const nome = document.createElement('figcaption');
      nome.className = 'rosto-nome';
      el.append(corpo, nome);
      return { el, corpo, nome, assinatura: '' };
    }

    // Só refaz o que mudou: a lista chega de novo a cada entrada e saída na sala, e trocar as
    // imagens de quem já estava faria cada GIF recomeçar do primeiro quadro.
    function desenharPessoa(rosto, pessoa) {
      const imagens = imagensDe(pessoa);
      const assinatura = JSON.stringify([imagens, pessoa.nome, pessoa.perfil?.avatar, pessoa.perfil?.cor, pessoa.perfil?.marca]);
      rosto.nome.textContent = pessoa.nome || '';
      rosto.el.title = pessoa.nome || '';
      if (rosto.assinatura === assinatura) return;
      rosto.assinatura = assinatura;
      rosto.imagens = imagens;
      rosto.corpo.replaceChildren();
      const imagem = (estado, src) => {
        const img = document.createElement('img');
        img.className = `rosto-img rosto-${estado}`;
        img.alt = '';
        img.decoding = 'async';
        img.src = src;
        rosto.corpo.append(img);
      };
      if (imagens.parado) {
        imagem('parado', imagens.parado);
        imagem('falando', imagens.falando);
      } else {
        const gerado = document.createElement('span');
        gerado.className = 'rosto-gerado';
        root.NexoPerfil?.pintar(gerado, pessoa.nome, pessoa.perfil);
        rosto.corpo.append(gerado);
      }
      rosto.el.classList.toggle('com-imagem', Boolean(imagens.parado));
      // Por cima de tudo, e só quando existem: a camada fica carregada e a troca é de opacidade.
      if (imagens.mudo) imagem('mudo', imagens.mudo);
      if (imagens.ensurdecido) imagem('ensurdecido', imagens.ensurdecido);
      pintarEstado(pessoa.identidade);
    }

    function definir({ config: novaConfig, pessoas }) {
      if (novaConfig) { config = novaConfig; aplicarEstilo(); }
      const lista = Array.isArray(pessoas) ? pessoas : [...rostos.values()].map(r => r.pessoa);
      const vivos = new Set();
      lista.forEach((pessoa, ordem) => {
        if (!pessoa?.identidade) return;
        vivos.add(pessoa.identidade);
        let rosto = rostos.get(pessoa.identidade);
        if (!rosto) { rosto = montar(pessoa); rostos.set(pessoa.identidade, rosto); }
        rosto.pessoa = pessoa;
        desenharPessoa(rosto, pessoa);
        rosto.el.style.order = String(ordem);
        if (rosto.el.parentNode !== raiz) raiz.append(rosto.el);
      });
      for (const [id, rosto] of rostos) {
        if (vivos.has(id)) continue;
        rosto.el.remove();
        rostos.delete(id);
        falando.delete(id);
        mudos.delete(id);
        ensurdecidos.delete(id);
      }
    }

    function definirFalando(id, fala) {
      const rosto = rostos.get(id);
      if (!rosto) return;
      const antes = falando.has(id);
      if (fala) falando.add(id); else falando.delete(id);
      if (antes === Boolean(fala)) return;
      rosto.el.classList.toggle('falando', Boolean(fala));
      // O pulo de quem começa a falar: um só, no começo da fala, reiniciado a cada frase.
      if (fala) { rosto.el.classList.remove('comecou'); void rosto.el.offsetWidth; rosto.el.classList.add('comecou'); }
    }

    function definirMudo(id, mudo) {
      if (!rostos.has(id)) return;
      if (mudo) mudos.add(id); else mudos.delete(id);
      pintarEstado(id);
    }

    function definirEnsurdecido(id, surdo) {
      if (!rostos.has(id)) return;
      if (surdo) ensurdecidos.add(id); else ensurdecidos.delete(id);
      pintarEstado(id);
    }

    aplicarEstilo();
    return { definir, definirFalando, definirMudo, definirEnsurdecido, ids: () => [...rostos.keys()], get config() { return config; } };
  }

  // De nível de áudio (0 a 1, a raiz da média dos quadrados) a "está falando". A sensibilidade
  // vira um limiar em dB: 35, o padrão, é -37,5 dBFS -- acima do chiado que a redução de ruído
  // deixa passar, abaixo de uma fala baixa.
  function limiarEmDb(sensibilidade = 35) {
    return -70 + (100 - Math.min(100, Math.max(1, sensibilidade))) * 0.5;
  }

  root.NexoReativo = { criar, limiarEmDb, origemDasImagens, ESTADOS };
})(window);
