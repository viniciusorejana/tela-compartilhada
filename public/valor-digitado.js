/* Digitar o valor de uma régua: clicar no número ao lado dela e escrever o que se quer.
 *
 * Arrastar é bom para "um pouco mais alto"; para "exatamente 130%" é tentativa e erro, e no
 * trilho de um quadradinho, com o polegar do tamanho de uma letra, nem isso. Toda régua do Nexo
 * mostra o próprio valor ao lado, e é nesse número que se clica: ele vira um campo com o valor
 * selecionado. Enter ou sair do campo aplica; Esc desiste.
 *
 * O valor entra na régua pelos mesmos eventos de um arrasto -- `input` e depois `change` --, e
 * cada lugar reage como sempre reagiu: o volume muda e é lembrado, os avisos tocam a prévia, o
 * bot de música recebe o volume novo, o Estúdio salva. Nada aqui sabe o que a régua controla. O
 * evento leva `detail.digitado`: o 100% que "gruda" no arrasto não pode desfazer um 97 escrito.
 *
 * Quem é o número de qual régua:
 *   - `.volume-valor` ao lado de uma régua (o quadradinho, o card da grade, o palco);
 *   - `<output for="régua">` (as configurações, o Estúdio, a folha de volume, a apresentação);
 *   - `[data-valor-de="régua"]` (a mesa de sons e a música, que mostram o valor num <span>).
 *
 * No toque, a pílula de volume do quadradinho abre a folha de volume (volume-folha.js), e é lá,
 * no número grande, que se digita.
 */
