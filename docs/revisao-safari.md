# Revisão: Safari, mídia e interface Nexo

Branch: `codex/safari-midia-interface`.

## O que foi encontrado

Não havia logs, modelo do iPhone nem versão do iOS do incidente. Portanto, não é possível
afirmar qual condição ocorreu naquele aparelho. Foram identificados e corrigidos defeitos
que podem produzir o sintoma de tela preta, com regressões reproduzidas em ambiente de teste.

| Defeito no código anterior | Correção |
| --- | --- |
| `ontrack` classificava todo vídeo sem stream reconhecido como câmera. Câmera e tela simultâneas podiam ser confundidas. | Cada offer/answer informa a fonte por MID do transceiver. Os IDs de stream continuam como fallback para clientes antigos. Uma faixa ambígua aguarda identificação. |
| `replaceTrack()` não atualiza necessariamente a associação de stream do receptor; a identificação dependia do ID do novo stream local. | A identidade da fonte acompanha o sender/MID, incluindo pausas e trocas de dispositivo/tela. |
| Os vídeos recebiam todas as faixas do stream, inclusive áudio, embora o som já tivesse elementos próprios. | Prévia e palco recebem exclusivamente faixas de vídeo, com `muted` e `playsinline` definidos antes de vincular o stream. |
| O palco ocultava “recebendo vídeo” assim que havia uma faixa, antes de saber se havia imagem reproduzida. | Estado de espera acompanha eventos de reprodução, dimensões e `readyState`; recuperação aparece quando a imagem demora. |
| O botão “Ativar som” escondia o aviso mesmo se a nova tentativa falhasse e não retomava todas as miniaturas. | Todas as mídias são retomadas diretamente no gesto. Falhas de autoplay mantêm o aviso; `AbortError` de troca de stream não é tratado como bloqueio de permissão. |
| O socket podia conectar enquanto `/api/rtc-config` estava pendente, antes da instalação do listener de conexão. | O socket só conecta depois da configuração e dos listeners, com prazo de espera para a configuração. |
| Rejeições de `replaceTrack()` não eram tratadas. | Trocas serializadas por par; `InvalidModificationError` usa remoção/adição da faixa e renegociação. |

H.264 baseline com packetization mode 1 recebe prioridade quando disponível, preservando
VP8, VP9 e os codecs auxiliares como alternativas. Isso favorece interoperabilidade, mas
**não comprova que o problema original era um codec**.

