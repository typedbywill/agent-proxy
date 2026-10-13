'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { color, symbols } = require('../formatting');
const systemd = require('../systemd');
const configManager = require('../config-manager');

async function handleDoctor() {
  console.log();
  console.log(` ${color.bold(color.cyan('🩺 Diagnóstico do agent-proxy'))}`);
  console.log(` ${color.dim('Verificando ambiente, dependências e conectividade...')}`);
  console.log();

  let hasErrors = false;

  // 1. Verificação do Node.js
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 18) {
    console.log(` ${symbols.check} Node.js runtime: ${color.green(nodeVersion)} ${color.dim('(OK)')}`);
  } else {
    console.log(` ${symbols.cross} Node.js runtime: ${color.red(nodeVersion)} ${color.yellow('(Recomendado Node >= 18)')}`);
    hasErrors = true;
  }

  // 2. Verificação do Antigravity CLI (agy)
  const homeAgy = path.join(os.homedir(), '.local/bin/agy');
  const envAgy = process.env.AGY_BIN;
  let agyPath = envAgy || (fs.existsSync(homeAgy) ? homeAgy : 'agy');

  try {
    const agyCheck = spawnSync(agyPath, ['--version'], { encoding: 'utf8' });
    if (agyCheck.status === 0) {
      const rawVersion = (agyCheck.stdout || agyCheck.stderr || '').trim();
      const versionStr = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
      console.log(` ${symbols.check} Antigravity CLI: ${color.green(agyPath)} ${color.dim(`(${versionStr})`)}`);
    } else {
      console.log(` ${symbols.warn} Antigravity CLI: ${color.yellow(agyPath)} retornou status ${agyCheck.status}`);
    }
  } catch (err) {
    console.log(` ${symbols.cross} Antigravity CLI (${color.cyan(agyPath)}): ${color.red('Não encontrado no PATH ou ~/.local/bin/agy')}`);
    console.log(`   ${color.dim('Instale o agy ou defina a variável AGY_BIN no seu ambiente.')}`);
    hasErrors = true;
  }

  // 3. Verificação do arquivo de configuração providers.json
  const configFile = configManager.CONFIG_FILE;
  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      const provCount = Object.keys(parsed.providers || {}).length;
      console.log(` ${symbols.check} Arquivo de configuração: ${color.green(configFile)} ${color.dim(`(${provCount} provedores cadastrados)`)}`);
    } catch (e) {
      console.log(` ${symbols.cross} Arquivo de configuração: ${color.red('JSON inválido ou corrompido')} ${color.dim(`(${e.message})`)}`);
      hasErrors = true;
    }
  } else {
    console.log(` ${symbols.warn} Arquivo de configuração não existia; criado padrão em: ${configFile}`);
    configManager.loadConfig(); // inicializa padrão
  }

  // 4. Verificação do Serviço systemd
  const serviceActive = systemd.isServiceActive();
  const mainPid = systemd.getMainPID();
  if (serviceActive) {
    console.log(` ${symbols.check} Serviço systemd (${color.cyan(systemd.SERVICE_NAME)}): ${color.green('Ativo')} ${color.dim(`(PID: ${mainPid})`)}`);
  } else {
    console.log(` ${symbols.warn} Serviço systemd (${color.cyan(systemd.SERVICE_NAME)}): ${color.yellow('Inativo / Parado')}`);
    console.log(`   ${color.dim('Para iniciar: agent-proxy up')}`);
  }

  // 5. Teste de Health Check HTTP
  const health = await systemd.queryHealth(2000);
  if (health.ok) {
    console.log(` ${symbols.check} Endpoint HTTP (${color.cyan(`http://${systemd.HOST}:${systemd.PORT}`)}): ${color.green('Respondendo')} ${color.dim(`(latência: ${health.latency}ms)`)}`);
  } else {
    if (serviceActive) {
      console.log(` ${symbols.cross} Endpoint HTTP (${color.cyan(`http://${systemd.HOST}:${systemd.PORT}`)}): ${color.red('Sem resposta')} ${color.dim(`(${health.error})`)}`);
      hasErrors = true;
    } else {
      console.log(` ${symbols.bullet} Endpoint HTTP (${color.cyan(`http://${systemd.HOST}:${systemd.PORT}`)}): ${color.dim('Desconectado (serviço parado)')}`);
    }
  }

  // 6. Verificação do Modelo Coringa e Provedores Externos
  const active = configManager.getActive();
  console.log(` ${symbols.check} Modelo Coringa ativo: ${color.magenta(`[${active.provider}]`)} ${color.bold(color.white(`-> ${active.model}`))}`);

  const config = configManager.loadConfig();
  if (config.providers) {
    for (const [pName, pData] of Object.entries(config.providers)) {
      if (pData.type === 'openai-compatible') {
        const hasKey = Boolean(pData.apiKey && pData.apiKey.trim());
        if (hasKey) {
          console.log(`   ${symbols.check} Provedor ${color.cyan(pName)}: Chave de API configurada ${color.dim(configManager.maskKey(pData.apiKey))}`);
        } else {
          console.log(`   ${symbols.warn} Provedor ${color.cyan(pName)}: Chave de API não configurada. Use: ${color.dim(`agent-proxy key set ${pName} <chave>`)}`);
        }
      }
    }
  }

  console.log();
  if (!hasErrors) {
    console.log(` ${color.bold(color.green('✔ Tudo em ordem! O agent-proxy está saudável.'))}`);
  } else {
    console.log(` ${color.bold(color.yellow('⚠ Foram encontrados avisos ou problemas. Verifique as mensagens acima.'))}`);
  }
  console.log();
}

module.exports = {
  handleDoctor,
};
