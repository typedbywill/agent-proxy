#!/usr/bin/env node

/**
 * agent-proxy: Servidor OpenAI-compatível & Anthropic Messages-compatível.
 *
 * Conceito do modelo coringa ("ai-proxy"):
 * - No Cursor IDE e no Claude Code, você configura o modelo como `ai-proxy`
 * - Sempre que uma requisição chega com `ai-proxy` (ou modelo vazio), o proxy despacha
 *   para o provedor e modelo atualmente definidos em `~/.config/agent-proxy/providers.json` ("active")!
 * - Você pode mudar o provedor e modelo ativos instantaneamente via comando:
 *     agent-proxy use <provedor> [modelo]
 *     ex: agent-proxy use antigravity gemini-3.8-flash-medium
 *     ex: agent-proxy use openrouter deepseek/deepseek-r1
 */

const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = parseInt(process.env.AGENT_PROXY_PORT || '8080', 10);
const HOST = process.env.AGENT_PROXY_HOST || '127.0.0.1';
const AGY_BIN = process.env.AGY_BIN || path.join(os.homedir(), '.local/bin/agy');
const LOG_FILE = process.env.AGENT_PROXY_LOG || path.join(os.homedir(), '.agent-proxy.log');
const CONFIG_FILE = process.env.AGENT_PROXY_CONFIG || path.join(os.homedir(), '.config/agent-proxy/providers.json');

const ALIAS_MODEL_NAMES = ['ai-proxy', 'agent-proxy', 'default', 'custom', 'auto'];

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
  'gpt-oss-120b-medium'
];

function log(msg) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  const line = `[${timestamp}] ${msg}\n`;
  process.stdout.write(line);

  // Evita duplicação quando stdout já estiver redirecionado para o arquivo de log (ex: via systemd)
  let isStdoutLogFile = false;
  try {
    const stdoutStat = fs.fstatSync(1);
    if (fs.existsSync(LOG_FILE)) {
      const fileStat = fs.statSync(LOG_FILE);
      isStdoutLogFile = (stdoutStat.ino === fileStat.ino && stdoutStat.dev === fileStat.dev);
    }
  } catch (_) {}

  if (!isStdoutLogFile) {
    try {
      fs.appendFileSync(LOG_FILE, line);
    } catch (_) {}
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      log(`⚠️  Erro ao ler ${CONFIG_FILE}: ${e.message}`);
    }
  }
  return {
    active: { provider: 'antigravity', model: 'gemini-3.8-flash-medium' },
    providers: {}
  };
}

function getAvailableModels() {
  const config = loadConfig();
  const models = [];

  // Modelo Coringa principal
  models.push({
    id: 'ai-proxy',
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'ai-proxy-active'
  });

  // Antigravity models
  const agyModels = (config.providers?.antigravity?.models) || DEFAULT_ANTIGRAVITY_MODELS;
  for (const m of agyModels) {
    models.push({
      id: m,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'antigravity'
    });
  }

  // Remote providers models
  if (config.providers) {
    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (providerKey === 'antigravity') continue;
      if (Array.isArray(provider.models)) {
        for (const m of provider.models) {
          models.push({
            id: m,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: providerKey
          });
        }
      }
    }
  }
  return models;
}

