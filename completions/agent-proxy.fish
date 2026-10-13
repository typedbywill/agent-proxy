# Autocompletes inteligentes e dinâmicos para agent-proxy no Fish Shell

function __agent_proxy_needs_command
    set -l cmd (commandline -opc)
    if test (count $cmd) -le 1
        return 0
    end
    return 1
end

function __agent_proxy_using_command
    set -l cmd (commandline -opc)
    set -l wanted $argv[1]
    if test (count $cmd) -ge 2; and test "$cmd[2]" = "$wanted"
        return 0
    end
    return 1
end

function __agent_proxy_providers
    agent-proxy _complete providers 2>/dev/null
end

function __agent_proxy_models
    set -l cmd (commandline -opc)
    if test (count $cmd) -ge 3
        agent-proxy _complete models "$cmd[3]" 2>/dev/null
    else
        agent-proxy _complete all-models 2>/dev/null
    end
end

complete -c agent-proxy -f

# 1. Comandos de primeiro nível
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'status' -d 'Exibe status do serviço, porta e modelo ativo'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'use' -d 'Altera o modelo coringa (com menu interativo)'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'models' -d 'Lista todos os provedores e modelos cadastrados'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'list' -d 'Lista todos os provedores e modelos cadastrados'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'doctor' -d 'Executa diagnóstico completo do sistema e dependências'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'key' -d 'Gerencia credenciais de API (list, set, get, rm)'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'up' -d 'Inicia o serviço systemd em segundo plano'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'start' -d 'Inicia o serviço systemd em segundo plano'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'down' -d 'Encerra o serviço em segundo plano'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'stop' -d 'Encerra o serviço em segundo plano'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'restart' -d 'Reinicia o serviço agent-proxy'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'logs' -d 'Acompanha os logs formatados em tempo real'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'config' -d 'Abre o providers.json no editor padrão'
complete -c agent-proxy -n '__agent_proxy_needs_command' -a 'help' -d 'Exibe ajuda e documentação'

# 2. Completions para 'agent-proxy use'
# Primeiro argumento após 'use' -> lista os provedores
complete -c agent-proxy -n '__agent_proxy_using_command use; and test (count (commandline -opc)) -eq 2' -a '(__agent_proxy_providers)' -d 'Provedor de IA'

# Segundo argumento após 'use <provedor>' -> lista modelos daquele provedor
complete -c agent-proxy -n '__agent_proxy_using_command use; and test (count (commandline -opc)) -ge 3' -a '(__agent_proxy_models)' -d 'Modelo'

# 3. Completions para 'agent-proxy key'
complete -c agent-proxy -n '__agent_proxy_using_command key; and test (count (commandline -opc)) -eq 2' -a 'list' -d 'Lista todas as chaves mascaradas'
complete -c agent-proxy -n '__agent_proxy_using_command key; and test (count (commandline -opc)) -eq 2' -a 'set' -d 'Configura uma chave de API'
complete -c agent-proxy -n '__agent_proxy_using_command key; and test (count (commandline -opc)) -eq 2' -a 'get' -d 'Consulta status da chave de um provedor'
complete -c agent-proxy -n '__agent_proxy_using_command key; and test (count (commandline -opc)) -eq 2' -a 'rm' -d 'Remove a chave de API de um provedor'

complete -c agent-proxy -n '__agent_proxy_using_command key; and test (count (commandline -opc)) -ge 3' -a '(__agent_proxy_providers)' -d 'Provedor'

# 4. Flags e opções
complete -c agent-proxy -l help -s h -d 'Exibe menu de ajuda'
complete -c agent-proxy -l version -s v -d 'Exibe a versão do agent-proxy'
complete -c agent-proxy -n '__agent_proxy_using_command logs' -s n -l lines -d 'Número de linhas de log'
complete -c agent-proxy -n '__agent_proxy_using_command logs' -l no-follow -d 'Não manter streaming de logs'
