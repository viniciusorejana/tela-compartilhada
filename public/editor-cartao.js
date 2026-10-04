/* O editor do cartão de perfil: tema, banner, fundo, borda, moldura, efeito, nome, bio, pronomes,
 * bolha de pensamento, conquistas à mostra e o status -- com a prévia ao vivo ao lado.
 *
 * Um editor só, em dois lugares: a seção "Personalizar perfil" do início (inicio.js) e um painel
 * dentro da sala (social-sala.js), para ninguém precisar sair da chamada nem abrir outra aba --
 * no aplicativo, a outra aba era o navegador. Quem o usa dá a raiz e recebe as ações; o resto
 * (o que se pode escolher, o que vale) é de public/vitrine.js e do servidor.
 *
 *   const editor = NexoEditorCartao.criar(raiz, { aviso, aoMudar });
 *   editor.abrir();               // carrega a vitrine (se preciso) e desenha
 *   editor.parte('status', true); // Visual, Sobre você ou Status
 *
 * O desenho é de editor-cartao.css. Texto de quem usa entra sempre por `textContent` ou `value`.
 */
(() => {
  const V = window.NexoVitrine;
  const C = window.NexoCartao;
  const S = () => window.NexoSocial;

  function elemento(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }
  const DESENHOS = {
    imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    tocar: '<path d="M8 5v14l11-7Z"/>'
  };
  const icone = nome => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${DESENHOS[nome] || ''}</svg>`;
  const copia = valor => JSON.parse(JSON.stringify(valor));
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // A bolha guarda quando foi escrita; para saber se mudou, só o texto importa.
  const semImagens = v => { const { imagens, ...resto } = v || {}; return { ...resto, pensamento: resto.pensamento?.texto || '' }; };
  const DESCRICAO_DOS_STATUS = { online: 'Aparece conectado', ausente: 'Conectado, mas longe', ocupado: 'Sem som nem aviso de mensagem', invisivel: 'Aparece desconectado' };
  const BYTES_DA_IMAGEM = 8 * 1024 * 1024;

  // O molde é fixo (nada de quem usa entra aqui). Os ids levam o prefixo de quem cria, para os
  // rótulos (`for`) e as abas (`aria-controls`) apontarem para o lugar certo.
  const molde = p => `
    <div class="ed-colunas">
      <header class="ed-cabeca">
        <h2 id="${p}-titulo">Personalizar perfil</h2>
        <p class="ed-explica">O cartão que aparece quando alguém clica em você, numa sala ou na lista de amigos. As peças com <span class="ed-selo-premium">Premium</span> ou com uma conquista ficam guardadas mesmo antes de valer, e aparecem para os outros quando você tiver o que elas pedem.</p>
        <div class="ed-abas" role="tablist" aria-label="Partes do perfil">
          <button type="button" role="tab" id="${p}-aba-visual" data-parte="visual" aria-controls="${p}-parte-visual" aria-selected="true" data-foco-inicial>Visual</button>
          <button type="button" role="tab" id="${p}-aba-sobre" data-parte="sobre" aria-controls="${p}-parte-sobre" aria-selected="false" tabindex="-1">Sobre você</button>
          <button type="button" role="tab" id="${p}-aba-status" data-parte="status" aria-controls="${p}-parte-status" aria-selected="false" tabindex="-1">Status</button>
        </div>
      </header>
      <aside class="ed-previa" aria-label="Prévia do cartão">
        <div class="ed-previa-dentro">
          <span class="ed-rotulo-previa">Como os outros veem</span>
          <div class="ed-previa-cartao" data-ed="previa"></div>
          <button class="nx-botao secundario pequeno" type="button" data-ed="verEfeito">${icone('tocar')}<span>Ver o efeito</span></button>
        </div>
      </aside>
      <form class="ed-form" data-ed="form" id="${p}-form" novalidate>
        <div class="ed-parte" data-parte="visual" id="${p}-parte-visual" role="tabpanel" aria-labelledby="${p}-aba-visual">
          <fieldset class="ed-grupo"><legend>Tema do cartão</legend><div class="ed-temas" data-ed="tema" role="radiogroup" aria-label="Tema do cartão"></div>
            <div class="ed-cores-exatas"><label class="ed-cor"><input type="color" data-ed="corA" value="#8879f6"><span>Cor 1</span></label><label class="ed-cor"><input type="color" data-ed="corB" value="#2b2456"><span>Cor 2</span></label><span class="ed-selo-premium" data-ed="seloCores">Premium</span><button type="button" class="nx-botao fantasma pequeno" data-ed="coresDoTema">Usar as do tema</button></div>
          </fieldset>
          <fieldset class="ed-grupo"><legend>Banner</legend><div class="ed-opcoes" data-ed="banner" role="radiogroup" aria-label="Banner"></div><div class="ed-imagem" data-ed="imagemBanner"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Fundo do cartão</legend><div class="ed-opcoes" data-ed="fundo" role="radiogroup" aria-label="Fundo do cartão"></div><div class="ed-imagem" data-ed="imagemFundo"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Borda do avatar</legend><div class="ed-opcoes ed-opcoes-redondas" data-ed="borda" role="radiogroup" aria-label="Borda do avatar"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Moldura do cartão</legend><div class="ed-opcoes" data-ed="moldura" role="radiogroup" aria-label="Moldura do cartão"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Efeito ao abrir o cartão</legend><div class="ed-opcoes ed-opcoes-texto" data-ed="efeito" role="radiogroup" aria-label="Efeito ao abrir o cartão"></div><small class="ed-dica">Toca por cima do cartão por dois segundos, quando alguém o abre. Com “Menos animação” ligado, não toca.</small></fieldset>
          <fieldset class="ed-grupo"><legend>Estilo do nome</legend><div class="ed-opcoes ed-opcoes-texto" data-ed="nome" role="radiogroup" aria-label="Estilo do nome"></div></fieldset>
        </div>
        <div class="ed-parte" data-parte="sobre" id="${p}-parte-sobre" role="tabpanel" aria-labelledby="${p}-aba-sobre" hidden>
          <label class="ed-rotulo-campo" for="${p}-bio">Sobre mim</label>
          <textarea id="${p}-bio" data-ed="bio" rows="4" maxlength="190" placeholder="Ex.: Jogo de tudo um pouco, mas é no Valorant que eu me acho."></textarea>
          <small class="ed-dica"><span data-ed="contagemBio">0</span>/190 · até quatro linhas</small>
          <label class="ed-rotulo-campo" for="${p}-pronomes">Pronomes</label>
          <input id="${p}-pronomes" data-ed="pronomes" type="text" maxlength="40" placeholder="Ex.: ela/dela">
          <label class="ed-rotulo-campo" for="${p}-pensamento">Bolha de pensamento</label>
          <input id="${p}-pensamento" data-ed="pensamento" type="text" maxlength="70" placeholder="Ex.: quem topa uma partida às 21h?">
          <small class="ed-dica">Flutua ao lado do seu avatar no cartão e some sozinha em 24 horas.</small>
          <fieldset class="ed-grupo ed-grupo-selos"><legend>Conquistas à mostra</legend><div class="ed-selos-escolha" data-ed="selos"></div><small class="ed-dica">Até cinco das que você já tem. Sem escolher, aparecem as mais difíceis.</small></fieldset>
        </div>
        <div class="ed-parte" data-parte="status" id="${p}-parte-status" role="tabpanel" aria-labelledby="${p}-aba-status" hidden>
          <fieldset class="ed-grupo"><legend>Como você aparece</legend><div class="ed-status" data-ed="status" role="radiogroup" aria-label="Status"></div>
            <small class="ed-dica">É o ponto ao lado do seu nome: os amigos o veem na lista deles, e quem está na mesma sala que você, na lista da sala. “Invisível” esconde você só dos amigos — numa sala, quem está nela continua te vendo. “Não incomodar” também cala o som do chat.</small></fieldset>
          <fieldset class="ed-grupo"><legend>Frase do status</legend>
            <div class="ed-frase"><input data-ed="fraseEmoji" type="text" maxlength="16" placeholder="🎮" aria-label="Emoji da frase"><input data-ed="fraseTexto" type="text" maxlength="80" placeholder="Ex.: jogando com a turma" aria-label="Frase do status"></div>
            <label class="ed-rotulo-campo" for="${p}-prazo">Some depois de</label>
            <select id="${p}-prazo" data-ed="frasePrazo"></select>
            <div class="ed-frase-acoes"><button class="nx-botao pequeno" type="button" data-ed="salvarFrase">Salvar a frase</button><button class="nx-botao fantasma pequeno" type="button" data-ed="limparFrase">Tirar a frase</button></div>
          </fieldset>
          <fieldset class="ed-grupo ed-chaves"><legend>Privacidade</legend>
            <label class="ed-chave" for="${p}-mostrar-sala"><span><strong>Mostrar aos amigos em que sala estou</strong><small>Desligado, eles veem que você está conectado, e não onde.</small></span><input id="${p}-mostrar-sala" data-ed="mostrarSala" type="checkbox" role="switch"></label>
            <label class="ed-chave" for="${p}-pedidos"><span><strong>Receber pedidos de amizade</strong><small>Desligado, ninguém novo consegue pedir. Quem já é amigo continua.</small></span><input id="${p}-pedidos" data-ed="receberPedidos" type="checkbox" role="switch"></label>
          </fieldset>
          <p class="ed-retorno" data-ed="statusRetorno" role="status"></p>
        </div>
      </form>
    </div>
    <!-- Fora da área que rola, e não grudado nela: um rodapé grudado não sobe acima do começo do
         formulário, e no celular, com a prévia em cima, o "Salvar" nascia cortado embaixo. -->
    <div class="ed-rodape" data-ed="rodape">
      <p class="ed-retorno" data-ed="retorno" role="status"></p>
      <button class="nx-botao secundario" type="button" data-ed="descartar" disabled>Descartar</button>
      <button class="nx-botao" type="submit" form="${p}-form" data-ed="salvar" disabled>Salvar o cartão</button>
    </div>`;

  function criar(raiz, { prefixo = 'editor', aviso = () => {}, aoMudar = () => {} } = {}) {
    raiz.classList.add('ed', 'nx-social');
    raiz.innerHTML = molde(prefixo);
    const q = nome => raiz.querySelector(`[data-ed="${nome}"]`);

    let conta = null;
    let perfil = null;            // o perfil da conta, com o `social` (status, frase, privacidade)
    let dados = null;             // GET /api/conta/vitrine: guardada, efetiva, conquistas, premium
    let rascunho = null;          // o que está na tela
    let guardada = null;          // o que está salvo
    let pararEfeito = () => {};

    const escolhido = () => S()?.estado.minha?.escolhido || 'online';
    const conquistasGanhas = () => new Set((dados?.lista || []).filter(c => c.ganhou).map(c => c.id));
    const nomeDaConquista = id => V.CONQUISTAS.find(c => c.id === id)?.nome || id;
    const csrf = () => window.NexoConta?.atual()?.csrf || '';
    function requisito(requer) {
      if (!requer) return null;
      if (requer === 'premium') return dados?.premium ? null : 'Premium';
      return conquistasGanhas().has(requer) ? null : `Conquista: ${nomeDaConquista(requer)}`;
    }
    const mudou = () => Boolean(rascunho && guardada) && !igual(semImagens(rascunho), semImagens(guardada));
    function dizer(alvo, texto, tom = '') {
      const el = q(alvo);
      el.dataset.tom = tom;
      el.textContent = texto;
    }
    // O perfil da página acompanha o que o editor salvou: a próxima abertura parte do novo.
    function guardarSocial(social) {
      perfil = { ...(perfil || {}), social };
      const atual = window.NexoConta?.atual()?.perfil;
      if (atual) window.NexoConta.atualizar({ perfil: { ...atual, social } });
    }

    // O cartão como os outros o veem, guardado na página (conta-cliente.js): a conversa direta e o
    // "eu" do início se mostram com ele, e passam a mostrar o novo assim que o editor salva.
    function guardarCartao(d) {
      if (!d?.vitrine || !window.NexoConta?.atual()?.conta) return;
      window.NexoConta.atualizar({ cartao: { vitrine: d.vitrine, frase: d.frase || null, conquistas: d.conquistas || [], desde: d.desde || null } });
    }

    async function carregar() {
      const r = await fetch('/api/conta/vitrine', { credentials: 'same-origin' }).then(resposta => resposta.json()).catch(() => null);
      if (!r?.guardada) return null;
      dados = r;
      guardarCartao(r);
      aoMudar({ dados });
      return r;
    }

    async function abrir() {
      const atual = window.NexoConta?.atual() || {};
      conta = atual.conta;
      if (!conta) return;
      perfil = { ...(atual.perfil || {}), ...(perfil?.social ? { social: perfil.social } : {}) };
      if (!dados) await carregar();
      if (!dados) { dizer('retorno', 'Não foi possível abrir o seu cartão. Tente de novo em instantes.', 'erro'); return; }
      if (!rascunho || !mudou()) {
        guardada = copia(dados.guardada);
        rascunho = copia(guardada);
      }
      montar();
      pintarPrevia(true);
    }

    // ---------- As escolhas do catálogo ----------
    // Cada uma é um rádio de verdade (setas no teclado), com a amostra desenhada.
    function grupoDeOpcoes(lugar, grupo, lista, desenhar) {
      const el = q(lugar);
      el.replaceChildren(...lista.map(item => {
        const b = elemento('button', 'ed-opcao');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.valor = item.id;
        const falta = requisito(item.requer);
        b.title = falta ? `${item.nome} · ${falta}. Fica guardado e aparece para os outros quando você tiver.` : item.nome;
        if (desenhar) {
          const amostra = elemento('span', 'ed-opcao-amostra');
          desenhar(amostra, item);
          b.append(amostra);
        }
        const nome = elemento('span', 'ed-opcao-nome');
        nome.append(elemento('span', '', item.nome));
        b.append(nome);
        if (falta) {
          const marca = elemento('span', 'ed-opcao-requer');
          marca.innerHTML = C.svg(item.requer === 'premium' ? 'estrela' : 'cadeado');
          marca.setAttribute('aria-label', falta);
          b.append(marca);
        }
        b.onclick = () => { rascunho[grupo] = item.id; marcar(); pintarPrevia(grupo === 'efeito'); };
        return b;
      }));
      el.onkeydown = evento => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(evento.key)) return;
        const botoes = [...el.querySelectorAll('[role="radio"]')];
        const i = botoes.indexOf(document.activeElement);
        const proximo = botoes[(i + (['ArrowRight', 'ArrowDown'].includes(evento.key) ? 1 : botoes.length - 1)) % botoes.length];
        evento.preventDefault();
        proximo.focus();
        proximo.click();
      };
    }
    function marcar() {
      for (const grupo of ['banner', 'fundo', 'borda', 'moldura', 'efeito', 'nome']) {
        q(grupo).querySelectorAll('[role="radio"]').forEach(b => { const sim = b.dataset.valor === rascunho[grupo]; b.setAttribute('aria-checked', String(sim)); b.tabIndex = sim ? 0 : -1; });
      }
      q('tema').querySelectorAll('[role="radio"]').forEach(b => { const sim = !rascunho.cores && b.dataset.valor === rascunho.tema; b.setAttribute('aria-checked', String(sim)); b.tabIndex = sim || (rascunho.cores && b.dataset.valor === rascunho.tema) ? 0 : -1; });
      const cores = V.coresDe(rascunho);
      q('corA').value = cores[0];
      q('corB').value = cores[1];
      q('coresDoTema').hidden = !rascunho.cores;
    }

    function montar() {
      const cores = V.coresDe(rascunho);
      const comCores = (el, a = cores[0], b = cores[1]) => { el.style.setProperty('--v1', a); el.style.setProperty('--v2', b); };
      // O tema: bolinhas com as duas cores de cada um.
      q('tema').replaceChildren(...V.TEMAS.map(tema => {
        const b = elemento('button', 'ed-tema');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.valor = tema.id;
        b.title = tema.nome;
        b.setAttribute('aria-label', tema.nome);
        b.style.setProperty('--a', tema.cores[0]);
        b.style.setProperty('--b', tema.cores[1]);
        b.onclick = () => { rascunho.tema = tema.id; rascunho.cores = null; montar(); pintarPrevia(false); };
        return b;
      }));
      q('tema').onkeydown = evento => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(evento.key)) return;
        const botoes = [...q('tema').querySelectorAll('[role="radio"]')];
        const i = botoes.indexOf(document.activeElement);
        evento.preventDefault();
        const proximo = botoes[(i + (['ArrowRight', 'ArrowDown'].includes(evento.key) ? 1 : botoes.length - 1)) % botoes.length];
        proximo.click();
        q('tema').querySelector(`[data-valor="${proximo.dataset.valor}"]`)?.focus();
      };
      q('seloCores').hidden = Boolean(dados.premium);
      grupoDeOpcoes('banner', 'banner', V.BANNERS, (amostra, item) => {
        comCores(amostra);
        if (item.id === 'imagem') { amostraDeImagem(amostra, guardada.imagens?.banner); return; }
        if (item.id !== 'tema') { const anim = elemento('div', 'nx-anim'); anim.dataset.anim = item.id; amostra.append(anim); }
      });
      grupoDeOpcoes('fundo', 'fundo', V.FUNDOS, (amostra, item) => {
        comCores(amostra);
        if (item.id === 'liso') { amostra.style.background = '#17171f'; return; }
        if (item.id === 'imagem') { amostraDeImagem(amostra, guardada.imagens?.fundo); return; }
        if (item.id === 'tema') { amostra.style.background = `linear-gradient(180deg,color-mix(in srgb,${cores[0]} 22%,#14141c),color-mix(in srgb,${cores[1]} 40%,#101016))`; return; }
        const anim = elemento('div', 'nx-anim'); anim.dataset.anim = item.id; anim.style.opacity = '.7'; amostra.append(anim);
      });
      grupoDeOpcoes('borda', 'borda', V.BORDAS, (amostra, item) => {
        amostra.append(C.avatar({ nome: conta.apelido, perfil: { conta: true, ...perfil }, vitrine: { ...rascunho, borda: item.id }, tamanho: 'pequeno' }));
      });
      grupoDeOpcoes('moldura', 'moldura', V.MOLDURAS, (amostra, item) => {
        comCores(amostra);
        const mini = elemento('span', 'nx-cartao ed-opcao-moldura');
        mini.dataset.moldura = item.id;
        comCores(mini);
        amostra.style.background = '#0f0f16';
        amostra.append(mini);
      });
      grupoDeOpcoes('efeito', 'efeito', V.EFEITOS, null);
      grupoDeOpcoes('nome', 'nome', V.NOMES, null);
      q('nome').querySelectorAll('.ed-opcao-nome > span').forEach((span, i) => {
        span.classList.add('nx-nome-estilo');
        span.dataset.estilo = V.NOMES[i].id === 'padrao' ? '' : V.NOMES[i].id;
        comCores(span);
      });
      // As imagens do banner e do fundo: enviar, trocar, tirar.
      montarImagem(q('imagemBanner'), 'banner');
      montarImagem(q('imagemFundo'), 'fundo');
      // Sobre você.
      q('bio').value = rascunho.bio || '';
      q('contagemBio').textContent = String([...(rascunho.bio || '')].length);
      q('pronomes').value = rascunho.pronomes || '';
      q('pensamento').value = rascunho.pensamento?.texto || '';
      const ganhas = (dados.lista || []).filter(c => c.ganhou);
      q('selos').replaceChildren(...ganhas.map(c => {
        const rotulo = elemento('label', 'ed-selo-opcao');
        const caixa = elemento('input');
        caixa.type = 'checkbox';
        caixa.value = c.id;
        caixa.checked = rascunho.selos.includes(c.id);
        caixa.onchange = () => {
          const marcados = [...q('selos').querySelectorAll('input:checked')].map(i => i.value);
          if (marcados.length > V.SELOS_MAXIMOS) { caixa.checked = false; return; }
          rascunho.selos = marcados;
          pintarPrevia(false);
        };
        rotulo.append(caixa, C.selos([c.id], rascunho).firstChild, document.createTextNode(nomeDaConquista(c.id)));
        return rotulo;
      }));
      if (!ganhas.length) q('selos').replaceChildren(elemento('span', 'ed-dica', 'Suas conquistas aparecem aqui quando você ganhar a primeira.'));
      marcar();
      pintarStatus();
    }
    function amostraDeImagem(amostra, id) {
      if (id) { amostra.style.backgroundImage = `url("/api/imagem/${id}")`; amostra.style.backgroundSize = 'cover'; amostra.style.backgroundPosition = 'center'; }
      else amostra.innerHTML = icone('imagem');
      amostra.style.display = 'grid';
      amostra.style.placeItems = 'center';
      amostra.style.color = '#fff';
    }

    // ---------- Imagens ----------
    async function prepararImagem(arquivo, ladoMaximo) {
      if (!NexoImagem.TIPOS_ACEITOS.includes(arquivo.type)) throw new Error('Escolha uma imagem PNG, JPEG, GIF ou WebP.');
      if (arquivo.type === 'image/gif') {
        if (arquivo.size <= BYTES_DA_IMAGEM) return arquivo;
        throw new Error('Um GIF pode ter até 8 MB. Este tem mais.');
      }
      // Imagem parada: reduzida até o lado maior caber, em WebP. Um banner de 4000 px seria 4 MB
      // que cada pessoa que abre o cartão baixaria para ver uma faixa de 360.
      const imagem = await createImageBitmap(arquivo).catch(() => { throw new Error('Não foi possível abrir esta imagem.'); });
      const escala = Math.min(1, ladoMaximo / Math.max(imagem.width, imagem.height));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(imagem.width * escala), height: Math.round(imagem.height * escala) });
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
      imagem.close?.();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
      if (!blob || blob.size > BYTES_DA_IMAGEM) throw new Error('A imagem continua grande demais mesmo reduzida.');
      return blob;
    }
    function montarImagem(lugar, campo) {
      const id = guardada.imagens?.[campo];
      const entrada = elemento('input');
      entrada.type = 'file';
      entrada.accept = 'image/png,image/jpeg,image/gif,image/webp';
      entrada.hidden = true;
      entrada.id = `${prefixo}-arquivo-${campo}`;
      const escolher = elemento('label', 'nx-botao secundario pequeno');
      escolher.htmlFor = entrada.id;
      escolher.tabIndex = 0;
      escolher.insertAdjacentHTML('beforeend', icone('imagem'));
      escolher.append(elemento('span', '', id ? 'Trocar a imagem' : 'Enviar uma imagem'));
      escolher.onkeydown = evento => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); entrada.click(); } };
      const pecas = [escolher, entrada];
      if (id) {
        const tirar = elemento('button', 'nx-botao fantasma pequeno', 'Tirar');
        tirar.type = 'button';
        tirar.onclick = async () => {
          const r = await fetch(`/api/conta/vitrine/imagem/${campo}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Nexo-CSRF': csrf() } })
            .then(async resposta => ({ ok: resposta.ok, dados: await resposta.json().catch(() => ({})) })).catch(() => ({ ok: false, dados: {} }));
          depoisDaImagem(r, campo, false);
        };
        pecas.push(tirar);
      }
      const falta = requisito('premium');
      pecas.push(elemento('small', '', `${campo === 'banner' ? 'A faixa de cima' : 'O corpo do cartão'} · PNG, JPEG, WebP ou GIF animado de até 8 MB${falta ? ' · Premium' : ''}`));
      lugar.replaceChildren(...pecas);
      entrada.onchange = async () => {
        const arquivo = entrada.files?.[0];
        entrada.value = '';
        if (!arquivo) return;
        dizer('retorno', 'Preparando a imagem…');
        let blob;
        try { blob = await prepararImagem(arquivo, campo === 'banner' ? 1600 : 1100); }
        catch (erro) { dizer('retorno', erro.message, 'erro'); return; }
        dizer('retorno', 'Enviando…');
        depoisDaImagem(await NexoImagem.enviar(`/api/conta/vitrine/imagem/${campo}`, blob, { csrf: csrf() }), campo, true);
      };
    }
    function depoisDaImagem(r, campo, enviou) {
      if (!r.ok) { dizer('retorno', r.dados.error || 'Não foi possível trocar a imagem.', 'erro'); return; }
      dados = { ...dados, ...r.dados };
      guardarCartao(dados);
      guardada.imagens = r.dados.guardada.imagens;
      if (enviou) rascunho[campo] = 'imagem';
      else if (rascunho[campo] === 'imagem') rascunho[campo] = 'tema';
      dizer('retorno', enviou ? 'Imagem guardada. Salve o cartão para ela valer.' : 'Imagem tirada.');
      montar();
      pintarPrevia(false);
    }

    // ---------- A prévia ----------
    function vitrineDaPrevia() {
      return { ...rascunho, imagens: { banner: rascunho.banner === 'imagem' ? guardada.imagens?.banner : null, fundo: rascunho.fundo === 'imagem' ? guardada.imagens?.fundo : null }, pensamento: rascunho.pensamento?.texto ? { texto: rascunho.pensamento.texto, em: Date.now() } : null };
    }
    function pintarPrevia(tocarEfeito) {
      if (!rascunho || !conta) return;
      pararEfeito();
      const vitrine = vitrineDaPrevia();
      const status = escolhido() === 'invisivel' ? 'offline' : escolhido();
      const montado = C.montar({ nome: conta.apelido, perfil: { conta: true, codigo: conta.codigo, ...perfil }, cartao: { vitrine, frase: perfil?.social?.frase || null, conquistas: [...conquistasGanhas()], desde: conta.criadaEm }, presenca: { status } });
      q('previa').replaceChildren(montado.el);
      // O efeito toca depois de o cartão ter tamanho.
      if (tocarEfeito) requestAnimationFrame(() => { pararEfeito = C.efeito(montado.el, vitrine.efeito, vitrine); });
      const alterado = mudou();
      q('salvar').disabled = !alterado;
      q('descartar').disabled = !alterado;
    }
    q('verEfeito').onclick = () => pintarPrevia(true);

    const lerCores = () => { rascunho.cores = { a: q('corA').value, b: q('corB').value }; marcar(); pintarPrevia(false); };
    q('corA').addEventListener('input', lerCores);
    q('corB').addEventListener('input', lerCores);
    q('coresDoTema').onclick = () => { rascunho.cores = null; montar(); pintarPrevia(false); };
    q('bio').addEventListener('input', () => { rascunho.bio = q('bio').value; q('contagemBio').textContent = String([...rascunho.bio].length); pintarPrevia(false); });
    q('pronomes').addEventListener('input', () => { rascunho.pronomes = q('pronomes').value; pintarPrevia(false); });
    q('pensamento').addEventListener('input', () => { const texto = q('pensamento').value; rascunho.pensamento = texto.trim() ? { texto, em: guardada.pensamento?.em || Date.now() } : null; pintarPrevia(false); });
    q('descartar').onclick = () => { rascunho = copia(guardada); montar(); pintarPrevia(false); dizer('retorno', ''); };
    q('form').addEventListener('submit', async evento => {
      evento.preventDefault();
      if (q('salvar').disabled) return;
      q('salvar').disabled = true;
      dizer('retorno', 'Salvando…');
      const envio = { ...rascunho, pensamento: rascunho.pensamento?.texto || '' };
      delete envio.imagens;
      const r = await fetch('/api/conta/vitrine', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': csrf() }, body: JSON.stringify({ vitrine: envio }) })
        .then(async resposta => ({ ok: resposta.ok, dados: await resposta.json().catch(() => ({})) })).catch(() => ({ ok: false, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } }));
      if (!r.ok) { dizer('retorno', r.dados.error || 'Não foi possível salvar.', 'erro'); q('salvar').disabled = false; return; }
      dados = r.dados;
      guardarCartao(dados);
      guardada = copia(r.dados.guardada);
      rascunho = copia(guardada);
      // O que não valeu (premium ou conquista que falta) é dito, e não escondido.
      const presas = Object.keys(V.CATALOGO).filter(grupo => guardada[grupo] !== r.dados.vitrine[grupo]);
      dizer('retorno', presas.length ? 'Salvo. Algumas escolhas ficam guardadas até você ter o que elas pedem.' : 'Salvo. Quem abrir o seu cartão já vê o novo.');
      montar();
      pintarPrevia(false);
      aoMudar({ dados });
    });

    // ---------- As partes: Visual, Sobre você e Status ----------
    const abas = [...raiz.querySelectorAll('.ed-abas [role="tab"]')];
    function parte(nome, focar = false) {
      abas.forEach(b => {
        const ativa = b.dataset.parte === nome;
        b.setAttribute('aria-selected', String(ativa));
        b.tabIndex = ativa ? 0 : -1;
        b.toggleAttribute('data-foco-inicial', ativa);
        if (ativa && focar) b.focus();
      });
      raiz.querySelectorAll('.ed-parte').forEach(p => { p.hidden = p.dataset.parte !== nome; });
      // O status salva sozinho: o rodapé do cartão não vale para ele.
      q('rodape').hidden = nome === 'status';
    }
    abas.forEach((b, i) => {
      b.onclick = () => parte(b.dataset.parte);
      b.onkeydown = evento => {
        if (!['ArrowLeft', 'ArrowRight'].includes(evento.key)) return;
        evento.preventDefault();
        parte(abas[(i + (evento.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length].dataset.parte, true);
      };
    });

    // ---------- O status ----------
    function pintarStatus() {
      const atual = escolhido();
      q('status').replaceChildren(...V.STATUS.map(s => {
        const b = elemento('button', 'ed-status-opcao');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(s.id === atual));
        // O mesmo ponto do avatar (cartao.css, `.nx-ponto`): a lua da ausência e o traço do "não incomodar".
        const ponto = elemento('span', 'nx-ponto');
        ponto.dataset.status = s.id;
        b.append(ponto, elemento('span', '', s.nome), elemento('small', '', DESCRICAO_DOS_STATUS[s.id]));
        b.onclick = () => definirStatus(s.id);
        return b;
      }));
      const social = perfil?.social || {};
      if (document.activeElement !== q('fraseTexto')) q('fraseTexto').value = social.frase?.texto || '';
      if (document.activeElement !== q('fraseEmoji')) q('fraseEmoji').value = social.frase?.emoji || '';
      q('mostrarSala').checked = social.mostrarSala !== false;
      q('receberPedidos').checked = social.pedidos !== false;
    }
    async function definirStatus(status) {
      const r = await S().definirStatus(status);
      if (!r.ok) { aviso({ tom: 'erro', icone: 'erro', titulo: 'O status não mudou', detalhe: r.dados.error }); return false; }
      guardarSocial(r.dados.social);
      if (conta) { pintarStatus(); pintarPrevia(false); }
      aoMudar({ social: r.dados.social });
      return true;
    }
    q('frasePrazo').replaceChildren(...V.PRAZOS_DA_FRASE.map(p => { const o = elemento('option', '', p.nome); o.value = p.id; return o; }));
    q('frasePrazo').value = 'hoje';
    function prazoEscolhido() {
      const prazo = V.PRAZOS_DA_FRASE.find(p => p.id === q('frasePrazo').value);
      if (!prazo || prazo.ms === 0) return null;
      if (prazo.ms === null) { const fim = new Date(); fim.setHours(23, 59, 59, 0); return fim.getTime(); }
      return Date.now() + prazo.ms;
    }
    async function salvarSocial(pedido, textoDeSucesso) {
      dizer('statusRetorno', 'Salvando…');
      const r = await S().definirSocial(pedido);
      if (!r.ok) { dizer('statusRetorno', r.dados.error || 'Não foi possível salvar.', 'erro'); return; }
      guardarSocial(r.dados.social);
      dizer('statusRetorno', textoDeSucesso);
      pintarStatus();
      pintarPrevia(false);
      aoMudar({ social: r.dados.social });
    }
    q('salvarFrase').onclick = () => {
      const texto = q('fraseTexto').value.trim(), emoji = q('fraseEmoji').value.trim();
      if (!texto && !emoji) { dizer('statusRetorno', 'Escreva a frase ou escolha um emoji.', 'erro'); return; }
      salvarSocial({ frase: { texto, emoji, ate: prazoEscolhido() } }, 'Frase salva. Seus amigos já veem.');
    };
    q('limparFrase').onclick = () => { q('fraseTexto').value = ''; q('fraseEmoji').value = ''; salvarSocial({ frase: null }, 'Frase tirada.'); };
    q('mostrarSala').onchange = () => salvarSocial({ mostrarSala: q('mostrarSala').checked }, q('mostrarSala').checked ? 'Seus amigos veem em que sala você está.' : 'Seus amigos veem só que você está conectado.');
    q('receberPedidos').onchange = () => salvarSocial({ pedidos: q('receberPedidos').checked }, q('receberPedidos').checked ? 'Você volta a receber pedidos de amizade.' : 'Ninguém novo consegue pedir amizade agora.');

    return {
      abrir,
      parte,
      carregar,
      definirStatus,
      dados: () => dados,
      // A presença mudou em outro lugar (outra aba, o menu do status): o editor acompanha.
      pintarStatus: () => { if (!conta) return; pintarStatus(); pintarPrevia(false); },
      focarFrase: () => { parte('status'); setTimeout(() => q('fraseTexto').focus(), 60); },
      // Fechado o painel, o efeito da prévia para: ele desenha num canvas a cada quadro.
      parar: () => { pararEfeito(); pararEfeito = () => {}; }
    };
  }

  window.NexoEditorCartao = { criar };
})();
