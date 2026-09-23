// O que uma conta aceita: nome de usuário, apelido, senha, código. Módulo puro, testado sem
// servidor, porque é o tipo de regra que muda de sentido com um caractere e não dá erro.
//
// Três nomes, três papéis (docs/plano-contas.md, seção 4, e seguranca-e-privacidade.md,
// decisão 1):
//   - `usuario` é único e serve para ENTRAR. Sem ele, com apelidos repetíveis, três Anas com
//     senha e o servidor não saberia qual delas conferir.
//   - `apelido` é livre e repetível, e é o que a sala mostra.
//   - `codigo` é permanente e imutável, e é o que distingue a Ana que você conhece das outras.
const crypto = require('node:crypto');
const { ALFABETO } = require('../telemetria/relatos');
const { SENHAS_COMUNS, PALAVRAS_COMUNS } = require('./senhas-comuns');

const USUARIO_MINIMO = 3;
const USUARIO_MAXIMO = 20;
const APELIDO_MAXIMO = 40;
const SENHA_MINIMA = 10;
const SENHA_MAXIMA = 128;
const TAMANHO_DO_CODIGO = 8;
const TAMANHO_DA_RECUPERACAO = 20;

// Nomes que, na mão de qualquer um, pareceriam o próprio Nexo falando.
const RESERVADOS = new Set(['nexo', 'nexodj', 'nexo.dj', 'nexo_dj', 'admin', 'administrador', 'adm', 'suporte',
  'moderador', 'moderacao', 'sistema', 'root', 'painel', 'oficial', 'staff', 'equipe', 'servidor', 'bot']);

function normalizarUsuario(texto) {
  return String(texto ?? '').normalize('NFC').trim().replace(/^@/, '').toLowerCase();
}

// Letras sem acento, números, ponto e sublinhado -- o conjunto que qualquer teclado digita
// igual e que ninguém confunde ao ditar. Maiúsculas viram minúsculas antes de chegar aqui,
// então "Ana" e "ana" são o mesmo usuário: comparar sempre o valor normalizado é o que
// dispensa `LIKE`, que ignora maiúsculas no SQLite e não no Postgres.
function problemaDoUsuario(usuario) {
  if (usuario.length < USUARIO_MINIMO || usuario.length > USUARIO_MAXIMO) return 'tamanho';
  if (!/^[a-z0-9._]+$/.test(usuario)) return 'caracteres';
  if (/^\.|\.$|\.\./.test(usuario)) return 'pontos';
  if (RESERVADOS.has(usuario)) return 'reservado';
  return null;
}

const MENSAGENS_DO_USUARIO = {
  tamanho: `O nome de usuário precisa ter de ${USUARIO_MINIMO} a ${USUARIO_MAXIMO} caracteres.`,
  caracteres: 'Use só letras sem acento, números, ponto e sublinhado no nome de usuário.',
  pontos: 'O nome de usuário não pode começar nem terminar com ponto, nem ter dois seguidos.',
  reservado: 'Esse nome de usuário é reservado. Escolha outro.'
};

// Controles e marcas de direção de texto saem: com eles, um apelido pode inverter o texto ao
// redor na tela de todo mundo, ou parecer vazio sem ser.
function limparApelido(texto) {
  return [...String(texto ?? '').normalize('NFC')
    .replace(/[\p{Cc}​‎‏‪-‮⁦-⁩﻿]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()]
    .slice(0, APELIDO_MAXIMO).join('').trim();
}

// ---------- Senha ----------
//
// Dez caracteres no mínimo, e nenhuma regra de "maiúscula, número e símbolo": ela produz
// `Senha@123` e não segurança. O que se recusa é o que qualquer pessoa tentaria primeiro.
function ehSequenciaOuRepeticao(texto) {
  const pontos = [...texto].map(c => c.codePointAt(0));
  if (new Set(pontos).size <= 3) return true;
  const passo = pontos[1] - pontos[0];
  return Math.abs(passo) === 1 && pontos.every((p, i) => i === 0 || p - pontos[i - 1] === passo);
}

function problemaDaSenha(senha, { usuario = '', apelido = '' } = {}) {
  const texto = String(senha ?? '');
  if ([...texto].length < SENHA_MINIMA) return 'curta';
  if (texto.length > SENHA_MAXIMA) return 'longa';
  const baixa = texto.normalize('NFC').toLowerCase();
  if (SENHAS_COMUNS.has(baixa)) return 'comum';
  // "flamengo2026", "@nexo123456": a palavra comum com enfeite em volta é o mesmo palpite.
  const nucleo = baixa.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (PALAVRAS_COMUNS.has(nucleo)) return 'comum';
  if (ehSequenciaOuRepeticao(baixa)) return 'repetitiva';
  const compacto = nucleo.replace(/\s+/g, '');
  const pessoais = [usuario, limparApelido(apelido).toLowerCase().replace(/\s+/g, '')].filter(p => p.length >= 3);
  if (pessoais.some(p => compacto === p || baixa === p)) return 'pessoal';
  return null;
}

const MENSAGENS_DA_SENHA = {
  curta: `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres. Uma frase curta serve: "cafe com pao no sabado".`,
  longa: `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`,
  comum: 'Essa senha está entre as primeiras que qualquer pessoa tentaria. Escolha outra.',
  repetitiva: 'Essa senha é uma sequência ou uma repetição. Escolha outra.',
  pessoal: 'A senha não pode ser o seu nome de usuário nem o seu apelido.'
};

// ---------- Códigos ----------
//
// O alfabeto é o dos relatos, sem 0/O/1/I/L: os dois códigos vão ser lidos em voz alta e
// digitados à mão, e é aí que esses cinco caracteres viram outra coisa.
function sortear(tamanho) {
  let texto = '';
  for (let i = 0; i < tamanho; i++) texto += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return texto;
}
const gerarCodigo = () => sortear(TAMANHO_DO_CODIGO);
// 31²⁰ são ~99 bits: não precisa de freio próprio para resistir a quem tenta adivinhar, mas
// passa pelo mesmo freio do login de todo modo.
const gerarRecuperacao = () => sortear(TAMANHO_DA_RECUPERACAO);

const emGrupos = (texto, tamanho) => texto.match(new RegExp(`.{1,${tamanho}}`, 'g'))?.join('-') || '';
// 'K7M2PQ4X' guardado; 'K7M2-PQ4X' mostrado.
const formatarCodigo = codigo => emGrupos(String(codigo || ''), 4);
const formatarRecuperacao = codigo => emGrupos(String(codigo || ''), 4);

// Quem digita um código à mão erra hífen, espaço e maiúscula. Nada disso é o código.
function normalizarCodigo(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').split('').filter(c => ALFABETO.includes(c)).join('');
}

module.exports = {
  normalizarUsuario, problemaDoUsuario, MENSAGENS_DO_USUARIO, limparApelido,
  problemaDaSenha, MENSAGENS_DA_SENHA, gerarCodigo, gerarRecuperacao, formatarCodigo,
  formatarRecuperacao, normalizarCodigo,
  USUARIO_MINIMO, USUARIO_MAXIMO, APELIDO_MAXIMO, SENHA_MINIMA, SENHA_MAXIMA, TAMANHO_DO_CODIGO, TAMANHO_DA_RECUPERACAO
};
