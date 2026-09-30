/* O Estúdio: um painel da sala, para quem tem conta.
 *
 * Duas metades. À esquerda, os rostos que reagem à voz: a prévia é o mesmo desenho que vai para
 * o OBS (reativo.js), e os ajustes valem na hora -- salvos meio segundo depois de cada mudança,
 * eles chegam às fontes que já estão no OBS sem ninguém recarregar nada (estudio-ao-vivo.js). À
 * direita, as pessoas: quem está na sala agora, com os links de cada fonte, e quem você guardou
 * com imagens -- pelo código da conta, ou pelo nome de quem entra sem conta. As imagens valem só
 * no seu OBS.
 *
 * Era uma página à parte (/estudio). Virou painel para não obrigar a abrir outra aba -- no
 * aplicativo, nem há onde abrir --, e porque é na sala que se sabe quem está nela.
 *
 * Tudo o que vem do servidor entra por `textContent`: nomes são escolhidos por quem os usa.
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('estudioPanel');
  const LARGURA_DA_FONTE = 1920;
  const MS_ENTRE_ATUALIZACOES = 8000;

  // Os desenhos dos ícones, os mesmos das novidades (novidades.js). O cartão de perfil
  // (estudio-sala.js) usa os de fonte daqui também.
  const ICONES = {
    camera: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
    tela: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    voz: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
    somDaTela: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    reativo: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
    olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    olhoFechado: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  const icone = (nome, classe = 'ico') => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] || ''}</svg>`;
  const FONTES = [['camera', 'Câmera'], ['tela', 'Tela'], ['voz', 'Voz'], ['somDaTela', 'Som da tela'], ['reativo', 'Rosto']];
  const ESTADOS = [['parado', 'parado'], ['falando', 'falando']];

  let retrato = null;
  let config = null;
  const perfisAdicionados = new Map();

  const conta = () => window.NexoConta?.atual()?.conta || null;
  const csrf = () => window.NexoConta?.atual()?.csrf || '';

  async function api(caminho, { metodo = 'GET', corpo } = {}) {
    let resposta;
    try {
      resposta = await fetch(caminho, {
        method: metodo, credentials: 'same-origin', body: corpo ? JSON.stringify(corpo) : undefined,
        headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf() }
      });
    } catch (_) {
      return { ok: false, status: 0, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } };
    }
    return { ok: resposta.ok, status: resposta.status, dados: await resposta.json().catch(() => ({})) };
  }

  function dizer(el, texto, tipo = '') {
    el.textContent = texto || '';
    el.classList.toggle('certo', tipo === 'certo');
    el.classList.toggle('problema', tipo === 'problema');
  }

  // ---------- Copiar ----------
  //
  // O botão confirma no lugar dele ("Copiado") e volta ao que era, como o "Convidar amigos". Se a
  // área de transferência recusar, o comando antigo de copiar ainda funciona -- e no aplicativo
  // não existe `prompt()` para mostrar o link numa caixa.
  function copiarTexto(texto) {
    return navigator.clipboard.writeText(texto).then(() => true).catch(() => {
      const campo = Object.assign(document.createElement('textarea'), { value: texto });
      campo.setAttribute('readonly', '');
      campo.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(campo);
      campo.select();
      let copiou = false;
      try { copiou = document.execCommand('copy'); } catch (_) { copiou = false; }
      campo.remove();
      return copiou;
    });
  }

  async function copiar(botao, texto) {
    const copiou = await copiarTexto(texto);
    if (!copiou) return false;
    clearTimeout(botao._voltar);
    if (!botao.dataset.original) botao.dataset.original = botao.innerHTML;
    botao.classList.add('copiado');
    botao.textContent = 'Copiado';
    botao._voltar = setTimeout(() => { botao.innerHTML = botao.dataset.original; delete botao.dataset.original; botao.classList.remove('copiado'); }, 1600);
    return true;
  }

  // O link inteiro, com o endereço público quando há um. Câmera e tela vêm com som, a não ser que
  // o interruptor diga o contrário.
  function endereco(caminho, fonte, comSom = $('estudioComSom').checked) {
    const url = new URL(caminho, retrato?.publicUrl || location.origin);
    if (['camera', 'tela'].includes(fonte) && !comSom) url.searchParams.set('som', '0');
    return url.href;
  }

  // ---------- A prévia ----------
  const previa = NexoReativo.criar($('estudioPrevia'));
  const manuais = new Map();
  new ResizeObserver(([entrada]) => {
    $('estudioPrevia').style.transform = `scale(${entrada.contentRect.width / LARGURA_DA_FONTE})`;
  }).observe($('estudioPalco'));

  // Sem ninguém real para mostrar, três pessoas de exemplo: ajustar tamanho e espaço num palco
  // vazio seria ajustar no escuro.
  const EXEMPLOS = [
    { identidade: 'exemplo-1', chave: 'n:exemplo-1', nome: 'Você', perfil: { cor: 'lilas' } },
    { identidade: 'exemplo-2', chave: 'n:exemplo-2', nome: 'Ana', perfil: { cor: 'menta', marca: 'estrela' } },
    { identidade: 'exemplo-3', chave: 'n:exemplo-3', nome: 'Bia Souza', perfil: { cor: 'coral' } }
  ];

  function redesenharPrevia() {
    const lista = pessoas().filter(p => !config.pessoas[p.chave]?.oculto && p.permite !== false)
      .map(p => ({ identidade: p.chave, chave: p.chave, nome: p.nome, perfil: p.perfil }));
    previa.definir({ config, pessoas: lista.length ? lista : EXEMPLOS });
  }

  // Quem fala na prévia é sorteado; um clique num rosto o faz falar (ou calar) até o próximo.
  let sorteio = null;
  function sortearFalas() {
    for (const id of previa.ids()) if (!manuais.has(id)) previa.definirFalando(id, Math.random() < 0.3);
  }
  $('estudioPrevia').addEventListener('click', evento => {
    const id = evento.target.closest('.rosto')?.dataset.id;
    if (!id) return;
    const fala = !(manuais.get(id) ?? false);
    manuais.set(id, fala);
    previa.definirFalando(id, fala);
  });

  // ---------- O estilo ----------
  const formulario = $('estudioEstilo');
  const FAIXAS = { tamanho: v => `${v} px`, tamanhoDoNome: v => `${v}%`, espaco: v => `${v} px`, apagar: v => `${v}%`, sensibilidade: v => String(v) };
  const CHAVES = ['nomes', 'anel', 'soQuemFala', 'mostrarMudos'];
  const ESCOLHAS = ['efeito', 'formato', 'direcao', 'alinhar'];

  function pintarEstilo() {
    const e = config.estilo;
    for (const nome of ESCOLHAS) formulario.querySelectorAll(`input[name="${nome}"]`).forEach(r => { r.checked = r.value === e[nome]; });
    for (const nome of Object.keys(FAIXAS)) formulario.elements[nome].value = e[nome];
    for (const nome of CHAVES) formulario.elements[nome].checked = Boolean(e[nome]);
    pintarSaidas();
  }

  function pintarSaidas() {
    for (const [nome, formatar] of Object.entries(FAIXAS)) {
      const faixa = formulario.elements[nome];
      faixa.closest('.volume-row').querySelector('output').textContent = formatar(config.estilo[nome]);
      faixa.disabled = nome === 'tamanhoDoNome' && !config.estilo.nomes;
    }
  }

  formulario.addEventListener('input', () => {
    const e = config.estilo;
    for (const nome of ESCOLHAS) e[nome] = formulario.querySelector(`input[name="${nome}"]:checked`)?.value || e[nome];
    for (const nome of Object.keys(FAIXAS)) e[nome] = Number(formulario.elements[nome].value);
    for (const nome of CHAVES) e[nome] = formulario.elements[nome].checked;
    pintarSaidas();
    redesenharPrevia();
    salvarDepois();
  });

  // ---------- Salvar ----------
  let timerDeSalvar = null;
  let versao = 0;

  function salvarDepois() {
    clearTimeout(timerDeSalvar);
    dizer($('estudioSalvo'), 'Salvando…');
    timerDeSalvar = setTimeout(salvar, 500);
  }

  async function salvar() {
    clearTimeout(timerDeSalvar);
    timerDeSalvar = null;
    const esta = ++versao;
    const r = await api('/api/conta/estudio', { metodo: 'PUT', corpo: { config } });
    if (!r.ok) { dizer($('estudioSalvo'), r.dados.error || 'Não foi possível salvar.', 'problema'); return false; }
    // O servidor devolve o que valeu -- pode ter descartado o que não passou. Só vale se ninguém
    // mexeu de novo enquanto o pedido ia e voltava.
    if (esta === versao && !timerDeSalvar) config = r.dados.config;
    dizer($('estudioSalvo'), 'Salvo · o OBS já mostra', 'certo');
    return true;
  }

  // ---------- As pessoas ----------
  function pessoas() {
    const lista = new Map();
    for (const p of retrato?.sala?.pessoas || []) {
      if (!p.chave || lista.has(p.chave)) continue;
      lista.set(p.chave, { ...p, naSala: true });
    }
    for (const [chave, dados] of Object.entries(config?.pessoas || {})) {
      if (lista.has(chave)) continue;
      const perfil = retrato?.perfis?.[chave] || perfisAdicionados.get(chave) || null;
      lista.set(chave, { chave, nome: perfil?.apelido || dados.rotulo || chave.slice(2), perfil, naSala: false });
    }
    return [...lista.values()];
  }

  function entradaDe(pessoa) {
    if (!config.pessoas[pessoa.chave]) config.pessoas[pessoa.chave] = { rotulo: pessoa.nome || '', parado: null, falando: null, oculto: false };
    return config.pessoas[pessoa.chave];
  }

  const elemento = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined) el.textContent = texto;
    return el;
  };
  const botao = (classe, conteudoHtml, rotulo) => {
    const el = elemento('button', classe);
    el.type = 'button';
    el.innerHTML = conteudoHtml;
    if (rotulo) { el.title = rotulo; el.setAttribute('aria-label', rotulo); }
    return el;
  };

  function quemE(pessoa) {
    const quem = elemento('div', 'estudio-quem');
    const avatar = elemento('span', 'estudio-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    NexoPerfil.pintar(avatar, pessoa.nome, pessoa.perfil);
    const textos = elemento('div');
    textos.append(elemento('strong', '', pessoa.nome));
    const meta = elemento('small');
    meta.append(pessoa.chave.startsWith('c:') ? pessoa.perfil?.codigo || `${pessoa.chave.slice(2, 6)}-${pessoa.chave.slice(6)}` : 'sem conta, pelo nome');
    if (pessoa.eu) meta.append(elemento('span', 'estudio-selo', 'você'));
    if (pessoa.naSala) meta.append(elemento('span', 'estudio-selo na-sala', 'na sala'));
    if (pessoa.permite === false) meta.append(elemento('span', 'estudio-selo recusa', 'não deixa'));
    textos.append(meta);
    quem.append(avatar, textos);
    return quem;
  }

  function lugarDaImagem(pessoa, estado, rotulo) {
    const lugar = elemento('span', 'estudio-imagem-lugar');
    const id = config.pessoas[pessoa.chave]?.[estado];
    const escolher = botao('estudio-imagem', icone('mais'), `${id ? 'Trocar' : 'Escolher'} a imagem de ${pessoa.nome} ${rotulo}`);
    if (id && /^[a-f0-9]{32}$/.test(id)) {
      escolher.classList.add('com-imagem');
      escolher.style.backgroundImage = `url("/api/imagem/${id}")`;
    }
    escolher.addEventListener('click', () => escolherArquivo(pessoa, estado));
    lugar.append(escolher);
    if (id) {
      const tirar = botao('estudio-tirar', icone('fechar'), `Tirar a imagem de ${pessoa.nome} ${rotulo}`);
      tirar.addEventListener('click', () => tirarImagem(pessoa, id));
      lugar.append(tirar);
    }
    return lugar;
  }

  function linhaDaPessoa(pessoa) {
    const item = elemento('li', 'estudio-pessoa');
    item.dataset.chave = pessoa.chave;
    const oculta = Boolean(config.pessoas[pessoa.chave]?.oculto);
    item.classList.toggle('oculta', oculta);

    const linha = elemento('div', 'estudio-pessoa-linha');
    linha.append(quemE(pessoa), ...ESTADOS.map(([estado, rotulo]) => lugarDaImagem(pessoa, estado, rotulo)));
    const acoes = elemento('div', 'estudio-pessoa-acoes');
    const esconder = botao('ghost icone-so', icone(oculta ? 'olhoFechado' : 'olho', 'ico ico-p'), oculta ? `Mostrar ${pessoa.nome} nos rostos do OBS` : `Esconder ${pessoa.nome} dos rostos do OBS`);
    esconder.setAttribute('aria-pressed', String(oculta));
    esconder.addEventListener('click', () => { entradaDe(pessoa).oculto = !oculta; pintarTudo(); salvarDepois(); });
    acoes.append(esconder);
    if (config.pessoas[pessoa.chave] && !pessoa.naSala) {
      const esquecer = botao('ghost icone-so', icone('lixo', 'ico ico-p'), `Tirar ${pessoa.nome} da lista, com as imagens escolhidas`);
      esquecer.addEventListener('click', () => esquecerPessoa(pessoa));
      acoes.append(esquecer);
    }
    linha.append(acoes);
    item.append(linha);

    const links = retrato?.links?.pessoas?.[pessoa.chave];
    if (links) {
      const fila = elemento('div', 'estudio-links');
      for (const [fonte, rotulo] of FONTES) {
        const noAr = pessoa.estado && (fonte === 'voz' ? !pessoa.estado.mudo : fonte === 'reativo' ? false : pessoa.estado[fonte]);
        const chip = botao(`estudio-link${noAr ? ' no-ar' : ''}`, `${icone(fonte)}${rotulo}`, `Copiar o link ${fonte === 'reativo' ? 'do rosto que reage' : `da fonte ${rotulo.toLowerCase()}`} de ${pessoa.nome}${noAr ? ' — no ar agora' : ''}`);
        chip.addEventListener('click', () => copiar(chip, endereco(links[fonte], fonte)));
        fila.append(chip);
      }
      item.append(fila);
    }
    return item;
  }

  // Só redesenha quando algo mudou: a lista chega de novo a cada oito segundos, e refazê-la à toa
  // tiraria o foco de quem está no meio de uma escolha.
  let assinaturaDasPessoas = '';
  function pintarPessoas() {
    const lista = pessoas();
    const assinatura = JSON.stringify([lista, config?.pessoas, retrato?.links?.pessoas]);
    if (assinatura === assinaturaDasPessoas) return;
    assinaturaDasPessoas = assinatura;
    $('estudioLista').replaceChildren(...lista.map(linhaDaPessoa));
    $('estudioVazio').hidden = lista.length > 0;
    document.querySelector('.estudio-lista-cabeca').hidden = !lista.length;
    $('estudioContagem').textContent = lista.length ? String(lista.length) : '';
  }

  // ---------- As imagens ----------
  let alvoDoArquivo = null;
  function escolherArquivo(pessoa, estado) {
    alvoDoArquivo = { pessoa, estado };
    $('estudioArquivo').click();
  }
  $('estudioArquivo').addEventListener('change', async evento => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = '';
    const alvo = alvoDoArquivo;
    alvoDoArquivo = null;
    if (!arquivo || !alvo) return;
    const aviso = $('estudioAviso');
    dizer(aviso, 'Preparando a imagem…');
    let blob;
    try { blob = await NexoImagem.prepararDoEstudio(arquivo); }
    catch (erro) { dizer(aviso, erro.message || 'Não foi possível abrir esta imagem.', 'problema'); return; }
    dizer(aviso, 'Enviando…');
    const r = await NexoImagem.enviar('/api/conta/estudio/imagens', blob, { metodo: 'POST', csrf: csrf() });
    if (!r.ok) { dizer(aviso, r.dados.error || 'Não foi possível enviar a imagem.', 'problema'); return; }
    entradaDe(alvo.pessoa)[alvo.estado] = r.dados.imagem.id;
    if (await salvar()) dizer(aviso, `Imagem de ${alvo.pessoa.nome} ${alvo.estado} guardada.`, 'certo');
    pintarTudo();
  });

  async function tirarImagem(pessoa, id) {
    const r = await api(`/api/conta/estudio/imagens/${id}`, { metodo: 'DELETE' });
    if (!r.ok) { dizer($('estudioAviso'), r.dados.error || 'Não foi possível tirar a imagem.', 'problema'); return; }
    config = r.dados.config;
    dizer($('estudioAviso'), '');
    pintarTudo();
  }

  async function esquecerPessoa(pessoa) {
    const entrada = config.pessoas[pessoa.chave];
    if (!entrada) return;
    for (const id of [entrada.parado, entrada.falando]) if (id) await api(`/api/conta/estudio/imagens/${id}`, { metodo: 'DELETE' });
    delete config.pessoas[pessoa.chave];
    await salvar();
    pintarTudo();
  }

  // ---------- Dar imagens a alguém que não está aqui ----------
  $('estudioAdicionar').addEventListener('submit', async evento => {
    evento.preventDefault();
    const campo = $('estudioAdicionarCampo');
    const aviso = $('estudioAviso');
    const texto = campo.value.trim();
    if (!texto) { dizer(aviso, 'Digite um código de conta ou um nome.', 'problema'); campo.focus(); return; }
    // Um código tem oito caracteres do alfabeto do Nexo; um nome que por acaso tenha essa forma
    // ("Anabelle") não acha conta nenhuma e vira nome.
    let r = /^[a-z2-9]{4}-?[a-z2-9]{4}$/i.test(texto) ? await api('/api/conta/estudio/pessoa', { metodo: 'POST', corpo: { codigo: texto } }) : null;
    if (!r || r.status === 404) r = await api('/api/conta/estudio/pessoa', { metodo: 'POST', corpo: { nome: texto } });
    if (!r.ok) { dizer(aviso, r.dados.error || 'Não foi possível adicionar.', 'problema'); return; }
    const { chave, rotulo, perfil } = r.dados.pessoa;
    if (perfil) perfisAdicionados.set(chave, { ...perfil, apelido: rotulo });
    if (!config.pessoas[chave]) config.pessoas[chave] = { rotulo, parado: null, falando: null, oculto: false };
    campo.value = '';
    dizer(aviso, perfil ? `${rotulo} entrou na lista, pela conta.` : `“${rotulo}” entrou na lista: vale para quem entrar sem conta com esse nome.`, 'certo');
    await salvar();
    await recarregar({ soAoVivo: true });
  });

  // ---------- O que está acontecendo agora ----------
  function pintarAgora() {
    const estado = $('estudioEstado');
    const sala = retrato?.sala;
    estado.classList.toggle('na-sala', Boolean(sala));
    $('estudioBloqueio').hidden = !sala?.bloqueada;
    if (!sala) { estado.textContent = 'Fora de uma sala'; return; }
    const outras = sala.pessoas.filter(p => !p.eu).length;
    const noAr = retrato.capturas?.length || 0;
    estado.textContent = `${outras ? `${outras + 1} na sala` : 'Só você na sala'}${noAr ? ` · ${noAr} no OBS` : ''}`;
  }

  function pintarTudo() {
    pintarAgora();
    pintarPessoas();
    redesenharPrevia();
  }

  async function recarregar({ soAoVivo = false } = {}) {
    const r = await api('/api/conta/estudio');
    if (!r.ok) { dizer($('estudioSalvo'), r.dados.error || 'Não foi possível abrir o Estúdio.', 'problema'); return false; }
    retrato = r.dados;
    // A atualização periódica traz só o que é da sala; a configuração na tela é a de quem mexe.
    if (!soAoVivo || !config) { config = retrato.config; pintarEstilo(); }
    pintarTudo();
    return true;
  }

  $('estudioCopiarGrupo').innerHTML = `${icone('link', 'ico ico-p')}${$('estudioCopiarGrupo').dataset.rotulo}`;
  $('estudioCopiarGrupo').addEventListener('click', event => {
    if (retrato?.links?.grupo) copiar(event.currentTarget, endereco(retrato.links.grupo, 'reativo'));
  });

  $('estudioAjudaBtn').addEventListener('click', () => {
    const aberta = $('estudioAjuda').hidden;
    $('estudioAjuda').hidden = !aberta;
    $('estudioAjudaBtn').setAttribute('aria-expanded', String(aberta));
  });

  $('estudioRevogar').addEventListener('click', async () => {
    if (!window.confirm('Desligar todos os links que você já criou? As fontes que estão no OBS param agora, e será preciso colar os links novos.')) return;
    const r = await api('/api/conta/estudio/revogar', { metodo: 'POST' });
    if (!r.ok) { dizer($('estudioSalvo'), r.dados.error || 'Não foi possível desligar os links.', 'problema'); return; }
    assinaturaDasPessoas = '';
    await recarregar({ soAoVivo: true });
    dizer($('estudioSalvo'), 'Links antigos desligados. Copie os novos daqui.', 'certo');
  });

  // ---------- Abrir e fechar ----------
  //
  // Enquanto o painel está aberto, ele acompanha a sala: gente entra, sai, liga a câmera. Fechado,
  // nada roda -- nem a atualização, nem a prévia.
  let atualizacao = null;
  function abrir() {
    if (!conta()) return;
    $('estudioAviso').textContent = '';
    painel.classList.remove('hidden');
    recarregar();
  }
  new MutationObserver(() => {
    const aberto = !painel.classList.contains('hidden');
    clearInterval(atualizacao);
    clearInterval(sorteio);
    atualizacao = sorteio = null;
    if (!aberto) return;
    atualizacao = setInterval(() => { if (!document.hidden) recarregar({ soAoVivo: true }); }, MS_ENTRE_ATUALIZACOES);
    sorteio = setInterval(sortearFalas, 900);
  }).observe(painel, { attributes: true, attributeFilter: ['class'] });

  window.NexoEstudio = { abrir, icone, copiar, copiarTexto };
})();
