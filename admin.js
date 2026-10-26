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
const recognitionsBackupStorageKey = 'programaIdeiasRecognitionsBackup';
const publicationStatusKey = 'portalPublicationStatus';
const publishApiUrl = window.PORTAL_API_URL ? `${window.PORTAL_API_URL.replace(/\/+$/, '')}/api/publish` : '/api/publish';
let adminPin = '';
try { localStorage.removeItem('portalGitHubToken'); } catch (error) { console.warn('[Administração] Não foi possível remover um token antigo salvo neste navegador.', error); }
let lastPublishedAt = '';
let recognitionEditing = null;
let pendingAdminData = null;
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
function readRecognitionsBackup() {
  try {
    const data = JSON.parse(localStorage.getItem(recognitionsBackupStorageKey) || 'null');
    if (!data || !Array.isArray(data.trimestre) || !Array.isArray(data.semestre)) return null;
    return { trimestre: data.trimestre, semestre: data.semestre };
  } catch (error) {
    console.warn('[Reconhecimento] Backup específico de reconhecimentos inválido.', error);
    return null;
  }
}
function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
  }
  return value;
}
function sameRecognitionLists(left, right) {
  return JSON.stringify(stableJsonValue(left?.reconhecidas || { trimestre: [], semestre: [] }))
    === JSON.stringify(stableJsonValue(right?.reconhecidas || { trimestre: [], semestre: [] }));
}
async function loadPublishedData() {
  let publishedData = null;
  try {
    const response = await fetch(`dados/ideias.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (validDataset(data)) publishedData = data;
  } catch (error) { console.info('[Administração] JSON publicado indisponível; verificando LocalStorage.', error); }
  const remoteData = publishedData;
  const stored = readStoredData(dataStorageKey);
  let savedRecognitions = readRecognitionsBackup();
  if (savedRecognitions && remoteData && sameRecognitionLists(remoteData, { reconhecidas: savedRecognitions })) {
    try { localStorage.removeItem(recognitionsBackupStorageKey); }
    catch (error) { console.warn('[Reconhecimento] Não foi possível limpar o backup já publicado.', error); }
    savedRecognitions = null;
  }
  if (savedRecognitions) {
    const pendingBase = stored && (!remoteData || compareDataVersions(stored.metadata?.version, remoteData.metadata?.version) > 0) ? stored : remoteData || stored;
    if (pendingBase) {
      const recognitionChangeIsStored = sameRecognitionLists(pendingBase, { reconhecidas: savedRecognitions });
      publishedData = {
        ...pendingBase,
        metadata: {
          ...pendingBase.metadata,
          version: recognitionChangeIsStored ? pendingBase.metadata?.version : nextDataVersion(pendingBase.metadata?.version),
          updatedAt: recognitionChangeIsStored ? pendingBase.metadata?.updatedAt : new Date().toISOString(),
          updateReason: recognitionChangeIsStored ? pendingBase.metadata?.updateReason : 'Alterações locais de reconhecimentos pendentes'
        },
        reconhecidas: savedRecognitions
      };
    }
  }
  return publishedData ? { data: publishedData, source: savedRecognitions ? 'LocalStorage' : 'dados/ideias.json', jsonAvailable: Boolean(remoteData), publishedData: remoteData } : { data: stored, source: stored ? 'LocalStorage' : 'Indisponível', jsonAvailable: false, publishedData: null };
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
  if (pendingAdminData) return { data: pendingAdminData, source: 'LocalStorage' };
  const published = await loadPublishedData();
  const local = readStoredData(dataStorageKey);
  if (local && (!published.data || compareDataVersions(local.metadata?.version, published.data.metadata?.version) > 0)) {
    const savedRecognitions = readRecognitionsBackup();
    if (!savedRecognitions) return { ...published, data: local, source: 'LocalStorage' };
    const recognitionChangeIsStored = sameRecognitionLists(local, { reconhecidas: savedRecognitions });
    return {
      ...published,
      data: {
        ...local,
        metadata: {
          ...local.metadata,
          version: recognitionChangeIsStored ? local.metadata?.version : nextDataVersion(local.metadata?.version),
          updatedAt: recognitionChangeIsStored ? local.metadata?.updatedAt : new Date().toISOString(),
          updateReason: recognitionChangeIsStored ? local.metadata?.updateReason : 'Alterações locais de reconhecimentos pendentes'
        },
        reconhecidas: savedRecognitions
      },
      source: 'LocalStorage'
    };
  }
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
async function callPublishApi(payload) {
  const response = await fetch(publishApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  let result;
  try { result = await response.json(); } catch (error) { throw new Error(`A API de publicação retornou uma resposta inválida (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(result.error || `Falha na API de publicação (HTTP ${response.status}).`);
  return result;
}
async function publishDataset(data) {
  if (!adminPin) throw new Error('A sessão administrativa expirou. Informe o PIN novamente.');
  return callPublishApi({ action: 'publish', pin: adminPin, data, history: loadUpdateHistory() });
}
function readPublicationStatus() {
  try { return JSON.parse(localStorage.getItem(publicationStatusKey) || 'null'); }
  catch (error) { console.warn('[Publicação] Estado de sincronização local inválido.', error); return null; }
}
function renderPublicationTargetSummary(loadedData) {
  const target = admin$('#publication-target-summary');
  if (!target) return;
  const publishedAt = loadedData?.publishedData?.metadata?.updatedAt;
  const sync = readPublicationStatus();
  if (sync?.status === 'published' && sync.syncedAt) lastPublishedAt = sync.syncedAt;
  else if (publishedAt) lastPublishedAt = publishedAt;
  const date = lastPublishedAt ? new Date(lastPublishedAt) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('pt-BR') : 'Nenhuma publicação registrada';
  target.innerHTML = `<strong>Publicação protegida pela API</strong><div>Destino: dados/ideias.json</div><div>Última publicação: ${escapeHistoryCell(dateLabel)}</div>`;
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
  const hasPendingData = Boolean(pendingAdminData || readStoredData(dataStorageKey) || readRecognitionsBackup());
  button.disabled = !hasPendingData || button.dataset.publishing === 'true';
  button.title = !hasPendingData ? 'Carregue e valide um arquivo antes de publicar.' : '';
}
async function renderPublicationCard(loadedData) {
  const target = admin$('#publication-status');
  if (!target) return;
  const loaded = loadedData || await loadAdminCurrentData();
  renderPublicationTargetSummary(loaded);
  const data = loaded.data;
  const sync = readPublicationStatus();
  const local = readStoredData(dataStorageKey);
  const hasUnpublishedLocal = Boolean(local && (!loaded.publishedData || compareDataVersions(local.metadata?.version, loaded.publishedData.metadata?.version) > 0));
  const pendingVersion = hasUnpublishedLocal ? local.metadata?.version : data?.metadata?.version;
  const remoteConfirmsCommit = Boolean(sync?.status === 'committed' && loaded.publishedData?.metadata?.version === sync.version && loaded.publishedData?.metadata?.updatedAt === local?.metadata?.updatedAt);
  const isPublished = Boolean(!hasUnpublishedLocal && (sync?.status === 'published' || remoteConfirmsCommit) && sync.version === data?.metadata?.version);
  const isCommitted = Boolean(sync?.status === 'committed' && sync.version === pendingVersion);
  const statusText = isPublished ? 'Publicado no portal' : isCommitted ? 'Commit enviado; aguardando deploy' : hasUnpublishedLocal ? 'Carga validada, aguardando publicação' : loaded.source === 'LocalStorage' ? 'Carga validada, aguardando publicação' : 'Portal publicado';
  const updatedAt = data?.metadata?.updatedAt ? new Date(data.metadata.updatedAt) : null;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleString('pt-BR') : 'Não informada';
  const syncedAt = sync?.syncedAt ? new Date(sync.syncedAt) : null;
  const syncedLabel = (isPublished || isCommitted) && syncedAt && !Number.isNaN(syncedAt.getTime()) ? syncedAt.toLocaleString('pt-BR') : loaded.source === 'dados/ideias.json' ? 'Conforme JSON publicado' : 'Pendente';
  target.innerHTML = `<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:14px 0"><div><dt>Status da publicação</dt><dd>${escapeHistoryCell(statusText)}</dd></div><div><dt>Última atualização</dt><dd>${escapeHistoryCell(updatedLabel)}</dd></div></dl>`;
}
async function waitForPortalDeployment(data, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`dados/ideias.json?v=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) {
        const published = await response.json();
        if (published.metadata?.version === data.metadata?.version && published.metadata?.updatedAt === data.metadata?.updatedAt) return true;
      }
    } catch (error) { console.info('[Publicação] Aguardando o deploy disponibilizar o JSON.', error); }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  return false;
}
async function publishCurrentDataset() {
  const button = admin$('#publish-portal'); const message = admin$('#upload-message');
  button.dataset.publishing = 'true'; button.textContent = 'Publicando...'; button.disabled = true;
  try {
    const loaded = await loadAdminCurrentData();
    if (!loaded.data || !validDataset(loaded.data)) throw new Error('Não há uma carga válida para publicar.');
    const result = await publishDataset(loaded.data);
    const status = { status: 'committed', version: loaded.data.metadata?.version, syncedAt: new Date().toISOString(), commitSha: result.commitSha };
    try { localStorage.setItem(publicationStatusKey, JSON.stringify(status)); } catch (error) { console.warn('[Publicação] Não foi possível salvar o status local da publicação.', error); }
    if (Array.isArray(result.history)) renderUpdateHistory({ historicoAtualizacoes: result.history });
    message.style.color = ''; button.textContent = 'Verificando publicação...';
    const isPublished = await waitForPortalDeployment(loaded.data);
    if (isPublished) {
      status.status = 'published';
      try { localStorage.setItem(publicationStatusKey, JSON.stringify(status)); } catch (error) { console.warn('[Publicação] Não foi possível salvar o status local da publicação.', error); }
      message.textContent = result.alreadyPublished ? 'Esta versão já está publicada no portal.' : 'Portal atualizado e confirmado.';
      pendingAdminData = null;
      try { localStorage.removeItem(recognitionsBackupStorageKey); } catch (error) { console.warn('[Reconhecimento] Não foi possível limpar o backup local após publicação.', error); }
    } else message.textContent = 'Commit criado no GitHub. O deploy ainda não confirmou a nova base; aguarde alguns instantes e atualize a página.';
    await refreshDataDiagnostic();
  } catch (error) {
    console.error('[Publicação] Falha ao atualizar o portal:', error); message.style.color = 'var(--red)'; message.textContent = `Não foi possível atualizar o portal: ${error.message}`;
    const status = readPublicationStatus();
    if (status) { status.status = 'error'; try { localStorage.setItem(publicationStatusKey, JSON.stringify(status)); } catch (storageError) { console.warn('[Publicação] Não foi possível salvar o estado do erro.', storageError); } }
    await refreshDataDiagnostic();
  } finally { button.dataset.publishing = 'false'; button.textContent = 'Atualizar Portal'; updatePublishButton(); }
}
async function verifyAdminPin(pin) {
  if (!pin) throw new Error('Informe o PIN administrativo.');
  await callPublishApi({ action: 'verify', pin });
}
function setupAdminReliabilityUI() {
  const guidance = admin$('#admin-panel > p');
  if (guidance) guidance.textContent = 'Importe a planilha e publique uma carga validada diretamente no portal.';
  const adminNote = admin$('.admin-footer');
  if (adminNote) adminNote.textContent = 'O token do GitHub é usado exclusivamente pela API e deve ser configurado como variável de ambiente na Vercel.';
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
  const connectionSummary = document.createElement('div');
  connectionSummary.id = 'publication-target-summary';
  connectionSummary.setAttribute('role', 'status');
  connectionSummary.style.cssText = 'display:grid;gap:4px;margin:0 0 16px;text-align:left';
  uploadBox.append(connectionSummary);
  uploadBox.append(summary);
  uploadBox.append(publishButton);
  renderPublicationTargetSummary();
  const publicationCard = document.createElement('section');
  publicationCard.className = 'admin-section';
  publicationCard.id = 'publication-card';
  publicationCard.innerHTML = '<h2>Status da Publicação</h2><div id="publication-status"></div>';
  uploadBox.closest('.admin-section')?.after(publicationCard);
  const advanced = document.createElement('details');
  advanced.className = 'admin-section';
  advanced.id = 'advanced-publication';
  advanced.innerHTML = `
    <summary style="cursor:pointer;font-weight:700">Configurações avançadas da publicação</summary>
    <p>A publicação é autenticada pela API. O token do GitHub não é enviado nem armazenado neste navegador.</p>
    <h3>Ferramentas avançadas</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0"><label>Responsável pela carga<input id="upload-responsible" type="text" value="Administração" autocomplete="name"></label><label>Justificativa<input id="upload-reason" type="text" value="Atualização da base de ideias" maxlength="240"></label></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="admin-action" id="download-data">Baixar JSON</button><button type="button" class="admin-action" id="restore-data" hidden>Restaurar última base</button></div>`;
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
  if (historySection) advanced.append(historySection);
  const diagnosticSection = [...document.querySelectorAll('.admin-section')].find((section) => section.querySelector('#data-diagnostic'));
  if (diagnosticSection) advanced.append(diagnosticSection);
  const recognitionSection = admin$('#recognition-form')?.closest('.admin-section');
  if (recognitionSection) advanced.before(recognitionSection);
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
  publishButton.addEventListener('click', publishCurrentDataset);
  renderPublicationCard();
  loadAdminCurrentData().then((loaded) => {
    renderUploadSummary(loaded.data);
    renderPublicationTargetSummary(loaded);
    renderUpdateHistory(loaded.data);
  }).catch((error) => console.warn('[Administração] Não foi possível carregar o resumo inicial.', error));
}
async function refreshDataDiagnostic() {
  const target = admin$('#data-diagnostic');
  if (!target) return;
  const published = await loadPublishedData();
  const local = pendingAdminData || readStoredData(dataStorageKey);
  const backup = readStoredData(backupStorageKey);
  const data = published.data;
  const sync = readPublicationStatus();
  const localIsNewer = Boolean(local && (!published.publishedData || compareDataVersions(local.metadata?.version, published.publishedData.metadata?.version) > 0));
  const remoteConfirmsCommit = Boolean(sync?.status === 'committed' && published.publishedData?.metadata?.version === sync.version && published.publishedData?.metadata?.updatedAt === local?.metadata?.updatedAt);
  const isPublished = Boolean(!localIsNewer && (sync?.status === 'published' || remoteConfirmsCommit) && sync.version === data?.metadata?.version);
  if (remoteConfirmsCommit) {
    sync.status = 'published';
    try { localStorage.setItem(publicationStatusKey, JSON.stringify(sync)); }
    catch (error) { console.warn('[Publicação] Não foi possível salvar o status local da publicação.', error); }
  }
  const isCommitted = Boolean(sync?.status === 'committed' && sync.version === local?.metadata?.version);
  const syncedAt = sync?.syncedAt ? new Date(sync.syncedAt) : null;
  const syncedLabel = (isPublished || isCommitted) && syncedAt && !Number.isNaN(syncedAt.getTime()) ? syncedAt.toLocaleString('pt-BR') : published.source === 'dados/ideias.json' ? 'Conforme JSON publicado' : 'Pendente';
  const portalStatus = isPublished ? 'Publicado no portal' : isCommitted ? 'Commit enviado; deploy pendente' : localIsNewer ? 'Carga validada; publicação pendente' : published.source === 'dados/ideias.json' ? 'Publicado' : 'Pendente de publicação';
  target.innerHTML = `<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:16px 0 0"><div><dt>Portal atualizado</dt><dd>${portalStatus}</dd></div><div><dt>Última sincronização</dt><dd>${escapeHistoryCell(syncedLabel)}</dd></div><div><dt>Versão</dt><dd>${escapeHistoryCell(data?.metadata?.version || 'Não informada')}</dd></div><div><dt>Fonte dos dados</dt><dd>${escapeHistoryCell(published.source)}</dd></div></dl>`;
  if (local && (!published.publishedData || compareDataVersions(local.metadata?.version, published.publishedData.metadata?.version) > 0)) admin$('#publish-portal').disabled = false;
  await renderPublicationCard();
  updatePublishButton();
  const restoreButton = admin$('#restore-data');
  if (restoreButton) restoreButton.hidden = !backup;
}
function loadUpdateHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(historyStorageKey) || '[]');
    if (Array.isArray(history) && history.length) return history;
  } catch (error) {
    console.warn('[Histórico] Dados locais inválidos; iniciando com o registro inicial.', error);
  }
  return [{ timestamp: '2026-09-08T06:40:00', file: 'ideias.json', reason: 'Carga inicial', ideas: 9, collaborators: 5, areas: 4, responsible: 'Administração' }];
}
function renderUpdateHistory(data) {
  const body = admin$('#history-body');
  if (!body) return;
  const persisted = Array.isArray(data?.historicoAtualizacoes) ? data.historicoAtualizacoes : [];
  const history = persisted.length ? persisted : loadUpdateHistory();
  if (!history.length) { body.innerHTML = '<tr><td colspan="7">Nenhuma atualização registrada.</td></tr>'; return; }
  body.innerHTML = history.map((entry) => {
    const date = new Date(entry.timestamp); const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
    return `<tr><td>${escapeHistoryCell(dateLabel)}</td><td>${escapeHistoryCell(entry.file)}</td><td>${escapeHistoryCell(entry.reason)}</td><td>${escapeHistoryCell(entry.ideas)}</td><td>${escapeHistoryCell(entry.collaborators)}</td><td>${escapeHistoryCell(entry.areas)}</td><td>${escapeHistoryCell(entry.responsible)}</td></tr>`;
  }).join('');
}
function saveUpdateHistory(entry) {
  const history = loadUpdateHistory();
  history.unshift(entry);
  localStorage.setItem(historyStorageKey, JSON.stringify(history));
  renderUpdateHistory();
}
function commitValidatedUpload(data, previous, historyEntry, { recognitionOnly = false } = {}) {
  pendingAdminData = data;
  const warnings = [];
  try {
    if (recognitionOnly) {
      localStorage.removeItem(backupStorageKey);
      localStorage.setItem(recognitionsBackupStorageKey, JSON.stringify(cloneRecognitions(data)));
    } else if (previous && validDataset(previous)) {
      localStorage.setItem(backupStorageKey, JSON.stringify(previous));
    }
  } catch (error) {
    console.warn('[Administração] Não foi possível salvar o backup local.', error);
    warnings.push('O armazenamento local está cheio. A alteração foi mantida nesta sessão; publique antes de fechar a página.');
  }
  if (!recognitionOnly) {
    try {
      localStorage.setItem(dataStorageKey, JSON.stringify(data));
    } catch (error) {
      console.warn('[Administração] Não foi possível salvar a carga completa no navegador.', error);
      warnings.push('A alteração foi mantida nesta sessão, mas não pôde ser salva integralmente no navegador. Publique antes de fechar a página.');
    }
  }
  try {
    saveUpdateHistory(historyEntry);
  } catch (error) {
    console.warn('[Histórico] Não foi possível atualizar o histórico local.', error);
    warnings.push('O histórico local não pôde ser atualizado por falta de espaço.');
  }
  return [...new Set(warnings)];
}
function cloneRecognitions(data) {
  return {
    trimestre: Array.isArray(data?.reconhecidas?.trimestre) ? [...data.reconhecidas.trimestre] : [],
    semestre: Array.isArray(data?.reconhecidas?.semestre) ? [...data.reconhecidas.semestre] : []
  };
}
function formatRecognitionDate(value) {
  if (!value) return 'Não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Não informada' : date.toLocaleString('pt-BR');
}
async function renderRecognitionsList(data) {
  const body = admin$('#recognitions-list');
  if (!body) return;
  const current = data ? { data } : await loadAdminCurrentData();
  const recognitions = current.data?.reconhecidas || {};
  const entries = ['trimestre', 'semestre'].flatMap((period) => {
    const items = Array.isArray(recognitions[period]) ? recognitions[period] : [];
    return items.map((item, index) => ({ period, item, index }));
  });
  const count = admin$('#recognition-count');
  if (count) count.textContent = `${entries.length} ${entries.length === 1 ? 'reconhecimento cadastrado' : 'reconhecimentos cadastrados'}`;
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="7">Nenhum reconhecimento cadastrado.</td></tr>';
    return;
  }
  body.innerHTML = entries.map(({ period, item, index }) => `<tr><td>${period === 'trimestre' ? 'Trimestre' : 'Semestre'}</td><td>${escapeHistoryCell(item.titulo || '')}</td><td>${escapeHistoryCell(item.autor || item.colaborador || '')}</td><td>${escapeHistoryCell(item.area || '')}</td><td>${escapeHistoryCell(item.subcategoria || '')}</td><td>${escapeHistoryCell(formatRecognitionDate(item.criadoEm))}</td><td><button class="admin-action" type="button" data-recognition-action="edit" data-period="${period}" data-index="${index}">Editar</button> <button class="admin-action" type="button" data-recognition-action="delete" data-period="${period}" data-index="${index}">Excluir</button></td></tr>`).join('');
}
function resetRecognitionForm() {
  recognitionEditing = null;
  admin$('#recognition-form').reset();
  admin$('#recognition-submit').textContent = 'Cadastrar reconhecimento';
  admin$('#recognition-cancel-edit').hidden = true;
  const preview = admin$('#recognition-photo-preview');
  preview.replaceChildren();
  preview.hidden = true;
}
async function readRecognitionPhoto(file) {
  if (!file) return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a foto selecionada.'));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a foto selecionada.'));
    reader.readAsDataURL(file);
  });
}
async function editRecognition(period, index) {
  const current = await loadAdminCurrentData();
  const item = current.data?.reconhecidas?.[period]?.[index];
  if (!item) throw new Error('Este reconhecimento não está mais disponível. Atualize a lista e tente novamente.');
  recognitionEditing = { period, index };
  admin$('#recognition-period').value = period;
  admin$('#recognition-title').value = item.titulo || '';
  admin$('#recognition-author').value = item.autor || item.colaborador || '';
  admin$('#recognition-area').value = item.area || '';
  const subcategory = admin$('#recognition-subcategory');
  if (item.subcategoria && ![...subcategory.options].some((option) => option.value === item.subcategoria)) {
    const option = document.createElement('option');
    option.value = item.subcategoria;
    option.textContent = item.subcategoria;
    subcategory.append(option);
  }
  subcategory.value = item.subcategoria || '';
  admin$('#recognition-reason').value = item.motivo || '';
  admin$('#recognition-photo').value = '';
  admin$('#recognition-submit').textContent = 'Salvar alterações';
  admin$('#recognition-cancel-edit').hidden = false;
  const preview = admin$('#recognition-photo-preview');
  preview.replaceChildren();
  preview.hidden = !item.foto;
  if (item.foto) {
    const image = document.createElement('img');
    image.src = item.foto;
    image.alt = 'Foto atual do reconhecimento';
    image.style.cssText = 'display:block;max-width:180px;max-height:140px;margin-top:8px';
    preview.append('Foto atual (selecione outra para substituir):', image);
  }
  admin$('#recognition-message').textContent = 'Edite os campos e salve as alterações.';
  admin$('#recognition-title').focus();
}
async function deleteRecognition(period, index) {
  if (!window.confirm('Deseja realmente excluir este reconhecimento?')) return;
  const current = await loadAdminCurrentData();
  const existing = current.data?.reconhecidas?.[period]?.[index];
  if (!existing) throw new Error('Este reconhecimento não está mais disponível. Atualize a lista e tente novamente.');
  const saved = {
    ...current.data,
    reconhecidas: cloneRecognitions(current.data)
  };
  saved.reconhecidas[period].splice(index, 1);
  const timestamp = new Date().toISOString();
  const metrics = datasetMetrics(saved);
  const reason = `Exclusão do reconhecimento: ${existing.titulo || 'Sem título'}`;
  const responsible = admin$('#upload-responsible').value.trim() || 'Administração';
  saved.metadata = { ...saved.metadata, updatedAt: timestamp, version: nextDataVersion(current.data.metadata?.version), recordCount: metrics.ideas, uploadedBy: responsible, updateReason: reason };
  const warnings = commitValidatedUpload(saved, current.data, { timestamp, file: 'Exclusão de reconhecimento', reason, responsible, ideas: metrics.ideas, collaborators: metrics.collaborators, areas: metrics.areas }, { recognitionOnly: true });
  if (recognitionEditing?.period === period) {
    if (recognitionEditing.index === index) resetRecognitionForm();
    else if (recognitionEditing.index > index) recognitionEditing.index -= 1;
  }
  admin$('#recognition-message').textContent = `Reconhecimento removido da carga. ${warnings.join(' ')}${warnings.length ? ' ' : 'Clique em Atualizar Portal para publicar a alteração.'}`;
  await renderRecognitionsList(saved);
  updatePublishButton();
  await refreshDataDiagnostic();
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
renderRecognitionsList().catch((error) => console.error('[Reconhecimento] Falha ao carregar a lista:', error));
refreshDataDiagnostic();

admin$('#admin-pin-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pinInput = admin$('#admin-pin'); const submit = event.currentTarget.querySelector('button[type="submit"]'); const errorMessage = admin$('#admin-error');
  submit.disabled = true; errorMessage.textContent = 'Validando acesso...';
  try {
    await verifyAdminPin(pinInput.value); adminPin = pinInput.value; pinInput.value = '';
    admin$('#admin-gate').style.display = 'none'; admin$('#admin-panel').style.display = 'block'; errorMessage.textContent = '';
    await refreshDataDiagnostic();
  } catch (error) { errorMessage.textContent = error.message; }
  finally { submit.disabled = false; }
});
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
      const ideiasPrincipais = ideaRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), descricaoCurta: valueOf(row, ['Descrição curta']), descricao: valueOf(row, ['Descrição', 'Descrição da dúvida']), status: valueOf(row, ['Status']), enviadoPor: valueOf(row, ['Enviado por']), categoria: valueOf(row, ['Categoria']), subcategoria: valueOf(row, ['Subcategoria', 'Sub categoria']), criada: valueOf(row, ['Criada']), areaTrabalho: valueOf(row, ['Área de trabalho']), atualizado: valueOf(row, ['Atualizado']), atribuidoA: valueOf(row, ['Atribuído a', 'Atribuído']), grupoAtribuicao: valueOf(row, ['Grupo de atribuição']), fechado: valueOf(row, ['Fechado']), grupo: valueOf(row, ['Grupo']), autor: valueOf(row, ['Enviado por']) })).filter((idea) => ideaNumberKey(idea.numero));
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
    if (!file.name.toLowerCase().endsWith('.json') && current.data?.reconhecidas) {
      data.reconhecidas = cloneRecognitions(current.data);
    }
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
    renderRecognitionsList(data);
    admin$('#upload-message').style.color = '';
    admin$('#upload-message').textContent = `Carga ${data.metadata.version} processada e validada. Pronta para publicação.`;
    updatePublishButton();
    refreshDataDiagnostic();
  } catch (error) { console.error('[Importação] Falha ao processar arquivo:', error); admin$('#upload-message').style.color = 'var(--red)'; admin$('#upload-message').textContent = `Não foi possível concluir a carga. ${error.message} A última base válida foi mantida.`; }
});
admin$('#recognition-cancel-edit').addEventListener('click', resetRecognitionForm);
admin$('#recognitions-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-recognition-action]');
  if (!button) return;
  const { recognitionAction: action, period, index: rawIndex } = button.dataset;
  const index = Number(rawIndex);
  const message = admin$('#recognition-message');
  message.style.color = '';
  button.disabled = true;
  try {
    if (!['trimestre', 'semestre'].includes(period) || !Number.isInteger(index) || index < 0) throw new Error('A seleção do reconhecimento é inválida.');
    if (action === 'edit') await editRecognition(period, index);
    else if (action === 'delete') await deleteRecognition(period, index);
  } catch (error) {
    console.error('[Reconhecimento] Falha ao gerenciar reconhecimento:', error);
    message.style.color = 'var(--red)';
    message.textContent = `Não foi possível concluir a ação. ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
admin$('#recognition-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = admin$('#recognition-message');
  try {
    const current = await loadAdminCurrentData();
    if (!current.data || !validDataset(current.data)) throw new Error('Carregue uma base válida antes de cadastrar reconhecimentos.');
    const saved = { ...current.data, reconhecidas: cloneRecognitions(current.data) };
    const targetPeriod = admin$('#recognition-period').value;
    if (!['trimestre', 'semestre'].includes(targetPeriod)) throw new Error('Selecione um período válido.');
    const wasEditing = Boolean(recognitionEditing);
    const existing = recognitionEditing ? current.data.reconhecidas?.[recognitionEditing.period]?.[recognitionEditing.index] : null;
    if (recognitionEditing && !existing) throw new Error('Este reconhecimento não está mais disponível. Atualize a lista e tente novamente.');
    const file = admin$('#recognition-photo').files[0];
    const photo = file ? await readRecognitionPhoto(file) : existing?.foto || '';
    const reason = admin$('#recognition-reason').value.trim() || 'Cadastro de reconhecimento';
    const timestamp = new Date().toISOString();
    const recognition = {
      ...(existing || {}),
      titulo: admin$('#recognition-title').value.trim(),
      autor: admin$('#recognition-author').value.trim(),
      area: admin$('#recognition-area').value.trim(),
      subcategoria: admin$('#recognition-subcategory').value,
      motivo: reason,
      foto: photo,
      criadoEm: existing?.criadoEm || timestamp
    };
    if (recognitionEditing) {
      saved.reconhecidas[recognitionEditing.period].splice(recognitionEditing.index, 1);
      if (targetPeriod === recognitionEditing.period) {
        saved.reconhecidas[targetPeriod].splice(recognitionEditing.index, 0, recognition);
      } else {
        saved.reconhecidas[targetPeriod].unshift(recognition);
      }
    } else {
      saved.reconhecidas[targetPeriod].unshift(recognition);
    }
    const metrics = datasetMetrics(saved);
    const responsible = admin$('#upload-responsible').value.trim() || 'Administração';
    const actionLabel = wasEditing ? 'Edição de reconhecimento' : 'Cadastro de reconhecimento';
    saved.metadata = { ...saved.metadata, updatedAt: timestamp, version: nextDataVersion(current.data.metadata?.version), recordCount: metrics.ideas, uploadedBy: responsible, updateReason: reason };
    const warnings = commitValidatedUpload(saved, current.data, { timestamp, file: actionLabel, reason, responsible, ideas: metrics.ideas, collaborators: metrics.collaborators, areas: metrics.areas }, { recognitionOnly: true });
    resetRecognitionForm();
    message.style.color = '';
    message.textContent = `${wasEditing ? 'Reconhecimento atualizado' : 'Reconhecimento cadastrado'} na carga. ${warnings.join(' ')}${warnings.length ? ' ' : 'Clique em Atualizar Portal para publicar a alteração.'}`;
    await renderRecognitionsList(saved);
    updatePublishButton();
    await refreshDataDiagnostic();
  } catch (error) {
    console.error('[Reconhecimento] Falha ao salvar cadastro:', error);
    message.textContent = `Não foi possível salvar o reconhecimento. ${error.message}`;
  }
});
