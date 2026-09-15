// O segredo só é mostrado quando o dono pede no terminal local. Nunca vai para uma URL
// nem para o log que um provedor de hospedagem pode guardar por meses.
const { prepararChave } = require('../telemetria/autenticacao');
try {
  const rotacionar = process.argv.includes('--rotacionar');
  const segredo = prepararChave(undefined, { rotacionar });
  console.log(rotacionar ? 'Nova chave. As sessões anteriores serão invalidadas em até 10 segundos.' : 'Chave local do painel:');
  console.log(segredo);
} catch (erro) { console.error(erro.message); process.exitCode = 1; }
