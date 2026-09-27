(() => {
  const input = document.getElementById('roomCode');
  const error = document.getElementById('roomError');
  const normalize = value => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
  function openRoom(raw) {
    const code = normalize(raw);
    if (!/^[a-z0-9_-]{4,32}$/.test(code)) {
      error.hidden = false;
      error.textContent = 'Informe um código de 4 a 32 caracteres: letras, números, hífen ou sublinhado.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    window.location.href = `/${encodeURIComponent(code)}/sala`;
  }
  document.getElementById('roomForm').onsubmit = event => { event.preventDefault(); openRoom(input.value); };
  // Quem já tem conta vê o próprio apelido no lugar do "Entrar". O pedido não segura nada da
  // página: sem resposta, o link continua dizendo "Entrar" e leva ao mesmo lugar. É o mesmo
  // pedido de conta-cliente.js, que também traz os ajustes da conta -- entre eles o que a pessoa
  // já leu das novidades.
  const conta = window.NexoConta ? window.NexoConta.pronto : Promise.resolve({ conta: null });
  conta.then(dados => {
    if (!dados?.conta) return;
    const link = document.getElementById('contaLink');
    link.textContent = dados.conta.apelido;
    link.title = `Sua conta · @${dados.conta.usuario}`;
  });
  // Criar uma sala é abrir uma, e só uma conta abre sala: quem clica sem conta vai para o
  // cadastro e volta direto para a sala nova. Entrar numa sala aberta continua sem cadastro.
  document.getElementById('createBtn').onclick = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    const random = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    const codigo = normalize(input.value) || `sala-${random}`;
    const dados = await conta;
    if (!dados?.conta && !dados?.abrirSemConta && /^[a-z0-9_-]{4,32}$/.test(codigo)) {
      window.location.href = `/conta?motivo=criar-sala&voltar=${encodeURIComponent(`/${codigo}/sala`)}`;
      return;
    }
    openRoom(codigo);
  };
  input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
  try {
    const recent = JSON.parse(localStorage.getItem('nexoRecentRooms') || '[]');
    if (!Array.isArray(recent)) return;
    const valid = recent.filter(code => typeof code === 'string' && /^[a-z0-9_-]{4,32}$/.test(code)).slice(0, 4);
    document.getElementById('recentRooms').hidden = !valid.length;
    valid.forEach(code => {
      const link = document.createElement('a');
      link.textContent = `# ${code}`;
      link.href = `/${encodeURIComponent(code)}/sala`;
      document.getElementById('recentLinks').append(link);
    });
  } catch (_) { /* Storage is optional, including in private browsing. */ }
})();
