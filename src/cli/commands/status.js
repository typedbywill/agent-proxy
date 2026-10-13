'use strict';

const { card, color, symbols } = require('../formatting');
const systemd = require('../systemd');
const configManager = require('../config-manager');

async function handleStatus() {
  const active = systemd.isServiceActive();
  const activeConfig = configManager.getActive();
  const config = configManager.loadConfig();

  if (!active) {
    console.log();
    console.log(
      card({
        title: color.bold(color.red('agent-proxy: INATIVO')),
        width: 66,
        lines: [
          `${color.bold('Estado:')}         ${color.red('🔴 Inativo (systemd user service parado)')}`,
          `${color.bold('Endpoint:')}       ${color.dim(`http://${systemd.HOST}:${systemd.PORT}/v1`)}`,
          `${color.bold('Modelo Ativo:')}   [${activeConfig.provider}] -> ${activeConfig.model}`,
          '',
          `${color.yellow('Dica:')} Para iniciar o proxy em segundo plano:`,
          `      ${color.cyan('agent-proxy up')}`,
        ],
      })
    );
    console.log();
    return;
  }

  const pid = systemd.getMainPID();
  const health = await systemd.queryHealth();
  const providersList = Object.keys(config.providers || {});

  const statusLine = `${color.bold('Estado:')}         ${color.green('🟢 Ativo')} ${color.dim(`(PID: ${pid})`)}`;
  let healthLine = '';

  if (health.ok) {
    healthLine = `${color.bold('Health Check:')}   ${symbols.check} ${color.green('Online')} ${color.dim(`(${health.latency}ms)`)}`;
  } else {
    healthLine = `${color.bold('Health Check:')}   ${symbols.cross} ${color.red('Sem resposta')} ${color.dim(`(${health.error})`)}`;
  }

  const endpointLine = `${color.bold('Base URL:')}       ${color.cyan(`http://${systemd.HOST}:${systemd.PORT}/v1`)}`;
  const activeModelLine = `${color.bold('Modelo Coringa:')} ${color.bold(color.magenta(`[${activeConfig.provider}]`))} ${color.bold(color.white(`-> ${activeConfig.model}`))}`;
  const providersLine = `${color.bold('Provedores:')}     ${providersList.map(p => p === activeConfig.provider ? color.bold(color.green(p)) : color.dim(p)).join(', ')}`;

  console.log();
  console.log(
    card({
      title: color.bold(color.cyan('agent-proxy')),
      width: 68,
      lines: [
        statusLine,
        healthLine,
        endpointLine,
        activeModelLine,
        providersLine,
      ],
    })
  );

  console.log();
  console.log(` ${color.dim('• Trocar modelo coringa:')} ${color.cyan('agent-proxy use')}`);
  console.log(` ${color.dim('• Ver todos os modelos:')}  ${color.cyan('agent-proxy models')}`);
  console.log(` ${color.dim('• Diagnóstico do sistema:')} ${color.cyan('agent-proxy doctor')}`);
  console.log();
}

module.exports = {
  handleStatus,
};
