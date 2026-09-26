// O tema: claro e escuro, os temas prontos e as cores exatas. A promessa que dá para medir é a
// de que nenhuma escolha -- nem a mais estranha que um seletor de cor livre permite -- produz
// texto ilegível: o texto nunca é a cor escolhida, é a cor levada até o contraste que ele pede.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Tema = require('../public/tema.js');
const { limparAjustes } = require('../public/perfil.js');
const { podeUsarCoresExatas } = require('../public/planos.js');

// Os pisos da WCAG: 4,5:1 para texto comum, 3:1 para borda e ícone.
function conferirLegibilidade(props, rotulo) {
  const c = (a, b) => Tema.contraste(props[a], props[b]);
  for (const fundo of ['--bg', '--bg-1', '--bg-2', '--bg-cartao']) {
    assert.ok(c('--text', fundo) >= 7, `${rotulo}: texto sobre ${fundo} (${c('--text', fundo).toFixed(2)})`);
    assert.ok(c('--muted', fundo) >= 4.5, `${rotulo}: texto secundário sobre ${fundo} (${c('--muted', fundo).toFixed(2)})`);
  }
  assert.ok(c('--faint', '--bg-1') >= 4.5, `${rotulo}: texto fraco (${c('--faint', '--bg-1').toFixed(2)})`);
  assert.ok(Tema.contraste(props['--accent-forte'], '#ffffff') >= 4.5, `${rotulo}: botão cheio com texto branco`);
  assert.ok(c('--accent-texto', '--bg-1') >= 4.5, `${rotulo}: texto em destaque (${c('--accent-texto', '--bg-1').toFixed(2)})`);
}

test('os oito temas prontos são legíveis nos dois modos', () => {
  for (const tema of Tema.TEMAS) {
    for (const modo of ['escuro', 'claro']) {
      conferirLegibilidade(Tema.derivar(Tema.resolver({ tema: tema.id, modo })), `${tema.id}/${modo}`);
    }
  }
});

test('a cor exata mais estranha continua legível: o texto é ajustado, não copiado', () => {
  const estranhas = ['#ffff00', '#00ff00', '#000080', '#ffffff', '#000000', '#ff00ff', '#7f7f7f'];
  for (const destaque of estranhas) {
    for (const fundo of estranhas) {
      for (const modo of ['escuro', 'claro']) {
        const efetivo = Tema.resolver({ modo, cores: { destaque, fundo } }, { coresLivres: true });
        conferirLegibilidade(Tema.derivar(efetivo), `destaque ${destaque}, fundo ${fundo}, ${modo}`);
      }
    }
  }
});

test('o tema pronto traz o modo dele; o modo escolhido manda sobre ele', () => {
  assert.equal(Tema.resolver({ tema: 'areia' }).modo, 'claro');
  assert.equal(Tema.resolver({ tema: 'floresta' }).modo, 'escuro');
  assert.equal(Tema.resolver({ tema: 'areia', modo: 'escuro' }).modo, 'escuro', 'o Areia no escuro vira um escuro de tom quente');
  assert.equal(Tema.resolver({ tema: 'nao-existe' }).tema, Tema.TEMA_PADRAO, 'tema desconhecido cai no padrão');
  assert.equal(Tema.resolver({}).padrao, true, 'o padrão não calcula nada: vale o que está em tema.css');
  assert.equal(Tema.resolver({ destaque: 'verde' }).destaque, Tema.DESTAQUES.verde);
});

test('as cores exatas só valem com permissão, e ficam guardadas sem ela', () => {
  const escolha = { tema: 'nexo', cores: { destaque: '#ff8800', fundo: '#102030' } };
  const sem = Tema.resolver(escolha, { coresLivres: false });
  assert.equal(sem.destaque, Tema.temaPorId('nexo').destaque);
  assert.equal(sem.padrao, true);
  const com = Tema.resolver(escolha, { coresLivres: true });
  assert.equal(com.destaque, '#ff8800');
  assert.equal(com.padrao, false);
  // O fundo exato define a camada principal: a cor escolhida é a que aparece.
  assert.equal(Tema.derivar(com)['--bg'], '#102030');
});

test('quem pode escolher a cor exata: premium, ou todo mundo com os planos desligados', () => {
  assert.equal(podeUsarCoresExatas('premium'), true);
  assert.equal(podeUsarCoresExatas('gratis'), false);
  assert.equal(podeUsarCoresExatas('anonimo'), false);
  assert.equal(podeUsarCoresExatas('anonimo', true), true, 'NEXO_PLANOS=0 libera, como o 1440p');
});

test('a conta guarda tema, modo, destaque e cores exatas -- e só valores que existem', () => {
  const limpos = limparAjustes({ aparencia: { tema: 'ceu', modo: 'sistema', destaque: 'coral', cores: { destaque: '#AABBCC', fundo: 'vermelho' }, invasor: 1 } });
  assert.deepEqual(limpos.aparencia, { tema: 'ceu', modo: 'sistema', destaque: 'coral', cores: { destaque: '#aabbcc' } });
  assert.deepEqual(limparAjustes({ aparencia: { tema: 'inventado', modo: 'neon', destaque: '#123456' } }), {});
});
