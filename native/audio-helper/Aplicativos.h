#pragma once

// Quais programas tem audio neste computador, para a pessoa escolher qual NAO transmitir.
//
// Fica aqui, e nao dentro do agente, porque os dois caminhos de captura precisam da mesma
// lista: o agente (que roda no PC de cada participante) e o helper (que o servidor executa
// para quem abre a sala na propria maquina do servidor). Antes so o agente sabia listar, e
// quem estava no localhost precisava baixar o agente sem necessidade nenhuma.

#include <Windows.h>
#include <string>
#include <vector>

struct AplicativoComAudio
{
    std::wstring executavel;
    std::wstring nome;      // o nome que o programa declara ("Google Chrome"), nao o arquivo
    bool tocando = false;
    bool padrao = false;    // o navegador de quem compartilha: a escolha automatica
};

// Nome declarado nas informacoes de versao do executavel; cai para o nome do arquivo sem
// extensao quando o programa nao declara nada.
std::wstring NomeAmigavelDoProcesso(DWORD pid, const std::wstring& executavel);

// Raiz da arvore de processos de um programa. A captura exclui a arvore inteira, entao e a
// raiz que precisa ser indicada -- excluir uma aba do Chrome nao adiantaria nada.
DWORD ProcessoRaizDe(const std::wstring& executavel);

// Um item por PROGRAMA (nao por processo): as sessoes de audio do Windows vem por processo
// e um mesmo programa costuma ter varios.
std::vector<AplicativoComAudio> AplicativosComAudio();

// A lista com o navegador garantido no topo, mesmo que ele nao esteja tocando nada: ele e
// a escolha automatica e o destino de volta, e navegador calado nao tem sessao de audio.
std::vector<AplicativoComAudio> AplicativosComAudioComNavegador(const std::wstring& navegador);

std::string ParaUtf8(const std::wstring& texto);
std::string EscaparJson(const std::string& texto);

// {"atual":"...","lista":[{"executavel","nome","tocando","padrao"}, ...]}
std::string ListaEmJson(const std::vector<AplicativoComAudio>& lista, const std::wstring& atual);
