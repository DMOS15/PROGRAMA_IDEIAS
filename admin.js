const admin$ = (selector) => document.querySelector(selector);
const adminNormalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const findSheet = (workbook, names) => { const wanted = names.map(adminNormalize); const sheetName = workbook.SheetNames.find((name) => wanted.includes(adminNormalize(name)) || wanted.some((item) => adminNormalize(name).includes(item))); return sheetName ? workbook.Sheets[sheetName] : null; };
const valueOf = (row, names) => { const key = Object.keys(row).find((candidate) => names.some((name) => adminNormalize(candidate) === adminNormalize(name))); return key ? row[key] : ''; };
const emptyData = () => ({ metadata: {}, cadastro: [], baseDmos: [], ideias: [], canceladas: [], reconhecidas: { trimestre: [], semestre: [] } });

admin$('#admin-pin-form').addEventListener('submit', (event) => { event.preventDefault(); if (admin$('#admin-pin').value === 'JDEPIU') { admin$('#admin-gate').style.display = 'none'; admin$('#admin-panel').style.display = 'block'; } else admin$('#admin-error').textContent = 'PIN incorreto. Tente novamente.'; });
admin$('#excel-upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    let data;
    if (file.name.toLowerCase().endsWith('.json')) data = JSON.parse(await file.text());
    else {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ideaRows = XLSX.utils.sheet_to_json(findSheet(workbook, ['tabela ideias', 'tab.ideias.total', 'ideias']) || workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      const cancelSheet = findSheet(workbook, ['canceladas', 'ideias canceladas', 'tab.cancelada']);
      const cadastroSheet = findSheet(workbook, ['cadastro']);
      const dmosSheet = findSheet(workbook, ['base dmos', 'tab.colab']);
      const cancelRows = cancelSheet ? XLSX.utils.sheet_to_json(cancelSheet, { defval: '' }) : [];
      const peopleRows = cadastroSheet ? XLSX.utils.sheet_to_json(cadastroSheet, { defval: '' }) : [];
      const dmosRows = dmosSheet ? XLSX.utils.sheet_to_json(dmosSheet, { defval: '' }) : [];
      data = { metadata: { updatedAt: new Date().toISOString(), version: '1.0.0', updateReason: 'Upload via administração', updatedBy: 'Administração' }, cadastro: peopleRows.filter((row) => adminNormalize(valueOf(row, ['STATUS', 'Status'])) === 'ativo').map((row) => ({ nome: valueOf(row, ['NOME', 'Nome']), turno: valueOf(row, ['TURNO', 'Turno']), turnoComp: valueOf(row, ['TURNO COMP']), coordenador: valueOf(row, ['COORDENADOR', 'Coordenador']), funcao: valueOf(row, ['FUNÇÃO', 'Função']), status: valueOf(row, ['STATUS', 'Status']), area: valueOf(row, ['ÁREA', 'Área']) })), baseDmos: dmosRows.map((row) => ({ nome: valueOf(row, ['NOME', 'Nome']), tipo: valueOf(row, ['TIPO', 'Tipo']), cargo: valueOf(row, ['CARGO', 'Cargo']), area: valueOf(row, ['AREA', 'Área']), coordenador: valueOf(row, ['COORDENADOR', 'Coordenador']) })), ideias: ideaRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), descricaoCurta: valueOf(row, ['Descrição curta']), descricao: valueOf(row, ['Descrição', 'Descrição da dúvida']), status: valueOf(row, ['Status']), enviadoPor: valueOf(row, ['Enviado por']), categoria: valueOf(row, ['Categoria']), subcategoria: valueOf(row, ['Sub categoria']), criada: valueOf(row, ['Criada']), areaTrabalho: valueOf(row, ['Área de trabalho']), atualizado: valueOf(row, ['Atualizado']), atribuidoA: valueOf(row, ['Atribuído a', 'Atribuído']), grupoAtribuicao: valueOf(row, ['Grupo de atribuição']), fechado: valueOf(row, ['Fechado']), grupo: valueOf(row, ['Grupo']), autor: valueOf(row, ['Enviado por']) })), canceladas: cancelRows.map((row) => ({ numero: valueOf(row, ['Número', 'Numero']), motivo: valueOf(row, ['Descrição curta', 'Descrição', 'Motivo do cancelamento']) })).filter((row) => row.numero), reconhecidas: { trimestre: [], semestre: [] } };
    }
    localStorage.setItem('programaIdeiasData', JSON.stringify(data));
    const areaCount = new Set((data.ideias || []).map((idea) => idea.grupo).filter(Boolean)).size;
    admin$('#upload-message').textContent = `Arquivo processado: ${data.ideias.length} ideias, ${data.cadastro.length} colaboradores e ${areaCount} áreas.`;
    admin$('#history-body').insertAdjacentHTML('afterbegin', `<tr><td>${new Date().toLocaleString('pt-BR')}</td><td>${file.name}</td><td>Upload administrativo</td><td>${data.ideias.length}</td><td>${data.cadastro.length}</td><td>${areaCount}</td></tr>`);
  } catch (error) { admin$('#upload-message').style.color = 'var(--red)'; admin$('#upload-message').textContent = 'Não foi possível processar o arquivo. Verifique as abas e colunas.'; }
});
admin$('#recognition-form').addEventListener('submit', async (event) => { event.preventDefault(); const saved = JSON.parse(localStorage.getItem('programaIdeiasData') || JSON.stringify(emptyData())); saved.reconhecidas = saved.reconhecidas || { trimestre: [], semestre: [] }; const file = admin$('#recognition-photo').files[0]; const photo = file ? await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }) : ''; saved.reconhecidas[admin$('#recognition-period').value].unshift({ titulo: admin$('#recognition-title').value, autor: admin$('#recognition-author').value, area: admin$('#recognition-area').value, motivo: admin$('#recognition-reason').value, foto: photo }); localStorage.setItem('programaIdeiasData', JSON.stringify(saved)); admin$('#recognition-message').textContent = 'Reconhecimento cadastrado para publicação.'; event.target.reset(); });
