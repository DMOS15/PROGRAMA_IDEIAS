const admin$ = (selector) => document.querySelector(selector);
const adminNormalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const findSheet = (workbook, names) => { const wanted = names.map(adminNormalize); const sheetName = workbook.SheetNames.find((name) => wanted.includes(adminNormalize(name)) || wanted.some((item) => adminNormalize(name).includes(item))); return sheetName ? workbook.Sheets[sheetName] : null; };
const valueOf = (row, names) => { const key = Object.keys(row).find((candidate) => names.some((name) => adminNormalize(candidate) === adminNormalize(name))); const value = key ? row[key] : ''; return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value; };
const uniqueAreas = (values) => [...new Map(values.map((value) => String(value || '').trim().replace(/\s+/g, ' ')).filter(Boolean).map((value) => [adminNormalize(value), value])).values()].sort((left, right) => left.localeCompare(right, 'pt-BR'));
const nameTokens = (value) => adminNormalize(value).split(/\s+/).filter((token) => token.length > 1);
const samePerson = (left, right) => { const a = nameTokens(left); const b = nameTokens(right); if (!a.length || !b.length) return false; if (a.join(' ') === b.join(' ')) return true; return (a[0] === b[0] || a[0][0] === b[0][0]) && a[a.length - 1] === b[b.length - 1]; };
function resolveIdeaPerson(idea, data, activePeople) {
  const dmosMatches = (data.baseDmos || []).filter((entry) => samePerson(idea.enviadoPor, entry.baseDmos || entry.nome));
  const cadastroPerson = activePeople.find((person) => samePerson(idea.enviadoPor, person.nome) || dmosMatches.some((entry) => samePerson(entry.nome, person.nome)));
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
renderUpdateHistory();

admin$('#admin-pin-form').addEventListener('submit', (event) => { event.preventDefault(); if (admin$('#admin-pin').value === 'JDEPIU') { admin$('#admin-gate').style.display = 'none'; admin$('#admin-panel').style.display = 'block'; } else admin$('#admin-error').textContent = 'PIN incorreto. Tente novamente.'; });
admin$('#excel-upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    let data;
    if (file.name.toLowerCase().endsWith('.json')) data = JSON.parse(await file.text());
    else {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ideaSheetName = workbook.SheetNames.find((name) => adminNormalize(name) === 'tab.ideias.total') || workbook.SheetNames.find((name) => ['tabela ideias', 'ideias'].some((candidate) => adminNormalize(name) === candidate || adminNormalize(name).includes(candidate)));
      if (!ideaSheetName) throw new Error('Aba TAB.IDEIAS.TOTAL não encontrada.');
      const ideaSheet = workbook.Sheets[ideaSheetName];
      const ideaRange = XLSX.utils.decode_range(ideaSheet['!ref']);
      const linhasTotais = Math.max(0, ideaRange.e.r - ideaRange.s.r);
      console.log('Linhas na aba:', linhasTotais);
      console.log('[Importação] Aba de ideias:', ideaSheetName, 'Range:', ideaSheet['!ref']);
      const ideaRows = XLSX.utils.sheet_to_json(ideaSheet, { defval: '', range: ideaRange });
      console.log('Após sheet_to_json:', ideaRows.length);
      const cancelSheet = findSheet(workbook, ['canceladas', 'ideias canceladas', 'tab.cancelada']);
      const cadastroSheet = findSheet(workbook, ['cadastro']);
      const dmosSheet = findSheet(workbook, ['base dmos', 'tab.colab']);
      const cancelRows = cancelSheet ? XLSX.utils.sheet_to_json(cancelSheet, { defval: '' }) : [];
      const peopleRows = cadastroSheet ? XLSX.utils.sheet_to_json(cadastroSheet, { defval: '' }) : [];
      const dmosRows = dmosSheet ? XLSX.utils.sheet_to_json(dmosSheet, { defval: '' }) : [];
      const ideiasTratadas = ideaRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), descricaoCurta: valueOf(row, ['Descrição curta']), descricao: valueOf(row, ['Descrição', 'Descrição da dúvida']), status: valueOf(row, ['Status']), enviadoPor: valueOf(row, ['Enviado por']), categoria: valueOf(row, ['Categoria']), subcategoria: valueOf(row, ['Sub categoria']), criada: valueOf(row, ['Criada']), areaTrabalho: valueOf(row, ['Área de trabalho']), atualizado: valueOf(row, ['Atualizado']), atribuidoA: valueOf(row, ['Atribuído a', 'Atribuído']), grupoAtribuicao: valueOf(row, ['Grupo de atribuição']), fechado: valueOf(row, ['Fechado']), grupo: valueOf(row, ['Grupo']), autor: valueOf(row, ['Enviado por']) }));
      console.log('Após tratamento:', ideiasTratadas.length);
      const ideiasFiltradas = ideiasTratadas;
      console.log('Após filtros:', ideiasFiltradas.length);
      console.log('[Importação] Primeiros 10 números importados:', ideiasFiltradas.slice(0, 10).map((idea) => idea.numero));
      console.log('[Importação] Últimos 10 números importados:', ideiasFiltradas.slice(-10).map((idea) => idea.numero));
      data = { metadata: { updatedAt: new Date().toISOString(), version: '1.0.0', updateReason: 'Upload via administração', updatedBy: 'Administração' }, cadastro: peopleRows.filter((row) => adminNormalize(valueOf(row, ['STATUS', 'Status'])) === 'ativo').map((row) => ({ nome: valueOf(row, ['NOME', 'Nome']), turno: valueOf(row, ['TURNO', 'Turno']), turnoComp: valueOf(row, ['TURNO COMP']), coordenador: valueOf(row, ['COORDENADOR', 'Coordenador']), funcao: valueOf(row, ['FUNÇÃO', 'Função']), status: valueOf(row, ['STATUS', 'Status']), area: valueOf(row, ['ÁREA', 'Área']) })), baseDmos: dmosRows.map((row) => ({ baseDmos: valueOf(row, ['Base DMOS']), nome: valueOf(row, ['NOME', 'Nome']), tipo: valueOf(row, ['TIPO', 'Tipo']), cargo: valueOf(row, ['CARGO', 'Cargo']), area: valueOf(row, ['AREA', 'Área']), coordenador: valueOf(row, ['COORDENADOR', 'Coordenador']) })), ideias: ideiasFiltradas, canceladas: cancelRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), motivo: valueOf(row, ['Descrição curta', 'Descrição', 'Motivo do cancelamento']) })).filter((row) => row.numero), reconhecidas: { trimestre: [], semestre: [] } };
    }
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
    console.info('Primeiras correspondências encontradas:');
    console.table(associatedIdeas.slice(0, 20).map(({ idea, cadastroPerson, dmosMatches }) => ({ enviadoPor: idea.enviadoPor, baseDMOS: dmosMatches.map((entry) => entry.baseDmos || '').filter(Boolean).join(' | '), nomeTAB_COLAB: dmosMatches.map((entry) => entry.nome).filter(Boolean).join(' | '), cadastro: cadastroPerson.nome, status: 'Correspondência encontrada' })));
    console.info('20 primeiras ideias sem correspondência:');
    console.table(unmatchedIdeas.slice(0, 20).map(({ idea, dmosMatches }) => ({ numero: idea.numero, enviadoPor: idea.enviadoPor, baseDMOS: dmosMatches.map((entry) => entry.baseDmos || '').filter(Boolean).join(' | '), nomesTAB_COLAB: dmosMatches.map((entry) => entry.nome).filter(Boolean).join(' | '), status: 'Sem correspondência' })));
    const areaCount = cadastroAreas.length || ideaAreas.length || dmosAreas.length;
    admin$('#upload-message').textContent = `Arquivo processado: ${data.ideias.length} ideias, ${data.cadastro.length} colaboradores e ${areaCount} áreas.`;
    saveUpdateHistory({ timestamp: new Date().toISOString(), file: file.name, reason: 'Upload administrativo', ideas: data.ideias.length, collaborators: data.cadastro.length, areas: areaCount });
  } catch (error) { admin$('#upload-message').style.color = 'var(--red)'; admin$('#upload-message').textContent = 'Não foi possível processar o arquivo. Verifique as abas e colunas.'; }
});
admin$('#recognition-form').addEventListener('submit', async (event) => { event.preventDefault(); const saved = JSON.parse(localStorage.getItem('programaIdeiasData') || JSON.stringify(emptyData())); saved.reconhecidas = saved.reconhecidas || { trimestre: [], semestre: [] }; const file = admin$('#recognition-photo').files[0]; const photo = file ? await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }) : ''; saved.reconhecidas[admin$('#recognition-period').value].unshift({ titulo: admin$('#recognition-title').value, autor: admin$('#recognition-author').value, area: admin$('#recognition-area').value, motivo: admin$('#recognition-reason').value, foto: photo }); localStorage.setItem('programaIdeiasData', JSON.stringify(saved)); admin$('#recognition-message').textContent = 'Reconhecimento cadastrado para publicação.'; event.target.reset(); });
