# TURN próprio com coturn

O Nexo manda a mídia direto de um participante para o outro. Quando as duas pontas estão em
redes diferentes, isso exige furar o NAT dos dois lados. Se **um** deles for NAT simétrico ou
CGNAT — o normal em fibra residencial e em rede móvel no Brasil — a conexão nunca fecha e o
diagnóstico mostra a assinatura disto:

```
ICE=checking          → nenhum par de candidatos foi selecionado
bytes=0               → nenhum pacote de mídia chegou
(sem linha "Rota:")   → não existe caminho escolhido
```

Um servidor TURN resolve isso retransmitindo a mídia. **O Tailscale Funnel e o Cloudflare
Tunnel não substituem TURN**: eles entregam a página e a sinalização por HTTPS, e o vídeo não
passa por lá.

---

## Antes de instalar: seu IP é público?

Um relay TURN precisa de um endereço alcançável de fora para as portas de relay. **Atrás de
CGNAT ele não funciona**, e nenhum túnel HTTPS contorna isso.

Compare o IP WAN que aparece na página de administração do seu roteador com:

```bash
curl -s https://api.ipify.org
```

| Resultado | O que fazer |
| --- | --- |
| Os dois iguais | IP público. Siga para a instalação. |
| Diferentes, ou o WAN começa em `100.64.`–`100.127.` | CGNAT. Peça IP público ao provedor ou hospede o coturn numa VPS. |

Numa VPS, tudo abaixo vale igual — troque `SEU_IP_PUBLICO` pelo IP dela e use o endereço dela
em `TURN_URLS`.

---

## 1. Gerar o segredo

O Nexo usa credenciais de prazo curto (o padrão *TURN REST API*, que o coturn implementa como
`use-auth-secret`). O segredo fica só no servidor; o que chega ao navegador é um HMAC dele,
com validade de poucas horas. Sem isso, `/api/rtc-config` — que é público, porque a sala não
tem login — entregaria uma senha permanente do seu TURN a qualquer pessoa com o link.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Guarde essa saída. Ela vai nos dois lados: no `turnserver.conf` e no ambiente do Node.

## 2. `turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=COLE_O_SEGREDO_AQUI
realm=nexo.local
# Endereço público / endereço da placa de rede local. Numa VPS com IP direto, só o público.
external-ip=SEU_IP_PUBLICO/SEU_IP_LOCAL
# Faixa das portas de relay: precisa estar liberada no firewall junto com 3478 e 5349.
min-port=49160
max-port=49200
no-multicast-peers
# Não é um proxy aberto: sem isto, alguém usaria seu servidor para alcançar sua rede interna.
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
no-cli
```

Para `turns:` (TLS), acrescente `cert=` e `pkey=` apontando para um certificado válido do seu
domínio. Sem certificado, use apenas `turn:` — a mídia WebRTC já é criptografada de ponta a
ponta por DTLS-SRTP; o TLS aqui serve para atravessar redes que só liberam a porta 443.

## 3. Rodar no Windows

O coturn não tem build oficial para Windows. Duas formas que funcionam:

**Docker Desktop** — a mais direta:

```bash
docker run -d --name nexo-turn --restart unless-stopped --network host -v C:/nexo/turnserver.conf:/etc/coturn/turnserver.conf coturn/coturn -c /etc/coturn/turnserver.conf
```

Se `--network host` não estiver disponível na sua instalação, troque por mapeamento explícito:
`-p 3478:3478/udp -p 3478:3478/tcp -p 5349:5349/tcp -p 49160-49200:49160-49200/udp`.

**WSL2** — `sudo apt install coturn`, coloque o arquivo em `/etc/turnserver.conf`, ligue
`TURNSERVER_ENABLED=1` em `/etc/default/coturn` e `sudo systemctl start coturn`. Como o WSL2
tem rede própria, será preciso encaminhar as portas do Windows para a VM (`netsh interface
portproxy`, ou *mirrored networking* no Windows 11). Por isso o Docker costuma dar menos
trabalho.

## 4. Firewall e roteador

Libere, para o IP do servidor:

| Porta | Protocolo | Para quê |
| --- | --- | --- |
| 3478 | UDP e TCP | TURN |
| 5349 | TCP | TURN sobre TLS (só se usar `turns:`) |
| 49160–49200 | UDP | portas de relay (a faixa do `min-port`/`max-port`) |

No Windows, tanto o firewall do sistema quanto o encaminhamento de portas do roteador
precisam apontar para a máquina do coturn.

## 5. Apontar o Nexo para ele

Antes de iniciar o Node:

```powershell
$env:TURN_URLS="turn:seu-endereco:3478,turns:seu-endereco:5349"
$env:TURN_STATIC_AUTH_SECRET="o mesmo segredo do turnserver.conf"
$env:TURN_TTL="7200"
npm start
```

`TURN_TTL` é a validade da credencial em segundos (padrão 7200). Ela vale para obter a
alocação; quem já está na sala continua com a conexão aberta depois de expirar.

## 6. Provar que funcionou

Configurar não é o mesmo que funcionar. O teste que decide:

1. Entre na sala, abra **Diagnóstico** e confira `TURN configurado: sim`.
2. Confira `Candidatos de relay coletados aqui`. Se for **0**, o navegador não conseguiu falar
   com o coturn — o serviço está fora do ar, a porta está fechada, ou o segredo não bate.
3. Marque **Forçar retransmissão pelo TURN**. As conexões são refeitas usando só o relay. Se a
   imagem aparecer assim, o TURN está funcionando de ponta a ponta.
4. Desmarque. Se a imagem some naquela rede, está confirmado: o que faltava era rota, e o TURN
   é o que resolve.

Também dá para conferir pelo lado de fora, em <https://icetest.info/> ou no *Trickle ICE* do
WebRTC samples, colando a URL, o usuário e a credencial que aparecem em `/api/rtc-config`.

## Custo

Com TURN, **toda a mídia daquela conexão passa pelo servidor** — o dobro do tráfego (entra e
sai) e latência um pouco maior. Ele só é usado quando não há caminho direto; conexões que
funcionam sozinhas continuam diretas. Numa VPS medida por tráfego, uma transmissão de tela a
8 Mbps consome cerca de 7 GB por hora, por espectador que precise do relay.

## Referências

- [coturn](https://github.com/coturn/coturn) — servidor e o `turnserver.conf` completo
- [RFC 8656](https://datatracker.ietf.org/doc/html/rfc8656) — TURN
- [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) — testar credenciais fora do Nexo
