'use strict';

const readline = require('node:readline');
const { color, symbols } = require('./formatting');

/**
 * Apresenta um menu de seleção interativo no terminal usando readline/keypress nativo.
 *
 * @param {Object} options
 * @param {string} options.message Mensagem/título do prompt
 * @param {Array<{label: string, value: any, hint?: string}>} options.choices Lista de opções
 * @param {number} [options.initialIndex=0] Índice pré-selecionado
 * @returns {Promise<any>} O valor da opção escolhida, ou null se cancelado
 */
function select({ message, choices = [], initialIndex = 0 }) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || choices.length === 0) {
      if (choices.length > 0) {
        return resolve(choices[0].value);
      }
      return resolve(null);
    }

    let selectedIndex = Math.max(0, Math.min(initialIndex, choices.length - 1));
    let isRendered = false;

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch (_) {}
    process.stdin.resume();

    // Oculta cursor
    process.stdout.write('\x1b[?25l');

    function render() {
      const lines = [];
      lines.push(`${color.bold(color.cyan('?'))} ${color.bold(message)} ${color.dim('(Use ↑/↓ para navegar, Enter para escolher)')}`);

      choices.forEach((choice, index) => {
        const isSelected = index === selectedIndex;
        const prefix = isSelected ? color.bold(color.cyan('▶ ')) : '  ';
        const label = isSelected ? color.bold(color.white(choice.label)) : color.gray(choice.label);
        const hint = choice.hint ? ` ${color.dim(`(${choice.hint})`)}` : '';
        lines.push(`${prefix}${label}${hint}`);
      });

      if (isRendered) {
        // Move cursor para cima e limpa linhas anteriores
        const totalLinesToClear = choices.length + 1;
        process.stdout.write(`\x1b[${totalLinesToClear}A\r`);
      }

      lines.forEach((line) => {
        process.stdout.write(`\x1b[2K${line}\n`);
      });

      isRendered = true;
    }

    function cleanup() {
      process.stdin.removeListener('keypress', onKeypress);
      if (!wasRaw) {
        try { process.stdin.setRawMode(false); } catch (_) {}
      }
      process.stdin.pause();
      // Restaura cursor
      process.stdout.write('\x1b[?25h');
    }

    function onKeypress(str, key) {
      if (!key) return;

      if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
        cleanup();
        process.stdout.write('\n' + color.dim('Operação cancelada.') + '\n');
        resolve(null);
        return;
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
        return;
      }

      if (key.name === 'home') {
        selectedIndex = 0;
        render();
        return;
      }

      if (key.name === 'end') {
        selectedIndex = choices.length - 1;
        render();
        return;
      }

      if (str && /^[1-9]$/.test(str)) {
        const num = parseInt(str, 10);
        if (num <= choices.length) {
          selectedIndex = num - 1;
          render();
          return;
        }
      }

      if (key.name === 'return' || key.name === 'enter' || key.name === 'space') {
        cleanup();
        // Redesenha a linha de confirmação de forma limpa
        const totalLinesToClear = choices.length + 1;
        process.stdout.write(`\x1b[${totalLinesToClear}A\r`);
        for (let i = 0; i <= choices.length; i++) {
          process.stdout.write('\x1b[2K\n');
        }
        process.stdout.write(`\x1b[${choices.length + 1}A\r`);

        const chosen = choices[selectedIndex];
        process.stdout.write(
          `${symbols.check} ${color.bold(message)} ${color.bold(color.cyan(chosen.label))}\n\n`
        );
        resolve(chosen.value);
      }
    }

    process.stdin.on('keypress', onKeypress);
    render();
  });
}

module.exports = {
  select,
};
