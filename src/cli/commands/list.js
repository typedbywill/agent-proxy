'use strict';

const { table, color, symbols } = require('../formatting');
const configManager = require('../config-manager');

async function handleList() {
  const config = configManager.loadConfig();
  const active = configManager.getActive();
  const providers = config.providers || {};

  console.log();
  console.log(` ${color.bold('Catálogo de Provedores e Modelos')}`);
  console.log(` ${color.dim('Modelo Coringa')} ${color.bold(color.cyan('ai-proxy'))} -> ${color.magenta(`[${active.provider}]`)} ${color.bold(color.white(active.model))}`);
  console.log();

  const headers = ['PROVEDOR', 'TIPO', 'CHAVE API', 'MODELO', 'STATUS'];
  const rows = [];

  for (const [providerName, provData] of Object.entries(providers)) {
    const pType = provData.type || 'cli';
    const keyStatus = provData.type === 'cli'
      ? color.dim('(local agy)')
      : provData.apiKey
        ? color.green(configManager.maskKey(provData.apiKey))
        : color.yellow('(não configurada)');

    const models = Array.isArray(provData.models) && provData.models.length > 0
      ? provData.models
      : ['(nenhum)'];

    models.forEach((modelName, index) => {
      const isCurrentActive = active.provider === providerName && active.model === modelName;
      const statusBadge = isCurrentActive
        ? `${symbols.activeBullet} ${color.bold(color.green('ATIVO'))}`
        : `${color.dim('○')}`;

      // Apenas exibe o nome do provedor, tipo e chave na primeira linha do grupo
      const displayProvider = index === 0 ? color.bold(color.cyan(providerName)) : '';
      const displayType = index === 0 ? color.dim(pType) : '';
      const displayKey = index === 0 ? keyStatus : '';
      const displayModel = isCurrentActive ? color.bold(color.white(modelName)) : color.dim(modelName);

      rows.push([
        displayProvider,
        displayType,
        displayKey,
        displayModel,
        statusBadge,
      ]);
    });
  }

  console.log(table(headers, rows));
  console.log();
  console.log(` ${color.dim('• Para alterar o modelo ativo:')}  ${color.cyan('agent-proxy use')}`);
  console.log(` ${color.dim('• Para gerenciar chaves API:')}    ${color.cyan('agent-proxy key set <provedor> <chave>')}`);
  console.log();
}

module.exports = {
  handleList,
};
