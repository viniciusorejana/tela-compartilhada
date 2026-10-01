import React from 'react';
import { Composition } from 'remotion';
import { FPS } from './base/tema';
import { Apresentacao, DURACAO_DA_APRESENTACAO } from './Apresentacao';
import { Lancamento, DURACAO_DO_LANCAMENTO } from './Lancamento';
import { Reels, DURACAO_DO_REELS } from './reels/Reels';

// A apresentação do modal (16:9), o lançamento em 16:9 e em pé para redes, e o Reels de humor em pé,
// em duas versões (com e sem a voz do narrador).
export function Raiz() {
  return (
    <>
      <Composition id="Apresentacao" component={Apresentacao} durationInFrames={DURACAO_DA_APRESENTACAO} fps={FPS} width={1920} height={1080} />
      <Composition id="Lancamento" component={Lancamento} durationInFrames={DURACAO_DO_LANCAMENTO} fps={FPS} width={1920} height={1080} />
      <Composition id="LancamentoVertical" component={Lancamento} durationInFrames={DURACAO_DO_LANCAMENTO} fps={FPS} width={1080} height={1920} />
      <Composition id="ReelsComVoz" component={Reels} durationInFrames={DURACAO_DO_REELS} fps={FPS} width={1080} height={1920} defaultProps={{ voz: true }} />
      <Composition id="ReelsSemVoz" component={Reels} durationInFrames={DURACAO_DO_REELS} fps={FPS} width={1080} height={1920} defaultProps={{ voz: false }} />
    </>
  );
}
