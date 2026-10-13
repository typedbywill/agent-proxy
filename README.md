# 🚀 agent-proxy

> **Proxy Inteligente Unificado para Cursor IDE, Claude Code e Ferramentas de IA.**  
> Faz a ponte entre clientes OpenAI / Anthropic e os modelos locais do **Google Antigravity CLI (`agy`)** ou Provedores Remotos (**OpenRouter**, **Groq**, **Ollama**, etc.), sem limites do Cloud Code e com alternância instantânea de modelos.

---

## 🌟 Principais Recursos

- **Zero Dependências Externas:** Construído 100% sobre o Node.js runtime nativo (`http`, `https`, `child_process`).
- **Suporte Dual de Protocolo:**
  - `POST /v1/chat/completions` (OpenAI format, para Cursor IDE, Continue, etc.)
  - `POST /v1/messages` (Anthropic format, para Claude Code CLI)
- **Modelo Coringa (`ai-proxy`):**
  - Configure apenas o modelo `ai-proxy` nas suas IDEs.
  - Alterne o modelo/provedor real no terminal com `agent-proxy use <provedor> [modelo]`.
- **Múltiplos Provedores:**
  - **Antigravity CLI (`agy`)**: `gemini-3.8-flash-medium`, `gemini-3.8-flash-high`, `claude-sonnet-5-5-high`, `claude-opus-5-5-high`, etc.
  - **OpenRouter**: `deepseek/deepseek-r1`, `deepseek/deepseek-chat`, `meta-llama/llama-3.3-70b`, etc.
  - **Ollama / Outros Provedores Locais e Remotos**.
- **Gerenciado como Serviço de Usuário:** Integrado nativamente ao `systemd --user` no Linux / NixOS (WillOS).
- **Autocompletes Fish Shell:** Comandos completos com ajuda e autocompletar dinâmico.

---

## 📁 Estrutura do Repositório

```text
agent-proxy/
├── bin/
│   ├── agent-proxy         # CLI executável (wrapper rápido que despacha para src/cli/)
│   └── claude-wrapper.sh   # Wrapper integrado para o Claude Code
├── src/
│   ├── server.js           # Servidor HTTP proxy OpenAI & Anthropic
│   └── cli/                # CLI modular nativa (zero dependências externas)
│       ├── index.js        # Parser de comandos e dispatch
│       ├── formatting.js   # Tabelas, cards ANSI e símbolos visuais
│       ├── interactive.js  # Seletor interativo via teclado (setas/números)
│       ├── config-manager.js # Leitura, validação e gravação atômica de providers.json
│       ├── systemd.js      # Integração com systemctl e health checks
│       └── commands/       # Subcomandos (status, use, list, doctor, key, logs)
├── completions/
│   └── agent-proxy.fish    # Autocompletes inteligentes e dinâmicos para Fish Shell
├── systemd/
│   └── agent-proxy.service # Serviço systemd do usuário
├── nix/
│   └── agent-proxy.nix     # Módulo Home Manager / NixOS
├── package.json
└── README.md
```

---

## ⚡ Comandos da CLI

| Comando | Descrição |
| :--- | :--- |
| `agent-proxy status` | Exibe card de status, porta, latência do health check e modelo coringa ativo |
| `agent-proxy use [prov] [mod]` | Alterna o modelo ativo (**menu interativo com setas** se omitir argumentos) |
| `agent-proxy models` / `list` | Tabela formatada com provedores, status de chaves e modelos cadastrados |
| `agent-proxy doctor` | Diagnóstico automático de Node, Antigravity (`agy`), systemd, portas e configs |
| `agent-proxy key <subcomando>` | Gerencia chaves com segurança (`list`, `set`, `get`, `rm`) |
| `agent-proxy up` / `start` | Inicia o serviço systemd em segundo plano |
| `agent-proxy down` / `stop` | Encerra o serviço em segundo plano |
| `agent-proxy restart` | Reinicia o proxy |
| `agent-proxy logs [-n 50]` | Monitora requisições em tempo real com realce de sintaxe HTTP e erros |
| `agent-proxy config` | Abre o arquivo de configuração `providers.json` no editor ($EDITOR) |

---

## 🎯 Alternando Modelos na Prática

```bash
# Gemini 3.8 Flash (Antigravity - ultra rápido)
agent-proxy use antigravity gemini-3.8-flash-medium

# Claude Sonnet 5.5 (Antigravity)
agent-proxy use antigravity claude-sonnet-5-5-high

# DeepSeek R1 (OpenRouter - raciocínio)
agent-proxy use openrouter deepseek/deepseek-r1

# Llama 3.3 70B (OpenRouter)
agent-proxy use openrouter meta-llama/llama-3.3-70b-instruct
```

---

## 🛠️ Como Configurar nas Ferramentas

### 1. Cursor IDE
1. Abra as configurações de modelos (**`Ctrl + Shift + J`** ➔ **Models**).
2. Ative **OpenAI API Key** (digite qualquer valor, ex: `sk-antigravity`).
3. Em **Override OpenAI Base URL**, insira:
   ```text
   http://127.0.0.1:8080/v1
   ```
4. Em **Model Names**, adicione apenas: `ai-proxy`.
5. No chat (`Ctrl + L`), selecione `ai-proxy`.

### 2. Claude Code
No terminal (já configurado por padrão no WillOS via `~/.config/fish/conf.d/agent-proxy-claude.fish`):
```bash
claude "Seu prompt aqui"
```
O Claude Code se conectará automaticamente na porta `8080` e usará o cérebro que você definiu no `agent-proxy use`.

---

## 📄 Licença

MIT © [William Gerhard Bueno](https://github.com/typedbywill)
