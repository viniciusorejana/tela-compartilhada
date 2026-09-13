// As preferências vivem no navegador de cada um, e são a única parte da sala que atravessa
// sessões. O que se fixa aqui é o que, errado, ficaria errado para sempre -- um volume
// gravado no lugar errado não se conserta sozinho na próxima entrada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'public', 'preferencias.js'), 'utf8');

// Objetos criados dentro do `vm` têm outro Object.prototype, e `deepStrictEqual` recusa
// dois objetos de contextos diferentes mesmo com o conteúdo idêntico. Comparar o conteúdo
// serializado testa o que interessa sem esbarrar nisso.
const mesmoConteudo = (a, b, mensagem) => assert.equal(JSON.stringify(a), JSON.stringify(b), mensagem);
const PADRAO = { voz: 1, vozMuda: false, tela: 1, telaMuda: false };

// localStorage de mentira, com o mesmo contrato do de verdade: tudo é string, e o que não
// existe volta null.
function comArmazenamento(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  const localStorage = {
    getItem: chave => (dados.has(chave) ? dados.get(chave) : null),
    setItem: (chave, valor) => dados.set(String(chave), String(valor)),
    removeItem: chave => dados.delete(chave),
    get length() { return dados.size; }
  };
  // `Object.keys(localStorage)` é como o módulo varre as chaves; no navegador elas são
  // propriedades do objeto.
  const alvo = new Proxy(localStorage, {
    ownKeys: () => [...dados.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true })
  });
  const janela = { localStorage: alvo };
  janela.window = janela;      // o módulo se registra em `window`
  vm.createContext(janela);
  vm.runInContext(fonte, janela);
  return { Preferencias: janela.Preferencias, dados };
}

test('guarda e devolve valores, e sobrevive a um armazenamento quebrado', () => {
  const { Preferencias, dados } = comArmazenamento();
  assert.equal(Preferencias.ler('naoExiste', 'padrão'), 'padrão');
  Preferencias.gravar('qualidade', 'high');
  assert.equal(Preferencias.ler('qualidade', null), 'high');
  // O prefixo existe para não colidir com as chaves que a sala já usava antes disto.
  assert.ok([...dados.keys()].every(k => k.startsWith('nexo.pref.')));

  // Valor corrompido (alguém editou à mão, outra versão gravou outro formato) devolve o
  // padrão em vez de derrubar a página no carregamento.
  dados.set('nexo.pref.quebrado', '{isto não é json');
  assert.equal(Preferencias.ler('quebrado', 'inteiro'), 'inteiro');
});

test('janela privada sem armazenamento não derruba nada', () => {
  const janela = {
    localStorage: {
      getItem() { throw new DOMExceptionFalsa(); },
      setItem() { throw new DOMExceptionFalsa(); },
      removeItem() { throw new DOMExceptionFalsa(); }
    }
  };
  function DOMExceptionFalsa() { this.name = 'SecurityError'; }
  janela.window = janela;
  vm.createContext(janela);
  vm.runInContext(fonte, janela);
  // Sem lembrar nada, mas sem quebrar: a sala inteira funciona igual.
  assert.equal(janela.Preferencias.ler('x', 'padrão'), 'padrão');
  assert.equal(janela.Preferencias.gravar('x', 1), false);
  mesmoConteudo(janela.Preferencias.audioDe('Ana'), PADRAO);
  assert.doesNotThrow(() => janela.Preferencias.guardarAudioDe('Ana', { voz: 0.5, vozMuda: false, tela: 1, telaMuda: false }));
});

// O volume é guardado pelo NOME porque a identidade de mídia carrega um sufixo sorteado a
// cada entrada: por ela, nada seria lembrado. É esta escolha que faz o ajuste sobreviver a
// sair e voltar -- e que faz o volume do bot de música valer em qualquer sala.
test('o volume é lembrado pelo nome, ignorando maiúscula e espaço', () => {
  const { Preferencias } = comArmazenamento();
  Preferencias.guardarAudioDe('Nexo DJ', { voz: 0.35, vozMuda: false, tela: 1, telaMuda: false });
  assert.equal(Preferencias.audioDe('Nexo DJ').voz, 0.35);
  assert.equal(Preferencias.audioDe('nexo dj').voz, 0.35);
  assert.equal(Preferencias.audioDe('  NEXO   DJ  ').voz, 0.35);
  assert.equal(Preferencias.audioDe('Outra Pessoa').voz, 1, 'quem nunca foi ajustado começa no padrão');
});

test('voltar ao padrão apaga a entrada em vez de gravar o padrão', () => {
  const { Preferencias } = comArmazenamento();
  Preferencias.guardarAudioDe('Ana', { voz: 0.2, vozMuda: true, tela: 0.5, telaMuda: true });
  assert.equal(Preferencias.resumo().pessoas, 1);
  // Desfazer tudo não pode deixar lixo ocupando uma das vagas lembradas.
  Preferencias.guardarAudioDe('Ana', { voz: 1, vozMuda: false, tela: 1, telaMuda: false });
  assert.equal(Preferencias.resumo().pessoas, 0);
  mesmoConteudo(Preferencias.audioDe('Ana'), PADRAO);
});

// Sem teto, uma sala grande ao longo de meses acumularia centenas de nomes que ninguém
// mais encontra -- e o armazenamento do navegador tem limite.
test('a lista tem teto, e quem sai é quem foi ajustado há mais tempo', async () => {
  const { Preferencias } = comArmazenamento();
  const teto = Preferencias.PESSOAS_LEMBRADAS;
  for (let i = 0; i < teto; i++) {
    Preferencias.guardarAudioDe(`pessoa ${i}`, { voz: 0.5, vozMuda: false, tela: 1, telaMuda: false });
    await new Promise(r => setTimeout(r, 1));   // instantes distintos, para a ordem valer
  }
  assert.equal(Preferencias.resumo().pessoas, teto);
  assert.equal(Preferencias.audioDe('pessoa 0').voz, 0.5);

  Preferencias.guardarAudioDe('recem chegada', { voz: 0.3, vozMuda: false, tela: 1, telaMuda: false });
  assert.equal(Preferencias.resumo().pessoas, teto, 'o teto tem de segurar');
  assert.equal(Preferencias.audioDe('pessoa 0').voz, 1, 'a mais antiga sai');
  assert.equal(Preferencias.audioDe('recem chegada').voz, 0.3, 'a nova fica');
  assert.equal(Preferencias.audioDe(`pessoa ${teto - 1}`).voz, 0.5, 'a mais recente continua');
});

test('esquecer apaga só o que é da sala, e diz que apagou', () => {
  const { Preferencias, dados } = comArmazenamento({ 'algoDeOutroApp': 'preservar' });
  Preferencias.gravar('qualidade', 'ultra');
  Preferencias.guardarAudioDe('Ana', { voz: 0.2, vozMuda: false, tela: 1, telaMuda: false });
  assert.ok(Preferencias.resumo().chaves >= 2);

  assert.equal(Preferencias.esquecerTudo(), true);
  assert.equal(Preferencias.resumo().pessoas, 0);
  assert.equal(Preferencias.resumo().chaves, 0);
  assert.equal(Preferencias.audioDe('Ana').voz, 1);
  // O que não é nosso não se toca: o prefixo existe exatamente para isso.
  assert.equal(dados.get('algoDeOutroApp'), 'preservar');
});