function resolveRoute(requestedModel) {
  const config = loadConfig();
  const reqLower = String(requestedModel || '').toLowerCase().trim();

  // 1. Se for o alias coringa "ai-proxy" (ou derivado)
  if (!reqLower || ALIAS_MODEL_NAMES.includes(reqLower)) {
    const active = config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
    log(`🎯 Modelo coringa 'ai-proxy' detectado -> Roteando para [${active.provider}] '${active.model}'`);

    if (active.provider === 'antigravity') {
      return { type: 'antigravity', model: active.model || 'gemini-3.8-flash-medium' };
    }

    const providerObj = config.providers?.[active.provider];
    if (providerObj) {
      return {
        type: 'remote',
        providerKey: active.provider,
        provider: providerObj,
        model: active.model
      };
    }

    return { type: 'antigravity', model: 'gemini-3.8-flash-medium' };
  }

  // 2. Se for especificado um modelo Antigravity direto
  const agyModels = (config.providers?.antigravity?.models) || DEFAULT_ANTIGRAVITY_MODELS;
  if (agyModels.includes(requestedModel)) {
    return { type: 'antigravity', model: requestedModel };
  }

  // 3. Se for de algum provedor cadastrado
  if (config.providers) {
    for (const [providerKey, provider] of Object.entries(config.providers)) {
      if (providerKey === 'antigravity') continue;

      if (Array.isArray(provider.models) && provider.models.includes(requestedModel)) {
        return { type: 'remote', providerKey, provider, model: requestedModel };
      }

      if (requestedModel.startsWith(`${providerKey}/`)) {
        const actualModel = requestedModel.slice(providerKey.length + 1);
        return { type: 'remote', providerKey, provider, model: actualModel };
      }
    }

    if (requestedModel.includes('/') && config.providers.openrouter && config.providers.openrouter.apiKey) {
      return {
        type: 'remote',
        providerKey: 'openrouter',
        provider: config.providers.openrouter,
        model: requestedModel
      };
    }
  }

  // Fallback padrão: rota ativa configurada
  const active = config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
  return { type: 'antigravity', model: active.model || 'gemini-3.8-flash-medium' };
}

function formatMessagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  if (messages.length === 1) {
    const content = messages[0].content;
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  return messages
    .map(m => {
      const role = m.role === 'assistant' ? 'Model' : m.role === 'system' ? 'System Instructions' : 'User';
      let content = m.content;
      if (Array.isArray(content)) {
        content = content
          .map(c => (typeof c === 'string' ? c : c.text || c.content || ''))
          .join('\n');
      }
      return `${role}:\n${content || ''}`;
    })
    .join('\n\n---\n\n') + '\n\nModel:\n';
}

