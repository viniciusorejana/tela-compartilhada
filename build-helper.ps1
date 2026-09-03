$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'native\audio-helper\ApplicationLoopback.vcxproj'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'Visual Studio Build Tools com C++ nao foi encontrado.' }
$vsDevCmd = Join-Path $vsPath 'Common7\Tools\VsDevCmd.bat'
cmd /c "call `"$vsDevCmd`" -arch=x64 && msbuild `"$project`" /p:Configuration=Release /p:Platform=x64 /m"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
