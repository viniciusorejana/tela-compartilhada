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
  document.getElementById('createBtn').onclick = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    const random = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    openRoom(input.value.trim() || `sala-${random}`);
  };
  input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
  // Quem já tem conta vê o próprio apelido no lugar do "Entrar". O pedido não segura nada da
  // página: sem resposta, o link continua dizendo "Entrar" e leva ao mesmo lugar.
  fetch('/api/conta/eu', { credentials: 'same-origin' })
    .then(resposta => (resposta.ok ? resposta.json() : null))
    .then(dados => {
      if (!dados?.conta) return;
      const link = document.getElementById('contaLink');
      link.textContent = dados.conta.apelido;
      link.title = `Sua conta · @${dados.conta.usuario}`;
    })
    .catch(() => { /* Sem conta ou sem rede: o "Entrar" continua valendo. */ });
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
