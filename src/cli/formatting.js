'use strict';

/**
 * Utilitários de formatação para CLI (cores ANSI, tabelas, caixas e indicadores)
 * Zero dependências externas - Node.js nativo.
 */

const isColorSupported = !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));

function ansi(code, str) {
  if (!isColorSupported || str === undefined || str === null) return String(str ?? '');
  return '\x1b[' + code + 'm' + str + '\x1b[0m';
}

const color = {
  reset: (s) => ansi(0, s),
  bold: (s) => ansi(1, s),
  dim: (s) => ansi(2, s),
  italic: (s) => ansi(3, s),
  underline: (s) => ansi(4, s),

  black: (s) => ansi(30, s),
  red: (s) => ansi(31, s),
  green: (s) => ansi(32, s),
  yellow: (s) => ansi(33, s),
  blue: (s) => ansi(34, s),
  magenta: (s) => ansi(35, s),
  cyan: (s) => ansi(36, s),
  white: (s) => ansi(37, s),
  gray: (s) => ansi(90, s),

  brightRed: (s) => ansi(91, s),
  brightGreen: (s) => ansi(92, s),
  brightYellow: (s) => ansi(93, s),
  brightBlue: (s) => ansi(94, s),
  brightMagenta: (s) => ansi(95, s),
  brightCyan: (s) => ansi(96, s),
  brightWhite: (s) => ansi(97, s),
};

const colors = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  italic: isColorSupported ? '\x1b[3m' : '',
  underline: isColorSupported ? '\x1b[4m' : '',

  black: isColorSupported ? '\x1b[30m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  white: isColorSupported ? '\x1b[37m' : '',
  gray: isColorSupported ? '\x1b[90m' : '',

  brightRed: isColorSupported ? '\x1b[91m' : '',
  brightGreen: isColorSupported ? '\x1b[92m' : '',
  brightYellow: isColorSupported ? '\x1b[93m' : '',
  brightBlue: isColorSupported ? '\x1b[94m' : '',
  brightMagenta: isColorSupported ? '\x1b[95m' : '',
  brightCyan: isColorSupported ? '\x1b[96m' : '',
  brightWhite: isColorSupported ? '\x1b[97m' : '',
};

function stripAnsi(str) {
  return String(str ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(str) {
  return stripAnsi(str).length;
}

function padRight(str, len) {
  const visible = visibleLength(str);
  if (visible >= len) return String(str ?? '');
  return String(str ?? '') + ' '.repeat(len - visible);
}

function padLeft(str, len) {
  const visible = visibleLength(str);
  if (visible >= len) return String(str ?? '');
  return ' '.repeat(len - visible) + String(str ?? '');
}

const symbols = {
  check: color.brightGreen('✔'),
  cross: color.brightRed('✖'),
  bullet: color.brightCyan('●'),
  activeBullet: color.brightGreen('●'),
  arrow: color.brightBlue('➜'),
  info: color.brightCyan('ℹ'),
  warn: color.brightYellow('⚠'),
  star: color.brightYellow('★'),
  pointer: color.brightCyan('❯'),
};

/**
 * Cria uma caixa estilizada ao redor de linhas de texto (card).
 */
function card(options = {}) {
  let lines = [];
  let title = '';
  let padding = 1;
  let borderColor = color.gray;
  let targetWidth = 0;

  if (Array.isArray(options)) {
    lines = options;
  } else if (typeof options === 'object' && options !== null) {
    lines = options.lines || [];
    title = options.title || '';
    padding = options.padding ?? 1;
    borderColor = options.borderColor || color.gray;
    targetWidth = options.width || 0;
  }

  const cleanTitle = stripAnsi(title);
  let maxContentLen = cleanTitle ? cleanTitle.length + 4 : 0;
  for (const line of lines) {
    const len = visibleLength(line);
    if (len > maxContentLen) maxContentLen = len;
  }

  const innerWidth = Math.max(maxContentLen + padding * 2, targetWidth ? targetWidth - 2 : 0);

  const topBorder = title
    ? `╭─ ${title} ${borderColor('─'.repeat(Math.max(0, innerWidth - cleanTitle.length - 3)))}╮`
    : `╭${borderColor('─'.repeat(innerWidth))}╮`;
  const bottomBorder = `╰${borderColor('─'.repeat(innerWidth))}╯`;

  const output = [];
  output.push(borderColor(topBorder));

  for (const line of lines) {
    const rightPad = Math.max(0, innerWidth - visibleLength(line) - padding);
    output.push(
      `${borderColor('│')}${' '.repeat(padding)}${line}${' '.repeat(rightPad)}${borderColor('│')}`
    );
  }

  output.push(borderColor(bottomBorder));
  return output.join('\n');
}

/**
 * Renderiza uma tabela de texto limpa e bem alinhada.
 */
function table(headers, rows) {
  const colWidths = headers.map(h => visibleLength(h));

  for (const row of rows) {
    row.forEach((cell, idx) => {
      const len = visibleLength(cell || '');
      if (len > (colWidths[idx] || 0)) {
        colWidths[idx] = len;
      }
    });
  }

  const out = [];

  const headerLine = headers
    .map((h, i) => color.bold(color.brightCyan(padRight(h, colWidths[i]))))
    .join('  ');
  out.push(headerLine);

  const sepLine = colWidths
    .map(w => color.gray('─'.repeat(w)))
    .join('  ');
  out.push(sepLine);

  for (const row of rows) {
    const rowLine = row
      .map((cell, i) => padRight(cell || '', colWidths[i]))
      .join('  ');
    out.push(rowLine);
  }

  return out.join('\n');
}

function badge(text, type = 'info') {
  switch (type) {
    case 'success':
      return color.bold(color.green(`[${text}]`));
    case 'error':
      return color.bold(color.red(`[${text}]`));
    case 'warning':
      return color.bold(color.yellow(`[${text}]`));
    case 'active':
      return color.bold(color.cyan(`[${text}]`));
    default:
      return color.bold(color.dim(`[${text}]`));
  }
}

module.exports = {
  color,
  colors,
  symbols,
  stripAnsi,
  visibleLength,
  visualLength: visibleLength,
  padRight,
  padLeft,
  padEndVisual: padRight,
  padStartVisual: padLeft,
  card,
  box: card,
  table,
  badge,
};
