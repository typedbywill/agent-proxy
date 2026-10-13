'use strict';

/**
 * Wrapper de controle de ciclo de vida do serviço systemd (--user) e health checks
 * Zero dependências externas - Node.js nativo (child_process, http).
 */

const { execSync, spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');

const SERVICE_NAME = 'agent-proxy.service';
const HOST = process.env.AGENT_PROXY_HOST || '127.0.0.1';
const PORT = parseInt(process.env.AGENT_PROXY_PORT || '8080', 10);
const LOG_FILE = process.env.AGENT_PROXY_LOG || path.join(os.homedir(), '.agent-proxy.log');

function isSystemdAvailable() {
  try {
    execSync('systemctl --user list-units --type=service', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function getServiceStatus() {
  const result = {
    exists: false,
    active: false,
    subState: 'unknown',
    mainPid: 0,
    uptime: '',
    memory: '',
  };

  try {
    const activeCheck = execSync(`systemctl --user is-active ${SERVICE_NAME} 2>/dev/null`, {
      encoding: 'utf8'
    }).trim();
    result.active = activeCheck === 'active';
    result.subState = activeCheck;
    result.exists = true;
  } catch (err) {
    result.active = false;
    result.subState = err.stdout ? err.stdout.trim() : 'inactive';
  }

  try {
    const showOutput = execSync(
      `systemctl --user show ${SERVICE_NAME} --property=MainPID,ActiveEnterTimestamp,MemoryCurrent,LoadState 2>/dev/null`,
      { encoding: 'utf8' }
    );

    const lines = showOutput.split('\n');
    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key === 'MainPID') result.mainPid = parseInt(value || '0', 10);
      if (key === 'LoadState') result.exists = value === 'loaded';
      if (key === 'ActiveEnterTimestamp' && value) result.uptime = value;
      if (key === 'MemoryCurrent' && value && value !== '[not set]') {
        const bytes = parseInt(value, 10);
        if (!isNaN(bytes)) {
          result.memory = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }
      }
    }
  } catch (_) {}

  return result;
}

function isServiceActive() {
  const status = getServiceStatus();
  return status.active;
}

function getMainPID() {
  const status = getServiceStatus();
  return status.mainPid;
}

function startService() {
  try {
    const before = getServiceStatus();
    if (before.active) {
      return { success: true, alreadyRunning: true, pid: before.mainPid };
    }
    execSync(`systemctl --user start ${SERVICE_NAME}`, { stdio: 'pipe' });
    const after = getServiceStatus();
    return { success: after.active, pid: after.mainPid, alreadyRunning: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function stopService() {
  try {
    const before = getServiceStatus();
    if (!before.active) {
      return { success: true, alreadyStopped: true };
    }
    execSync(`systemctl --user stop ${SERVICE_NAME}`, { stdio: 'pipe' });
    const after = getServiceStatus();
    return { success: !after.active, alreadyStopped: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function restartService() {
  try {
    execSync(`systemctl --user restart ${SERVICE_NAME}`, { stdio: 'pipe' });
    const after = getServiceStatus();
    return { success: after.active, pid: after.mainPid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Consulta o endpoint /health do proxy local com medição de latência.
 */
function queryHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(
      {
        host: HOST,
        port: PORT,
        path: '/health',
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          const latency = Date.now() - start;
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(raw);
              resolve({ ok: true, latency, data });
            } catch (_) {
              resolve({ ok: true, latency });
            }
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}`, latency });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout de conexão' });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.code || err.message });
    });
  });
}

function streamLogs(lines = 50, follow = true) {
  const args = ['--user', '-u', SERVICE_NAME, '-n', String(lines)];
  if (follow) args.push('-f');

  const proc = spawn('journalctl', args, {
    stdio: 'inherit'
  });

  return new Promise((resolve) => {
    proc.on('close', resolve);
    process.on('SIGINT', () => {
      proc.kill('SIGINT');
      resolve();
    });
  });
}

module.exports = {
  SERVICE_NAME,
  HOST,
  PORT,
  LOG_FILE,
  isSystemdAvailable,
  getServiceStatus,
  isServiceActive,
  getMainPID,
  startService,
  stopService,
  restartService,
  queryHealth,
  streamLogs,
};