(function (root) {
  const SELETOR = '.volume-valor, output[for], [data-valor-de]';

  const toque = () => document.documentElement.classList.contains('volume-toque');

  function reguaDo(el) {
    if (el.matches('.volume-valor')) return el.parentElement?.querySelector('input[type="range"]') || null;
    const id = el.getAttribute('for') || el.dataset.valorDe;
    const regua = id ? document.getElementById(id) : null;
    return regua?.type === 'range' ? regua : null;
  }

  function nomeDa(regua) {
    return regua.getAttribute('aria-label') || document.querySelector(`label[for="${CSS.escape(regua.id)}"]`)?.textContent.trim() || 'Valor';
  }

  // Limitado à régua e inteiro, como qualquer posição dela. "150%", "150" e "150,0" valem igual.
  // Escrever o valor que já estava não é mudança: o volume do bot de música, por exemplo, avisaria
  // a sala inteira de um ajuste que não houve.
  function definir(regua, numero) {
    const minimo = Number(regua.min || 0);
    const maximo = Number(regua.max || 100);
    const valor = Math.round(Math.min(maximo, Math.max(minimo, numero)));
    if (String(valor) === regua.value) return valor;
    regua.value = String(valor);
    regua.dispatchEvent(new CustomEvent('input', { bubbles: true, detail: { digitado: true } }));
    regua.dispatchEvent(new Event('change', { bubbles: true }));
    return valor;
  }

  // A unidade que o número mostra ("%", "px"), para continuar à vista enquanto se digita. Quem
  // às vezes mostra uma palavra no lugar do número (a mesa de sons diz "mudo") declara a sua.
  function unidadeDo(el) {
    if (el.dataset.unidade !== undefined) return el.dataset.unidade;
    return el.textContent.trim().match(/^-?\d+(?:[.,]\d+)?\s*(\D{0,3})$/)?.[1] || '';
  }

  function editar(el) {
    const regua = reguaDo(el);
    if (!regua || regua.disabled || el.dataset.editando) return false;
    const estilo = getComputedStyle(el);
    const caixa = document.createElement('span');
    caixa.className = 'valor-digitado-caixa';
    // A caixa ocupa o lugar do número, com a mesma letra e pelo menos a mesma largura: é o número
    // que ficou editável, e não um campo novo empurrando a linha. A letra vai propriedade por
    // propriedade: o `font` abreviado volta vazio quando há `tabular-nums`.
    for (const propriedade of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']) caixa.style[propriedade] = estilo[propriedade];
    caixa.style.minWidth = `${el.getBoundingClientRect().width}px`;
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.inputMode = 'numeric';
    campo.autocomplete = 'off';
    campo.spellcheck = false;
    campo.className = 'valor-digitado';
    campo.value = String(Math.round(Number(regua.value)));
    campo.setAttribute('aria-label', `${nomeDa(regua)}: de ${regua.min || 0} a ${regua.max || 100}`);
    // Do tamanho do maior número que a régua aceita, e não mais.
    campo.style.width = `calc(${Math.max(2, String(regua.max || 100).length)}ch + 3px)`;
    caixa.append(campo);
    const unidade = unidadeDo(el);
    if (unidade) {
      const rotulo = document.createElement('span');
      rotulo.className = 'valor-digitado-unidade';
      rotulo.setAttribute('aria-hidden', 'true');
      rotulo.textContent = unidade;
      caixa.append(rotulo);
    }
    // Clicar na unidade é clicar no campo.
    caixa.addEventListener('mousedown', evento => { if (evento.target !== campo) { evento.preventDefault(); campo.focus(); } });
    el.dataset.editando = '1';
    el.hidden = true;
    el.after(caixa);
    campo.focus();
    campo.select();

    let terminou = false;
    const terminar = (aplicar, devolverFoco) => {
      if (terminou) return;
      terminou = true;
      const texto = campo.value.replace(',', '.').replace(/[^\d.-]/g, '');
      caixa.remove();
      el.hidden = false;
      delete el.dataset.editando;
      if (aplicar && texto !== '' && Number.isFinite(Number(texto))) definir(regua, Number(texto));
      if (devolverFoco) el.focus();
    };
    // Enter dentro de um formulário o enviaria (o do Estúdio recarregaria a página): o Enter é
    // só "aplicar".
    campo.addEventListener('keydown', evento => {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      terminar(true, true);
    });
    campo.addEventListener('blur', () => terminar(true, false));
    // O que se digita no campo não é mudança de ajuste nenhum até o Enter: sem isto, o
    // formulário do Estúdio salvaria a cada tecla.
    campo.addEventListener('input', evento => evento.stopPropagation());
    campo.addEventListener('change', evento => evento.stopPropagation());
    campo._cancelar = () => terminar(false, true);
    return true;
  }

  // Um clique no número (ou um toque) edita. A pílula de volume no toque é de volume-folha.js.
  document.addEventListener('click', evento => {
    const el = evento.target.closest?.(SELETOR);
    if (!el || (el.matches('.volume-valor') && toque())) return;
    if (!reguaDo(el)) return;
    evento.stopPropagation();
    editar(el);
  });
  // Pelo teclado: o botão já vira clique com Enter; os <output> e <span> com `tabindex` ganham
  // Enter, espaço e F2.
  document.addEventListener('keydown', evento => {
    if (!['Enter', ' ', 'F2'].includes(evento.key)) return;
    const el = evento.target.closest?.(SELETOR);
    if (!el || el.tagName === 'BUTTON' || !reguaDo(el)) return;
    evento.preventDefault();
    editar(el);
  });
  // Esc desiste de digitar -- e só disso. Na janela, e na captura, para chegar antes de quem
  // fecha o painel com Esc (room-ui.js escuta no documento).
  window.addEventListener('keydown', evento => {
    if (evento.key !== 'Escape' || !evento.target.classList?.contains('valor-digitado')) return;
    evento.preventDefault();
    evento.stopImmediatePropagation();
    evento.target._cancelar?.();
  }, true);
  // Quem passa o mouse fica sabendo que o número se edita. O número do volume de cada pessoa
  // cuida disso sozinho (sala.js e sala.css), porque no toque ele é outra coisa: a pílula.
  document.addEventListener('pointerover', evento => {
    const el = evento.target.closest?.('output[for], [data-valor-de]');
    if (!el || el.dataset.editavel || !reguaDo(el)) return;
    el.dataset.editavel = '1';
    el.classList.add('valor-editavel');
    if (!el.title) el.title = 'Clique para digitar o valor';
  });

  root.NexoValorDigitado = { editar, definir, reguaDo };
})(window);
