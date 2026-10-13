'use strict';

const { select } = require('../interactive');
const { color, symbols } = require('../formatting');
const configManager = require('../config-manager');
const systemd = require('../systemd');

async function handleUse(args = []) {
  const [firstArg, secondArg] = args;
  const config = configManager.loadConfig();
  const currentActive = configManager.getActive();
  const providers = config.providers || {};

  // Caso 1: Dois argumentos passados: [provedor] [modelo]
  if (firstArg && secondArg) {
    const updated = configManager.setActive(firstArg, secondArg);
    console.log();
    console.log(`${symbols.check} Modelo coringa ${color.bold(color.cyan('ai-proxy'))} agora direciona para:`);
    console.log(`   ${color.magenta(`[${updated.provider}]`)} ${color.bold(color.white(`-> ${updated.model}`))}`);

    if (systemd.isServiceActive()) {
      systemd.restartService();
      console.log(`   ${color.dim('⚡ Serviço agent-proxy reiniciado com a nova configuração.')}`);
    }
    console.log();
    return;
  }

  // Caso 2: Um único argumento passado
  if (firstArg && !secondArg) {
    // 2a. O argumento é o nome de um provedor conhecido
    if (providers[firstArg]) {
      const providerArg = firstArg;
      const providerConfig = providers[providerArg];
      const availableModels = providerConfig?.models || (providerArg === 'antigravity' ? configManager.DEFAULT_ANTIGRAVITY_MODELS : []);

      if (availableModels.length === 0) {
        console.log();
        console.error(`${symbols.cross} ${color.red(`Provedor '${providerArg}' não possui modelos cadastrados.`)}`);
        console.log(`${color.yellow('Dica:')} Especifique o modelo: ${color.cyan(`agent-proxy use ${providerArg} <nome-do-modelo>`)}`);
        console.log();
        process.exitCode = 1;
        return;
      }

      // Se houver TTY, abre seletor interativo para os modelos do provedor
      if (process.stdin.isTTY) {
        console.log();
        const choices = availableModels.map((m) => ({
          label: m,
          value: m,
          hint: currentActive.provider === providerArg && currentActive.model === m ? 'ativo' : undefined,
        }));

        const defaultIdx = Math.max(0, availableModels.indexOf(currentActive.model));
        const chosenModel = await select({
          message: `Selecione o modelo para o provedor ${color.magenta(providerArg)}:`,
          choices,
          initialIndex: defaultIdx !== -1 ? defaultIdx : 0,
        });

        if (!chosenModel) return;

        const updated = configManager.setActive(providerArg, chosenModel);
        console.log(`${symbols.check} Modelo coringa ${color.bold(color.cyan('ai-proxy'))} atualizado para:`);
        console.log(`   ${color.magenta(`[${updated.provider}]`)} ${color.bold(color.white(`-> ${updated.model}`))}`);

        if (systemd.isServiceActive()) {
          systemd.restartService();
          console.log(`   ${color.dim('⚡ Serviço agent-proxy reiniciado.')}`);
        }
        console.log();
        return;
      } else {
        // Sem TTY: escolhe o primeiro modelo cadastrado
        const fallbackModel = availableModels[0];
        const updated = configManager.setActive(providerArg, fallbackModel);
        console.log(`${symbols.check} Modelo coringa ${color.bold(color.cyan('ai-proxy'))} definido como [${updated.provider}] -> ${updated.model}`);
        if (systemd.isServiceActive()) systemd.restartService();
        return;
      }
    }

    // 2b. O argumento pode ser um modelo diretamente (ex: claude-sonnet-5-5-high ou deepseek/deepseek-r1)
    let matchedProvider = null;
    let matchedModel = null;

    for (const [pName, pData] of Object.entries(providers)) {
      if (Array.isArray(pData.models) && pData.models.includes(firstArg)) {
        matchedProvider = pName;
        matchedModel = firstArg;
        break;
      }
    }

    if (!matchedProvider && firstArg.includes('/') && providers.openrouter) {
      matchedProvider = 'openrouter';
      matchedModel = firstArg;
    }

    if (matchedProvider && matchedModel) {
      const updated = configManager.setActive(matchedProvider, matchedModel);
      console.log();
      console.log(`${symbols.check} Modelo identificado no provedor ${color.magenta(matchedProvider)}!`);
      console.log(`   ${color.bold(color.cyan('ai-proxy'))} agora direciona para: ${color.magenta(`[${updated.provider}]`)} ${color.bold(color.white(`-> ${updated.model}`))}`);

      if (systemd.isServiceActive()) {
        systemd.restartService();
        console.log(`   ${color.dim('⚡ Serviço agent-proxy reiniciado.')}`);
      }
      console.log();
      return;
    }

    console.log();
    console.error(`${symbols.cross} ${color.red(`Provedor ou modelo '${firstArg}' não encontrado.`)}`);
    console.log(`Provedores disponíveis: ${Object.keys(providers).join(', ')}`);
    console.log(`${color.yellow('Dica:')} Use ${color.cyan('agent-proxy models')} para ver os modelos cadastrados.`);
    console.log();
    process.exitCode = 1;
    return;
  }

  // Caso 3: Nenhum argumento -> Fluxo Interativo Completo (Provedor -> Modelo)
  const providerNames = Object.keys(providers);
  if (providerNames.length === 0) {
    console.error(`${symbols.cross} ${color.red('Nenhum provedor configurado no providers.json!')}`);
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    console.log();
    console.log(`${color.bold('Uso:')} ${color.cyan('agent-proxy use <provedor> [modelo]')}`);
    console.log(`Provedores disponíveis: ${providerNames.join(', ')}`);
    console.log();
    return;
  }

  console.log();
  // Passo 1: Escolher Provedor
  const providerChoices = providerNames.map((name) => {
    const prov = providers[name];
    const isCurrent = currentActive.provider === name;
    let hint = prov.type || 'provider';
    if (isCurrent) hint += ' | ativo';
    return {
      label: name,
      value: name,
      hint,
    };
  });

  const provInitialIndex = Math.max(0, providerNames.indexOf(currentActive.provider));
  const chosenProvider = await select({
    message: 'Escolha o Provedor de IA:',
    choices: providerChoices,
    initialIndex: provInitialIndex !== -1 ? provInitialIndex : 0,
  });

  if (!chosenProvider) return;

  // Passo 2: Escolher Modelo do Provedor Selecionado
  const providerConfig = providers[chosenProvider];
  let availableModels = providerConfig?.models || [];

  if (availableModels.length === 0) {
    if (chosenProvider === 'antigravity') {
      availableModels = configManager.DEFAULT_ANTIGRAVITY_MODELS;
    } else {
      console.log(`${symbols.warn} Provedor ${chosenProvider} não possui modelos pré-cadastrados.`);
      console.log(`${color.yellow('Dica:')} Use ${color.cyan(`agent-proxy use ${chosenProvider} <modelo>`)} para cadastrar e ativar.`);
      return;
    }
  }

  const modelChoices = availableModels.map((m) => {
    const isCurrent = currentActive.provider === chosenProvider && currentActive.model === m;
    return {
      label: m,
      value: m,
      hint: isCurrent ? 'ativo' : undefined,
    };
  });

  let modelInitialIndex = availableModels.indexOf(currentActive.model);
  if (modelInitialIndex === -1) modelInitialIndex = 0;

  const chosenModel = await select({
    message: `Escolha o Modelo em [${chosenProvider}]:`,
    choices: modelChoices,
    initialIndex: modelInitialIndex,
  });

  if (!chosenModel) return;

  // Atualiza configuração
  const updated = configManager.setActive(chosenProvider, chosenModel);
  console.log(`${symbols.check} Modelo coringa ${color.bold(color.cyan('ai-proxy'))} agora direciona para:`);
  console.log(`   ${color.magenta(`[${updated.provider}]`)} ${color.bold(color.white(`-> ${updated.model}`))}`);

  if (systemd.isServiceActive()) {
    systemd.restartService();
    console.log(`   ${color.dim('⚡ Serviço agent-proxy reiniciado com a nova configuração.')}`);
  }
  console.log();
}

module.exports = {
  handleUse,
};
