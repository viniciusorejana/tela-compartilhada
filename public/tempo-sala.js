/* Há quanto tempo a sala está aberta, e há quanto tempo cada pessoa está nela.
 *
 * Os instantes vêm do servidor (tempos.js), que reconhece a pessoa e não a aba: um F5 ou uma
 * queda curta continua o relógio de onde ele estava. Aqui eles viram texto -- no topo, o da
 * sala; na barra lateral, o de cada pessoa ao passar o mouse; e num popover, todos juntos.
 *
 * Nada disto pesa na tela de quem não procura: o relógio do topo é um número pequeno, e os
 * tempos por pessoa só aparecem quando alguém pede por eles.
 */
(() => {
  const $ = id => document.getElementById(id);
  const CHAVE_DO_SORTEIO = 'nexo.chaveDeTempo';

  // Quanto o relógio do servidor está à frente do deste computador. Sem isto, uma máquina com o
  // relógio adiantado mostraria "há cinco minutos" para quem acabou de chegar.
  let desvio = 0;
  let abertaEm = null;
  let meuDesde = null;
  const desdePorIdentidade = new Map();
  const local = instante => (Number.isFinite(instante) ? instante - desvio : null);

  // O sorteio que reconhece quem não tem conta depois de um F5. Fica neste navegador e só vai
  // ao servidor desta sala, ao conectar; a sala nunca o vê.
  function chave() {
    try {
      let sorteio = localStorage.getItem(CHAVE_DO_SORTEIO);
      if (!/^[a-f0-9]{32}$/.test(sorteio || '')) {
        sorteio = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(CHAVE_DO_SORTEIO, sorteio);
      }
      return sorteio;
    } catch (_) { return undefined; }   // sem armazenamento: vale a identidade da sessão
  }

  // ---------- As três formas de dizer um tempo ----------
  // Relógio, para o que anda à vista: "42:10", "1:02:13".
  function relogio(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const horas = Math.floor(total / 3600);
    const minutos = Math.floor((total % 3600) / 60);
    const segundos = String(total % 60).padStart(2, '0');
    return horas ? `${horas}:${String(minutos).padStart(2, '0')}:${segundos}` : `${minutos}:${segundos}`;
  }
  // Curta, para uma lista: "agora", "12 min", "1 h 05".
  function curta(ms) {
    const minutos = Math.floor(Math.max(0, ms) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `${minutos} min`;
    return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')}`;
  }
  // Por extenso, para ler em voz alta ou num título: "1 hora e 5 minutos".
  function extenso(ms) {
    const minutos = Math.floor(Math.max(0, ms) / 60000);
    if (minutos < 1) return 'menos de um minuto';
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    const h = horas ? `${horas} ${horas === 1 ? 'hora' : 'horas'}` : '';
    const m = resto ? `${resto} ${resto === 1 ? 'minuto' : 'minutos'}` : '';
    return [h, m].filter(Boolean).join(' e ');
  }
  const hora = instante => new Date(instante).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  function desdeDe(id) {
    if (id === 'self') return meuDesde;
    return desdePorIdentidade.get(id) ?? null;
  }
  const duracaoDe = id => { const desde = desdeDe(id); return desde === null ? null : Date.now() - desde; };

  // ---------- O que chega da sala ----------
  function aoEntrar(pacote, pares = []) {
    if (!pacote || !Number.isFinite(pacote.agora)) return;
    desvio = pacote.agora - Date.now();
    abertaEm = local(pacote.abertaEm);
    meuDesde = local(pacote.desde);
    for (const par of pares) if (par?.identidade && Number.isFinite(par.desde)) desdePorIdentidade.set(par.identidade, local(par.desde));
    pintar();
  }
  function definir(identidade, desde) {
    if (!identidade || !Number.isFinite(desde)) return;
    desdePorIdentidade.set(identidade, local(desde));
  }
  function esquecer(identidade) { desdePorIdentidade.delete(identidade); }

  // ---------- O relógio do topo e o popover ----------
  const botao = $('tempoSalaBtn');
  const texto = $('tempoSalaTexto');
  const menu = $('tempoSalaMenu');
  let ancora = null;

  // Quem está na sala agora, na ordem de quem chegou primeiro. O bot de música fica de fora:
  // ele não "está" na sala, ele toca nela.
  function presentes() {
    const lista = [];
    if (tiles.has('self')) lista.push({ id: 'self', nome: myName, voce: true });
    for (const par of peers.values()) if (!par.ehBot) lista.push({ id: par.id, nome: par.name });
    return lista
      .map(pessoa => ({ ...pessoa, desde: desdeDe(pessoa.id) }))
      .sort((a, b) => (a.desde ?? Infinity) - (b.desde ?? Infinity));
  }

  function pintarMenu() {
    if (menu.classList.contains('hidden')) return;
    const agora = Date.now();
    $('tempoSalaTitulo').textContent = abertaEm ? `Sala aberta há ${extenso(agora - abertaEm)}` : 'Tempo na sala';
    $('tempoSalaDesde').textContent = abertaEm ? `Desde as ${hora(abertaEm)} · ${relogio(agora - abertaEm)}` : 'Assim que você entrar, o relógio aparece aqui.';
    const total = abertaEm ? Math.max(1, agora - abertaEm) : 1;
    const lista = $('tempoSalaLista');
    const pessoas = presentes();
    // Redesenhar a lista inteira a cada segundo trocaria o nó sob o cursor e o leitor de tela
    // releria tudo. As linhas são reaproveitadas; só o texto e a barra mudam.
    const assinatura = pessoas.map(p => p.id).join('|');
    if (lista.dataset.assinatura !== assinatura) {
      lista.dataset.assinatura = assinatura;
      lista.replaceChildren(...pessoas.map(pessoa => {
        const linha = document.createElement('div');
        linha.className = 'tempo-linha';
        linha.dataset.id = pessoa.id;
        linha.setAttribute('role', 'listitem');
        const avatar = document.createElement('span');
        avatar.className = 'tempo-avatar';
        pintarAvatar(avatar, pessoa.nome || '?', perfilDe(pessoa.id));
        avatar.setAttribute('aria-hidden', 'true');
        const nome = document.createElement('span');
        nome.className = 'tempo-nome';
        nome.textContent = pessoa.voce ? `${pessoa.nome} (você)` : pessoa.nome;
        const barra = document.createElement('span');
        barra.className = 'tempo-barra';
        barra.setAttribute('aria-hidden', 'true');
        barra.append(document.createElement('i'));
        const valor = document.createElement('span');
        valor.className = 'tempo-valor';
        linha.append(avatar, nome, valor, barra);
        return linha;
      }));
    }
    for (const pessoa of pessoas) {
      const linha = lista.querySelector(`[data-id="${CSS.escape(pessoa.id)}"]`);
      if (!linha) continue;
      const duracao = pessoa.desde === null ? null : agora - pessoa.desde;
      linha.querySelector('.tempo-valor').textContent = duracao === null ? '—' : curta(duracao);
      // A barra é a fração da vida da sala: quem está desde o começo a enche. Diz de relance
      // quem chegou agora e quem abriu a conversa, sem ler número nenhum.
      linha.querySelector('.tempo-barra i').style.width = duracao === null ? '0%' : `${Math.min(100, (duracao / total) * 100)}%`;
      linha.title = duracao === null ? '' : `Na sala há ${extenso(duracao)}, desde as ${hora(pessoa.desde)}`;
      linha.setAttribute('aria-label', duracao === null ? pessoa.nome : `${pessoa.nome}: na sala há ${extenso(duracao)}`);
    }
  }

  function pintar() {
    const agora = Date.now();
    // Ao lado de "NO SQUAD": o relógio da sala sempre à vista, inclusive onde a barra de cima
    // já não tem espaço para ele (e no celular, dentro da gaveta).
    const lateral = $('tempoLateralTexto');
    if (lateral) {
      lateral.textContent = abertaEm ? relogio(agora - abertaEm) : '';
      if (abertaEm) $('tempoLateralBtn').title = `Sala aberta há ${extenso(agora - abertaEm)}. Ver o tempo de cada pessoa.`;
    }
    if (botao) {
      botao.hidden = !abertaEm;
      if (abertaEm) {
        texto.textContent = relogio(agora - abertaEm);
        botao.title = `Sala aberta há ${extenso(agora - abertaEm)} (desde as ${hora(abertaEm)}). Clique para ver o tempo de cada pessoa.`;
        botao.setAttribute('aria-label', `Sala aberta há ${extenso(agora - abertaEm)}. Ver o tempo de cada pessoa.`);
      }
    }
    pintarMenu();
  }
  setInterval(pintar, 1000);

  function abrir(origem) {
    ancora = origem || botao;
    menu.classList.remove('hidden');
    ancora?.setAttribute('aria-expanded', 'true');
    pintarMenu();
    ancorarAbaixoDe(menu, ancora);
  }
  function fechar() {
    if (menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    ancora?.setAttribute('aria-expanded', 'false');
    ancora = null;
  }
  function alternar(origem, evento) {
    evento?.stopPropagation();
    if (!menu.classList.contains('hidden') && ancora === origem) fechar(); else { fechar(); abrir(origem); }
  }
  botao?.addEventListener('click', evento => alternar(botao, evento));
  $('tempoLateralBtn')?.addEventListener('click', evento => alternar($('tempoLateralBtn'), evento));
  document.addEventListener('click', evento => { if (!evento.target.closest('#tempoSalaMenu')) fechar(); });
  document.addEventListener('keydown', evento => {
    if (evento.key !== 'Escape' || menu.classList.contains('hidden')) return;
    evento.stopPropagation();
    const volta = ancora;
    fechar();
    volta?.focus();
  }, true);
  window.addEventListener('resize', () => { if (ancora) ancorarAbaixoDe(menu, ancora); });

  window.NexoTempo = { chave, aoEntrar, definir, esquecer, desdeDe, duracaoDe, relogio, curta, extenso, hora, abrir: () => abrir(botao) };
})();