O autoplay de vídeo no iOS depende de áudio, visibilidade e gesto de reprodução; não basta
adicionar `autoplay`. A política está documentada pelo
[WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/).
Eventos de faixa podem não trazer streams, conforme a
[documentação de RTCTrackEvent](https://developer.mozilla.org/en-US/docs/Web/API/RTCTrackEvent/streams).
Algumas trocas de faixa exigem renegociação, conforme a
[documentação de replaceTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack).

## Outros defeitos corrigidos

- **Injeção de HTML nos nomes:** nomes e iniciais agora entram como texto, inclusive nas listas e avatares novos.
- **Convites locais:** `PUBLIC_URL` passa a fornecer a origem pública aos clientes. Sem ela, permanece a origem atual; nenhum domínio do Funnel é adivinhado.
- **Áudio do agente:** o servidor descartava o campo `modo` na resposta de aplicativos, fazendo um agente atualizado parecer antigo. O campo validado é preservado.
- **Cancelamento da troca de tela:** o seletor abre antes de encerrar a captura de áudio existente. Cancelar mantém a transmissão atual.
- **Limpeza e recuperação:** timer de início é encerrado ao remover um par; falhas definitivas de mídia não removem silenciosamente a pessoa da lista da sala.
- **Som da tela:** a escolha considera fontes atualmente anunciadas, sem contar streams de compartilhamentos encerrados.
- **Chat desconectado:** o rascunho de texto é preservado e a interface pede reconexão antes do envio.
- **Armazenamento indisponível:** bloquear o armazenamento local não impede a entrada; a preferência e o pareamento ficam limitados à sessão.
- **Dependências do servidor:** atualizado o lockfile para corrigir os alertas de `body-parser`, `socket.io-parser` e `qs`. O override de `express > qs` para `^6.16.0` é necessário porque Express 4.22.2 declara `~6.15.1`. Reavaliar o override quando o Express atualizar essa dependência.

## Interface

Nexo é a nova identidade visual, com navegação lateral inspirada em salas de comunicação,
palco para transmissões, lista do squad, status de voz, contador de sessão e indicação de
telas ao vivo. Os indicadores usam a atividade real da sala.

O celular tem navegação recolhível, chat em painel, controles compactos e envio de imagens
pelo seletor de arquivos. As janelas têm rótulos e controle de foco por teclado. A entrada
mantém câmera/microfone desligados e explica isso antes da conexão. O início mostra salas
recentes efetivamente visitadas, somente neste navegador. As telas locais de endereço e
seleção do Electron acompanham a paleta.

## Validação automatizada

- Regras unitárias de associação de faixas com e sem stream, MID estável, vínculo de vídeo
  sem áudio, prioridade de codecs e composição segura do convite.
- Chromium: transmissão WebRTC com captura sintética, espectador chegando depois de câmera
  e tela já ativas, eventos sem streams, quadros realmente decodificados, recuperação de
  autoplay negado, substituição/parada/reinício de tela, erro de `replaceTrack`, mídia nos
  dois sentidos, reconexão do socket, chat, nomes como texto, modo do agente e diagnóstico.
- WebKit 26.5 para Windows: navegação, chat, diálogos e layout móvel. Esse build não oferece
  WebRTC, portanto o teste informa **somente validação de interface**.
- Conferência visual de início, sala desktop, sala móvel e orientação paisagem.
- `npm audit` na raiz: **0 vulnerabilidades** após atualizar as dependências.

Os testes não exercitam captura WASAPI por processo, dispositivos físicos, redes móveis,
um servidor TURN real nem um iPhone. O helper e o agente foram compilados em Release x64;
o Electron foi empacotado em `app/dist/SalaCompartilhada.exe`.

## Validacao em um iPhone real

1. No host, inicie esta branch e mantenha o Funnel ativo. Defina `PUBLIC_URL` para o endereço
   HTTPS real antes de iniciar o Node. Atualize/reabra a página nos dois participantes para
   evitar misturar uma página antiga em memória com os scripts novos.
2. Compartilhe uma tela pelo Windows **antes** do iPhone entrar. No Safari, abra o convite,
   entre sem ativar microfone/câmera e confira a imagem. Toque em **Ativar reprodução** caso
   o navegador peça uma ação.
3. Ligue também a câmera do Windows. Alterne entre tela e câmera pelos cartões. Troque a
   origem da tela, pare e reinicie a transmissão.
4. Teste receber tela com áudio, colocar o Safari em segundo plano e voltar, e mudar entre
   Wi-Fi e rede móvel. No celular, não poder **transmitir** a própria tela é diferente de
   não poder **assistir** à tela de outra pessoa.
5. Se falhar, abra **Ver diagnóstico** (ou a opção na lateral), copie o relatório e informe
   o modelo, a versão do iOS e a rede usada. O relatório exclui IPs, endereço da sala,
   mensagens e credenciais.

| Evidência | Próxima investigação |
| --- | --- |
| Servidor conectado, ICE falhou/continua negociando, sem bytes de vídeo | NAT/firewall; configurar/verificar TURN e comparar Wi-Fi com rede móvel. |
| ICE conectado, bytes de vídeo recebidos, zero quadros decodificados após aguardar | Negociação do codec ou decodificação; conferir codec e versão do iOS. |
| Quadros decodificados, palco pausado ou aviso de reprodução | Autoplay/visibilidade; retomar pelo botão e comparar após voltar à página. |
| Câmera aparece, tela anunciada mas sem faixa identificada | Conferir MIDs no relatório e se todos recarregaram a versão nova. |

HTTPS do Tailscale Funnel entrega o site e a sinalização. **Ele não retransmite a mídia
WebRTC nem substitui TURN.** Sem TURN configurado, algumas redes continuam sem conseguir
estabelecer mídia direta. Esta revisão não instala um relay nem inventa credenciais.

Permanecem as limitações arquiteturais: malha P2P voltada a grupos pequenos e sala sem
autenticação/controle de acesso. O link é o convite; nomes não são identidades verificadas.


## Saída da sala, janelas e áudio

- Os links de retorno e o botão Sair encerram faixas, conexões e captura de áudio. O cliente
  aguarda a confirmação de `leave-room` antes de navegar. `pagehide` desconecta também ao
  fechar/trocar a página; uma restauração pelo histórico recarrega o estado. Testes verificam
  sair/reentrar sozinho (incluindo descarte do histórico da sala vazia) e acompanhado.
- A coluna de servidores foi retirada. A lateral restante contém a sala atual, participantes,
  chat e convite. Voz e volume usam ícones vetoriais; o executável recebe a marca Nexo.
- O Electron prepara um pedido por tipo e por frame principal. `desktopCapturer.getSources`
  recebe apenas `window` ou apenas `screen`. Pedidos concorrentes, tipos inválidos e pedidos
  de outros frames são rejeitados. Cancelar não altera a transmissão anterior.
- O HWND da janela escolhida é resolvido pelo agente para seu processo, subindo apenas pais
  do mesmo executável. O cliente usa `incluir-pid` e aguarda o agente confirmar esse modo
  antes de começar a captura. A árvore desta aplicação não pode ser selecionada para áudio.
  Identificação indisponível ou agente antigo resulta em vídeo sem áudio, com aviso.
- Isso isola o **programa/árvore de processos**, não uma janela de áudio independente:
  janelas e abas do mesmo processo podem compartilhar o som. O seletor de abas foi retirado
  do Electron porque a API não enumera abas de outros navegadores. Referência:
  [desktopCapturer do Electron](https://www.electronjs.org/docs/latest/api/desktop-capturer).
- No navegador, a seleção de janela solicita `windowAudio: window`, exclui áudio do sistema
  e sugere ocultar monitores. A fonte retornada é verificada quando o navegador informa
  `displaySurface`; uma escolha de outro tipo é descartada. Os navegadores controlam seu
  próprio seletor e podem ignorar sugestões. Sem suporte a áudio da janela, segue só vídeo.

## Redução inteligente de ruído

O gate dependente de `requestAnimationFrame` foi substituído por RNNoise 0.2, distribuído
pelo pacote fixado `@jitsi/rnnoise-wasm@0.2.1`, em um AudioWorklet mono de 48 kHz. Os pesos
são servidos pela própria aplicação, sem CDN, conta, cota ou inferência no servidor. O
módulo só carrega quando o microfone é ativado. Referência do empacotamento:
[jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm).

O processamento usa blocos de 480 amostras, buffers fixos e não depende da aba estar visível.
Mudo interrompe o trabalho do modelo; desligar o filtro ou trocar o microfone libera o
processador/contexto. Se o módulo falhar ou o contexto estiver suspenso, a faixa original
continua com a supressão/cancelamento de eco do navegador. **Dispositivos → RNNoise ativo**
permite alternar para o filtro padrão. O áudio de jogos/telas não passa pelo RNNoise.

Medição local de uma execução: **5 s de áudio sintético em 213 ms**, aproximadamente 4,3%
de um núcleo no ensaio; a atenuação do ruído branco foi 67,2 dB. Esses números são de um
sinal sintético sem voz e **não** demonstram preservação de timbre nem equivalência ao Krisp.
A adaptação entre blocos de 128 e 480 amostras tem **10 ms de buffer**, verificados por uma
sequência contínua em teste. O modelo, reamostragem e dispositivo acrescentam atraso;
a latência total da chamada não foi medida. Não há promessa de latência zero.

O teste também instancia o AudioWorklet real no Chromium, alterna os filtros, verifica mudo
e simula falha de carregamento. Falta comparar fala real com ventilador, teclado, música e
microfones distintos, inclusive em celular mais lento. RNNoise pode alterar o timbre ou
reduzir sons desejados; o botão permite comparar os dois modos durante a conversa.

As licenças estão disponíveis em `/licenses/RNNoise.txt` (RNNoise) e
`/vendor/rnnoise-LICENSE` (distribuição WASM do Jitsi).

## Verificações adicionais e atualização

- `npm test`: regras de mídia e RNNoise real, incluindo processamento e continuidade de buffer.
- `npm run test:browser`: comunicação, ciclo de saída, política de áudio da janela, transmissão
  de `incluir-pid` antes da captura e bloqueio de fallback amplo em agente antigo simulado.
- `npm run test:electron`: Electron/preload reais, perfil isolado, janelas de teste ocultas,
  fontes sintéticas, filtros de tipo, cancelamento e resolução nativa do HWND próprio.
  Não captura tela, som ou dispositivos físicos de quem executa.
- `npm run build:helper`: compilação dos dois executáveis nativos.
- Na pasta `app`, `npm run empacotar`: pacote portátil Windows x64 com agente atualizado.

Para testar esta revisão, reinicie o servidor nesta branch, recarregue as páginas e feche
completamente o Electron antigo antes de abrir o novo executável. Se usar o agente avulso,
substitua também essa versão. O teste final deve comparar áudio de dois programas diferentes:
compartilhando a janela do primeiro, só ele deve ser ouvido. Duas abas do mesmo navegador
podem compartilhar o som no modo de programa; use o seletor de abas do Chrome/Edge para
isolar uma guia. O roteiro de iPhone acima continua necessário.


## Complemento: qualidade adaptativa e controles (09/09/2026)

A captura fixa em 1280×720 foi substituída pelos perfis 720p/4 Mbps, 1080p/8 Mbps e
1440p/14 Mbps, todos com alvo/teto de 30 fps. O orçamento global calculado a partir do
pior participante foi removido: cada par acompanha o transporte ICE selecionado e ajusta
seu próprio orçamento. O limite de upload escolhido pelo remetente é repartido apenas
quando a soma ultrapassa a parcela reservada para vídeo (85% do valor informado).

O teste encontrou retenção da resolução baixa escolhida no início pelo adaptador do
navegador. A tela agora usa escala explícita por sender, escolhida pela banda e com
histerese, e preferência de manter essa resolução até a próxima adaptação. A captura
continua em até 30 fps; congestionamento e CPU podem baixar o fps real. Câmera mantém sua
adaptação nativa priorizando movimento. H.264 e os fallbacks existentes foram preservados.
As mudanças de parâmetros são serializadas e a captura de origem não é reduzida para
todos em função de um único espectador. As estatísticas da interface são de envio; não
medem a experiência final, CPU ou tempo de renderização no aparelho remoto.

O teste Chromium recebe e decodifica 1920×1080, muda o perfil durante a transmissão e
confere o limite de 30 fps nos parâmetros de envio. Testes puros verificam redução e
recuperação independentes, limite agregado de upload e histerese da resolução. Isso não
substitui ensaio em redes móveis, sob perda de pacotes, CPU limitada ou iPhone real.
Não foi adicionado relay/SFU, simulcast ou serviço externo; a malha continua adequada
para grupos pequenos e sua carga cresce por participante.

O bloqueio de esconder controles por hover e foco decorrente de clique foi removido.
Somente foco por teclado mantém a barra visível. O teste entra em fullscreen, clica no
controle, aguarda ocultação e verifica recuperação por mouse e acessibilidade por teclado.

Referência de parâmetros de envio e seus limites:
[RTCRtpSender.setParameters](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters).
As alterações deste complemento são servidas pelo site: recarregar a sala atualiza também
o Electron, sem precisar reconstruir o executável desta revisão.
# Atualização: tela compartilhada no iPhone (9 de setembro de 2026)

O relato de campo continua sendo ausência da tela compartilhada no Safari do iPhone 12/13. Ainda não há diagnóstico coletado desse aparelho que comprove a causa. Os arquivos JavaScript e CSS servidos pelo endereço público foram comparados com os locais e estavam atualizados.

- A faixa de tela agora prioriza VP8, com H.264 e demais codecs preservados como alternativas. A câmera continua priorizando H.264, exceto quando divide um transceptor com uma tela no sentido oposto. A seleção considera a fonte enviada e o MID recebido, não o nome do navegador.
- Oferta, resposta e candidatos ICE passam por uma fila por conexão. Isso impede que uma descrição gerada por `createOffer`/`createAnswer` fique desatualizada enquanto outro evento muda o estado da conexão. O teste de mídias simultâneas que antes falhava passou após essa correção.
- O diagnóstico identifica a revisão `screen-vp8-serial-1`, a última categoria de erro de sinalização, direções dos transceptores e contadores de recepção/decodificação por MID, sem incluir SDP, IPs ou credenciais.

Para validar: recarregar o emissor (inclusive Electron) e o Safari, entrar novamente na sala e reiniciar a transmissão. Não requer empacotar outro executável. Se persistir, copiar o diagnóstico do iPhone enquanto a tela está anunciada e sem imagem. A validação automatizada de mídia usa Chromium real; WebKit no Windows só valida interface, pois essa distribuição não disponibiliza WebRTC. A mudança de codec é uma medida de compatibilidade, não uma confirmação de que H.264 causou o problema nesse aparelho.

# Atualização: rota entre redes, codec e câmera do celular (9 de setembro de 2026)

Branch: `codex/turn-codec-camera`. Revisão de mídia: `turn-codec-camera-1`.

## O que o diagnóstico do Safari mostrou

Pela primeira vez houve um relatório colhido durante a falha. Ele é conclusivo sobre **onde** o
fluxo morre, e descarta codec como causa:

- `signalingState=stable`, transceptores com `currentDirection=recvonly` negociada, faixas
  `screen` e `screenAudio` `live` e identificadas por MID. **A sinalização funcionou.**
- `bytes=0`, `keyframes=0`, `PLI=0` nas duas conexões. Não é "chegou e não decodificou"
  (`bytes>0` com `framesDecoded=0`), que seria a assinatura de um codec incompatível.
  **Nenhum pacote de mídia chegou.**
- Nenhuma linha `Rota:`. O relatório só a imprime quando existe par de candidatos selecionado.
  **Nenhum caminho foi escolhido**, e `ICE=checking` nas duas conexões confirma.
- Primeira linha do relatório: `TURN configurado: não`.

Sem relay, a mídia depende de furar o NAT dos dois lados. Basta **um** ser NAT simétrico ou
CGNAT — o normal em fibra residencial e em rede móvel no Brasil — para todos os *connectivity
checks* falharem. Na rede do host funciona porque os candidatos *host* da LAN se alcançam.
O Tailscale Funnel entrega a página e a sinalização; ele não carrega a mídia.

O relatório veio de um simulador de iPhone hospedado em datacenter, ambiente naturalmente
restritivo para UDP. Ele prova que o Safari negocia corretamente e que o transporte não fecha;
não prova que o iPhone real falha pelo mesmo motivo. O modo "forçar TURN" abaixo fecha essa
lacuna. **Uma pergunta ainda encurtaria o diagnóstico: nesses iPhones, o áudio de voz dos
outros é ouvido?** Se for, o ICE conecta e a hipótese de NAT cai.

## Conectividade

| Defeito ou lacuna | Correção |
| --- | --- |
| Candidato ICE recebido enquanto `ignoreOffer` estava ligado era descartado. Ele pertence à negociação anterior, que continua valendo — e isso prende o ICE em `checking`. | Sempre aplica o candidato; o erro só é silenciado enquanto a oferta está sendo ignorada, como na negociação perfeita de referência. |
| Conexão presa em `connecting` não dispara evento nenhum: nem `failed`, nem `disconnected`. Nada explicava a espera. | Vigia por par: 15 s tenta `restartIce()`, 30 s nomeia a falta de TURN e abre o diagnóstico. |
| Um único STUN é ponto único de falha: bloqueado, só a mesma LAN funciona. | Três servidores independentes por padrão, configuráveis por `STUN_URLS`. |
| `/api/rtc-config` é público e entregava usuário e senha fixos do TURN a quem abrisse a URL. | Credencial de prazo curto assinada com HMAC (`TURN_STATIC_AUTH_SECRET`), o padrão *TURN REST API* que o coturn implementa com `use-auth-secret`. Credencial fixa continua aceita. |
| Não havia como saber se o TURN respondeu, nem como provar que ele resolve. | O relatório conta os candidatos de relay coletados, e **Forçar retransmissão pelo TURN** refaz as conexões usando só o relay. |
| `onnegotiationneeded` desistia em silêncio quando a fila o atrasava para além de `stable`. | Reagenda para a volta a `stable`. Endurecimento: o navegador costuma redisparar sozinho. |

Instalação, firewall e verificação do coturn em [`docs/turn.md`](turn.md). **Ele só funciona com
endereço público alcançável**: atrás de CGNAT nenhum túnel HTTPS substitui isso, e o documento
começa pelo teste que decide.

## Codec

Não existe API no WebRTC do navegador para escolher o encoder de hardware.
`setCodecPreferences` escolhe o **codec**; usar NVENC, Quick Sync ou AMF é decisão do Chromium
a partir do codec, da resolução e dos drivers. **A placa de vídeo não corrige `bytes=0`.**

O que a escolha muda: H.264 é o único codec decodificado por hardware no iPhone
(VideoToolbox) e o que mais chega ao encoder da GPU no Windows; VP8 é software nos dois lados.
A prioridade VP8 para tela introduzida em `screen-vp8-serial-1` era, portanto, a pior das duas
opções para um receptor iPhone, no fluxo mais pesado da sala. O padrão automático voltou a
H.264 baseline / packetization-mode 1.

Um seletor **Automático / H.264 / VP8 / VP9 / AV1** aparece em Dispositivos e no painel de
compartilhamento. Ele **só reordena**: nenhum codec sai da lista, então quem não suporta a
escolha recebe pelo melhor codec em comum em vez de ficar sem imagem. Como é a resposta que
fecha a negociação, a escolha de quem transmite viaja junto do `mediaInfo` — sem isso o
receptor reordenaria tudo de volta e o seletor não teria efeito. Trocar durante a transmissão
renegocia.

O diagnóstico passou a mostrar `encoderImplementation` / `powerEfficientEncoder` de quem envia
e `decoderImplementation` / `powerEfficientDecoder` de quem recebe. É a única evidência
objetiva de que a GPU está sendo usada; onde o navegador não informa, o relatório diz
"não informado" em vez de afirmar.

## Câmera do celular

Botão **Virar câmera** na barra de controles, visível quando há mais de uma câmera e o
navegador aceita `facingMode`. A troca tenta primeiro `applyConstraints` na faixa existente —
no Safari isso vira a câmera sem renegociar, sem `replaceTrack` e sem `onended`. Se não der,
reabre: **a faixa antiga é encerrada antes** do `getUserMedia`, porque no iOS abrir a segunda
câmera com a primeira viva congela a primeira. Falhando a nova, a anterior é reaberta.

Dois defeitos apareceram durante o teste e foram corrigidos: `trocarCamera()` abria a nova
antes de parar a antiga — a mesma ordem que quebra no iPhone —, e `abrirCamera()` caía num
fallback de "qualquer câmera" que fazia virar a câmera reabrir a mesma e ainda anunciar que
tinha virado. O lado anunciado agora vem do que a faixa realmente entrega, quando o navegador
informa. A preferência de lado só é guardada quando a pessoa vira a câmera: quem nunca virou
mantém o comportamento anterior, e webcams de mesa não recebem um `facingMode` que ninguém
pediu.

## Validação

`npm test` (24 casos), `npm run test:browser` (Chromium real), `TEST_BROWSER=webkit` (só
interface: essa distribuição não tem WebRTC), `npm run test:electron`, `npm run test:download`,
`npm audit` sem vulnerabilidades. Casos novos: candidato ICE sobrevivendo a uma oferta ignorada;
vigia de conexão travada; troca de codec ao vivo verificada pelo `getStats` do receptor nos dois
sentidos; virada de câmera parando a faixa antiga primeiro e recuperando quando a outra falha;
`/api/rtc-config` com HMAC conferido contra o cálculo do coturn e sem o segredo na resposta.

**O que nada disso testa:** um iPhone real, redes móveis, um coturn no ar. O teste que decide
continua sendo o do aparelho: entrar pela rede que falhava, abrir Diagnóstico e comparar
`bytes` e `quadros decodificados` com o relatório desta página. Sem TURN configurado, o sintoma
nesses iPhones continua — a diferença é que agora a sala diz isso em vez de esperar calada.
