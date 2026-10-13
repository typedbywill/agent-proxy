'use strict';

const readline = require('node:readline');
const { color, symbols } = require('./formatting');

/**
 * Apresenta um menu de seleção interativo no terminal usando readline/keypress nativo.
 * Suporta navegação por setas, paginação por janela e pesquisa/filtro em tempo real.
 *
 * @param {Object} options
 * @param {string} options.message Mensagem/título do prompt
 * @param {Array<{label: string, value: any, hint?: string}>} options.choices Lista de opções
 * @param {number} [options.initialIndex=0] Índice pré-selecionado
 * @param {boolean} [options.searchable=false] Se permite digitar texto para filtrar opções em tempo real
 * @param {number} [options.pageSize=10] Número máximo de itens visíveis simultaneamente
 * @returns {Promise<any>} O valor da opção escolhida, ou null se cancelado
 */
function select({ message, choices = [], initialIndex = 0, searchable = false, pageSize = 10 }) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || choices.length === 0) {
      if (choices.length > 0) {
        return resolve(choices[0].value);
      }
      return resolve(null);
    }

    let searchTerm = '';
    let selectedIndex = Math.max(0, Math.min(initialIndex, choices.length - 1));
    let scrollOffset = 0;
    let lastRenderedLineCount = 0;
    let isRendered = false;

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch (_) {}
    process.stdin.resume();

    // Oculta cursor
    process.stdout.write('\x1b[?25l');

    function getVisibleChoices() {
      let filtered = choices;
      if (searchable && searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase();
        filtered = choices.filter((c) => {
          if (c.value === '__custom__') return true;
          return c.label.toLowerCase().includes(query) || (c.hint && c.hint.toLowerCase().includes(query));
        });

        const exactMatch = filtered.some((c) => c.label.toLowerCase() === query);
        if (!exactMatch && query.length > 0) {
          filtered = [
            {
              label: `Personalizado: "${searchTerm.trim()}"`,
              value: '__custom_direct__',
              customValue: searchTerm.trim(),
              hint: 'usar exatamente o que digitou',
            },
            ...filtered,
          ];
        }
      }
      return filtered;
    }

    function adjustScroll(currentFiltered, selIdx) {
      if (selIdx < scrollOffset) {
        scrollOffset = selIdx;
      } else if (selIdx >= scrollOffset + pageSize) {
        scrollOffset = selIdx - pageSize + 1;
      }
      scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, currentFiltered.length - pageSize)));
    }

    function render() {
      const currentFiltered = getVisibleChoices();
      if (selectedIndex >= currentFiltered.length) {
        selectedIndex = Math.max(0, currentFiltered.length - 1);
      }
      adjustScroll(currentFiltered, selectedIndex);

      const lines = [];

      // Cabeçalho com status da pesquisa
      let header = `${color.bold(color.cyan('?'))} ${color.bold(message)}`;
      if (searchable) {
        if (searchTerm) {
          header += ` ${color.bold(color.yellow(`"${searchTerm}"`))} ${color.dim(`(${currentFiltered.length} encontrados)`)}`;
        } else {
          header += ` ${color.dim('(digite para filtrar)')}`;
        }
      } else {
        header += ` ${color.dim('(Use ↑/↓ para navegar, Enter para escolher)')}`;
      }
      lines.push(header);

      if (currentFiltered.length === 0) {
        lines.push(`  ${color.yellow('Nenhum modelo encontrado para esta pesquisa.')}`);
      } else {
        const visibleSlice = currentFiltered.slice(scrollOffset, scrollOffset + pageSize);

        if (scrollOffset > 0) {
          lines.push(color.dim(`  ▲ (${scrollOffset} modelos anteriores...)`));
        }

        visibleSlice.forEach((choice, idx) => {
          const actualIdx = scrollOffset + idx;
          const isSelected = actualIdx === selectedIndex;
          const prefix = isSelected ? color.bold(color.cyan('▶ ')) : '  ';
          const label = isSelected ? color.bold(color.white(choice.label)) : color.gray(choice.label);
          const hint = choice.hint ? ` ${color.dim(`(${choice.hint})`)}` : '';
          lines.push(`${prefix}${label}${hint}`);
        });

        const remainingBelow = currentFiltered.length - (scrollOffset + visibleSlice.length);
        if (remainingBelow > 0) {
          lines.push(color.dim(`  ▼ (${remainingBelow} mais modelos abaixo...)`));
        }
      }

      if (searchable) {
        lines.push(color.dim('  (↑/↓: navegar • Enter: escolher • Digite: filtrar • Esc: limpar)'));
      }

      if (isRendered && lastRenderedLineCount > 0) {
        process.stdout.write(`\x1b[${lastRenderedLineCount}A\r`);
      }

      lines.forEach((line) => {
        process.stdout.write(`\x1b[2K${line}\n`);
      });

      lastRenderedLineCount = lines.length;
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

      if ((key.ctrl && key.name === 'c')) {
        cleanup();
        process.stdout.write('\n' + color.dim('Operação cancelada.') + '\n');
        resolve(null);
        return;
      }

      if (key.name === 'escape') {
        if (searchable && searchTerm.length > 0) {
          searchTerm = '';
          selectedIndex = 0;
          render();
          return;
        }
        cleanup();
        process.stdout.write('\n' + color.dim('Operação cancelada.') + '\n');
        resolve(null);
        return;
      }

      if (key.name === 'up' || (key.ctrl && key.name === 'p') || (!searchable && key.name === 'k')) {
        const currentFiltered = getVisibleChoices();
        if (currentFiltered.length > 0) {
          selectedIndex = (selectedIndex - 1 + currentFiltered.length) % currentFiltered.length;
        }
        render();
        return;
      }

      if (key.name === 'down' || (key.ctrl && key.name === 'n') || (!searchable && key.name === 'j')) {
        const currentFiltered = getVisibleChoices();
        if (currentFiltered.length > 0) {
          selectedIndex = (selectedIndex + 1) % currentFiltered.length;
        }
        render();
        return;
      }

      if (key.name === 'home') {
        selectedIndex = 0;
        render();
        return;
      }

      if (key.name === 'end') {
        const currentFiltered = getVisibleChoices();
        selectedIndex = Math.max(0, currentFiltered.length - 1);
        render();
        return;
      }

      if (key.name === 'pageup') {
        selectedIndex = Math.max(0, selectedIndex - pageSize);
        render();
        return;
      }

      if (key.name === 'pagedown') {
        const currentFiltered = getVisibleChoices();
        selectedIndex = Math.min(Math.max(0, currentFiltered.length - 1), selectedIndex + pageSize);
        render();
        return;
      }

      if (key.name === 'backspace') {
        if (searchable && searchTerm.length > 0) {
          searchTerm = searchTerm.slice(0, -1);
          selectedIndex = 0;
          render();
        }
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        const currentFiltered = getVisibleChoices();
        if (currentFiltered.length === 0) return;
        cleanup();

        if (lastRenderedLineCount > 0) {
          process.stdout.write(`\x1b[${lastRenderedLineCount}A\r`);
          for (let i = 0; i < lastRenderedLineCount; i++) {
            process.stdout.write('\x1b[2K\n');
          }
          process.stdout.write(`\x1b[${lastRenderedLineCount}A\r`);
        }

        const chosen = currentFiltered[selectedIndex];
        const resultValue = chosen.value === '__custom_direct__' ? chosen.customValue : chosen.value;
        process.stdout.write(
          `${symbols.check} ${color.bold(message)} ${color.bold(color.cyan(chosen.label))}\n\n`
        );
        resolve(resultValue);
        return;
      }

      // Tecla de atalho numérico (apenas quando não estiver em modo de busca)
      if (!searchable && str && /^[1-9]$/.test(str)) {
        const num = parseInt(str, 10);
        const currentFiltered = getVisibleChoices();
        if (num <= currentFiltered.length) {
          selectedIndex = num - 1;
          render();
          return;
        }
      }

      // Se for tecla de texto digitável para filtro
      if (searchable && str && !key.ctrl && !key.meta && str.length === 1 && str.charCodeAt(0) >= 32) {
        searchTerm += str;
        selectedIndex = 0;
        render();
        return;
      }
    }

    process.stdin.on('keypress', onKeypress);
    render();
  });
}

