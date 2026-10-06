// O servidor que os aplicativos (o de mesa e o Android) trazem preenchido na primeira vez vem da variável
// NEXO_SERVIDOR_PADRAO do .env.prod. O aplicativo instalado não lê o .env de ninguém, então o valor é gravado
// no pacote na hora de empacotar: este script o escreve em app/servidor-padrao.json (fora do Git, gerado), de
// onde o aplicativo de mesa o lê e o Gradle o leva para o APK.
//
//   npm run servidor:padrao
//
// Os empacotamentos (app: `npm run empacotar*`, Android: `npm run android:empacotar`) já rodam isto antes.
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.join(__dirname, '..', 'app', 'servidor-padrao.json');

// Só uma origem http(s): o que passa daqui vai para a tela de endereço e, dela, para a janela.
function origemDoServidor(valor) {
  try {
    const alvo = new URL(String(valor || '').trim());
    return alvo.protocol === 'http:' || alvo.protocol === 'https:' ? alvo.origin : '';
  } catch (_) { return ''; }
}

// Escreve o arquivo (ou apaga o de um build anterior, se a variável sumiu) e devolve o endereço gravado.
function escrever(ambiente = process.env, arquivo = ARQUIVO) {
  const bruto = String(ambiente.NEXO_SERVIDOR_PADRAO || '').trim();
  const endereco = origemDoServidor(bruto);
  if (bruto && !endereco) throw new Error(`NEXO_SERVIDOR_PADRAO precisa ser um endereço http(s), e veio "${bruto}".`);
  if (!endereco) {
    fs.rmSync(arquivo, { force: true });
    return '';
  }
  fs.writeFileSync(arquivo, JSON.stringify({ endereco }, null, 2) + '\n');
  return endereco;
}

if (require.main === module) {
  try {
    const endereco = escrever();
    console.log(endereco
      ? `Servidor padrão dos aplicativos: ${endereco}`
      : 'NEXO_SERVIDOR_PADRAO não está no .env.prod: a tela de endereço dos aplicativos abre vazia.');
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}

module.exports = { escrever, origemDoServidor };
