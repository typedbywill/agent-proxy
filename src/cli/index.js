#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { color, symbols } = require('./formatting');
const systemd = require('./systemd');
const configManager = require('./config-manager');

// Importação dos comandos
const { handleStatus } = require('./commands/status');
const { handleUse } = require('./commands/use');
const { handleList } = require('./commands/list');
const { handleDoctor } = require('./commands/doctor');
const { handleKey } = require('./commands/key');
const { handleLogs } = require('./commands/logs');

function showHelp() {
  console.log(`
${color.bold(color.cyan('agent-proxy'))} - Proxy de IA Unificado (Antigravity & Provedores Externos)

${color.bold('USO:')}
  ${color.cyan('agent-proxy')} <comando> [argumentos...]

${color.bold('COMANDOS DISPONÍVEIS:')}
  ${color.bold(color.cyan('status'))}                  Exibe o status do serviço, PID, porta e modelo ativo
  ${color.bold(color.cyan('use'))} [provedor] [modelo] Altera o destino do modelo coringa 'ai-proxy' (com menu interativo)
  ${color.bold(color.cyan('models'))} | ${color.bold(color.cyan('list'))}          Lista todos os provedores e modelos cadastrados
  ${color.bold(color.cyan('doctor'))}                  Executa diagnóstico completo do sistema e dependências
  ${color.bold(color.cyan('key'))} <subcomando>         Gerencia credenciais de API (list, set, get, rm)
  ${color.bold(color.cyan('up'))} | ${color.bold(color.cyan('start'))}             Inicia o serviço systemd em segundo plano
  ${color.bold(color.cyan('down'))} | ${color.bold(color.cyan('stop'))}           Encerra o serviço em segundo plano
  ${color.bold(color.cyan('restart'))}                 Reinicia o serviço agent-proxy
  ${color.bold(color.cyan('logs'))} [-n 50]            Acompanha os logs de requisições em tempo real
  ${color.bold(color.cyan('config'))}                  Abre o arquivo providers.json no editor padrão ($EDITOR)
  ${color.bold(color.cyan('help'))}                    Exibe este menu de ajuda

${color.bold('EXEMPLOS:')}
  ${color.dim('# Abrir menu interativo para escolher modelo com as setas')}
  agent-proxy use

  ${color.dim('# Definir modelo diretamente')}
  agent-proxy use antigravity claude-sonnet-5-5-high
  agent-proxy use openrouter deepseek/deepseek-r1

  ${color.dim('# Configurar chave de API para provedor externo')}
  agent-proxy key set openrouter sk-or-v1-xxxxxxxx

  ${color.dim('# Testar saúde da instalação')}
  agent-proxy doctor
`);
}

async function handleUp() {
  console.log();
  console.log(`Subindo ${color.cyan('agent-proxy')} via systemd...`);
  const res = systemd.startService();
  if (res.success) {
    if (res.alreadyRunning) {
      console.log(`${symbols.warn} ${color.yellow('O serviço já estava em execução.')}`);
    } else {
      console.log(`${symbols.check} ${color.green('Serviço iniciado com sucesso!')} (PID: ${res.pid})`);
    }
    await handleStatus();
  } else {
    console.error(`${symbols.cross} ${color.red('Falha ao iniciar:')} ${res.error}`);
    process.exitCode = 1;
  }
}

async function handleDown() {
  console.log();
  console.log(`Derrubando ${color.cyan('agent-proxy')}...`);
  const res = systemd.stopService();
  if (res.success) {
    if (res.alreadyStopped) {
      console.log(`${symbols.info} O serviço já estava parado.`);
    } else {
      console.log(`${symbols.check} ${color.green('Serviço finalizado com sucesso.')}`);
    }
  } else {
    console.error(`${symbols.cross} ${color.red('Falha ao parar serviço:')} ${res.error}`);
    process.exitCode = 1;
  }
  console.log();
}

async function handleRestart() {
  console.log();
  console.log(`Reiniciando ${color.cyan('agent-proxy')}...`);
  const res = systemd.restartService();
  if (res.success) {
    console.log(`${symbols.check} ${color.green('Serviço reiniciado com sucesso!')} (PID: ${res.pid})`);
    await handleStatus();
  } else {
    console.error(`${symbols.cross} ${color.red('Falha ao reiniciar serviço:')} ${res.error}`);
    process.exitCode = 1;
  }
}

function handleConfig() {
  const configFile = configManager.CONFIG_FILE;
  configManager.loadConfig(); // garante diretório e arquivo existente
  const editor = process.env.EDITOR || 'nano';
  console.log(`${symbols.info} Abrindo ${color.cyan(configFile)} com ${color.bold(editor)}...`);
  spawnSync(editor, [configFile], { stdio: 'inherit' });
}

function handleComplete(args) {
  const sub = args[0];
  const config = configManager.loadConfig();
  const providers = config.providers || {};

  if (sub === 'providers') {
    Object.keys(providers).forEach((p) => console.log(p));
  } else if (sub === 'models') {
    const prov = args[1];
    if (prov && providers[prov] && Array.isArray(providers[prov].models)) {
      providers[prov].models.forEach((m) => console.log(m));
    } else if (!prov) {
      const all = new Set();
      for (const p of Object.values(providers)) {
        if (Array.isArray(p.models)) p.models.forEach((m) => all.add(m));
      }
      all.forEach((m) => console.log(m));
    }
  } else if (sub === 'all-models') {
    const all = new Set();
    for (const p of Object.values(providers)) {
      if (Array.isArray(p.models)) p.models.forEach((m) => all.add(m));
    }
    all.forEach((m) => console.log(m));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const commandArgs = args.slice(1);

  try {
    switch (command) {
      case 'status':
        await handleStatus();
        break;
      case 'use':
        await handleUse(commandArgs);
        break;
      case 'models':
      case 'list':
        await handleList();
        break;
      case 'doctor':
        await handleDoctor();
        break;
      case 'key':
        await handleKey(commandArgs);
        break;
      case 'set-key': // Compatibilidade com a versão anterior
        await handleKey(['set', ...commandArgs]);
        break;
      case 'up':
      case 'start':
        await handleUp();
        break;
      case 'down':
      case 'stop':
        await handleDown();
        break;
      case 'restart':
        await handleRestart();
        break;
      case 'logs':
        await handleLogs(commandArgs);
        break;
      case 'config':
        handleConfig();
        break;
      case '--version':
      case '-v':
      case 'version':
        console.log(`agent-proxy v1.0.0`);
        break;
      case '_complete':
        handleComplete(commandArgs);
        break;
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
      default:
        console.log();
        console.error(`${symbols.cross} ${color.red(`Comando desconhecido:`)} ${color.bold(command)}`);
        showHelp();
        process.exitCode = 1;
        break;
    }
  } catch (err) {
    console.error(`\n${symbols.cross} ${color.red('Erro inesperado:')} ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  }
}

main();
