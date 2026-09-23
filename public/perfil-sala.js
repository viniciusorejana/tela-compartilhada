/* O perfil editado de dentro da sala.
 *
 * Antes, mudar o apelido ou a cor pedia sair da chamada, ir à página da conta e voltar --
 * e o perfil novo só valia "na próxima vez que você entrar numa sala". Aqui ele muda sem
 * sair, e o servidor avisa a sala inteira (`peer-perfil`, em sala.js) no instante em que a
 * conta salva. A rota é a mesma da página da conta: uma regra só, conferida no servidor.
 *
 * Sem conta, não há o que editar: o nome de quem entrou sem conta vale só naquela entrada, e
 * trocá-lo no meio da conversa seria um jeito fácil de se passar por outra pessoa.
 */
(() => {
  const $ = id => document.getElementById(id);
  const painel = $('meuPerfilPanel');
  const formulario = $('meuPerfilForm');
  const salvar = $('meuPerfilSalvar');
  let montado = false;
  // O que está salvo. O botão só acende quando o que está na tela é diferente disto.
  let salvo = null;

  const escolhido = grupo => formulario.querySelector(`input[name="sala-${grupo}"]:checked`)?.value || null;
  const naTela = () => ({ apelido: $('meuPerfilApelido').value.replace(/\s+/g, ' ').trim(), cor: escolhido('cor'), marca: escolhido('marca') });
  const mudou = atual => atual.apelido !== salvo.apelido || atual.cor !== salvo.cor || atual.marca !== salvo.marca;

  function dizer(texto, tipo = '') {
    $('meuPerfilStatus').textContent = texto;
    $('meuPerfilStatus').dataset.tipo = tipo;
  }

  // A prévia do topo acompanha cada escolha antes de salvar: é ali que se vê como vai ficar.
  function previa() {
    const atual = naTela();
    const nome = atual.apelido || salvo.apelido;
    pintarAvatar($('meuPerfilAvatar'), nome, { cor: atual.cor, marca: atual.marca });
    $('meuPerfilNome').textContent = nome;
    salvar.disabled = !atual.apelido || !mudou(atual);
  }

  function abrir() {
    const { conta, perfil } = window.NexoConta?.atual() || {};
    const comConta = Boolean(conta);
    formulario.hidden = !comConta;
    $('meuPerfilSub').hidden = !comConta;
    $('meuPerfilSemConta').hidden = comConta;
    salvar.hidden = !comConta;
    $('meuPerfilConta').hidden = !comConta;
    $('meuPerfilCriar').hidden = comConta;
    dizer('');
    if (!comConta) {
      pintarAvatar($('meuPerfilAvatar'), myName || '?', null);
      $('meuPerfilNome').textContent = myName || 'Você';
      $('meuPerfilCodigo').textContent = 'Sem conta';
      painel.classList.remove('hidden');
      return;
    }
    if (!montado) {
      NexoPerfil.montarEscolhas($('meuPerfilCores'), $('meuPerfilMarcas'), 'sala-');
      montado = true;
    }
    // O que a SALA mostra agora vence o que a página guardou ao carregar: a pessoa pode ter
    // mudado o perfil em outra aba, e o `peer-perfil` já trouxe o novo até aqui.
    salvo = {
      apelido: myName || conta.apelido,
      cor: (meuPerfil ? meuPerfil.cor : perfil?.cor) || null,
      marca: (meuPerfil ? meuPerfil.marca : perfil?.marca) || null
    };
    $('meuPerfilApelido').value = salvo.apelido;
    for (const grupo of ['cor', 'marca']) {
      formulario.querySelectorAll(`input[name="sala-${grupo}"]`).forEach(radio => { radio.checked = radio.value === (salvo[grupo] || ''); });
    }
    $('meuPerfilCodigo').textContent = `@${conta.usuario} · código ${conta.codigo}`;
    previa();
    painel.classList.remove('hidden');
  }

  formulario.addEventListener('input', () => { previa(); dizer(''); });
  formulario.addEventListener('submit', async evento => {
    evento.preventDefault();
    const atual = naTela();
    if (salvar.disabled) return;
    if (!atual.apelido) { dizer('O apelido não pode ficar vazio.', 'problema'); $('meuPerfilApelido').focus(); return; }
    salvar.disabled = true;
    salvar.setAttribute('aria-busy', 'true');
    dizer('Salvando…');
    try {
      const resposta = await fetch('/api/conta/perfil', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Nexo-CSRF': window.NexoConta?.atual().csrf || '' },
        body: JSON.stringify(atual)
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        dizer(dados.error || 'Não foi possível salvar. Tente de novo.', 'problema');
        if (dados.campo === 'apelido') $('meuPerfilApelido').focus();
        salvar.disabled = false;
        return;
      }
      window.NexoConta?.atualizar({ conta: dados.conta, perfil: dados.perfil });
      salvo = { apelido: dados.conta.apelido, cor: dados.perfil.cor || null, marca: dados.perfil.marca || null };
      // O servidor limpa espaços e caracteres de controle: o campo mostra o que ficou valendo.
      $('meuPerfilApelido').value = salvo.apelido;
      previa();
      dizer('Salvo. A sala já vê o perfil novo.', 'certo');
    } catch (_) {
      dizer('Sem conexão com o servidor. Tente de novo.', 'problema');
      salvar.disabled = false;
    } finally {
      salvar.removeAttribute('aria-busy');
    }
  });

  // "Criar conta" abre noutra aba, e sem `?voltar=`: com ele, a aba nova entraria na sala
  // depois do cadastro, e a pessoa ficaria duas vezes na mesma chamada.
  $('meuPerfilBtn').addEventListener('click', abrir);

  window.NexoPerfilSala = { abrir };
})();
