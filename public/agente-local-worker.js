'use strict';

// A conexão direta com o agente de áudio, FORA do fio principal da página.
//
// O PCM chega em ~100 mensagens por segundo, e antes cada uma passava pelo fio principal --
// o mesmo que desenha a sala, decodifica o chat e roda o LiveKit. Qualquer engasgo dele
// segurava o som, e o reprodutor secava: medido com a página travando 30 a 110 ms, foram 124
// buracos em dois minutos. Aqui o som vai do WebSocket direto para o reprodutor, por uma
// porta própria, sem esperar pela página.
//
// Um Worker por tentativa: quando a conexão cai, a página encerra este e abre outro. Nada de
// estado para desfazer.

let porta = null;

onmessage = ({ data }) => {
  if (!data?.url || !data.porta) return;
  porta = data.porta;
  let ws;
  try { ws = new WebSocket(data.url); }
  catch (_) { postMessage({ evento: 'fechado' }); return; }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => postMessage({ evento: 'aberto' });
  ws.onmessage = ({ data: pcm }) => {
    if (pcm instanceof ArrayBuffer) porta.postMessage(pcm, [pcm]);
  };
  ws.onclose = () => postMessage({ evento: 'fechado' });
};
