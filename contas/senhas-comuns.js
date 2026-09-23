// Senhas que aparecem no topo de todo vazamento, só as de 10 caracteres ou mais -- as menores
// já são recusadas pelo tamanho. A lista não tenta ser completa: ela existe para barrar o
// primeiro palpite de quem tenta adivinhar, que é sempre um destes.
//
// Sem dependência de propósito: uma lista de milhões de linhas pesaria mais que o servidor
// inteiro para pegar o mesmo punhado de casos que as regras de padrão (regras.js) já pegam.
const SENHAS = `
1234567890 0123456789 1234567891 12345678910 123456789a a123456789 123456789q 1234567890a
0987654321 9876543210 1111111111 0000000000 2222222222 1212121212 1122334455 1231231231
123123123123 1234512345 1234554321 0102030405 1020304050 1357924680 1029384756 5555555555
qwertyuiop qwertyuiop1 qwerty1234 qwerty12345 qwerty123456 1qaz2wsx3edc 1q2w3e4r5t
1q2w3e4r5t6y 1qazxsw23edc zaq12wsxcde zaq1zaq1zaq1 asdfghjkl1 asdfghjklç asdfasdfasdf
qazwsxedcrfv q1w2e3r4t5 q1w2e3r4t5y6 poiuytrewq mnbvcxzasd zxcvbnm123 zxcvbnmasd
abcdefghij abcdefghijk abcd123456 abc1234567 abcdef1234 abcabcabcabc aaaaaaaaaa
password12 password123 password1234 password12345 passw0rd12 p@ssw0rd123 p@ssword123
mypassword mypassword1 thepassword secretpassword senhasecreta minhasenha minhasenha1
minhasenha123 senha12345 senha123456 senhasenha senhaforte senhaforte123 novasenha123
iloveyou12 iloveyou123 teamo12345 teamomuito eutelamo123 euteamo123 amormeu123 meuamor123
princesa12 princesa123 sunshine12 sunshine123 football12 football123 baseball12
basketball superman12 superman123 batman1234 batman12345 spiderman1 spiderman12
starwars12 starwars123 pokemon123 pokemon1234 minecraft1 minecraft12 minecraft123
fortnite12 fortnite123 roblox1234 roblox12345 freefire12 freefire123 valorant12
leagueoflegends counterstrike playstation playstation1 playstation2 playstation3
playstation4 playstation5 nintendo12 xbox360123 gamer12345 corinthians corinthians1
corinthians10 flamengo10 flamengo123 flamengo1234 palmeiras1 palmeiras10 palmeiras123
saopaulo10 saopaulo123 santosfc123 vasco12345 vascodagama gremio1234 internacional
cruzeiro12 cruzeiro123 atleticomg botafogo12 botafogo123 fluminense fluminense1
brasil1234 brasil2022 brasil2023 brasil2024 brasil2025 brasil2026 brasil12345
riodejaneiro saopaulosp belohorizonte portoalegre jesus12345 jesuscristo deusefiel
deusefiel1 deuseamor123 deuseamor gabriel123 gabriel1234 matheus123 lucas12345 pedro12345
rafael1234 felipe1234 bruno12345 gustavo123 guilherme1 guilherme12 guilherme123 leonardo12
fernanda12 juliana123 mariana123 camila1234 beatriz123 larissa123 amanda1234 letmein123
welcome123 welcome1234 changeme123 trustno123 master12345 administrator admin12345
admin123456 administrador root123456 dragon1234 monkey1234 shadow1234 michael123
jennifer12 qwe123qwe123 asd123asd123 zxc123zxc123 abc123abc123 nexo123456 nexo1234567
nexonexo12 nexosenha1 tela123456 telacompartilhada salacompartilhada discord123
discord1234 whatsapp123 instagram1 instagram123 facebook12 facebook123 google1234
youtube123 twitter123 internet123 computador computador1 computador123 notebook12
celular123 telefone12 teclado123 iphone1234 samsung123 senha@12345 senha#12345
`;

// Palavras que, sozinhas ou com números em volta, são o palpite número um: "flamengo2026",
// "Senha@2025!", "nexo_123456". Recusadas quando são tudo o que há na senha além de
// dígitos e símbolos.
const PALAVRAS = `
senha password passw0rd p@ssword p@ssw0rd pass qwerty qwertyuiop asdfgh asdfghjkl zxcvbn
admin administrador root nexo tela sala teste test iloveyou teamo amor meuamor princesa
flamengo corinthians palmeiras saopaulo santos vasco gremio inter internacional cruzeiro
atletico botafogo fluminense bahia sport brasil jesus deus gabriel lucas pedro maria
football futebol pokemon minecraft fortnite roblox freefire valorant discord whatsapp
google youtube facebook instagram dragon monkey shadow master welcome batman superman
`;

const lista = texto => new Set(texto.split(/\s+/).map(s => s.trim().toLowerCase()).filter(Boolean));

module.exports = { SENHAS_COMUNS: lista(SENHAS), PALAVRAS_COMUNS: lista(PALAVRAS) };
