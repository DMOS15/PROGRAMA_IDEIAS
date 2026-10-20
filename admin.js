const admin$ = (selector) => document.querySelector(selector);
const adminNormalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const findSheet = (workbook, names) => { const wanted = names.map(adminNormalize); const sheetName = workbook.SheetNames.find((name) => wanted.includes(adminNormalize(name)) || wanted.some((item) => adminNormalize(name).includes(item))); return sheetName ? workbook.Sheets[sheetName] : null; };
const valueOf = (row, names) => { const key = Object.keys(row).find((candidate) => names.some((name) => adminNormalize(candidate) === adminNormalize(name))); const value = key ? row[key] : ''; return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value; };
const ideaNumberKey = (value) => String(value ?? '').trim().toLocaleUpperCase('pt-BR');
function consolidateIdeas(ideas, cancelled) {
  const cancelledByNumber = new Map(cancelled.filter((entry) => entry && typeof entry === 'object').map((entry) => [ideaNumberKey(entry.numero), entry]).filter(([number]) => number));
  return ideas.filter((idea) => idea && typeof idea === 'object' && ideaNumberKey(idea.numero)).map((idea) => {
    const cancellation = cancelledByNumber.get(ideaNumberKey(idea.numero));
    return cancellation ? { ...idea, status: 'Cancelado', motivoCancelamento: cancellation.motivo || cancellation.descricao || cancellation.descricaoCurta || '' } : idea;
  });
}
function logIdeaStatusTotals(mainTotal, cancelledTotal, ideas) {
  const countStatus = (status) => ideas.filter((idea) => adminNormalize(idea.status) === adminNormalize(status)).length;
  console.info('[Importação] Quantidade TAB.IDEIAS.TOTAL:', mainTotal);
  console.info('[Importação] Quantidade TAB.cancelada:', cancelledTotal);
  console.info('[Importação] Quantidade Final:', ideas.length);
  console.info('[Importação] Quantidade Canceladas:', countStatus('Cancelado'));
  console.info('[Importação] Quantidade Em andamento:', countStatus('Em andamento'));
  console.info('[Importação] Quantidade Resolvidas:', countStatus('Resolvido'));
  console.info('[Importação] Quantidade Fechadas:', countStatus('Fechado'));
  console.info('[Importação] Quantidade Rascunho:', countStatus('Rascunho'));
}
const uniqueAreas = (values) => [...new Map(values.map((value) => String(value || '').trim().replace(/\s+/g, ' ')).filter(Boolean).map((value) => [adminNormalize(value), value])).values()].sort((left, right) => left.localeCompare(right, 'pt-BR'));
const normalizedPersonName = (value) => adminNormalize(value).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const samePerson = (left, right) => Boolean(normalizedPersonName(left)) && normalizedPersonName(left) === normalizedPersonName(right);
function resolveIdeaPerson(idea, data, activePeople) {
  const dmosMatches = (data.baseDmos || []).filter((entry) => samePerson(idea.enviadoPor, entry.baseDmos));
  const officialNames = [...new Set(dmosMatches.map((entry) => normalizedPersonName(entry.nome)).filter(Boolean))];
  const cadastroMatches = officialNames.length === 1 ? activePeople.filter((person) => samePerson(person.nome, officialNames[0])) : [];
  const cadastroPerson = cadastroMatches.length === 1 ? cadastroMatches[0] : null;
  return { cadastroPerson, dmosMatches };
}
const emptyData = () => ({ metadata: {}, cadastro: [], baseDmos: [], ideias: [], canceladas: [], reconhecidas: { trimestre: [], semestre: [] } });
const historyStorageKey = 'portalHistoricoAtualizacoes';
const dataStorageKey = 'programaIdeiasData';
const backupStorageKey = 'programaIdeiasDataBackup';
const publicationStatusKey = 'portalPublicationStatus';
const githubRepository = { owner: 'DMOS15', name: 'PROGRAMA_IDEIAS', branch: 'main', path: 'dados/ideias.json' };
let activeGitHubToken = '';
const escapeHistoryCell = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const datasetMetrics = (data) => {
  const ideas = Array.isArray(data?.ideias) ? data.ideias.filter((idea) => idea && typeof idea === 'object' && ideaNumberKey(idea.numero)) : [];
  const collaborators = Array.isArray(data?.cadastro) ? data.cadastro.filter((person) => person && typeof person === 'object' && adminNormalize(person.status) === 'ativo' && String(person.nome || '').trim()) : [];
  const areas = uniqueAreas(collaborators.map((person) => person.area)).length || uniqueAreas(ideas.map((idea) => idea.areaTrabalho || idea.grupo)).length || uniqueAreas((data?.baseDmos || []).map((person) => person.area)).length;
  const cancelled = Array.isArray(data?.canceladas) ? data.canceladas.filter((entry) => entry && ideaNumberKey(entry.numero)).length : ideas.filter((idea) => adminNormalize(idea.status) === 'cancelado').length;
  return { ideas: ideas.length, collaborators: collaborators.length, areas, cancelled, subcategories: uniqueAreas(ideas.map((idea) => idea.subcategoria)).length };
};
const validDataset = (data) => {
  const metrics = datasetMetrics(data);
  return metrics.ideas > 0 && metrics.collaborators > 0 && metrics.areas > 0;
};
const readStoredData = (key) => {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return validDataset(value) ? value : null; }
  catch (error) { console.warn(`[Administração] Dados inválidos em ${key}.`, error); return null; }
};
async function loadPublishedData() {
  let publishedData = null;
  try {
    const response = await fetch(`dados/ideias.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (validDataset(data)) publishedData = data;
  } catch (error) { console.info('[Administração] JSON publicado indisponível; verificando LocalStorage.', error); }
  const stored = readStoredData(dataStorageKey);
  return publishedData ? { data: publishedData, source: 'dados/ideias.json', jsonAvailable: true, publishedData } : { data: stored, source: stored ? 'LocalStorage' : 'Indisponível', jsonAvailable: false, publishedData: null };
}
function nextDataVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.0';
}
function compareDataVersions(left, right) {
  const parts = (value) => String(value || '').split('.').map((part) => Number(part) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < 3; index += 1) if ((leftParts[index] || 0) !== (rightParts[index] || 0)) return (leftParts[index] || 0) - (rightParts[index] || 0);
  return 0;
}
async function loadAdminCurrentData() {
  const published = await loadPublishedData();
  const local = readStoredData(dataStorageKey);
  if (local && (!published.data || compareDataVersions(local.metadata?.version, published.data.metadata?.version) > 0)) return { data: local, source: 'LocalStorage' };
  return published;
}
function downloadDataset(data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ideias.json';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
async function githubResponseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `GitHub respondeu HTTP ${response.status}.`);
  return payload;
}
async function publishDatasetToGitHub(data, token) {
  const endpoint = `https://api.github.com/repos/${githubRepository.owner}/${githubRepository.name}/contents/${githubRepository.path}`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const currentResponse = await fetch(`${endpoint}?ref=${githubRepository.branch}`, { headers, cache: 'no-store' });
  const currentFile = await githubResponseJson(currentResponse);
  let currentData;
  if (currentFile.content) {
    const binary = atob(currentFile.content.replace(/\s/g, ''));
    currentData = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } else if (currentFile.download_url) {
    const rawResponse = await fetch(currentFile.download_url, { cache: 'no-store' });
    if (!rawResponse.ok) throw new Error('Não foi possível validar a versão atual do JSON remoto.');
    currentData = await rawResponse.json();
  } else throw new Error('O GitHub não retornou o conteúdo atual de dados/ideias.json.');
  const versionComparison = compareDataVersions(currentData.metadata?.version, data.metadata?.version);
  if (versionComparison > 0) throw new Error(`O repositório já contém a versão ${currentData.metadata.version}, mais nova que esta carga. Recarregue os dados antes de tentar novamente.`);
  if (versionComparison === 0) {
    if (currentData.metadata?.updatedAt === data.metadata?.updatedAt) return { alreadyPublished: true, commitSha: null };
    throw new Error('A versão desta carga diverge da versão remota. Recarregue o portal antes de publicar para evitar perda de dados.');
  }
  const updateResponse = await fetch(endpoint, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: `Atualiza dados do portal (${data.metadata.version})`, content: encodeBase64Utf8(`${JSON.stringify(data, null, 2)}\n`), sha: currentFile.sha, branch: githubRepository.branch })
  });
  const result = await githubResponseJson(updateResponse);
  return { alreadyPublished: false, commitSha: result.commit?.sha || null };
}
function readPublicationStatus() {
  try { return JSON.parse(localStorage.getItem(publicationStatusKey) || 'null'); }
  catch (error) { console.warn('[Publicação] Estado de sincronização local inválido.', error); return null; }
}
function renderUploadSummary(data, fileName = '') {
  const summary = admin$('#upload-summary');
  if (!summary || !data) return;
  const metrics = datasetMetrics(data);
  const updatedAt = data.metadata?.updatedAt ? new Date(data.metadata.updatedAt) : null;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleString('pt-BR') : 'Não informada';
  summary.innerHTML = `<div style="display:grid;gap:12px">${fileName ? `<div><strong>Arquivo selecionado</strong><div>${escapeHistoryCell(fileName)}</div></div>` : ''}<div><strong>Resumo da carga</strong><div>${metrics.ideas} ideias · ${metrics.collaborators} colaboradores · ${metrics.areas} áreas</div><small>Última atualização: ${escapeHistoryCell(updatedLabel)}</small></div></div>`;
  summary.hidden = false;
}
function updatePublishButton() {
  const button = admin$('#publish-portal');
  if (!button) return;
  const hasPendingData = Boolean(readStoredData(dataStorageKey));
  button.disabled = !hasPendingData || button.dataset.publishing === 'true';
  button.title = !hasPendingData ? 'Carregue e valide um arquivo antes de publicar.' : !activeGitHubToken ? 'Conecte um token do GitHub na configuração avançada para publicar.' : '';
}
async function renderPublicationCard(loadedData) {
  const target = admin$('#publication-status');
  if (!target) return;
  const loaded = loadedData || await loadPublishedData();
  const data = loaded.data;
  const metrics = data ? datasetMetrics(data) : { ideas: 0, collaborators: 0, areas: 0 };
  const sync = readPublicationStatus();
  const local = readStoredData(dataStorageKey);
  const hasUnpublishedLocal = Boolean(local && (!loaded.publishedData || compareDataVersions(local.metadata?.version, loaded.publishedData.metadata?.version) > 0));
  const pendingVersion = hasUnpublishedLocal ? local.metadata?.version : data?.metadata?.version;
  const remoteConfirmsCommit = Boolean(sync?.status === 'committed' && loaded.publishedData?.metadata?.version === sync.version && loaded.publishedData?.metadata?.updatedAt === local?.metadata?.updatedAt);
  const isPublished = Boolean(!hasUnpublishedLocal && (sync?.status === 'published' || remoteConfirmsCommit) && sync.version === data?.metadata?.version);
  const isCommitted = Boolean(sync?.status === 'committed' && sync.version === pendingVersion);
  const statusText = isPublished ? 'Publicado no GitHub Pages' : isCommitted ? 'Commit enviado; aguardando GitHub Pages' : hasUnpublishedLocal ? 'Carga validada, aguardando publicação' : loaded.source === 'LocalStorage' ? 'Carga validada, aguardando publicação' : 'Portal publicado';
  const updatedAt = data?.metadata?.updatedAt ? new Date(data.metadata.updatedAt) : null;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleString('pt-BR') : 'Não informada';
  const syncedAt = sync?.syncedAt ? new Date(sync.syncedAt) : null;
  const syncedLabel = (isPublished || isCommitted) && syncedAt && !Number.isNaN(syncedAt.getTime()) ? syncedAt.toLocaleString('pt-BR') : loaded.source === 'dados/ideias.json' ? 'Conforme JSON publicado' : 'Pendente';
  target.innerHTML = `<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:14px 0"><div><dt>Status</dt><dd>${escapeHistoryCell(statusText)}</dd></div><div><dt>Última atualização</dt><dd>${escapeHistoryCell(updatedLabel)}</dd></div><div><dt>Última sincronização</dt><dd>${escapeHistoryCell(syncedLabel)}</dd></div><div><dt>Versão</dt><dd>${escapeHistoryCell(data?.metadata?.version || 'Não informada')}</dd></div><div><dt>Quantidade de ideias</dt><dd>${metrics.ideas}</dd></div><div><dt>Quantidade de colaboradores</dt><dd>${metrics.collaborators}</dd></div><div><dt>Quantidade de áreas</dt><dd>${metrics.areas}</dd></div></dl>`;
}
async function waitForGitHubPages(data, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`dados/ideias.json?v=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) {
        const published = await response.json();
        if (published.metadata?.version === data.metadata?.version && published.metadata?.updatedAt === data.metadata?.updatedAt) return true;
      }
    } catch (error) { console.info('[Publicação] Aguardando o GitHub Pages disponibilizar o JSON.', error); }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  return false;
}
async function publishCurrentDataset() {
  const button = admin$('#publish-portal');
  const message = admin$('#upload-message');
  if (!activeGitHubToken) {
    admin$('#advanced-publication').open = true;
    admin$('#github-token-status').textContent = 'Conecte um token fine-grained para publicar a carga validada.';
    admin$('#github-token').focus();
    return;
  }
  button.dataset.publishing = 'true';
  button.textContent = 'Publicando...';
  button.disabled = true;
  try {
    const loaded = await loadAdminCurrentData();
    if (!loaded.data || !validDataset(loaded.data)) throw new Error('Não há uma carga válida para publicar.');
    const result = await publishDatasetToGitHub(loaded.data, activeGitHubToken);
    const status = { status: 'committed', version: loaded.data.metadata?.version, syncedAt: new Date().toISOString(), commitSha: result.commitSha };
    localStorage.setItem(publicationStatusKey, JSON.stringify(status));
    message.style.color = '';
    button.textContent = 'Verificando publicação...';
    const isPublished = await waitForGitHubPages(loaded.data);
    if (isPublished) {
      status.status = 'published';
      localStorage.setItem(publicationStatusKey, JSON.stringify(status));
      message.textContent = result.alreadyPublished ? 'Esta versão já está publicada no GitHub Pages.' : 'Portal atualizado e confirmado no GitHub Pages.';
    } else {
      message.textContent = result.alreadyPublished ? 'O repositório já contém esta versão; o GitHub Pages ainda está propagando os dados.' : 'Commit criado no GitHub. O GitHub Pages ainda não confirmou a nova base; aguarde alguns instantes e atualize a página.';
    }
    await refreshDataDiagnostic();
  } catch (error) {
    console.error('[Publicação] Falha ao atualizar o portal:', error);
    message.style.color = 'var(--red)';
    message.textContent = `Não foi possível atualizar o portal: ${error.message}`;
    const status = readPublicationStatus();
    if (status) { status.status = 'error'; localStorage.setItem(publicationStatusKey, JSON.stringify(status)); }
    await refreshDataDiagnostic();
  } finally {
    button.dataset.publishing = 'false';
    button.textContent = 'Atualizar Portal';
    updatePublishButton();
  }
}
function setupAdminReliabilityUI() {
  const guidance = admin$('#admin-panel > p');
  if (guidance) guidance.textContent = 'Importe a planilha e publique uma carga validada diretamente no portal.';
  const adminNote = admin$('.admin-footer');
  if (adminNote) adminNote.textContent = 'A integração usa um token fine-grained do GitHub apenas nesta sessão. Restrinja-o a este repositório, conceda somente Contents: Read and write e configure expiração; o token nunca é salvo no navegador.';
  const uploadBox = admin$('.upload-box');
  if (!uploadBox) return;
  const excelInput = admin$('#excel-upload');
  if (excelInput) excelInput.accept = '.xlsx,.xls';
  const excelLabel = uploadBox.querySelector('.upload-label');
  if (excelLabel) excelLabel.textContent = 'Selecionar Excel';
  uploadBox.closest('.admin-section')?.querySelector('p')?.remove();
  const publishButton = document.createElement('button');
  publishButton.type = 'button';
  publishButton.id = 'publish-portal';
  publishButton.className = 'admin-action';
  publishButton.textContent = 'Atualizar Portal';
  publishButton.disabled = true;
  publishButton.style.cssText = 'margin-top:18px;padding:13px 22px;cursor:pointer';
  const summary = document.createElement('div');
  summary.id = 'upload-summary';
  summary.hidden = true;
  summary.style.cssText = 'margin-top:20px;padding:18px;border:1px solid var(--line);text-align:left';
  uploadBox.append(summary);
  uploadBox.append(publishButton);
  const publicationCard = document.createElement('section');
  publicationCard.className = 'admin-section';
  publicationCard.id = 'publication-card';
  publicationCard.innerHTML = '<h2>Status da Publicação</h2><div id="publication-status"></div>';
  uploadBox.closest('.admin-section')?.after(publicationCard);
  const advanced = document.createElement('details');
  advanced.className = 'admin-section';
  advanced.id = 'advanced-publication';
  advanced.innerHTML = '<summary style="cursor:pointer;font-weight:700">Configuração avançada da publicação</summary><p>Use um token fine-grained com acesso somente a Contents: Read and write neste repositório. O token é usado apenas nesta sessão e não é armazenado.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0"><label>Responsável pela carga<input id="upload-responsible" type="text" value="Administração" autocomplete="name"></label><label>Justificativa<input id="upload-reason" type="text" value="Atualização da base de ideias" maxlength="240"></label></div><label for="github-token">Token pessoal do GitHub</label><input id="github-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_..." style="display:block;width:min(100%,520px);margin:8px 0;padding:12px"><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="admin-action" id="connect-github">Conectar nesta sessão</button><button type="button" class="admin-action" id="download-data">Baixar JSON</button><button type="button" class="admin-action" id="restore-data" hidden>Restaurar última base</button></div><small id="github-token-status" role="status"></small>';
  publicationCard.after(advanced);
  const historySection = [...document.querySelectorAll('.admin-section')].find((section) => section.querySelector('#history-body'));
  if (historySection) {
    const diagnostic = document.createElement('section');
    diagnostic.className = 'admin-section';
    diagnostic.innerHTML = '<h2>Diagnóstico técnico</h2><div id="data-diagnostic" role="status">Carregando estado das bases...</div>';
    historySection.before(diagnostic);
    const header = historySection.querySelector('thead tr');
    if (header && ![...header.cells].some((cell) => cell.textContent.trim() === 'Responsável')) {
      const cell = document.createElement('th');
      cell.textContent = 'Responsável';
      header.append(cell);
    }
  }
  advanced.append(publicationCard);
  if (historySection) advanced.append(historySection);
  const diagnosticSection = [...document.querySelectorAll('.admin-section')].find((section) => section.querySelector('#data-diagnostic'));
  if (diagnosticSection) advanced.append(diagnosticSection);
  const recognitionSection = admin$('#recognition-form')?.closest('.admin-section');
  if (recognitionSection) advanced.append(recognitionSection);
  const footer = admin$('.admin-footer');
  if (footer) advanced.append(footer);
  admin$('#download-data').addEventListener('click', async () => {
    const data = (await loadAdminCurrentData()).data;
    if (!data) { admin$('#upload-message').textContent = 'Não existe uma base válida para exportar.'; return; }
    downloadDataset(data);
  });
  admin$('#restore-data').addEventListener('click', () => {
    const backup = readStoredData(backupStorageKey);
    if (!backup) { admin$('#upload-message').textContent = 'Nenhuma base válida de recuperação foi encontrada.'; return; }
    localStorage.setItem(dataStorageKey, JSON.stringify(backup));
    admin$('#upload-message').textContent = `Base ${backup.metadata?.version || ''} restaurada no LocalStorage. Baixe o JSON para publicá-la.`;
    refreshDataDiagnostic();
  });
  admin$('#connect-github').addEventListener('click', () => {
    const field = admin$('#github-token');
    activeGitHubToken = field.value.trim();
    field.value = '';
    admin$('#github-token-status').textContent = activeGitHubToken ? 'Credencial ativa somente nesta sessão.' : 'Informe um token válido.';
    updatePublishButton();
  });
  publishButton.addEventListener('click', publishCurrentDataset);
  renderPublicationCard();
  loadAdminCurrentData().then(({ data }) => renderUploadSummary(data)).catch((error) => console.warn('[Administração] Não foi possível carregar o resumo inicial.', error));
}
async function refreshDataDiagnostic() {
  const target = admin$('#data-diagnostic');
  if (!target) return;
  const published = await loadPublishedData();
  const local = readStoredData(dataStorageKey);
  const backup = readStoredData(backupStorageKey);
  const data = published.data;
  const sync = readPublicationStatus();
  const localIsNewer = Boolean(local && (!published.publishedData || compareDataVersions(local.metadata?.version, published.publishedData.metadata?.version) > 0));
  const remoteConfirmsCommit = Boolean(sync?.status === 'committed' && published.publishedData?.metadata?.version === sync.version && published.publishedData?.metadata?.updatedAt === local?.metadata?.updatedAt);
  const isPublished = Boolean(!localIsNewer && (sync?.status === 'published' || remoteConfirmsCommit) && sync.version === data?.metadata?.version);
  if (remoteConfirmsCommit) {
    sync.status = 'published';
    localStorage.setItem(publicationStatusKey, JSON.stringify(sync));
  }
  const isCommitted = Boolean(sync?.status === 'committed' && sync.version === local?.metadata?.version);
  const syncedAt = sync?.syncedAt ? new Date(sync.syncedAt) : null;
  const syncedLabel = (isPublished || isCommitted) && syncedAt && !Number.isNaN(syncedAt.getTime()) ? syncedAt.toLocaleString('pt-BR') : published.source === 'dados/ideias.json' ? 'Conforme JSON publicado' : 'Pendente';
  const portalStatus = isPublished ? 'Publicado no GitHub Pages' : isCommitted ? 'Commit enviado; deploy do Pages pendente' : localIsNewer ? 'Carga validada; publicação pendente' : published.source === 'dados/ideias.json' ? 'Publicado' : 'Pendente de publicação';
  target.innerHTML = `<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:16px 0 0"><div><dt>Portal atualizado</dt><dd>${portalStatus}</dd></div><div><dt>Última sincronização</dt><dd>${escapeHistoryCell(syncedLabel)}</dd></div><div><dt>Versão</dt><dd>${escapeHistoryCell(data?.metadata?.version || 'Não informada')}</dd></div><div><dt>Fonte dos dados</dt><dd>${escapeHistoryCell(published.source)}</dd></div></dl>`;
  if (local && (!published.publishedData || compareDataVersions(local.metadata?.version, published.publishedData.metadata?.version) > 0)) admin$('#publish-portal').disabled = !activeGitHubToken;
  await renderPublicationCard(published);
  updatePublishButton();
  const restoreButton = admin$('#restore-data');
  if (restoreButton) restoreButton.hidden = !backup;
}
function loadUpdateHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.warn('[Histórico] Dados locais inválidos; iniciando sem registros salvos.', error);
    return [];
  }
}
function renderUpdateHistory() {
  const body = admin$('#history-body');
  const history = loadUpdateHistory();
  if (!body) return;
  if (!history.length) { body.innerHTML = '<tr><td colspan="7">Nenhuma atualização registrada neste navegador.</td></tr>'; return; }
  body.innerHTML = history.map((entry) => {
    const date = new Date(entry.timestamp);
    const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
    return `<tr><td>${escapeHistoryCell(dateLabel)}</td><td>${escapeHistoryCell(entry.file)}</td><td>${escapeHistoryCell(entry.reason)}</td><td>${escapeHistoryCell(entry.ideas)}</td><td>${escapeHistoryCell(entry.collaborators)}</td><td>${escapeHistoryCell(entry.areas)}</td><td>${escapeHistoryCell(entry.responsible)}</td></tr>`;
  }).join('');
}
function saveUpdateHistory(entry) {
  const history = loadUpdateHistory();
  history.unshift(entry);
  localStorage.setItem(historyStorageKey, JSON.stringify(history));
  renderUpdateHistory();
}
function commitValidatedUpload(data, previous, historyEntry) {
  const previousData = localStorage.getItem(dataStorageKey);
  const previousBackup = localStorage.getItem(backupStorageKey);
  const previousHistory = localStorage.getItem(historyStorageKey);
  try {
    if (previous && validDataset(previous)) localStorage.setItem(backupStorageKey, JSON.stringify(previous));
    localStorage.setItem(dataStorageKey, JSON.stringify(data));
    saveUpdateHistory(historyEntry);
  } catch (error) {
    const restore = (key, value) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
    try {
      restore(dataStorageKey, previousData);
      restore(backupStorageKey, previousBackup);
      restore(historyStorageKey, previousHistory);
      renderUpdateHistory();
    } catch (restoreError) { console.error('[Administração] Falha ao restaurar o estado anterior do LocalStorage.', restoreError); }
    throw error;
  }
}
async function addRecognitionSubcategoryField() {
  const form = admin$('#recognition-form');
  const photo = admin$('#recognition-photo');
  if (!form || !photo) return;
  const ideas = (await loadPublishedData()).data?.ideias || [];
  const options = [...new Set(ideas.map((idea) => String(idea.subcategoria || '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'pt-BR'));
  const label = document.createElement('label');
  label.textContent = 'Subcategoria';
  const select = document.createElement('select');
  select.id = 'recognition-subcategory';
  select.innerHTML = '<option value="">Selecione uma subcategoria</option>';
  options.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  label.append(select);
  photo.closest('label')?.before(label);
}
addRecognitionSubcategoryField();
setupAdminReliabilityUI();
renderUpdateHistory();
refreshDataDiagnostic();

admin$('#admin-pin-form').addEventListener('submit', (event) => { event.preventDefault(); if (admin$('#admin-pin').value === 'JDEPIU') { admin$('#admin-gate').style.display = 'none'; admin$('#admin-panel').style.display = 'block'; refreshDataDiagnostic(); } else admin$('#admin-error').textContent = 'PIN incorreto. Tente novamente.'; });
admin$('#excel-upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    let data;
    admin$('#upload-summary').hidden = true;
    if (file.name.toLowerCase().endsWith('.json')) data = JSON.parse(await file.text());
    else {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ideaSheetName = workbook.SheetNames.find((name) => adminNormalize(name) === 'tab.ideias.total') || workbook.SheetNames.find((name) => adminNormalize(name) === 'tabela ideias');
      if (!ideaSheetName) throw new Error('Aba TAB.IDEIAS.TOTAL não encontrada.');
      const ideaSheet = workbook.Sheets[ideaSheetName];
      if (!ideaSheet['!ref']) throw new Error('Aba TAB.IDEIAS.TOTAL sem dados.');
      const ideaRows = XLSX.utils.sheet_to_json(ideaSheet, { defval: '', raw: false });
      console.info('[Importação] Aba principal:', ideaSheetName, 'Range:', ideaSheet['!ref']);
      console.info('[Importação] Quantidade lida da TAB.IDEIAS.TOTAL:', ideaRows.length);
      const cancelSheet = findSheet(workbook, ['canceladas', 'ideias canceladas', 'tab.cancelada']);
      const cadastroSheet = findSheet(workbook, ['cadastro']);
      const dmosSheet = findSheet(workbook, ['base dmos', 'tab.colab']);
      const cancelRows = cancelSheet ? XLSX.utils.sheet_to_json(cancelSheet, { defval: '', raw: false }) : [];
      const peopleRows = cadastroSheet ? XLSX.utils.sheet_to_json(cadastroSheet, { defval: '', raw: false }) : [];
      const dmosRows = dmosSheet ? XLSX.utils.sheet_to_json(dmosSheet, { defval: '', raw: false }) : [];
      const ideiasPrincipais = ideaRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), descricaoCurta: valueOf(row, ['Descrição curta']), descricao: valueOf(row, ['Descrição', 'Descrição da dúvida']), status: valueOf(row, ['Status']), enviadoPor: valueOf(row, ['Enviado por']), subcategoria: valueOf(row, ['Subcategoria', 'Sub categoria']), criada: valueOf(row, ['Criada']), areaTrabalho: valueOf(row, ['Área de trabalho']), atualizado: valueOf(row, ['Atualizado']), atribuidoA: valueOf(row, ['Atribuído a', 'Atribuído']), grupoAtribuicao: valueOf(row, ['Grupo de atribuição']), fechado: valueOf(row, ['Fechado']), grupo: valueOf(row, ['Grupo']), autor: valueOf(row, ['Enviado por']) })).filter((idea) => ideaNumberKey(idea.numero));
      data = { metadata: { updatedAt: new Date().toISOString(), version: '1.0.0', updateReason: 'Upload via administração', updatedBy: 'Administração' }, cadastro: peopleRows.filter((row) => adminNormalize(valueOf(row, ['STATUS', 'Status'])) === 'ativo').map((row) => ({ nome: valueOf(row, ['NOME', 'Nome']), turno: valueOf(row, ['TURNO', 'Turno']), turnoComp: valueOf(row, ['TURNO COMP']), coordenador: valueOf(row, ['COORDENADOR', 'Coordenador']), funcao: valueOf(row, ['FUNÇÃO', 'Função']), status: valueOf(row, ['STATUS', 'Status']), area: valueOf(row, ['ÁREA', 'Área']) })), baseDmos: dmosRows.map((row) => ({ baseDmos: valueOf(row, ['Base DMOS']), nome: valueOf(row, ['NOME', 'Nome']), tipo: valueOf(row, ['TIPO', 'Tipo']), cargo: valueOf(row, ['CARGO', 'Cargo']), area: valueOf(row, ['AREA', 'Área']), coordenador: valueOf(row, ['COORDENADOR', 'Coordenador']) })), ideias: ideiasPrincipais, canceladas: cancelRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), motivo: valueOf(row, ['Descrição curta', 'Descrição', 'Motivo do cancelamento']) })).filter((row) => ideaNumberKey(row.numero)), reconhecidas: { trimestre: [], semestre: [] } };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('O arquivo não contém um objeto de dados válido.');
    data.cadastro = Array.isArray(data.cadastro) ? data.cadastro : [];
    data.baseDmos = Array.isArray(data.baseDmos) ? data.baseDmos : [];
    data.canceladas = Array.isArray(data.canceladas) ? data.canceladas : [];
    const ideiasOriginais = Array.isArray(data.ideias) ? data.ideias : [];
    data.ideias = consolidateIdeas(ideiasOriginais, data.canceladas);
    logIdeaStatusTotals(ideiasOriginais.length, data.canceladas.length, data.ideias);
    const current = await loadAdminCurrentData();
    const previousMetrics = current.data ? datasetMetrics(current.data) : null;
    const cadastroAreas = uniqueAreas((data.cadastro || []).map((person) => person.area));
    const ideaAreas = uniqueAreas((data.ideias || []).map((idea) => idea.areaTrabalho || idea.grupo));
    const dmosAreas = uniqueAreas((data.baseDmos || []).map((person) => person.area));
    const activePeople = (data.cadastro || []).filter((person) => adminNormalize(person.status) === 'ativo');
    const linkedIdeas = (data.ideias || []).map((idea) => ({ idea, ...resolveIdeaPerson(idea, data, activePeople) }));
    const associatedIdeas = linkedIdeas.filter((entry) => entry.cadastroPerson);
    const unmatchedIdeas = linkedIdeas.filter((entry) => !entry.cadastroPerson);
    console.info('[Importação] Áreas únicas no CADASTRO:', cadastroAreas);
    console.info('[Importação] Áreas únicas nas IDEIAS (Área de trabalho/Grupo):', ideaAreas);
    console.info('[Importação] Áreas únicas na BASE DMOS:', dmosAreas);
    console.info('Total ideias importadas:', data.ideias.length);
    console.info('Total colaboradores ativos:', activePeople.length);
    console.info('Total ideias associadas:', associatedIdeas.length);
    console.info('Total ideias sem correspondência:', unmatchedIdeas.length);
    console.info('Primeiras 100 associações realizadas:');
    console.table(associatedIdeas.slice(0, 100).map(({ idea, cadastroPerson, dmosMatches }) => ({ 'Número ideia': idea.numero, 'Enviado por': idea.enviadoPor, 'Base DMOS encontrado': dmosMatches.map((entry) => entry.baseDmos || '').filter(Boolean).join(' | '), 'Nome oficial encontrado': cadastroPerson.nome, Status: 'Associada' })));
    console.info('20 primeiras ideias sem correspondência:');
    console.table(unmatchedIdeas.slice(0, 20).map(({ idea, dmosMatches }) => ({ numero: idea.numero, enviadoPor: idea.enviadoPor, baseDMOS: dmosMatches.map((entry) => entry.baseDmos || '').filter(Boolean).join(' | '), nomesTAB_COLAB: dmosMatches.map((entry) => entry.nome).filter(Boolean).join(' | '), status: 'Sem correspondência' })));
    const areaCount = cadastroAreas.length || ideaAreas.length || dmosAreas.length;
    const metrics = datasetMetrics(data);
    console.info('[Validação] Ideias:', metrics.ideas, 'Colaboradores:', metrics.collaborators, 'Áreas:', metrics.areas, 'Canceladas:', metrics.cancelled, 'Subcategorias:', metrics.subcategories);
    if (!validDataset(data)) throw new Error('Carga bloqueada: ideias, colaboradores ativos e áreas precisam ser maiores que zero.');
    const decreases = previousMetrics && ['ideas', 'collaborators', 'areas'].some((key) => metrics[key] < previousMetrics[key]);
    if (decreases && !window.confirm('ATENÇÃO: a nova carga possui menos registros que a anterior.\n\nDeseja substituir a base mesmo assim?')) throw new Error('Carga cancelada após alerta de redução de registros.');
    const timestamp = new Date().toISOString();
    const responsible = admin$('#upload-responsible').value.trim() || 'Administração';
    const reason = admin$('#upload-reason').value.trim() || 'Atualização da base de ideias';
    data.metadata = { ...(data.metadata && typeof data.metadata === 'object' ? data.metadata : {}), updatedAt: timestamp, version: nextDataVersion(current.data?.metadata?.version), recordCount: metrics.ideas, uploadedBy: responsible, sourceFile: file.name, updateReason: reason };
    const historyEntry = { timestamp, file: file.name, reason, responsible, ideas: metrics.ideas, collaborators: metrics.collaborators, areas: metrics.areas };
    commitValidatedUpload(data, current.data, historyEntry);
    renderUploadSummary(data, file.name);
    admin$('#upload-message').style.color = '';
    admin$('#upload-message').textContent = `Carga ${data.metadata.version} processada e validada. Pronta para publicação.`;
    updatePublishButton();
    refreshDataDiagnostic();
  } catch (error) { console.error('[Importação] Falha ao processar arquivo:', error); admin$('#upload-message').style.color = 'var(--red)'; admin$('#upload-message').textContent = `Não foi possível concluir a carga. ${error.message} A última base válida foi mantida.`; }
});
admin$('#recognition-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = admin$('#recognition-message');
  try {
    const current = await loadAdminCurrentData();
    if (!current.data || !validDataset(current.data)) throw new Error('Carregue uma base válida antes de cadastrar reconhecimentos.');
    const saved = { ...current.data, reconhecidas: { trimestre: [...(current.data.reconhecidas?.trimestre || [])], semestre: [...(current.data.reconhecidas?.semestre || [])] } };
    const file = admin$('#recognition-photo').files[0];
    const photo = file ? await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }) : '';
    const reason = admin$('#recognition-reason').value.trim() || 'Cadastro de reconhecimento';
    saved.reconhecidas[admin$('#recognition-period').value].unshift({ titulo: admin$('#recognition-title').value, autor: admin$('#recognition-author').value, area: admin$('#recognition-area').value, subcategoria: admin$('#recognition-subcategory').value, motivo: reason, foto: photo });
    const timestamp = new Date().toISOString();
    const metrics = datasetMetrics(saved);
    const responsible = admin$('#upload-responsible').value.trim() || 'Administração';
    saved.metadata = { ...saved.metadata, updatedAt: timestamp, version: nextDataVersion(current.data.metadata?.version), recordCount: metrics.ideas, uploadedBy: responsible, updateReason: reason };
    commitValidatedUpload(saved, current.data, { timestamp, file: 'Reconhecimento administrativo', reason, responsible, ideas: metrics.ideas, collaborators: metrics.collaborators, areas: metrics.areas });
    message.textContent = 'Reconhecimento salvo. Baixe e publique o JSON para disponibilizar a atualização a todos.';
    event.target.reset();
    refreshDataDiagnostic();
  } catch (error) {
    console.error('[Reconhecimento] Falha ao salvar cadastro:', error);
    message.textContent = `Não foi possível salvar o reconhecimento. ${error.message}`;
  }
});
