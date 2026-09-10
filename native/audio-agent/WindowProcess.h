#pragma once
#include <Windows.h>
#include <tlhelp32.h>
#include <string>
#include <map>
#include <set>

// Resolve the selected HWND, then walk only parents of the SAME executable.
// This includes Chromium's audio subprocesses without selecting a different running
// instance of the same program or walking up into Explorer/the launcher.
inline DWORD RaizDaJanela(HWND janela)
{
    if (!IsWindow(janela)) return 0;
    DWORD pid = 0;
    GetWindowThreadProcessId(janela, &pid);
    const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;
    std::map<DWORD, PROCESSENTRY32W> processos;
    PROCESSENTRY32W entrada{};
    entrada.dwSize = sizeof(entrada);
    if (Process32FirstW(snapshot, &entrada)) {
        do { processos.emplace(entrada.th32ProcessID, entrada); }
        while (Process32NextW(snapshot, &entrada));
    }
    CloseHandle(snapshot);
    if (!processos.count(pid)) return 0;
    std::set<DWORD> visitados;
    while (visitados.insert(pid).second) {
        const auto& atual = processos.at(pid);
        const auto pai = processos.find(atual.th32ParentProcessID);
        if (pai == processos.end() || _wcsicmp(atual.szExeFile, pai->second.szExeFile) != 0) break;
        pid = pai->first;
    }
    return pid;
}
