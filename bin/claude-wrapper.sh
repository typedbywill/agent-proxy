#!/usr/bin/env bash
#
# Claude Code Wrapper - Roteamento permanente via agent-proxy local
#

export ANTHROPIC_BASE_URL="http://127.0.0.1:8080"
export ANTHROPIC_API_KEY="sk-antigravity"

# Se o proxy não estiver rodando, sobe imediatamente
if ! curl -s http://127.0.0.1:8080/health >/dev/null 2>&1; then
  systemctl --user start agent-proxy.service 2>/dev/null || true
  sleep 1
fi

exec /home/william/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe "$@"