/**
 * Solicita uma entrada de texto interativa ao usuário via terminal.
 *
 * @param {Object} options
 * @param {string} options.message Mensagem/título do prompt
 * @param {string} [options.defaultValue=''] Valor padrão sugerido
 * @param {boolean} [options.allowEmpty=false] Se permite entrada vazia
 * @param {Function} [options.validate] Função de validação opcional
 * @returns {Promise<string|null>} O valor digitado, ou null se cancelado/vazio
 */
function input({ message, defaultValue = '', allowEmpty = false, validate } = {}) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      return resolve(defaultValue || null);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const defaultHint = defaultValue ? ` ${color.dim(`(padrão: ${defaultValue})`)}` : '';
    const cancelHint = !allowEmpty ? ` ${color.dim('(Enter vazio para cancelar)')}` : '';
    const promptMessage = `${color.bold(color.cyan('?'))} ${color.bold(message)}${defaultHint}${cancelHint} `;

    let isClosed = false;
    const cleanupAndResolve = (val) => {
      if (isClosed) return;
      isClosed = true;
      rl.close();
      resolve(val);
    };

    rl.once('SIGINT', () => {
      process.stdout.write('\n' + color.dim('Operação cancelada.') + '\n');
      cleanupAndResolve(null);
    });

    function ask() {
      rl.question(promptMessage, (answer) => {
        const val = answer.trim() || defaultValue;
        if (!val && !allowEmpty) {
          process.stdout.write(color.dim('Operação cancelada.') + '\n');
          cleanupAndResolve(null);
          return;
        }

        if (val && typeof validate === 'function') {
          const res = validate(val);
          if (res !== true) {
            const errorMsg = typeof res === 'string' ? res : 'Valor inválido.';
            process.stdout.write(`${symbols.cross} ${color.red(errorMsg)}\n`);
            ask();
            return;
          }
        }

        cleanupAndResolve(val || null);
      });
    }

    ask();
  });
}

module.exports = {
  select,
  input,
};
