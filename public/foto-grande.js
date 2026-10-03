/* A foto de perfil ampliada, o mesmo visor em qualquer página.
 *
 * Antes, só o cartão de perfil da sala abria a foto grande: o visor era dela (sala.html), e o cartão
 * do início, a prévia do editor, a página da conta e o "Meu perfil" mostravam a foto e não deixavam
 * ver maior. Agora há um visor só, criado na primeira vez que alguém o pede, e duas maneiras de
 * chegar a ele:
 *
 *   - `ampliavel(el, dados)` liga um avatar que já existe: ele vira botão (teclado e leitor de tela
 *     incluídos) e abre a foto de quem é. `dados` é `{ foto, nome, codigo, vitrine }`, ou uma função
 *     que devolve isso, ou nada -- sem foto não há o que ampliar, e o avatar volta a ser só um
 *     desenho (a cor e as iniciais são as mesmas em qualquer tamanho). `cartao.js` faz isso sozinho
 *     para o avatar de todo cartão que monta.
 *   - `abrir(dados)` abre direto.
 *
 * O visor tem a moldura e o fundo do cartão da pessoa, o nome no estilo dela -- a mesma foto grande
 * que a sala já tinha. Nasce no fim do `body`, por cima de qualquer painel (camada 97, como o visor
 * das imagens da conversa), e não é um painel da sala: o `inert` e o Esc de room-ui.js são dos
 * painéis que existiam quando ele rodou. Por isso o Esc é ouvido na janela, antes de qualquer outro:
 * fecha a foto e só ela, e o painel de onde ela veio continua aberto.
 */
(function (root) {
  const doc = root.document;
  const FONTES = new WeakMap();
  let visor = null;
  let gatilho = null;

  const elemento = (tag, classe) => {
    const el = doc.createElement(tag);
    if (classe) el.className = classe;
    return el;
  };

  function criarVisor() {
    // `nx-social`: é a classe que dá ao X a base de botão das peças sociais, a salvo das regras
    // globais de `button` da sala (social.css, docs/interface.md seção 8).
    const raiz = elemento('div', 'nx-foto-visor nx-social');
    raiz.id = 'fotoPanel';
    raiz.hidden = true;
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-labelledby', 'fotoNome');
    const caixa = elemento('div', 'nx-foto-caixa');
    const fechar = elemento('button', 'nx-foto-fechar');
    fechar.type = 'button';
    fechar.title = 'Fechar';
    fechar.setAttribute('aria-label', 'Fechar a foto');
    fechar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    const imagem = elemento('img', 'nx-foto-imagem');
    imagem.id = 'fotoGrande';
    imagem.alt = '';
    imagem.decoding = 'async';
    const legenda = elemento('div', 'nx-foto-legenda');
    const nome = elemento('strong');
    nome.id = 'fotoNome';
    const codigo = elemento('small');
    codigo.id = 'fotoCodigo';
    legenda.append(nome, codigo);
    caixa.append(fechar, imagem, legenda);
    raiz.append(caixa);
    fechar.addEventListener('click', fecharVisor);
    // Clicar fora da caixa fecha; clicar na foto, não.
    raiz.addEventListener('click', evento => { if (evento.target === raiz) fecharVisor(); });
    doc.body.append(raiz);
    visor = { raiz, caixa, fechar, imagem, nome, codigo };
    return visor;
  }

  // O Esc na janela, antes de qualquer outro ouvinte: na sala, ele fecharia também o painel de onde
  // a foto veio. O Tab fica no X -- é a única coisa que o visor tem para focar.
  function teclas(evento) {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      fecharVisor();
    } else if (evento.key === 'Tab') {
      evento.preventDefault();
      visor?.fechar.focus();
    }
  }

  function abrir({ foto, nome = '', codigo = '', vitrine = null } = {}) {
    if (!foto) return;
    const v = visor || criarVisor();
    gatilho = doc.activeElement;
    v.imagem.src = foto;
    v.imagem.alt = `Foto de ${nome}`;
    v.nome.textContent = nome;
    v.codigo.textContent = codigo;
    // A foto grande é emoldurada como o cartão da pessoa: a moldura dela em volta, o fundo do cartão
    // atrás, o nome no estilo dela. Com fundo próprio, o visor fica escuro também no tema claro --
    // o texto da legenda vai sobre a arte da pessoa, como no cartão.
    root.NexoCartao?.moldurar(v.caixa, vitrine);
    root.NexoCartao?.vestirFundo(v.caixa, vitrine);
    root.NexoCartao?.estilizarNome(v.nome, vitrine);
    v.caixa.classList.toggle('contexto-escuro', Boolean(vitrine));
    v.raiz.hidden = false;
    root.addEventListener('keydown', teclas, true);
    v.fechar.focus();
  }

  function fecharVisor() {
    if (!visor || visor.raiz.hidden) return;
    visor.raiz.hidden = true;
    root.removeEventListener('keydown', teclas, true);
    // O foco volta ao avatar que abriu, para o teclado continuar de onde estava.
    if (gatilho?.isConnected) gatilho.focus?.({ preventScroll: true });
    gatilho = null;
  }

  function desligar(el) {
    FONTES.delete(el);
    el.classList.remove('nx-ampliavel');
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.removeAttribute('title');
    el.setAttribute('aria-hidden', 'true');
  }

  function ampliavel(el, dados) {
    if (!el) return;
    const atual = typeof dados === 'function' ? dados() : dados;
    if (!atual?.foto) { desligar(el); return; }
    FONTES.set(el, atual);
    el.classList.add('nx-ampliavel');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Ver a foto de ${atual.nome || 'esta pessoa'} maior`);
    el.title = 'Ver a foto maior';
    el.removeAttribute('aria-hidden');
    // Os ouvintes são postos uma vez: o avatar é repintado e religado várias vezes (a prévia do
    // editor a cada tecla), e a fonte nova entra pelo mapa.
    if (el.dataset.nxFoto) return;
    el.dataset.nxFoto = '1';
    el.addEventListener('click', () => { const fonte = FONTES.get(el); if (fonte) abrir(fonte); });
    el.addEventListener('keydown', evento => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      const fonte = FONTES.get(el);
      if (!fonte) return;
      evento.preventDefault();
      abrir(fonte);
    });
  }

  root.NexoFoto = { abrir, fechar: fecharVisor, aberto: () => Boolean(visor && !visor.raiz.hidden), ampliavel };
})(window);
