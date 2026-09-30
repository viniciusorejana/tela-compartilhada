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
 * pessoa); sem elas, a foto do perfil; sem foto, a cor e as iniciais, como na sala.
 */
(function (root) {
  const endereco = id => (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? `/api/imagem/${id}` : null);

  function criar(raiz) {
    raiz.classList.add('reativo');
    let config = { estilo: {}, pessoas: {} };
    const rostos = new Map();   // identidade -> { el, corpo, parado, falando, gerado, assinatura }
    const falando = new Set();
    const mudos = new Set();

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

    // As duas imagens da pessoa. "Falando" sem imagem própria repete a de "parado": o efeito
    // (pulo, pulso, brilho) é o que diz que ela está falando.
    function imagensDe(pessoa) {
      const escolhidas = config.pessoas?.[pessoa.chave] || {};
      const parado = endereco(escolhidas.parado);
      const falandoImg = endereco(escolhidas.falando);
      return { parado: parado || falandoImg, falando: falandoImg || parado };
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
      rosto.corpo.replaceChildren();
      if (imagens.parado) {
        for (const [estado, src] of Object.entries(imagens)) {
          const img = document.createElement('img');
          img.className = `rosto-img rosto-${estado}`;
          img.alt = '';
          img.decoding = 'async';
          img.src = src;
          rosto.corpo.append(img);
        }
        rosto.el.classList.add('com-imagem');
      } else {
        const gerado = document.createElement('span');
        gerado.className = 'rosto-gerado';
        root.NexoPerfil?.pintar(gerado, pessoa.nome, pessoa.perfil);
        rosto.corpo.append(gerado);
        rosto.el.classList.remove('com-imagem');
      }
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
      const rosto = rostos.get(id);
      if (!rosto) return;
      if (mudo) mudos.add(id); else mudos.delete(id);
      rosto.el.classList.toggle('mudo', Boolean(mudo));
    }

    aplicarEstilo();
    return { definir, definirFalando, definirMudo, ids: () => [...rostos.keys()], get config() { return config; } };
  }

  // De nível de áudio (0 a 1, a raiz da média dos quadrados) a "está falando". A sensibilidade
  // vira um limiar em dB: 35, o padrão, é -37,5 dBFS -- acima do chiado que a redução de ruído
  // deixa passar, abaixo de uma fala baixa.
  function limiarEmDb(sensibilidade = 35) {
    return -70 + (100 - Math.min(100, Math.max(1, sensibilidade))) * 0.5;
  }

  root.NexoReativo = { criar, limiarEmDb };
})(window);