function handleAntigravityChat(model, payload, res, apiFormat) {
  const prompt = formatMessagesToPrompt(payload.messages || []);
  const isStream = payload.stream === true;
  log(`🤖 [Antigravity] Modelo: ${model} | Formato: ${apiFormat} | Stream: ${isStream} | Prompt: ${prompt.length} chars`);

  const completionId = `chatcmpl-${Date.now()}`;
  const msgId = `msg_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const args = [
    `--model=${model}`,
    '--output-format=text',
    `--print=${prompt}`
  ];

  const proc = spawn(AGY_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrOutput = '';
  let sentAnyChunk = false;

  proc.stderr.on('data', errData => {
    const text = errData.toString();
    stderrOutput += text;
    log(`⚠️  [agy stderr]: ${text.trim()}`);
  });

  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    if (apiFormat === 'anthropic') {
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
    } else {
      const initialChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
      };
      res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);
    }

    // Heartbeat keep-alive para evitar timeout em clientes HTTP (ex: Claude Code / Cursor)
    const pingInterval = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(pingInterval);
        return;
      }
      if (apiFormat === 'anthropic') {
        res.write(`event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`);
      } else {
        res.write(': ping\n\n');
      }
    }, 5000);

    res.on('close', () => {
      clearInterval(pingInterval);
      if (!proc.killed) {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }
    });

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      if (!text) return;
      sentAnyChunk = true;
      if (apiFormat === 'anthropic') {
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`);
      } else {
        const sseData = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
        };
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);
      }
    });

    proc.on('close', code => {
      clearInterval(pingInterval);
      if (code !== 0 && !sentAnyChunk && stderrOutput) {
        let cleanErr = stderrOutput.trim();
        try {
          const m = cleanErr.match(/AGY_ERROR:\s*(\{.*\})/);
          if (m) {
            const parsed = JSON.parse(m[1]);
            cleanErr = parsed.short_error || parsed.status || cleanErr;
          }
        } catch (_) {}
        const errorMsg = `\n⚠️ [agent-proxy]: ${cleanErr}\n`;
        if (apiFormat === 'anthropic') {
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: errorMsg } })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: errorMsg }, finish_reason: null }] })}\n\n`);
        }
      }

      if (apiFormat === 'anthropic') {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      } else {
        const finalChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end();
      log(`✅ [Antigravity] Finalizado com código ${code}`);
    });
  } else {
    let output = '';
    proc.stdout.on('data', chunk => { output += chunk.toString(); });
    proc.on('close', code => {
      if (code !== 0 && !output && stderrOutput) {
        output = `⚠️ [agent-proxy]: ${stderrOutput.trim()}`;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (apiFormat === 'anthropic') {
        res.end(JSON.stringify({
          id: msgId,
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: output.trim() }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 }
        }));
      } else {
        res.end(JSON.stringify({
          id: completionId,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: output.trim() },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        }));
      }
      log(`✅ [Antigravity] Resposta enviada com sucesso (código ${code})`);
    });
  }
}

function isReasoningModel(model) {
  const m = String(model || '').toLowerCase();
  return (
    m.includes('o1') ||
    m.includes('o3') ||
    m.includes('o4') ||
    m.includes('reason') ||
    m.includes('gpt-5') ||
    m.includes('gpt-6') ||
    m.includes('deepseek-r1') ||
    m.startsWith('o1') ||
    m.startsWith('o3')
  );
}

function convertAnthropicToOpenAIPayload(payload, model) {
  const messages = [];
  const reasoning = isReasoningModel(model);

  if (payload.system) {
    const systemText = typeof payload.system === 'string'
      ? payload.system
      : Array.isArray(payload.system)
        ? payload.system.map(s => s.text || '').join('\n')
        : '';
    if (systemText) {
      const role = reasoning ? 'developer' : 'system';
      messages.push({ role, content: systemText });
    }
  }

  if (Array.isArray(payload.messages)) {
    for (const m of payload.messages) {
      let content = m.content;
      if (Array.isArray(content)) {
        content = content.map(b => (typeof b === 'string' ? b : b.text || b.content || '')).join('\n');
      }
      messages.push({ role: m.role, content: content || '' });
    }
  }

  const result = {
    model,
    messages,
    stream: payload.stream === true,
  };

  const tokenLimit = payload.max_tokens || payload.max_completion_tokens;
  if (tokenLimit) {
    // Modelos modernos e modelos de raciocínio da OpenAI exigem max_completion_tokens
    result.max_completion_tokens = tokenLimit;
  }

  // Modelos de raciocínio (o1, o3, etc.) na OpenAI proíbem temperature e top_p
  if (!reasoning) {
    if (payload.temperature !== undefined) result.temperature = payload.temperature;
    if (payload.top_p !== undefined) result.top_p = payload.top_p;
  }

  return result;
}

function convertOpenAIToAnthropicResponse(openaiJson, model) {
  const choice = openaiJson.choices?.[0];
  const text = choice?.message?.content || '';
  return {
    id: `msg_${openaiJson.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : (choice?.finish_reason || 'end_turn'),
    usage: {
      input_tokens: openaiJson.usage?.prompt_tokens || 0,
      output_tokens: openaiJson.usage?.completion_tokens || 0,
    }
  };
}

