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
│   └── agent-proxy         # CLI de gerenciamento (up, down, restart, use, logs, status)
├── src/
│   └── server.js           # Servidor HTTP proxy OpenAI & Anthropic
├── completions/
│   └── agent-proxy.fish    # Autocompletes para Fish Shell
├── systemd/
│   └── agent-proxy.service # Serviço systemd do usuário
├── nix/
│   └── agent-proxy.nix     # Módulo Home Manager / NixOS
├── package.json
└── README.md
```

---

## ⚡ Comandos Rápidos

| Comando | Descrição |
| :--- | :--- |
| `agent-proxy status` | Exibe se o serviço está ativo, porta e o modelo ativo do `ai-proxy` |
| `agent-proxy use <prov> [mod]` | Alterna o modelo/provedor ativo instantaneamente |
| `agent-proxy up` / `start` | Inicia o serviço em segundo plano |
| `agent-proxy down` / `stop` | Encerra o serviço |
| `agent-proxy restart` | Reinicia o proxy |
| `agent-proxy logs` | Monitora as requisições e streaming em tempo real |
| `agent-proxy set-key <prov> <key>` | Configura a API key de um provedor (ex: `openrouter`) |
| `agent-proxy config` | Abre o arquivo de configuração `providers.json` |

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
