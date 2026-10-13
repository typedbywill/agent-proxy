'use strict';

/**
 * Gerenciador de configuração de ~/.config/agent-proxy/providers.json
 * Gravação atômica, carregamento seguro e validação de schema.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_DIR = path.join(os.homedir(), '.config/agent-proxy');
const CONFIG_FILE = process.env.AGENT_PROXY_CONFIG || path.join(CONFIG_DIR, 'providers.json');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude/settings.json');

const DEFAULT_ANTIGRAVITY_MODELS = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'claude-sonnet-5-5-high',
  'claude-sonnet-5-5-medium',
  'claude-sonnet-5-5-low',
  'claude-opus-5-5-high',
  'claude-opus-5-5-medium',
  'claude-opus-5-5-low',
  'gpt-oss-120b-medium',
];

const DEFAULT_CONFIG = {
  active: {
    provider: 'antigravity',
    model: 'gemini-3.8-flash-medium'
  },
  providers: {
    antigravity: {
      type: 'cli',
      models: DEFAULT_ANTIGRAVITY_MODELS
    },
    openrouter: {
      type: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      models: [
        'openrouter/auto',
        'deepseek/deepseek-chat',
        'deepseek/deepseek-r1',
        'meta-llama/llama-3.3-70b-instruct',
        'google/gemini-2.0-flash-001'
      ]
    },
    openai: {
      type: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      models: [
        'gpt-4o',
        'gpt-4o-mini',
        'o1',
        'o1-mini',
        'o3-mini',
        'gpt-4-turbo'
      ]
    }
  }
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    try {
      saveConfig(fresh);
    } catch (_) {}
    return fresh;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.active) parsed.active = { ...DEFAULT_CONFIG.active };
    if (!parsed.providers) parsed.providers = { ...DEFAULT_CONFIG.providers };
    return parsed;
  } catch (err) {
    throw new Error(`Falha ao ler ${CONFIG_FILE}: ${err.message}`);
  }
}

function saveConfig(config) {
  ensureDir(CONFIG_DIR);
  const tempFile = path.join(CONFIG_DIR, `.providers.tmp.${Date.now()}`);
  const jsonStr = JSON.stringify(config, null, 2) + '\n';

  fs.writeFileSync(tempFile, jsonStr, { mode: 0o600 });
  fs.renameSync(tempFile, CONFIG_FILE);
}

function getActive() {
  const config = loadConfig();
  return config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
}

function setActive(provider, model) {
  const config = loadConfig();
  if (!config.providers) config.providers = {};

  if (!config.providers[provider]) {
    // Se o provedor ainda não existir, cria estrutura básica
    config.providers[provider] = {
      type: provider === 'antigravity' ? 'cli' : 'openai-compatible',
      models: [model]
    };
  } else if (model) {
    if (!Array.isArray(config.providers[provider].models)) {
      config.providers[provider].models = provider === 'antigravity' ? [...DEFAULT_ANTIGRAVITY_MODELS] : [];
    }
    if (!config.providers[provider].models.includes(model)) {
      // Se for um modelo novo não listado, adiciona à lista
      config.providers[provider].models.push(model);
    }
  }

  config.active = {
    provider,
    model: model || (config.providers[provider].models && config.providers[provider].models[0]) || 'default'
  };

  saveConfig(config);
  syncClaudeSettings();
  return config.active;
}

function syncClaudeSettings() {
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      const raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf8');
      const settings = JSON.parse(raw);
      if (settings.model !== 'ai-proxy') {
        settings.model = 'ai-proxy';
        fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
      }
    } catch (_) {}
  }
}

function setKey(provider, key) {
  const config = loadConfig();
  if (!config.providers[provider]) {
    config.providers[provider] = {
      type: 'openai-compatible',
      baseUrl: provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1',
      apiKey: '',
      models: []
    };
  }

  config.providers[provider].apiKey = key;
  saveConfig(config);
}

function removeKey(provider) {
  const config = loadConfig();
  if (config.providers && config.providers[provider]) {
    delete config.providers[provider].apiKey;
    saveConfig(config);
  }
}

function maskKey(key) {
  if (!key) return '(nenhuma chave configurada)';
  const str = String(key).trim();
  if (str.length <= 8) return '********';
  return str.slice(0, 4) + '...' + str.slice(-4);
}

module.exports = {
  CONFIG_FILE,
  CONFIG_DIR,
  CLAUDE_SETTINGS,
  DEFAULT_CONFIG,
  DEFAULT_ANTIGRAVITY_MODELS,
  loadConfig,
  saveConfig,
  getActive,
  setActive,
  setKey,
  setProviderKey: setKey,
  removeKey,
  removeProviderKey: removeKey,
  maskKey,
  syncClaudeSettings,
};
