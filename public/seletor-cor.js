/* O seletor de cor do Nexo: o painelzinho que abre ao lado de um botão (popover.js), no lugar do quadrado
 * nativo do navegador -- que cada sistema desenha de um jeito e que destoava de todo o resto.
 *
 *   NexoCor.abrir(botao, { valor, rotulo, paleta, aoMudar, aoFechar })
 *   NexoCor.sortear()      // { a, b }: duas cores que combinam, uma viva e uma funda (o "sortear" do cartão)
 *   NexoCor.hex(texto)     // '#rrggbb' em minúsculas, ou null -- aceita "#abc", "abc" e "#aabbcc"
 *
 * Desenho de Discord: a área de saturação e brilho com a bolinha, a régua do matiz, o código da cor com o
 * conta-gotas (onde o navegador tem), e uma fileira de cores prontas. Tudo pelo mouse, pelo toque e pelo
 * teclado (setas na área, com Shift de dez em dez). `aoMudar` recebe o `#rrggbb` a cada movimento.
 * A conversa entre HSV e RGB é aqui; o catálogo do que vale no cartão é de vitrine.js (o servidor só
 * guarda `#rrggbb`).
 */
(function (root) {
  const doc = root.document;
  const limitar = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));

  const hex = texto => {
    const achou = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(texto ?? '').trim());
    if (!achou) return null;
    const cheio = achou[1].length === 3 ? [...achou[1]].map(c => c + c).join('') : achou[1];
    return `#${cheio.toLowerCase()}`;
  };
  const rgbDe = cor => { const n = parseInt(cor.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hexDe = (r, g, b) => `#${[r, g, b].map(c => Math.round(limitar(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
  function hsvDe(cor) {
    const [r, g, b] = rgbDe(cor).map(c => c / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }
  function rgbDeHsv(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  const hexDeHsv = (h, s, v) => hexDe(...rgbDeHsv(h, s, v));

  // Duas cores que combinam, como os temas do cartão: uma viva (o destaque) e uma funda (o fundo), com o
  // matiz da segunda deslocado um pouco da primeira. O acaso é só o ponto de partida: nada sai feio.
  function sortear() {
    const h = Math.random() * 360;
    const desvio = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 50);
    return {
      a: hexDeHsv(h, 0.5 + Math.random() * 0.35, 0.86 + Math.random() * 0.12),
      b: hexDeHsv((h + desvio + 360) % 360, 0.55 + Math.random() * 0.35, 0.2 + Math.random() * 0.22)
    };
  }

  const elemento = (tag, classe, texto) => {
    const el = doc.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const GOTA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';

  function abrir(botao, { valor = '#8879f6', rotulo = 'Escolher a cor', paleta = [], aoMudar = () => {}, aoFechar = null } = {}) {
    const inicial = hex(valor) || '#8879f6';
    let { h, s, v } = hsvDe(inicial);
    return root.NexoPopover.abrir(botao, caixa => {
      const area = elemento('div', 'nx-cor-area');
      area.tabIndex = 0;
      area.setAttribute('role', 'group');
      area.setAttribute('aria-label', 'Saturação e brilho. Use as setas; com Shift, de dez em dez.');
      const bolinha = elemento('span', 'nx-cor-bolinha');
      area.append(bolinha);

      const matiz = elemento('input', 'nx-cor-matiz');
      matiz.type = 'range';
      matiz.min = '0'; matiz.max = '359'; matiz.step = '1';
      matiz.setAttribute('aria-label', 'Matiz');

      const linha = elemento('div', 'nx-cor-linha');
      const previa = elemento('span', 'nx-cor-previa');
      previa.setAttribute('aria-hidden', 'true');
      const campo = elemento('input', 'nx-cor-hex');
      campo.type = 'text';
      campo.maxLength = 7;
      campo.spellcheck = false;
      campo.autocomplete = 'off';
      campo.setAttribute('autocapitalize', 'off');
      campo.setAttribute('aria-label', 'Código da cor, como #8879f6');
      linha.append(previa, campo);
      if (root.EyeDropper) {
        const gota = elemento('button', 'nx-cor-gota');
        gota.type = 'button';
        gota.title = 'Pegar uma cor da tela';
        gota.setAttribute('aria-label', 'Pegar uma cor da tela');
        gota.innerHTML = GOTA;
        // O conta-gotas do navegador cobre a janela inteira; se a pessoa desiste (Esc), a promessa rejeita.
        gota.addEventListener('click', async () => {
          try { definir(hex((await new root.EyeDropper().open()).sRGBHex)); } catch (_) { /* desistiu */ }
        });
        linha.append(gota);
      }

      const pronta = elemento('div', 'nx-cor-paleta');
      pronta.setAttribute('role', 'group');
      pronta.setAttribute('aria-label', 'Cores prontas');
      const amostras = paleta.map(hex).filter(Boolean).map(cor => {
        const b = elemento('button', 'nx-cor-pronta');
        b.type = 'button';
        b.style.setProperty('--c', cor);
        b.title = cor.toUpperCase();
        b.setAttribute('aria-label', `Cor ${cor.toUpperCase()}`);
        b.addEventListener('click', () => definir(cor));
        pronta.append(b);
        return b;
      });
      caixa.classList.add('nx-cor');
      caixa.append(area, matiz, linha, ...(amostras.length ? [pronta] : []));

      // Desenha o estado inteiro de uma vez. `emitir` é falso no primeiro desenho: abrir o painel não é mudar a cor.
      function pintar({ emitir = true } = {}) {
        const cor = hexDeHsv(h, s, v);
        caixa.style.setProperty('--matiz', String(Math.round(h)));
        caixa.style.setProperty('--cor', cor);
        bolinha.style.left = `${s * 100}%`;
        bolinha.style.top = `${(1 - v) * 100}%`;
        if (Number(matiz.value) !== Math.round(h)) matiz.value = String(Math.round(h));
        // O campo não é reescrito enquanto a pessoa digita nele.
        if (doc.activeElement !== campo) { campo.value = cor.toUpperCase(); campo.removeAttribute('aria-invalid'); }
        amostras.forEach(b => b.setAttribute('aria-pressed', String(b.title.toLowerCase() === cor)));
        if (emitir) aoMudar(cor);
      }
      // De uma cor pronta, digitada ou do conta-gotas. Cinza e preto perdem o matiz na conversa para HSV:
      // ele fica o que estava, para a régua não pular para o vermelho.
      function definir(cor) {
        if (!cor) return;
        const novo = hsvDe(cor);
        s = novo.s; v = novo.v;
        if (novo.s > 0.02 && novo.v > 0.02) h = novo.h;
        pintar();
      }

      function mover(evento) {
        const r = area.getBoundingClientRect();
        s = limitar((evento.clientX - r.left) / r.width);
        v = 1 - limitar((evento.clientY - r.top) / r.height);
        pintar();
      }
      area.addEventListener('pointerdown', evento => {
        if (evento.button) return;
        evento.preventDefault();
        area.focus({ preventScroll: true });
        area.setPointerCapture(evento.pointerId);
        mover(evento);
      });
      area.addEventListener('pointermove', evento => { if (area.hasPointerCapture(evento.pointerId)) mover(evento); });
      area.addEventListener('keydown', evento => {
        const passo = evento.shiftKey ? 0.1 : 0.01;
        const dx = { ArrowLeft: -passo, ArrowRight: passo }[evento.key] || 0;
        const dy = { ArrowUp: passo, ArrowDown: -passo }[evento.key] || 0;
        if (!dx && !dy) return;
        evento.preventDefault();
        s = limitar(s + dx);
        v = limitar(v + dy);
        pintar();
      });
      matiz.addEventListener('input', () => { h = Number(matiz.value); pintar(); });
      campo.addEventListener('input', () => {
        const digitada = hex(campo.value);
        if (!digitada) { campo.setAttribute('aria-invalid', 'true'); return; }
        campo.removeAttribute('aria-invalid');
        definir(digitada);
      });
      campo.addEventListener('blur', () => pintar({ emitir: false }));
      campo.addEventListener('keydown', evento => { if (evento.key === 'Enter') { evento.preventDefault(); root.NexoPopover.fechar({ devolverFoco: true }); } });
      pintar({ emitir: false });
    }, { rotulo, classe: 'nx-cor-pop', foco: '.nx-cor-area', aoFechar });
  }

  root.NexoCor = { abrir, sortear, hex, hexDeHsv, hsvDe };
})(window);
