/* O editor do cartão de perfil: tema, banner, fundo, borda, moldura, efeito, nome, bio, pronomes,
 * bolha de pensamento, conquistas à mostra e o status -- com a prévia ao vivo ao lado.
 *
 * Um editor só, em dois lugares: a seção "Personalizar perfil" do início (inicio.js) e um painel
 * dentro da sala (social-sala.js), para ninguém precisar sair da chamada nem abrir outra aba --
 * no aplicativo, a outra aba era o navegador. Quem o usa dá a raiz e recebe as ações; o resto
 * (o que se pode escolher, o que vale) é de public/vitrine.js e do servidor.
 *
 *   const editor = NexoEditorCartao.criar(raiz, { aviso, aoMudar, semTitulo });
 *   editor.abrir();               // carrega a vitrine (se preciso) e desenha
 *   editor.parte('status', true); // Visual, Sobre você ou Status
 *
 * `semTitulo`: sem o "Personalizar perfil" do alto -- para quem já tem um título em cima (o início).
 * `aoMudar` recebe `{ dados }` quando o cartão muda, `{ social }` quando o status muda e `{ perfil }`
 * quando a foto muda. A foto é da conta, e não do cartão: sobe ao ser escolhida, como na página da conta.
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
    tocar: '<path d="M8 5v14l11-7Z"/>',
    // As duas setas de trocar de lugar, e o dado do "sortear" (os pontos cheios).
    trocar: '<path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4"/>',
    dado: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><g fill="currentColor" stroke="none"><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="8.5" cy="15.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/></g>'
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
  //
  // O título só existe onde nada diz o que a pessoa está vendo: o painel da sala, que não tem barra de cima.
  // No início a barra de cima já diz "Personalizar perfil", e repetir o título logo abaixo era ruído
  // (`semTitulo`).
  const molde = (p, { semTitulo = false } = {}) => `
    <div class="ed-colunas">
      <header class="ed-cabeca">
        ${semTitulo ? '' : `<h2 id="${p}-titulo">Personalizar perfil</h2>`}
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
          <fieldset class="ed-grupo ed-foto"><legend>Foto de perfil</legend>
            <div class="ed-foto-linha">
              <span class="ed-foto-avatar" data-ed="fotoAvatar"></span>
              <div class="ed-foto-acoes">
                <label class="nx-botao secundario pequeno" for="${p}-foto-arquivo" tabindex="0">${icone('imagem')}<span data-ed="fotoRotulo">Enviar uma foto</span></label>
                <input id="${p}-foto-arquivo" data-ed="fotoArquivo" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
                <button type="button" class="nx-botao fantasma pequeno" data-ed="fotoTirar" hidden>Tirar a foto</button>
              </div>
            </div>
            <small class="ed-dica">PNG, JPEG, WebP ou GIF animado. O Nexo usa o quadrado do meio da imagem. A foto vale assim que você a escolhe: não precisa salvar o cartão. Sem foto, aparecem a cor e as iniciais do seu perfil.</small>
            <p class="ed-retorno" data-ed="fotoRetorno" role="status"></p>
          </fieldset>
          <fieldset class="ed-grupo"><legend>Tema do cartão</legend><div class="ed-temas" data-ed="tema" role="radiogroup" aria-label="Tema do cartão"></div>
            <div class="ed-cores" data-ed="cores">
              <div class="ed-cores-cabeca"><span>Cores exatas</span><span class="ed-selo-premium" data-ed="seloCores">Premium</span></div>
              <div class="ed-cores-linha">
                <button type="button" class="ed-slot" data-ed="corA" aria-haspopup="true" aria-expanded="false" aria-label="Cor 1: escolher"><span class="ed-slot-gema" aria-hidden="true"></span><span class="ed-slot-textos"><strong>Cor 1</strong><small>#8879F6</small></span></button>
                <button type="button" class="nx-icone cheio ed-trocar" data-ed="trocarCores" title="Trocar as duas cores de lugar" aria-label="Trocar as duas cores de lugar">${icone('trocar')}</button>
                <button type="button" class="ed-slot" data-ed="corB" aria-haspopup="true" aria-expanded="false" aria-label="Cor 2: escolher"><span class="ed-slot-gema" aria-hidden="true"></span><span class="ed-slot-textos"><strong>Cor 2</strong><small>#2B2456</small></span></button>
              </div>
              <div class="ed-cores-barra" data-ed="barraDeCores" aria-hidden="true"></div>
              <div class="ed-cores-acoes"><button type="button" class="nx-botao secundario pequeno" data-ed="sortearCores">${icone('dado')}<span>Sortear</span></button><button type="button" class="nx-botao fantasma pequeno" data-ed="coresDoTema">Usar as do tema</button></div>
            </div>
          </fieldset>
          <fieldset class="ed-grupo"><legend>Banner</legend><div class="ed-opcoes" data-ed="banner" role="radiogroup" aria-label="Banner"></div><div class="ed-imagem" data-ed="imagemBanner"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Fundo do cartão</legend><div class="ed-opcoes" data-ed="fundo" role="radiogroup" aria-label="Fundo do cartão"></div><div class="ed-imagem" data-ed="imagemFundo"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Borda do avatar</legend><div class="ed-opcoes ed-opcoes-redondas" data-ed="borda" role="radiogroup" aria-label="Borda do avatar"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Moldura do cartão</legend><div class="ed-opcoes" data-ed="moldura" role="radiogroup" aria-label="Moldura do cartão"></div></fieldset>
          <fieldset class="ed-grupo"><legend>Efeito ao abrir o cartão</legend><div class="ed-opcoes ed-opcoes-texto" data-ed="efeito" role="radiogroup" aria-label="Efeito ao abrir o cartão"></div><small class="ed-dica">Toca por cima do cartão por dois segundos, quando alguém o abre. Com “Menos animação” ligado, não toca.</small></fieldset>
          <fieldset class="ed-grupo"><legend>Estilo do nome</legend><div class="ed-opcoes ed-opcoes-texto" data-ed="nome" role="radiogroup" aria-label="Estilo do nome"></div></fieldset>
        </div>
        <div class="ed-parte" data-parte="sobre" id="${p}-parte-sobre" role="tabpanel" aria-labelledby="${p}-aba-sobre" hidden>
          <div class="ed-campo-cabeca"><label class="ed-rotulo-campo" for="${p}-bio">Sobre mim</label><span data-ed="bioEmoji"></span></div>
          <textarea id="${p}-bio" data-ed="bio" rows="4" maxlength="190" placeholder="Ex.: Jogo de tudo um pouco, mas é no Valorant que eu me acho."></textarea>
          <small class="ed-dica"><span data-ed="contagemBio">0</span>/190 · até quatro linhas</small>
          <label class="ed-rotulo-campo" for="${p}-pronomes">Pronomes</label>
          <input id="${p}-pronomes" data-ed="pronomes" type="text" maxlength="40" placeholder="Ex.: ela/dela">
          <div class="ed-campo-cabeca"><label class="ed-rotulo-campo" for="${p}-pensamento">Bolha de pensamento</label><span data-ed="pensamentoEmoji"></span></div>
          <input id="${p}-pensamento" data-ed="pensamento" type="text" maxlength="70" placeholder="Ex.: quem topa uma partida às 21h?">
          <small class="ed-dica">Flutua ao lado do seu avatar no cartão e some sozinha em 24 horas.</small>
          <fieldset class="ed-grupo ed-grupo-selos"><legend>Conquistas à mostra</legend><div class="ed-selos-escolha" data-ed="selos"></div><small class="ed-dica">Até cinco das que você já tem. Sem escolher, aparecem as mais difíceis.</small></fieldset>
        </div>
        <div class="ed-parte" data-parte="status" id="${p}-parte-status" role="tabpanel" aria-labelledby="${p}-aba-status" hidden>
          <fieldset class="ed-grupo"><legend>Como você aparece</legend><div class="ed-status" data-ed="status" role="radiogroup" aria-label="Status"></div>
            <small class="ed-dica">É o ponto ao lado do seu nome: os amigos o veem na lista deles, e quem está na mesma sala que você, na lista da sala. “Invisível” esconde você só dos amigos — numa sala, quem está nela continua te vendo. “Não incomodar” também cala o som do chat.</small></fieldset>
          <fieldset class="ed-grupo"><legend>Frase do status</legend>
            <div class="ed-frase">
              <span class="ed-frase-emoji">
                <button type="button" class="ed-emoji-btn" data-ed="fraseEmojiBtn" aria-haspopup="true" aria-expanded="false" aria-label="Escolher o emoji da frase" title="Escolher o emoji da frase"></button>
                <button type="button" class="ed-emoji-tirar" data-ed="fraseEmojiTirar" aria-label="Tirar o emoji da frase" title="Tirar o emoji" hidden><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
              </span>
              <input data-ed="fraseEmoji" type="hidden">
              <input data-ed="fraseTexto" type="text" maxlength="80" placeholder="Ex.: jogando com a turma" aria-label="Frase do status">
            </div>
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

  function criar(raiz, { prefixo = 'editor', aviso = () => {}, aoMudar = () => {}, semTitulo = false } = {}) {
    raiz.classList.add('ed', 'nx-social');
    raiz.innerHTML = molde(prefixo, { semTitulo });
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
    // As amostras que desenham as cores do cartão (banner, fundo, borda, moldura e estilo do nome) ficam
    // registradas aqui: ao mudar as cores exatas, `recolorir` as repinta na hora, sem refazê-las. Uma troca de
    // tema refaz tudo (`montar`), mas arrastar na área do seletor dispara dezenas de mudanças por segundo, e
    // refazer cada amostra a cada quadro pesaria -- e tiraria o foco de quem escolhe pelo teclado. A cor de
    // todas elas é só um par de variáveis (`--v1` e `--v2`, cartao.css).
    const coloridas = new Set();
    const comCores = (el, [a, b] = V.coresDe(rascunho)) => {
      el.style.setProperty('--v1', a);
      el.style.setProperty('--v2', b);
      coloridas.add(el);
    };
    const recolorir = () => {
      const cores = V.coresDe(rascunho);
      coloridas.forEach(el => comCores(el, cores));
    };

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
      pintarCores(V.coresDe(rascunho));
      q('coresDoTema').hidden = !rascunho.cores;
    }
    // As duas "gemas" e o degradê entre elas: o que o cartão está usando agora, do tema ou das cores exatas.
    function pintarCores([a, b]) {
      q('corA').style.setProperty('--gema', a);
      q('corA').querySelector('small').textContent = a.toUpperCase();
      q('corB').style.setProperty('--gema', b);
      q('corB').querySelector('small').textContent = b.toUpperCase();
      q('barraDeCores').style.setProperty('--ca', a);
      q('barraDeCores').style.setProperty('--cb', b);
    }

    function montar() {
      // As amostras antigas saem da página junto com o que as continha: o registro recomeça.
      coloridas.clear();
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
        // Pelas variáveis da própria amostra (e não pelos valores de agora): as cores exatas a repintam sozinhas.
        if (item.id === 'tema') { amostra.style.background = 'linear-gradient(180deg,color-mix(in srgb,var(--v1) 22%,#14141c),color-mix(in srgb,var(--v2) 40%,#101016))'; return; }
        const anim = elemento('div', 'nx-anim'); anim.dataset.anim = item.id; anim.style.opacity = '.7'; amostra.append(anim);
      });
      grupoDeOpcoes('borda', 'borda', V.BORDAS, (amostra, item) => {
        const avatar = C.avatar({ nome: conta.apelido, perfil: { conta: true, ...perfil }, vitrine: { ...rascunho, borda: item.id }, tamanho: 'pequeno' });
        comCores(avatar);
        amostra.append(avatar);
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

    // ---------- A foto de perfil ----------
    // É da conta, e não do cartão: sobe ao ser escolhida -- como na página da conta e no "Meu perfil" da
    // sala --, sem esperar o "Salvar o cartão". Uma escolha que já está na tela e ainda não vale faria a
    // pessoa achar que salvou. O servidor leva a foto nova à sala inteira (`peer-perfil`), e quem criou o
    // editor repinta o que é dele (`aoMudar`: o "eu" do início).
    function pintarFoto() {
      if (!conta || !rascunho) return;
      const vitrine = vitrineDaPrevia();
      const caixa = C.avatar({ nome: conta.apelido, perfil: { conta: true, codigo: conta.codigo, ...perfil }, vitrine });
      caixa.style.setProperty('--av', '64px');
      q('fotoAvatar').replaceChildren(caixa);
      const foto = window.NexoPerfil.enderecoDaImagem(perfil?.avatar);
      // Com foto, o avatar daqui também abre a foto grande, como o da prévia do cartão ao lado.
      window.NexoFoto?.ampliavel(caixa.querySelector('.nx-av-img'), foto ? { foto, nome: conta.apelido, codigo: conta.codigo, vitrine } : null);
      q('fotoRotulo').textContent = foto ? 'Trocar a foto' : 'Enviar uma foto';
      q('fotoTirar').hidden = !foto;
    }
    const dizerDaFoto = (texto, tom = '') => dizer('fotoRetorno', texto, tom);
    function depoisDaFoto(r, textoDeSucesso) {
      if (!r.ok) { dizerDaFoto(r.dados?.error || 'Não foi possível trocar a foto.', 'erro'); return; }
      perfil = { ...r.dados.perfil };
      window.NexoConta?.atualizar({ conta: r.dados.conta, perfil: r.dados.perfil });
      pintarPrevia(false);
      dizerDaFoto(textoDeSucesso);
      aoMudar({ perfil: r.dados.perfil });
    }
    q('fotoArquivo').addEventListener('change', async () => {
      const arquivo = q('fotoArquivo').files?.[0];
      q('fotoArquivo').value = '';
      if (!arquivo) return;
      dizerDaFoto('Preparando a foto…');
      let blob;
      try { blob = await NexoImagem.prepararAvatar(arquivo); }
      catch (erro) { dizerDaFoto(erro.message || 'Não foi possível abrir esta imagem.', 'erro'); return; }
      dizerDaFoto('Enviando…');
      depoisDaFoto(await NexoImagem.enviar('/api/conta/avatar', blob, { csrf: csrf() }), 'Foto trocada. Quem está numa sala com você já vê a nova.');
    });
    // O rótulo faz as vezes de botão: pelo teclado, Enter e espaço abrem a escolha do arquivo também.
    raiz.querySelector(`label[for="${prefixo}-foto-arquivo"]`).addEventListener('keydown', evento => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      evento.preventDefault();
      q('fotoArquivo').click();
    });
    q('fotoTirar').addEventListener('click', async () => {
      dizerDaFoto('Tirando…');
      const r = await fetch('/api/conta/avatar', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Nexo-CSRF': csrf() } })
        .then(async resposta => ({ ok: resposta.ok, dados: await resposta.json().catch(() => ({})) }))
        .catch(() => ({ ok: false, dados: { error: 'Sem conexão com o servidor. Tente de novo.' } }));
      depoisDaFoto(r, 'Sem foto: a sala volta a mostrar a cor e as iniciais do seu perfil.');
    });

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
      // A foto do grupo de cima acompanha a borda escolhida: é o avatar da pessoa, como o do cartão.
      pintarFoto();
      // O efeito toca depois de o cartão ter tamanho.
      if (tocarEfeito) requestAnimationFrame(() => { pararEfeito = C.efeito(montado.el, vitrine.efeito, vitrine); });
      const alterado = mudou();
      q('salvar').disabled = !alterado;
      q('descartar').disabled = !alterado;
    }
    q('verEfeito').onclick = () => pintarPrevia(true);

    // ---------- As cores exatas ----------
    // Cada gema abre o seletor de cor (seletor-cor.js), e o cartão acompanha enquanto a pessoa arrasta. A
    // prévia é refeita no máximo uma vez por quadro: arrastar dispara dezenas de mudanças por segundo.
    // As amostras do catálogo (banner, fundo, borda, moldura, nome) vão junto, no mesmo quadro: o que a pessoa
    // vê nelas é o cartão dela com as cores de agora, e não com as do tema até salvar.
    let previaAgendada = 0;
    const agendarPrevia = () => {
      if (previaAgendada) return;
      previaAgendada = requestAnimationFrame(() => { previaAgendada = 0; recolorir(); pintarPrevia(false); });
    };
    const mudarCores = (a, b) => { rascunho.cores = { a, b }; marcar(); agendarPrevia(); };
    // A paleta de cada gema: as cores dos temas do cartão -- as vivas para a primeira, as fundas para a segunda.
    const paletaDa = indice => V.TEMAS.map(t => t.cores[indice]);
    const tocar = (el, classe) => { el.classList.remove(classe); void el.offsetWidth; el.classList.add(classe); };
    for (const [nome, indice] of [['corA', 0], ['corB', 1]]) {
      q(nome).addEventListener('click', () => {
        NexoCor.abrir(q(nome), {
          valor: V.coresDe(rascunho)[indice], rotulo: `Cor ${indice + 1}`, paleta: paletaDa(indice),
          aoMudar: cor => { const par = [...V.coresDe(rascunho)]; par[indice] = cor; mudarCores(par[0], par[1]); tocar(q(nome), 'pop'); }
        });
      });
    }
    q('trocarCores').addEventListener('click', () => {
      const [a, b] = V.coresDe(rascunho);
      mudarCores(b, a);
      tocar(q('trocarCores'), 'gira');
      tocar(q('corA'), 'pop');
      tocar(q('corB'), 'pop');
    });
    // O dado: as gemas passam por algumas combinações antes de parar numa -- o gesto vira um pequeno sorteio.
    // Com menos movimento (do sistema ou da Aparência), cai direto na que saiu.
    let rolando = null;
    q('sortearCores').addEventListener('click', () => {
      const { a, b } = NexoCor.sortear();
      clearInterval(rolando);
      const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('menos-movimento');
      tocar(q('sortearCores'), 'gira');
      if (reduzido) { mudarCores(a, b); return; }
      let giros = 0;
      rolando = setInterval(() => {
        if (++giros < 6) { const falsa = NexoCor.sortear(); pintarCores([falsa.a, falsa.b]); return; }
        clearInterval(rolando);
        mudarCores(a, b);
        tocar(q('corA'), 'pop');
        tocar(q('corB'), 'pop');
      }, 65);
    });
    q('coresDoTema').onclick = () => { rascunho.cores = null; montar(); pintarPrevia(false); };
    // Um emoji onde o cursor está, na descrição e na bolha: o seletor insere e dispara o `input`, que refaz a prévia.
    if (window.NexoEmojis) {
      q('bioEmoji').append(NexoEmojis.botaoDeCampo(q('bio'), { classe: 'nx-icone pequeno ed-emoji-campo', rotulo: 'Inserir um emoji na descrição' }));
      q('pensamentoEmoji').append(NexoEmojis.botaoDeCampo(q('pensamento'), { classe: 'nx-icone pequeno ed-emoji-campo', rotulo: 'Inserir um emoji na bolha de pensamento' }));
    }
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
      // O emoji escolhido e ainda não salvo não é apagado por um repintar (o status mudou em outra aba, por
      // exemplo): ele só volta ao que está guardado depois de "Salvar a frase" ou "Tirar a frase".
      if (!q('fraseEmoji').dataset.sujo) q('fraseEmoji').value = social.frase?.emoji || '';
      pintarEmojiDaFrase();
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
    // O emoji da frase vem do seletor de emojis (emojis.js): o botão mostra o escolhido -- ou a carinha, quando
    // não há -- e o valor fica num campo escondido, que é o que "Salvar a frase" lê.
    function pintarEmojiDaFrase() {
      const emoji = q('fraseEmoji').value;
      const botao = q('fraseEmojiBtn');
      if (emoji) botao.textContent = emoji; else botao.innerHTML = window.NexoEmojis?.ICONE || '';
      botao.classList.toggle('com-emoji', Boolean(emoji));
      botao.title = emoji ? 'Trocar o emoji da frase' : 'Escolher o emoji da frase';
      q('fraseEmojiTirar').hidden = !emoji;
    }
    q('fraseEmojiBtn').addEventListener('click', () => {
      window.NexoEmojis?.abrir(q('fraseEmojiBtn'), {
        rotulo: 'Escolher o emoji da frase',
        aoEscolher: emoji => { q('fraseEmoji').value = emoji; q('fraseEmoji').dataset.sujo = '1'; pintarEmojiDaFrase(); q('fraseTexto').focus(); }
      });
    });
    q('fraseEmojiTirar').addEventListener('click', () => { q('fraseEmoji').value = ''; q('fraseEmoji').dataset.sujo = '1'; pintarEmojiDaFrase(); q('fraseEmojiBtn').focus(); });
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
      if (Object.prototype.hasOwnProperty.call(pedido, 'frase')) delete q('fraseEmoji').dataset.sujo;
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
      // Fechado o painel, o efeito da prévia para: ele desenha num canvas a cada quadro. O seletor de cor
      // aberto fecha junto: ele mora fora do painel, e ficaria boiando sozinho.
      parar: () => { pararEfeito(); pararEfeito = () => {}; window.NexoPopover?.fechar(); clearInterval(rolando); }
    };
  }

  window.NexoEditorCartao = { criar };
})();
