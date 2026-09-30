/* O volume de cada pessoa no toque: uma pílula no quadradinho e uma folha com a régua grande.
 *
 * No computador, o controle de volume é uma régua fina ao lado do número, e o mouse acerta nela.
 * No celular, a mesma régua num quadradinho de 120 px tem uns 50 px de trilho e um polegar do
 * tamanho de uma letra: mexer dez por cento pedia sorte. Então, no toque, a régua sai do
 * quadradinho (e do card da grade, e do palco) e o número vira uma pílula; tocar nela abre esta
 * folha, que sobe de baixo, com uma régua da largura da tela, um polegar do tamanho do dedo,
 * volumes prontos e o silenciar.
 *
 * "Toque" é a tela estreita ou o aparelho sem mouse. A classe `volume-toque` no documento é o
 * que o CSS lê, e `toque()` é o que sala.js pergunta ao clicar na pílula: uma pergunta só, e o
 * desenho e o comportamento nunca discordam.
 *
 * Nada de volume mora aqui. A folha lê e escreve pelas funções de sala.js (audioDaVoz,
 * definirAudioDaVoz, audioDaTela, definirAudioDaTela), e é redesenhada por
 * sincronizarControlesDeAudio como qualquer outro controle do mesmo som.
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('volumePanel');
  const regua = $('volumeRegua');
  const TOQUE = window.matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');
  const MAXIMO = 200;
  let alvo = null;   // { id, fonte: 'voz' | 'tela' }

  const aberta = () => !painel.classList.contains('hidden');
  const estadoDe = ({ id, fonte }) => (fonte === 'tela' ? audioDaTela(id) : audioDaVoz(id));
  const mexer = mudanca => { if (alvo) (alvo.fonte === 'tela' ? definirAudioDaTela : definirAudioDaVoz)(alvo.id, mudanca); };

  // Todos os controles se redesenham quando o modo muda: a pílula no toque fica sempre
  // clicável (ela é a porta da folha), e no mouse o número volta a ser o campo de digitar o volume.
  function aplicarModo() {
    document.documentElement.classList.toggle('volume-toque', TOQUE.matches);
    if (typeof peers === 'undefined') return;
    peers.forEach((_par, id) => sincronizarControlesDeAudio(id));
  }
  TOQUE.addEventListener?.('change', aplicarModo);
  aplicarModo();

  function pintar() {
    if (!alvo || !aberta()) return;
    const par = peers.get(alvo.id);
    // A pessoa saiu da sala com a folha aberta: não sobra nada para ajustar.
    if (!par) { painel.classList.add('hidden'); return; }
    pintarAvatar($('volumeAvatar'), par.name, perfilDe(alvo.id));
    $('volumeTitulo').textContent = par.name;
    // Voz e som da tela são dois volumes. A escolha só aparece quando a tela tem som.
    const temTela = telaTemSom(alvo.id);
    if (!temTela && alvo.fonte === 'tela') alvo.fonte = 'voz';
    $('volumeFontes').hidden = !temTela;
    painel.querySelectorAll('input[name="volumeFonte"]').forEach(opcao => { opcao.checked = opcao.value === alvo.fonte; });

    const estado = estadoDe(alvo);
    const porcento = Math.round(estado.nivel * 100);
    if (document.activeElement !== regua) regua.value = String(porcento);
    regua.style.setProperty('--cheio', `${(Number(regua.value) / MAXIMO) * 100}%`);
    regua.disabled = !estado.disponivel;
    regua.setAttribute('aria-label', alvo.fonte === 'tela' ? `Volume do som da tela de ${par.name}` : `Volume da voz de ${par.name}`);
    regua.setAttribute('aria-valuetext', `${porcento}%`);
    $('volumeValor').textContent = `${porcento}%`;
    painel.classList.toggle('reforcado', porcento > 100);
    painel.classList.toggle('mudo', estado.mudo);
    const mudo = $('volumeMudo');
    mudo.disabled = !estado.disponivel;
    mudo.setAttribute('aria-pressed', String(estado.mudo));
    mudo.title = estado.mudo ? 'Voltar a ouvir' : 'Silenciar';
    mudo.setAttribute('aria-label', mudo.title);
    painel.querySelectorAll('#volumeAtalhos button').forEach(botao => {
      botao.disabled = !estado.disponivel;
      botao.setAttribute('aria-pressed', String(Number(botao.dataset.nivel) === porcento && !estado.mudo));
    });
    $('volumeSub').textContent = estado.disponivel
      ? (alvo.fonte === 'tela' ? 'Som da tela' : 'Voz')
      : (alvo.fonte === 'tela' ? 'Esta tela está sem som agora.' : 'Sem microfone ligado agora.');
  }

  function abrir(id, fonte = 'voz') {
    if (typeof peers === 'undefined' || !peers.has(id)) return;
    alvo = { id, fonte: fonte === 'tela' ? 'tela' : 'voz' };
    painel.classList.remove('hidden');
    pintar();
  }

  // 100% gruda, como na régua fina: com o dedo, acertar o meio exato é sorte, e voltar ao normal
  // é o que mais se faz com ela. O número grande também se digita (valor-digitado.js), e o que foi
  // escrito não gruda.
  regua.addEventListener('input', evento => {
    let valor = Number(regua.value);
    if (!evento.detail?.digitado && valor !== 100 && Math.abs(valor - 100) <= 5) { valor = 100; regua.value = '100'; }
    regua.style.setProperty('--cheio', `${(valor / MAXIMO) * 100}%`);
    mexer({ nivel: valor / 100 });
  });
  $('volumeMudo').addEventListener('click', () => mexer({ alternarMudo: true }));
  $('volumeAtalhos').addEventListener('click', evento => {
    const botao = evento.target.closest('button[data-nivel]');
    if (botao) mexer({ nivel: Number(botao.dataset.nivel) / 100 });
  });
  $('volumeFontes').addEventListener('change', evento => {
    if (!alvo || evento.target.name !== 'volumeFonte') return;
    alvo.fonte = evento.target.value;
    pintar();
  });
  // Quem sai, entra ou liga a tela muda o que a folha mostra.
  document.addEventListener('room-update', pintar);

  window.NexoVolume = {
    abrir,
    toque: () => TOQUE.matches,
    sincronizar: id => { if (alvo?.id === id) pintar(); }
  };
})();
