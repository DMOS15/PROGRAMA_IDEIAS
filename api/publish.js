const { timingSafeEqual } = require('node:crypto');

const maxRequestBytes = 4 * 1024 * 1024;
const githubApi = 'https://api.github.com';

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

function sameSecret(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function compareVersions(left, right) {
  const parts = (value) => String(value || '').split('.').map((part) => Number(part) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < 3; index += 1) {
    if ((leftParts[index] || 0) !== (rightParts[index] || 0)) {
      return (leftParts[index] || 0) - (rightParts[index] || 0);
    }
  }
  return 0;
}

function validateDataset(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const ideas = Array.isArray(data.ideias) ? data.ideias : [];
  const people = Array.isArray(data.cadastro) ? data.cadastro : [];
  const numberedIdeas = ideas.filter((idea) => idea && typeof idea === 'object' && String(idea.numero || '').trim());
  const activePeople = people.filter((person) => person && String(person.status || '').trim().toLowerCase() === 'ativo' && String(person.nome || '').trim());
  const areas = new Set([
    ...activePeople.map((person) => String(person.area || '').trim()),
    ...(Array.isArray(data.baseDmos) ? data.baseDmos.map((person) => String(person?.area || '').trim()) : []),
    ...ideas.map((idea) => String(idea?.areaTrabalho || idea?.grupo || '').trim())
  ].filter(Boolean));
  const metadata = data.metadata;
  return numberedIdeas.length > 0 && activePeople.length > 0 && areas.size > 0
    && metadata && /^\d+\.\d+\.\d+$/.test(String(metadata.version || ''))
    && !Number.isNaN(Date.parse(metadata.updatedAt || ''))
    && Array.isArray(data.baseDmos) && Array.isArray(data.canceladas)
    && data.reconhecidas && Array.isArray(data.reconhecidas.trimestre)
    && Array.isArray(data.reconhecidas.semestre);
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  let body;
  try { body = await response.json(); }
  catch (error) { body = {}; }
  return { response, body };
}

module.exports = async function publish(req, res) {
  const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
  const apiOrigin = `${req.headers['x-forwarded-proto'] || 'https'}://${forwardedHost}`;
  const allowedOrigins = new Set([
    apiOrigin,
    'https://dmos15.github.io',
    ...(process.env.FRONTEND_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean)
  ]);
  const requestOrigin = req.headers.origin;

  res.setHeader('Vary', 'Origin');
  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return sendJson(res, 403, { error: 'Origem não autorizada.' });
  }
  if (requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }
  if (Number(req.headers['content-length'] || 0) > maxRequestBytes) {
    return sendJson(res, 413, { error: 'A carga excede o limite de 4 MB da API.' });
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch (error) { return sendJson(res, 400, { error: 'Corpo da requisição não contém JSON válido.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, { error: 'Corpo da requisição inválido.' });
  }
  if (!process.env.ADMIN_PIN) {
    return sendJson(res, 500, { error: 'A variável ADMIN_PIN não está configurada na Vercel.' });
  }
  if (!sameSecret(body.pin, process.env.ADMIN_PIN)) {
    return sendJson(res, 401, { error: 'PIN administrativo inválido.' });
  }
  if (body.action === 'verify') return sendJson(res, 200, { authenticated: true });
  if (body.action !== 'publish') {
    return sendJson(res, 400, { error: 'Ação não reconhecida.' });
  }
  if (!process.env.GITHUB_TOKEN) {
    return sendJson(res, 500, { error: 'A variável GITHUB_TOKEN não está configurada na Vercel.' });
  }
  if (!validateDataset(body.data)) {
    return sendJson(res, 400, { error: 'A carga não contém uma base válida de ideias, colaboradores, áreas e reconhecimentos.' });
  }

  const repository = process.env.GITHUB_REPOSITORY || 'DMOS15/PROGRAMA_IDEIAS';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const fileUrl = `${githubApi}/repos/${repository}/contents/dados/ideias.json`;

  try {
    const currentResult = await githubRequest(`${fileUrl}?ref=${encodeURIComponent(branch)}`);
    let currentFile = null;
    let currentData = null;
    if (currentResult.response.ok) {
      currentFile = currentResult.body;
      if (typeof currentFile.content === 'string' && currentFile.content.trim()) {
        currentData = JSON.parse(Buffer.from(currentFile.content.replace(/\s/g, ''), 'base64').toString('utf8'));
      } else if (currentFile.download_url) {
        const rawResponse = await fetch(currentFile.download_url, {
          headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
          cache: 'no-store'
        });
        if (!rawResponse.ok) {
          console.error('[publish] GitHub raw read failed:', rawResponse.status);
          return sendJson(res, 502, { error: 'Não foi possível validar a versão atual do JSON remoto.' });
        }
        currentData = await rawResponse.json();
      } else {
        return sendJson(res, 502, { error: 'O GitHub não retornou o conteúdo atual de dados/ideias.json.' });
      }
    } else if (currentResult.response.status !== 404) {
      console.error('[publish] GitHub read failed:', currentResult.response.status, currentResult.body.message);
      return sendJson(res, 502, { error: `Não foi possível ler o arquivo atual no GitHub (HTTP ${currentResult.response.status}).` });
    }

    if (currentData) {
      const versionComparison = compareVersions(currentData.metadata?.version, body.data.metadata.version);
      if (versionComparison > 0) {
        return sendJson(res, 409, { error: `O repositório já contém a versão ${currentData.metadata.version}, mais nova que esta carga. Recarregue os dados antes de tentar novamente.` });
      }
      if (versionComparison === 0) {
        if (currentData.metadata?.updatedAt === body.data.metadata.updatedAt) {
          return sendJson(res, 200, { alreadyPublished: true, commitSha: null, history: currentData.historicoAtualizacoes || [] });
        }
        return sendJson(res, 409, { error: 'A versão desta carga diverge da versão remota. Recarregue o portal antes de publicar para evitar perda de dados.' });
      }
    }

    const metrics = {
      ideas: body.data.ideias.length,
      collaborators: body.data.cadastro.filter((person) => String(person?.status || '').trim().toLowerCase() === 'ativo' && String(person?.nome || '').trim()).length,
      areas: new Set([
        ...body.data.cadastro.map((person) => String(person?.area || '').trim()),
        ...body.data.baseDmos.map((person) => String(person?.area || '').trim()),
        ...body.data.ideias.map((idea) => String(idea?.areaTrabalho || idea?.grupo || '').trim())
      ].filter(Boolean)).size
    };
    const historyEntry = {
      timestamp: body.data.metadata.updatedAt,
      file: body.data.metadata.sourceFile || 'dados/ideias.json',
      reason: body.data.metadata.updateReason || 'Atualização da base de ideias',
      responsible: body.data.metadata.uploadedBy || body.data.metadata.updatedBy || 'Administração',
      ...metrics,
      version: body.data.metadata.version
    };
    const previousHistory = Array.isArray(currentData?.historicoAtualizacoes) ? currentData.historicoAtualizacoes : [];
    const submittedHistory = Array.isArray(body.history) ? body.history.slice(0, 5000) : [];
    const historyByIdentity = new Map();
    for (const entry of [...previousHistory, ...submittedHistory, historyEntry]) {
      if (!entry || typeof entry !== 'object' || !entry.timestamp) continue;
      const identity = `${entry.timestamp}|${entry.reason || ''}`;
      if (!historyByIdentity.has(identity)) historyByIdentity.set(identity, entry);
    }
    const history = [...historyByIdentity.values()].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
    const publishedData = {
      ...body.data,
      historicoAtualizacoes: history
    };
    const updateResult = await githubRequest(fileUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Atualiza dados do portal (${body.data.metadata.version})`,
        content: Buffer.from(`${JSON.stringify(publishedData, null, 2)}\n`, 'utf8').toString('base64'),
        sha: currentFile?.sha,
        branch
      })
    });
    if (!updateResult.response.ok) {
      console.error('[publish] GitHub write failed:', updateResult.response.status, updateResult.body.message);
      return sendJson(res, 502, { error: `O GitHub recusou a atualização (HTTP ${updateResult.response.status}).` });
    }
    return sendJson(res, 200, {
      alreadyPublished: false,
      commitSha: updateResult.body.commit?.sha || null,
      history: publishedData.historicoAtualizacoes
    });
  } catch (error) {
    console.error('[publish] Publication failed:', error);
    return sendJson(res, 502, { error: 'Falha ao publicar a carga no GitHub. Verifique as variáveis de ambiente e tente novamente.' });
  }
};
