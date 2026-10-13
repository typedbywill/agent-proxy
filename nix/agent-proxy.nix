{ config, pkgs, lib, ... }:

let
  proxyServer = pkgs.writeScriptBin "agent-proxy-server" ''
    #!${pkgs.nodejs}/bin/node
    ${builtins.readFile ./agent-proxy-server.js}
  '';

  proxyCli = pkgs.writeScriptBin "agent-proxy" ''
    #!${pkgs.bash}/bin/bash
    ${builtins.readFile ../scripts/agent-proxy.sh}
  '';
in
{
  home.packages = [
    proxyServer
    proxyCli
  ];

  # Serviço systemd do usuário gerenciado nativamente pelo Home Manager
  systemd.user.services.agent-proxy = {
    Unit = {
      Description = "Antigravity OpenAI-Compatible Proxy (agent-proxy)";
      After = [ "network.target" ];
    };
    Service = {
      Type = "simple";
      ExecStart = "${proxyServer}/bin/agent-proxy-server";
      Restart = "always";
      RestartSec = 3;
      Environment = [
        "NODE_ENV=production"
        "AGENT_PROXY_PORT=8080"
      ];
      StandardOutput = "append:%h/.agent-proxy.log";
      StandardError = "append:%h/.agent-proxy.log";
    };
    Install = {
      WantedBy = [ "default.target" ];
    };
  };
}
