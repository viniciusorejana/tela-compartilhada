// As contas pela tela, com navegadores de verdade. O que se afirma aqui é o que só existe no
// navegador: o cookie indo sozinho, o código de recuperação aparecendo uma vez, os ajustes
// chegando a outro aparelho -- e os aparelhos NÃO chegando.
//
// Sem servidor de mídia: a sala funciona só com o chat, que é tudo o que estas regras tocam.
// Cada contexto do Playwright é um navegador limpo, e é assim que se simula "outro aparelho".
const { chromium } = require('playwright');
const { iniciarServidor } = require('./helpers/servidor-telemetria.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const port = 3221;
const origin = `http://localhost:${port}`;
const saida = path.join(__dirname, '..', 'test-results', 'contas');
fs.mkdirSync(saida, { recursive: true });
const SENHA = 'cafe com pao no sabado';
const erros = [];
let instancia, browser;

async function novaPagina(contexto) {
  const pagina = await contexto.newPage();
  pagina.on('pageerror', e => { erros.push(e.message); console.error('erro na página:', e.message); });
  return pagina;
}

async function esperarAte(condicao, mensagem, prazo = 10000) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(mensagem);
}

async function cadastrarPelaTela(pagina, { usuario, apelido }) {
  await pagina.goto(`${origin}/conta`);
  await pagina.locator('#abaCriar').click();
  await pagina.locator('#criarUsuario').fill(usuario);
  await pagina.locator('#criarApelido').fill(apelido);
  await pagina.locator('#criarSenha').fill(SENHA);
  await pagina.locator('#formCriar button[type="submit"]').click();
  await pagina.locator('#codigoNovo').waitFor();
  const codigo = await pagina.locator('#codigoNovoValor').textContent();
  assert.match(codigo, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  // Não segue sem dizer que guardou: é a única vez que o código aparece.
  assert.equal(await pagina.locator('#seguirDoCodigo').isDisabled(), true);
  await pagina.screenshot({ path: path.join(saida, 'codigo-de-recuperacao.png') });
  await pagina.locator('#guardeiCodigo').check();
  await pagina.locator('#seguirDoCodigo').click();
  return codigo;
}

async function entrarPelaTela(pagina, usuario) {
  await pagina.goto(`${origin}/conta`);
  await pagina.locator('#entrarUsuario').fill(usuario);
  await pagina.locator('#entrarSenha').fill(SENHA);
  await pagina.locator('#formEntrar button[type="submit"]').click();
  await pagina.locator('#comConta').waitFor();
}

async function entrarNaSala(pagina, sala, nome) {
  await pagina.goto(`${origin}/${sala}/sala`);
  if (nome) await pagina.locator('#nameInput').fill(nome);
  await pagina.locator('#nameConfirmBtn').click();
  await pagina.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
}

async function etapaB(contextoA, contextoB, contextoC) {
  // ---------- Cadastro e perfil, pela tela ----------
  const ana = await novaPagina(contextoA);
  await cadastrarPelaTela(ana, { usuario: 'Molejo', apelido: 'Molejo 🎮' });
  await ana.locator('#comConta').waitFor();
  assert.equal(await ana.locator('#contaUsuario').textContent(), '@molejo');
  assert.equal(await ana.locator('#contaAvatar').textContent(), 'M🎮', 'a inicial de um emoji não é meia letra');
  await ana.locator('#secaoPerfil summary').click();
  await ana.locator('#perfilCores input[value="menta"]').check({ force: true });
  await ana.locator('#perfilMarcas input[value="lua"]').check({ force: true });
  assert.equal(await ana.locator('#contaAvatar').textContent(), '☾', 'a prévia acompanha a escolha antes de salvar');
  await ana.locator('#formPerfil button[type="submit"]').click();
  await ana.waitForFunction(() => /Perfil salvo/.test(document.getElementById('contaStatus').textContent));
  await ana.screenshot({ path: path.join(saida, 'conta-com-perfil.png'), fullPage: true });

  // Baixar meus dados: o arquivo é o que a LGPD chama de portabilidade.
  await ana.locator('summary', { hasText: 'Seus dados' }).click();
  const [download] = await Promise.all([ana.waitForEvent('download'), ana.locator('#baixarDados').click()]);
  const dados = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(dados.conta.usuario, 'molejo');
  assert.equal(dados.perfil.cor, 'menta');
  assert.equal(JSON.stringify(dados).includes('scrypt$'), false);

  // ---------- Na sala, o apelido da conta vence ----------
  await ana.goto(`${origin}/squad-contas/sala`);
  await ana.waitForFunction(() => document.getElementById('nameInput').readOnly);
  assert.equal(await ana.locator('#nameInput').inputValue(), 'Molejo 🎮');
  assert.equal(await ana.locator('#gateConta').isVisible(), true);
  assert.equal(await ana.locator('#gateContaLink').isVisible(), false);
  await ana.screenshot({ path: path.join(saida, 'portao-com-conta.png') });
  await ana.locator('#nameConfirmBtn').click();
  await ana.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await ana.evaluate(() => myName), 'Molejo 🎮');
  assert.equal(await ana.locator('#selfAvatar').textContent(), '☾');

  // Um ajuste que segue a pessoa, e um que NÃO segue.
  await ana.evaluate(() => Preferencias.gravarAjuste('microfone', 'microfone-do-desktop'));
  await ana.locator('#devicesBtn').click();
  await ana.locator('#abaQualidade').click();
  await ana.locator('#videoQuality').selectOption('economical');
  await ana.keyboard.press('Escape');
  // O envio sai dois segundos depois da última mudança. A espera é do lado do Node: o
  // `waitForFunction` não aguarda uma promessa, e uma função assíncrona ali "passa" na hora.
  await esperarAte(async () => (await ana.evaluate(() => fetch('/api/conta/eu').then(r => r.json()))).perfil?.ajustes?.qualidade === 'economical',
    'a qualidade escolhida não chegou à conta');

  // ---------- Outro aparelho recebe a qualidade, e não o microfone ----------
  const outroAparelho = await novaPagina(contextoB);
  await entrarPelaTela(outroAparelho, 'molejo');
  await outroAparelho.goto(`${origin}/squad-contas/sala`);
  await outroAparelho.waitForFunction(() => document.getElementById('nameInput').readOnly);
  assert.equal(await outroAparelho.evaluate(() => localStorage.getItem('nexoQuality')), 'economical');
  assert.equal(await outroAparelho.locator('#videoQuality').inputValue(), 'economical');
  assert.equal(await outroAparelho.evaluate(() => localStorage.getItem('sala.dispositivo.microfone')), null,
    'o id de um aparelho não existe em outro, e não viaja com a conta');

  // ---------- Quem não tem conta vê a marca de quem tem ----------
  const bia = await novaPagina(contextoC);
  await entrarNaSala(bia, 'squad-contas', 'Bia');
  assert.equal(await bia.locator('#gateConta').isVisible(), false);
  await ana.locator('#chatInput').fill('oi, sou eu');
  await ana.locator('#chatSend').click();
  await bia.waitForFunction(() => [...document.querySelectorAll('.msg-texto')].some(el => el.textContent === 'oi, sou eu'));
  assert.equal(await bia.locator('.msg-avatar').last().textContent(), '☾');
  await bia.close();

  // ---------- Apagar a conta desfaz tudo, nos dois aparelhos ----------
  await outroAparelho.goto(`${origin}/conta`);
  await outroAparelho.locator('summary', { hasText: 'Apagar a conta' }).click();
  assert.equal(await outroAparelho.locator('#formApagar button').isDisabled(), true);
  await outroAparelho.locator('#apagarSenha').fill(SENHA);
  await outroAparelho.locator('#apagarCerteza').check();
  await outroAparelho.locator('#formApagar button').click();
  await outroAparelho.locator('#semConta').waitFor();
  const eu = await ana.evaluate(() => fetch('/api/conta/eu').then(r => r.json()));
  assert.equal(eu.conta, null, 'a sessão do primeiro aparelho caiu junto');
  await ana.close();
  await outroAparelho.close();
  console.log('PASS: cadastro pela tela, código de recuperação, perfil, apelido na sala, ajustes em outro aparelho sem o microfone, baixar e apagar');
}

