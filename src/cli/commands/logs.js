'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { color, symbols } = require('../formatting');
const systemd = require('../systemd');

function colorizeLogLine(line) {
  let formatted = line;

  // Timestamps [14:40:00]
  formatted = formatted.replace(/^\[(.*?)\]/, (match, ts) => {
    return color.dim(`[${ts}]`);
  });

  // Métodos HTTP
  formatted = formatted.replace(/\b(POST|GET|PUT|DELETE|OPTIONS)\b/g, (m) => {
    return color.bold(color.cyan(m));
  });

  // Status codes HTTP
  formatted = formatted.replace(/\b(200 OK|200)\b/g, (m) => color.green(m));
  formatted = formatted.replace(/\b(400|401|403|404|500|502|503)\b/g, (m) => color.bold(color.red(m)));

  // Modelos e Providers conhecidos
  formatted = formatted.replace(/\b(ai-proxy|antigravity|openrouter|openai)\b/g, (m) => color.magenta(m));

  // Ícones de sucesso / erro
  if (formatted.includes('❌') || formatted.includes('ERROR') || formatted.includes('Erro') || formatted.includes('Falha')) {
    formatted = color.red(formatted);
  }

  return formatted;
}

async function handleLogs(args = []) {
  const follow = !args.includes('--no-follow') && !args.includes('--no-tail');
  let numLines = 30;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-n' || a === '--lines') && args[i + 1]) {
      numLines = parseInt(args[i + 1], 10) || 30;
      break;
    } else if (/^\d+$/.test(a)) {
      numLines = parseInt(a, 10);
      break;
    }
  }

  console.log();
  console.log(` ${color.bold('Streaming de Logs do agent-proxy')} ${color.dim(`(últimas ${numLines} linhas)`)}`);
  console.log(` ${color.dim('Pressione Ctrl+C para encerrar')}`);
  console.log(color.dim('─'.repeat(60)));

  if (fs.existsSync(systemd.LOG_FILE)) {
    const tailArgs = ['-n', String(numLines)];
    if (follow) tailArgs.push('-f');
    tailArgs.push(systemd.LOG_FILE);

    const tailProc = spawn('tail', tailArgs);
    const rl = readline.createInterface({ input: tailProc.stdout });

    rl.on('line', (line) => {
      console.log(colorizeLogLine(line));
    });

    tailProc.stderr.on('data', (d) => process.stderr.write(d));

    process.on('SIGINT', () => {
      tailProc.kill();
      console.log();
      process.exit(0);
    });
  } else {
    // Fallback para journalctl
    const journalArgs = ['--user', '-u', systemd.SERVICE_NAME, '-n', String(numLines), '--no-pager'];
    if (follow) journalArgs.push('-f');

    const journalProc = spawn('journalctl', journalArgs);
    const rl = readline.createInterface({ input: journalProc.stdout });

    rl.on('line', (line) => {
      console.log(colorizeLogLine(line));
    });

    journalProc.stderr.on('data', (d) => process.stderr.write(d));

    process.on('SIGINT', () => {
      journalProc.kill();
      console.log();
      process.exit(0);
    });
  }
}

module.exports = {
  handleLogs,
};
