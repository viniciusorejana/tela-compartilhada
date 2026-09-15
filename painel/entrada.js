document.getElementById('entrada').addEventListener('submit', async evento => {
  evento.preventDefault();
  const formulario = evento.currentTarget, botao = formulario.querySelector('button');
  const campo = document.getElementById('segredo'), mensagem = document.getElementById('mensagem');
  botao.disabled = true; mensagem.textContent = '';
  try {
    const resposta = await fetch('/painel/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segredo: campo.value }) });
    const dados = await resposta.json();
    campo.value = '';
    if (resposta.ok) location.assign('/painel');
    else { mensagem.textContent = dados.erro || 'Acesso recusado.'; campo.focus(); }
  } catch (_) { mensagem.textContent = 'Não foi possível conectar. Tente novamente.'; }
  finally { botao.disabled = false; }
});
