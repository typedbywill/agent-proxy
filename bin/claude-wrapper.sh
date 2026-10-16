#!/usr/bin/env bash
#
# Claude Code Wrapper - Roteamento permanente via agent-proxy local
#

export ANTHROPIC_BASE_URL="http://127.0.0.1:8080"
export ANTHROPIC_API_KEY="sk-antigravity"
export ANTHROPIC_MODEL="ai-proxy"
export CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1

# Timeouts estendidos para evitar erros ao processar prompts longos ou modelos de raciocínio
export API_TIMEOUT_MS=600000                       # 10 minutos para a requisição geral
export CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS=300000  # 5 minutos aguardando o primeiro chunk
export CLAUDE_STREAM_IDLE_TIMEOUT_MS=300000        # 5 minutos de inatividade entre chunks
# Impede auto-updates em background que corrompem binários ou quebram symlinks no NixOS
export DISABLE_AUTOUPDATER=1
unset ANTHROPIC_AUTH_TOKEN

# Se o proxy não estiver rodando, sobe imediatamente
if ! curl -s http://127.0.0.1:8080/health >/dev/null 2>&1; then
  systemctl --user start agent-proxy.service 2>/dev/null || true
  sleep 1
fi

exec /home/william/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe "$@"
