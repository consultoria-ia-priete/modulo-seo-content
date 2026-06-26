# 🪟 Instalando no Windows

A boa notícia: o **Claude Code e as skills funcionam igual** no Windows. Só o ambiente
(instalar as ferramentas e os caminhos) muda um pouco. Siga isto **uma vez**.

## 1. Instale as ferramentas (10 min)

Abra o **PowerShell** e instale o gerenciador de pacotes + as ferramentas:

```powershell
# Winget já vem no Windows 10/11. Instale o que faltar:
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install GitHub.cli
```

Depois instale o **Claude Code** (siga claude.com/claude-code) e rode `claude` uma vez
pra logar. Autentique o GitHub: `gh auth login`.

> Recomendado: use o **Git Bash** (vem com o Git) pra rodar os scripts `.sh` deste repo.
> Alternativa: **WSL** (Ubuntu dentro do Windows) — aí é idêntico ao macOS.

## 2. Mapa de caminhos (macOS → Windows)

| macOS | Windows |
|---|---|
| `~/` ou `/Users/voce/` | `%USERPROFILE%\` ou `C:\Users\voce\` |
| `~/.claude/` | `%USERPROFILE%\.claude\` |
| `/Users/Shared/` | `C:\ProgramData\` |

Os comandos `git`, `node`, `npx`, `gh`, `claude` são **os mesmos** nas duas plataformas.

## 3. Rodando os scripts deste repo

- Pelo **Git Bash** ou **WSL**: `bash scripts/scan-secrets.sh .` funciona igual.
- `chmod 600` (permissão de segredo no macOS) não existe igual no Windows — os arquivos
  de segredo já ficam protegidos pela sua conta de usuário e fora do git (`.gitignore`).

## 4. Automação avançada (opcional)

A instalação deste módulo **não** precisa de nada disso. Só clientes avançados que rodam
pipelines agendados precisam de equivalentes:

| macOS | Windows |
|---|---|
| `launchd` / `.plist` | **Agendador de Tarefas** (Task Scheduler) |
| `caffeinate` (não dormir) | `powercfg` / Win32 `SetThreadExecutionState` |
| `sips` (converter imagem) | **Pillow** (Python) ou ImageMagick |
| `osascript` (notificação) | Toast do PowerShell |

> O passo a passo detalhado dessa automação está no repositório **`tutorial-windows`**.