async function comConta(contexto, usuario, apelido) {
  const { cookie } = await instancia.conta(usuario, { apelido });
  await contexto.addCookies([{ name: 'nexo_conta', value: cookie.split('=')[1], url: origin }]);
}

async function etapaC(contextoAnonimo, contextoDaDona) {
  // ---------- Criar sala sem conta leva ao cadastro ----------
  const inicio = await novaPagina(contextoAnonimo);
  await inicio.goto(origin);
  await inicio.locator('#roomCode').fill('sala-nova');
  await inicio.locator('#createBtn').click();
  await inicio.waitForURL('**/conta?motivo=criar-sala**');
  assert.equal(new URL(inicio.url()).searchParams.get('voltar'), '/sala-nova/sala');
  assert.equal(await inicio.locator('#abaCriar').getAttribute('aria-selected'), 'true', 'quem veio criar a sala cai direto em "Criar conta"');
  await inicio.close();

  // ---------- Quem chega antes de a sala abrir espera, e entra junto ----------
  const bia = await novaPagina(contextoAnonimo);
  await bia.goto(`${origin}/sala-da-dona/sala`);
  await bia.locator('#nameInput').fill('Bia');
  await bia.locator('#nameConfirmBtn').click();
  await bia.locator('#waitingPanel').waitFor();
  assert.equal(await bia.locator('#waitingTitle').textContent(), 'A sala ainda não foi aberta');
  assert.equal(await bia.locator('#waitingConta').isVisible(), true, 'quem tem conta pode abrir a sala ele mesmo');
  await bia.screenshot({ path: path.join(saida, 'espera-pela-sala.png') });

  await comConta(contextoDaDona, 'dona', 'Dona');
  const dona = await novaPagina(contextoDaDona);
  await entrarNaSala(dona, 'sala-da-dona');
  // A página da Bia pergunta de novo a cada cinco segundos: ela entra sem apertar nada.
  await bia.waitForFunction(() => tiles.has('self'), null, { timeout: 20000 });
  assert.equal(await bia.locator('#waitingPanel').isVisible(), false);

  // ---------- A lista, o cartão de perfil e a mesa de sons de quem não tem conta ----------
  await bia.locator('#soundboardBtn').click();
  assert.equal(await bia.locator('#sonsEnviarBtn').isDisabled(), true, 'enviar som pede conta');
  await bia.keyboard.press('Escape');
  await dona.close();
  await bia.close();
  console.log('PASS: criar sala sem conta leva ao cadastro; quem chega antes espera e entra junto quando a conta abre');
}

(async () => {
  // Sem a janela de transição: "só conta abre sala" valendo, como vai estar em produção.
  instancia = await iniciarServidor({ ambiente: { PORT: String(port), NEXO_ANONIMO_ABRE_SALA: '0' } });
  browser = await chromium.launch({ headless: true });
  const contexto = () => browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  await etapaB(await contexto(), await contexto(), await contexto());
  await etapaC(await contexto(), await contexto());
  assert.deepEqual(erros, []);
})().catch(erro => {
  console.error(erro);
  console.error(instancia?.erros());
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await instancia?.encerrar();
});
