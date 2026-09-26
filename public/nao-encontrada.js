/* A página de "não encontrada": diz o que aconteceu e oferece o caminho de volta.
 *
 * A carinha não é só enfeite. Ela olha para onde a pessoa está mexendo, sorri quando a mão
 * chega num caminho de volta e balança a cabeça quando um código não serve -- é o que faz um
 * erro parecer parte do produto, e não o fim dele.
 */
(() => {
  const $ = id => document.getElementById(id);
  const rosto = $('rosto');
  const svg = rosto.querySelector('svg');
  const pupilas = [...rosto.querySelectorAll('.pupila')];
  const CENTROS = [{ x: 82, y: 112 }, { x: 138, y: 112 }];
  const LARGURA_DO_DESENHO = 220;
  const ALCANCE = 6.5;
  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CODIGO = /^[a-z0-9_-]{4,32}$/;
  // Páginas que existem e cujo nome também caberia num código de sala. Sugerir "a sala #conta"
  // para quem errou um endereço da conta seria mandar a pessoa para um lugar ainda mais errado.
  const RESERVADOS = new Set(['sala', 'conta', 'painel', 'api', 'downloads', 'vendor', 'socket.io', 'rtc', 'agente']);

  // ---------- O endereço que não existe ----------
  let caminho = location.pathname;
  try { caminho = decodeURIComponent(caminho); } catch (_) { /* fica como veio */ }
  $('caminho').textContent = caminho.length > 64 ? `${caminho.slice(0, 61)}…` : caminho;
  document.title = 'Página não encontrada · Nexo';

  const partes = location.pathname.split('/').filter(Boolean);
  const primeira = (partes[0] || '').toLowerCase();
  if (partes.length >= 1 && partes.length <= 2 && CODIGO.test(primeira) && !RESERVADOS.has(primeira)) {
    const sugestao = $('sugestao');
    sugestao.href = `/${encodeURIComponent(primeira)}/sala`;
    $('sugestaoNome').textContent = `#${primeira}`;
    sugestao.hidden = false;
  }

  // "Voltar" só existe quando há de onde voltar: numa aba aberta direto no link quebrado, ele
  // levaria para fora do Nexo -- ou para lugar nenhum.
  const voltar = $('voltarBtn');
  let veioDoNexo = false;
  try { veioDoNexo = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin; } catch (_) { /* referência ilegível */ }
  if (history.length > 1 && veioDoNexo) {
    voltar.hidden = false;
    voltar.onclick = () => history.back();
  }

  // ---------- Os olhos ----------
  let ultimoMovimento = 0;
  function olharPara(x, y) {
    const caixa = svg.getBoundingClientRect();
    if (!caixa.width) return;
    const escala = caixa.width / LARGURA_DO_DESENHO;
    CENTROS.forEach((centro, i) => {
      const dx = x - (caixa.left + centro.x * escala);
      const dy = y - (caixa.top + centro.y * escala);
      const distancia = Math.hypot(dx, dy) || 1;
      // Perto do rosto os olhos quase não andam; longe, vão até a borda. Sem isso, um cursor a
      // dois pixels do olho faria a pupila pular para o canto.
      const alcance = Math.min(ALCANCE, distancia / (18 * escala));
      pupilas[i].style.transform = `translate(${(dx / distancia) * alcance}px, ${(dy / distancia) * alcance}px)`;
    });
  }
  function olharParaElemento(elemento) {
    const caixa = elemento.getBoundingClientRect();
    olharPara(caixa.left + caixa.width / 2, caixa.top + caixa.height / 2);
  }
  window.addEventListener('pointermove', evento => {
    ultimoMovimento = Date.now();
    olharPara(evento.clientX, evento.clientY);
  }, { passive: true });
  // Parada, ela procura sozinha: um olhar para um lado, depois para o outro.
  setInterval(() => {
    if (Date.now() - ultimoMovimento < 3500) return;
    const caixa = svg.getBoundingClientRect();
    const lado = Math.random() < .5 ? -1 : 1;
    olharPara(caixa.left + caixa.width / 2 + lado * 400, caixa.top + caixa.height / 2 + (Math.random() - .5) * 240);
  }, 2600);

  function piscar() {
    rosto.classList.add('piscando');
    setTimeout(() => rosto.classList.remove('piscando'), 130);
  }
  (function agendarPiscada() {
    setTimeout(() => {
      piscar();
      // De vez em quando, duas seguidas: um piscar sempre igual parece relógio.
      if (Math.random() < .25) setTimeout(piscar, 260);
      agendarPiscada();
    }, 2200 + Math.random() * 3800);
  })();

  // ---------- As reações ----------
  function reagir(classe, ms) {
    rosto.classList.remove(classe);
    void rosto.offsetWidth;   // reinicia a animação quando a reação se repete
    rosto.classList.add(classe);
    clearTimeout(reagir[classe]);
    reagir[classe] = setTimeout(() => rosto.classList.remove(classe), ms);
  }
  const feliz = ligado => rosto.classList.toggle('feliz', ligado);
  for (const alvo of document.querySelectorAll('.botao, .sugestao, #recentesLinks, .campo button')) {
    alvo.addEventListener('pointerenter', () => feliz(true));
    alvo.addEventListener('pointerleave', () => feliz(false));
    alvo.addEventListener('focusin', () => { feliz(true); olharParaElemento(alvo); });
    alvo.addEventListener('focusout', () => feliz(false));
  }
  let cutucadas = 0;
  rosto.addEventListener('click', () => {
    cutucadas++;
    reagir('cutucado', 560);
    rosto.setAttribute('aria-label', cutucadas > 4 ? 'O Nexo, já meio tonto de tanto cutucão.' : 'O Nexo, meio perdido. Toque para cutucar.');
  });

  // ---------- Entrar numa sala daqui mesmo ----------
  const campo = $('codigoSala');
  const erro = $('codigoErro');
  const normalizar = valor => valor.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '-');
  campo.addEventListener('focus', () => olharParaElemento(campo));
  campo.addEventListener('input', () => {
    erro.hidden = true;
    campo.removeAttribute('aria-invalid');
    feliz(CODIGO.test(normalizar(campo.value)));
  });
  $('entrarForm').addEventListener('submit', evento => {
    evento.preventDefault();
    const codigo = normalizar(campo.value);
    if (!CODIGO.test(codigo)) {
      erro.textContent = 'Um código tem de 4 a 32 caracteres: letras, números, hífen ou sublinhado.';
      erro.hidden = false;
      campo.setAttribute('aria-invalid', 'true');
      feliz(false);
      if (!semMovimento) reagir('negando', 520);
      campo.focus();
      return;
    }
    location.href = `/${encodeURIComponent(codigo)}/sala`;
  });

  // As mesmas "últimas salas" da página inicial: quem se perdeu costuma querer voltar para
  // uma delas.
  try {
    const recentes = JSON.parse(localStorage.getItem('nexoRecentRooms') || '[]');
    const validas = (Array.isArray(recentes) ? recentes : []).filter(codigo => typeof codigo === 'string' && CODIGO.test(codigo)).slice(0, 4);
    for (const codigo of validas) {
      const link = document.createElement('a');
      link.href = `/${encodeURIComponent(codigo)}/sala`;
      link.textContent = `# ${codigo}`;
      $('recentesLinks').append(link);
    }
    $('recentes').hidden = !validas.length;
  } catch (_) { /* Sem armazenamento, a lista só não aparece. */ }
})();
