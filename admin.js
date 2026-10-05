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
const escapeHistoryCell = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
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
  if (!body || !history.length) return;
  body.innerHTML = history.map((entry) => {
    const date = new Date(entry.timestamp);
    const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
    return `<tr><td>${escapeHistoryCell(dateLabel)}</td><td>${escapeHistoryCell(entry.file)}</td><td>${escapeHistoryCell(entry.reason)}</td><td>${escapeHistoryCell(entry.ideas)}</td><td>${escapeHistoryCell(entry.collaborators)}</td><td>${escapeHistoryCell(entry.areas)}</td></tr>`;
  }).join('');
}
function saveUpdateHistory(entry) {
  const history = loadUpdateHistory();
  history.unshift(entry);
  localStorage.setItem(historyStorageKey, JSON.stringify(history.slice(0, 100)));
  renderUpdateHistory();
}
function addRecognitionSubcategoryField() {
  const form = admin$('#recognition-form');
  const photo = admin$('#recognition-photo');
  if (!form || !photo) return;
  let ideas = [];
  try { ideas = JSON.parse(localStorage.getItem('programaIdeiasData') || '{}').ideias || []; }
  catch (error) { console.warn('[Reconhecimento] Não foi possível carregar subcategorias salvas.', error); }
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
renderUpdateHistory();

admin$('#admin-pin-form').addEventListener('submit', (event) => { event.preventDefault(); if (admin$('#admin-pin').value === 'JDEPIU') { admin$('#admin-gate').style.display = 'none'; admin$('#admin-panel').style.display = 'block'; } else admin$('#admin-error').textContent = 'PIN incorreto. Tente novamente.'; });
admin$('#excel-upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    let data;
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
    data.canceladas = Array.isArray(data.canceladas) ? data.canceladas : [];
    const ideiasOriginais = Array.isArray(data.ideias) ? data.ideias : [];
    data.ideias = consolidateIdeas(ideiasOriginais, data.canceladas);
    logIdeaStatusTotals(ideiasOriginais.length, data.canceladas.length, data.ideias);
    localStorage.setItem('programaIdeiasData', JSON.stringify(data));
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
    admin$('#upload-message').textContent = `Arquivo processado: ${data.ideias.length} ideias, ${data.cadastro.length} colaboradores e ${areaCount} áreas.`;
    saveUpdateHistory({ timestamp: new Date().toISOString(), file: file.name, reason: 'Upload administrativo', ideas: data.ideias.length, collaborators: data.cadastro.length, areas: areaCount });
  } catch (error) { console.error('[Importação] Falha ao processar arquivo:', error); admin$('#upload-message').style.color = 'var(--red)'; admin$('#upload-message').textContent = 'Não foi possível processar o arquivo. Verifique as abas e colunas.'; }
});
admin$('#recognition-form').addEventListener('submit', async (event) => { event.preventDefault(); const saved = JSON.parse(localStorage.getItem('programaIdeiasData') || JSON.stringify(emptyData())); saved.reconhecidas = saved.reconhecidas || { trimestre: [], semestre: [] }; const file = admin$('#recognition-photo').files[0]; const photo = file ? await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }) : ''; saved.reconhecidas[admin$('#recognition-period').value].unshift({ titulo: admin$('#recognition-title').value, autor: admin$('#recognition-author').value, area: admin$('#recognition-area').value, subcategoria: admin$('#recognition-subcategory').value, motivo: admin$('#recognition-reason').value, foto: photo }); localStorage.setItem('programaIdeiasData', JSON.stringify(saved)); admin$('#recognition-message').textContent = 'Reconhecimento cadastrado para publicação.'; event.target.reset(); });
