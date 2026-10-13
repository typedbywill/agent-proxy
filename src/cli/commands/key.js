'use strict';

const { color, symbols, table } = require('../formatting');
const configManager = require('../config-manager');
const systemd = require('../systemd');

async function handleKey(args = []) {
  const [subAction, providerName, keyValue] = args;

  if (!subAction || subAction === 'list') {
    const config = configManager.loadConfig();
    const providers = config.providers || {};

    console.log();
    console.log(` ${color.bold('Chaves de API Configuradas')}`);
    console.log();

    const headers = ['PROVEDOR', 'TIPO', 'ENDPOINT', 'STATUS CHAVE'];
    const rows = [];

    for (const [name, data] of Object.entries(providers)) {
      if (data.type === 'cli') {
        rows.push([
          color.bold(color.cyan(name)),
          color.dim('cli (antigravity)'),
          color.dim('local / agy'),
          color.dim('(autenticado via agy)'),
        ]);
      } else {
        const masked = data.apiKey ? color.green(configManager.maskKey(data.apiKey)) : color.yellow('(não configurada)');
        rows.push([
          color.bold(color.cyan(name)),
          color.dim(data.type || 'openai-compatible'),
          color.dim(data.baseUrl || 'padrão'),
          masked,
        ]);
      }
    }

    console.log(table(headers, rows));
    console.log();
    console.log(` ${color.dim('• Para definir uma chave:')}  ${color.cyan('agent-proxy key set <provedor> <chave>')}`);
    console.log(` ${color.dim('• Para remover uma chave:')}  ${color.cyan('agent-proxy key rm <provedor>')}`);
    console.log();
    return;
  }

  if (subAction === 'set') {
    if (!providerName || !keyValue) {
      console.log();
      console.error(`${symbols.cross} ${color.red('Uso incorreto.')}`);
      console.log(`Formato: ${color.cyan('agent-proxy key set <provedor> <sua-api-key>')}`);
      console.log(`Exemplo: ${color.cyan('agent-proxy key set openrouter sk-or-v1-...')}`);
      console.log();
      process.exitCode = 1;
      return;
    }

    configManager.setKey(providerName, keyValue);
    console.log();
    console.log(`${symbols.check} Chave de API para o provedor ${color.bold(color.cyan(providerName))} foi salva com sucesso!`);
    console.log(`   Valor mascarado: ${color.dim(configManager.maskKey(keyValue))}`);

    if (systemd.isServiceActive()) {
      systemd.restartService();
      console.log(`   ${color.dim('⚡ Serviço agent-proxy reiniciado para aplicar a credencial.')}`);
    }
    console.log();
    return;
  }

  if (subAction === 'rm' || subAction === 'remove' || subAction === 'delete') {
    if (!providerName) {
      console.log();
      console.error(`${symbols.cross} ${color.red('Informe o provedor a ter a chave removida.')}`);
      console.log(`Formato: ${color.cyan('agent-proxy key rm <provedor>')}`);
      console.log();
      process.exitCode = 1;
      return;
    }

    configManager.removeKey(providerName);
    console.log();
    console.log(`${symbols.check} Chave do provedor ${color.bold(color.cyan(providerName))} foi removida.`);

    if (systemd.isServiceActive()) {
      systemd.restartService();
      console.log(`   ${color.dim('⚡ Serviço agent-proxy reiniciado.')}`);
    }
    console.log();
    return;
  }

  if (subAction === 'get') {
    if (!providerName) {
      console.log();
      console.error(`${symbols.cross} ${color.red('Informe o provedor.')}`);
      console.log();
      process.exitCode = 1;
      return;
    }

    const config = configManager.loadConfig();
    const prov = config.providers?.[providerName];
    if (!prov) {
      console.log();
      console.error(`${symbols.cross} Provedor ${providerName} não encontrado.`);
      console.log();
      process.exitCode = 1;
      return;
    }

    console.log();
    console.log(`${color.bold(providerName)}: ${configManager.maskKey(prov.apiKey)}`);
    console.log();
    return;
  }

  console.log();
  console.error(`${symbols.cross} Subcomando desconhecido: ${subAction}`);
  console.log(`Opções disponíveis: ${color.cyan('list')}, ${color.cyan('set')}, ${color.cyan('get')}, ${color.cyan('rm')}`);
  console.log();
  process.exitCode = 1;
}

module.exports = {
  handleKey,
};
