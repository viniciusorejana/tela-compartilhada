import React from 'react';
import { Composition } from 'remotion';
import { FPS } from './base/tema';
import { Apresentacao, DURACAO_DA_APRESENTACAO } from './Apresentacao';
import { Lancamento, DURACAO_DO_LANCAMENTO } from './Lancamento';

// Três saídas: a apresentação do modal (16:9) e o lançamento em 16:9 e em pé, para redes.
export function Raiz() {
  return (
    <>
      <Composition id="Apresentacao" component={Apresentacao} durationInFrames={DURACAO_DA_APRESENTACAO} fps={FPS} width={1920} height={1080} />
      <Composition id="Lancamento" component={Lancamento} durationInFrames={DURACAO_DO_LANCAMENTO} fps={FPS} width={1920} height={1080} />
      <Composition id="LancamentoVertical" component={Lancamento} durationInFrames={DURACAO_DO_LANCAMENTO} fps={FPS} width={1080} height={1920} />
    </>
  );
}
