# Autocompletes interativos do comando agent-proxy
complete -c agent-proxy -f
complete -c agent-proxy -a "use" -d "Altera o destino do modelo coringa 'ai-proxy' (ex: agent-proxy use openrouter deepseek/deepseek-r1)"
complete -c agent-proxy -a "status" -d "Exibe o status atual e para onde o 'ai-proxy' aponta"
complete -c agent-proxy -a "up" -d "Sobe o agent-proxy em segundo plano"
complete -c agent-proxy -a "start" -d "Sobe o agent-proxy em segundo plano"
complete -c agent-proxy -a "down" -d "Derruba o agent-proxy"
complete -c agent-proxy -a "stop" -d "Derruba o agent-proxy"
complete -c agent-proxy -a "restart" -d "Reinicia o agent-proxy"
complete -c agent-proxy -a "logs" -d "Acompanha os logs de requisições em tempo real"
complete -c agent-proxy -a "config" -d "Abre o arquivo providers.json para edição"
complete -c agent-proxy -a "set-key" -d "Define a chave de API de um provedor (ex: openrouter)"
complete -c agent-proxy -a "help" -d "Exibe o guia de uso e configuração do Cursor e Claude"