function handleRemoteProviderChat(routeInfo, payload, res, apiFormat) {
  const { providerKey, provider, model } = routeInfo;
  const isStream = payload.stream === true;
  const isAnthropicToOpenRouter = apiFormat === 'anthropic' && providerKey === 'openrouter';
  const isAnthropicToGenericOpenAI = apiFormat === 'anthropic' && providerKey !== 'openrouter';

  const targetPath = isAnthropicToOpenRouter ? '/messages' : '/chat/completions';
  log(`🌐 [${providerKey}] Encaminhando modelo: ${model} para ${provider.baseUrl}${targetPath} (Formato: ${apiFormat}, Stream: ${isStream})`);

  if (!provider.apiKey) {
    const errorMsg = `API Key do provedor '${providerKey}' não configurada em ~/.config/agent-proxy/providers.json!`;
    log(`❌ ${errorMsg}`);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: errorMsg, type: 'authentication_error' } }));
    return;
  }

  let remotePayload;
  if (isAnthropicToGenericOpenAI) {
    remotePayload = convertAnthropicToOpenAIPayload(payload, model);
  } else {
    remotePayload = {
      ...payload,
      model
    };
    if (isReasoningModel(model)) {
      if (remotePayload.max_tokens !== undefined) {
        if (!remotePayload.max_completion_tokens) {
          remotePayload.max_completion_tokens = remotePayload.max_tokens;
        }
        delete remotePayload.max_tokens;
      }
      delete remotePayload.temperature;
      delete remotePayload.top_p;
    }
  }

  const parsedUrl = new URL(provider.baseUrl.replace(/\/+$/, '') + targetPath);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.apiKey}`,
  };

  if (providerKey === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/typedbywill/WillOS';
    headers['X-Title'] = 'WillOS Agent Proxy';
    if (apiFormat === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
    }
  }

  function sendRemoteRequest(payloadToSend, isRetry = false) {
    const postData = JSON.stringify(payloadToSend);
    headers['Content-Length'] = Buffer.byteLength(postData);

    const clientReq = transport.request(parsedUrl, {
      method: 'POST',
      headers,
      timeout: 600000 // 10 minutos
    }, remoteRes => {
      // Se a API retornar 400 por parâmetro incompatível (max_tokens / temperature), corrige e tenta novamente
      if (remoteRes.statusCode === 400 && !isRetry) {
        let errBody = '';
        remoteRes.on('data', c => { errBody += c; });
        remoteRes.on('end', () => {
          if (errBody.includes('max_tokens') || errBody.includes('max_completion_tokens') || errBody.includes('temperature') || errBody.includes('top_p')) {
            log(`⚠️  [${providerKey}] Parâmetro incompatível (${errBody.trim()}). Ajustando para max_completion_tokens e repetindo...`);
            const retryPayload = { ...payloadToSend };
            if (retryPayload.max_tokens !== undefined) {
              retryPayload.max_completion_tokens = retryPayload.max_tokens;
              delete retryPayload.max_tokens;
            }
            delete retryPayload.temperature;
            delete retryPayload.top_p;
            sendRemoteRequest(retryPayload, true);
            return;
          }

          const responseHeaders = { ...remoteRes.headers };
          delete responseHeaders['content-length'];
          res.writeHead(400, responseHeaders);
          res.end(errBody);
        });
        return;
      }

      // Caso 1: Passthrough direto (OpenRouter Anthropic nativo ou OpenAI -> OpenAI)
      if (!isAnthropicToGenericOpenAI) {
        const responseHeaders = { ...remoteRes.headers };
        delete responseHeaders['content-length'];
        res.writeHead(remoteRes.statusCode, responseHeaders);
        remoteRes.pipe(res);
        remoteRes.on('end', () => {
          log(`✅ [${providerKey}] Resposta concluída com status ${remoteRes.statusCode}`);
        });
        return;
      }

      // Caso 2: Tradução de OpenAI genérico para cliente Anthropic (ex: Claude Code)
      if (remoteRes.statusCode !== 200) {
        const responseHeaders = { ...remoteRes.headers };
        delete responseHeaders['content-length'];
        res.writeHead(remoteRes.statusCode, responseHeaders);
        remoteRes.pipe(res);
        return;
      }

      if (!isStream) {
        let rawData = '';
        remoteRes.on('data', chunk => { rawData += chunk; });
        remoteRes.on('end', () => {
          try {
            const json = JSON.parse(rawData);
            const anthropicMsg = convertOpenAIToAnthropicResponse(json, model);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(anthropicMsg));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `Erro ao converter resposta: ${e.message}` } }));
          }
          log(`✅ [${providerKey}] Resposta traduzida para Anthropic com sucesso`);
        });
      } else {
        // Streaming SSE: traduz chunks OpenAI para chunks Anthropic
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const msgId = `msg_${Date.now()}`;
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);

        let buffer = '';
        remoteRes.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // mantém linha incompleta no buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const parsedChunk = JSON.parse(dataStr);
              const deltaText = parsedChunk.choices?.[0]?.delta?.content;
              if (deltaText) {
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: deltaText } })}\n\n`);
              }
            } catch (_) {}
          }
        });

        remoteRes.on('end', () => {
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
          res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })}\n\n`);
          res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
          res.end();
          log(`✅ [${providerKey}] Stream traduzido para Anthropic com sucesso`);
        });
      }
    });

    clientReq.on('timeout', () => {
      clientReq.destroy(new Error(`Timeout de 10 minutos excedido com ${providerKey}`));
    });

    clientReq.on('error', err => {
      log(`❌ [${providerKey}] Erro na conexão: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Erro ao conectar com ${providerKey}: ${err.message}` } }));
      }
    });

    clientReq.write(postData);
    clientReq.end();
  }

  sendRemoteRequest(remotePayload);
}

const server = http.createServer((req, res) => {
  log(`➡️  ${req.method} ${req.url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const rawUrl = (req.url || '').split('?')[0].replace(/\/+$/, ''); const url = rawUrl;

  // 1. Endpoint /v1/models (listagem unificada)
  if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
    const models = getAvailableModels();
    log(`📋 Listando ${models.length} modelos disponíveis`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
    return;
  }

  // 2. Endpoint OpenAI Chat /v1/chat/completions OU Anthropic Messages /v1/messages
  const isAnthropic = url === '/v1/messages' || url === '/messages';
  const isOpenAIChat = url === '/v1/chat/completions' || url === '/chat/completions';

  if (req.method === 'POST' && (isOpenAIChat || isAnthropic)) {
    req.socket.setTimeout(0);
    res.setTimeout(0);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const requestedModel = payload.model || 'ai-proxy';
        const route = resolveRoute(requestedModel);

        const apiFormat = isAnthropic ? 'anthropic' : 'openai';

        if (route.type === 'antigravity') {
          handleAntigravityChat(route.model, payload, res, apiFormat);
        } else if (route.type === 'remote') {
          handleRemoteProviderChat(route, payload, res, apiFormat);
        } else {
          handleAntigravityChat('gemini-3.8-flash-medium', payload, res, apiFormat);
        }
      } catch (err) {
        log(`❌ Erro no processamento: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: 'invalid_request_error' } }));
      }
    });
    return;
  }

  if (req.url === '/api/hello' || req.url?.startsWith('/api/hello')) { res.writeHead(200); res.end(); return; }
  // 3. Health check & status da rota ativa
  if (req.method === 'GET' && (url === '/health' || url === '')) {
    const config = loadConfig();
    const active = config.active || { provider: 'antigravity', model: 'gemini-3.8-flash-medium' };
    const activeProviders = ['antigravity', ...Object.keys(config.providers || {})];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      name: 'agent-proxy',
      port: PORT,
      active,
      providers: activeProviders
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found', code: 404 } }));
});

// Desativa limites de timeout no servidor para suportar requisições demoradas
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 65000;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  log(`🚀 agent-proxy ativo em http://${HOST}:${PORT}`);
  log(`   Endpoint OpenAI Base URL: http://${HOST}:${PORT}/v1`);
  log(`   Endpoint Anthropic Base URL: http://${HOST}:${PORT}/v1`);
});
