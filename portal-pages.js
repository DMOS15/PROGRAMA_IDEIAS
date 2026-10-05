async function renderPerson2(personName, ideaNumber) {
  await getPageData();
  const person = pageState.people.find((item) => pageNormalize(item.nome) === pageNormalize(personName));
  if (!person) return renderPeople();
  const selectedIdea = ideaNumber ? person.ideas.find((idea) => String(idea.numero) === String(ideaNumber)) : person.ideas.length === 1 ? person.ideas[0] : null;
  if (selectedIdea) {
    pageLayout(ideaDetail(selectedIdea, person.nome), 'people');
    return;
  }
  const emptyMessage = person.ideas.length ? '' : emptyPersonIdeas(person);
  pageLayout(`<a class="back-link" href="colaboradores.html">← Todos os colaboradores</a><div class="person-header"><span class="avatar">${pageInitials(person.nome)}</span><div><h1>${pageEsc(person.nome)}</h1><p>${pageEsc(person.funcao)} · ${pageEsc(person.area)} · Coord. ${pageEsc(person.coordenador)}</p></div></div><div class="ideas-heading"><h2>Ideias abertas por ${pageEsc(person.nome.split(' ')[0])}</h2></div>${person.ideas.length ? `<div class="ideas-summary-list">${person.ideas.map((idea) => ideaSummaryCard(idea, person.nome)).join('')}</div>` : emptyMessage}`, 'people');
}

const PORTAL_FALLBACK = { cadastro: [], baseDmos: [], ideias: [], canceladas: [], reconhecidas: { trimestre: [], semestre: [] } };
const pageState = { people: [], ideas: [], metadata: {}, recognitions: { trimestre: [], semestre: [] } };
const page$ = (selector) => document.querySelector(selector);
window.onerror = (message, source, line, column, error) => {
  console.error('[Portal] Erro JavaScript não tratado:', { message, source, line, column, error });
  const coordinatorContent = page$('#coordinator-content');
  if (coordinatorContent && !coordinatorContent.innerHTML.trim()) {
    coordinatorContent.classList.remove('hidden');
    coordinatorContent.innerHTML = '<div class="empty-search"><p>O painel não pôde ser carregado. Os detalhes do erro estão no console.</p><button type="button" class="primary-button" onclick="location.reload()">Tentar novamente</button></div>';
  }
  return false;
};
window.addEventListener('unhandledrejection', (event) => console.error('[Portal] Promise rejeitada sem tratamento:', event.reason));
const pageNormalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const pageEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const pageInitials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const pageDateValue = (value) => { if (value === null || value === undefined || value === '') return null; if (typeof value === 'number') { const excelDate = new Date(Date.UTC(1899, 11, 30) + value * 86400000); return Number.isNaN(excelDate.getTime()) ? null : excelDate; } const text = String(value).trim(); const brazilian = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/); const normalized = brazilian ? `${brazilian[3]}-${brazilian[2].padStart(2, '0')}-${brazilian[1].padStart(2, '0')}T${brazilian[4] ? `${brazilian[4].padStart(2, '0')}:${brazilian[5]}:${brazilian[6] || '00'}` : '12:00:00'}` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? null : date; };
const pageDate = (value) => { const date = pageDateValue(value); return date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '') : 'Não informado'; };
const pageStatusClass = (status) => `status-${pageNormalize(status).replaceAll(' ', '-')}`;
const normalizedPersonName = (value) => pageNormalize(value).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
function samePerson(left, right) { const normalizedLeft = normalizedPersonName(left); return Boolean(normalizedLeft) && normalizedLeft === normalizedPersonName(right); }
function emptyPersonIdeas(person) { console.warn('[Colaboradores] Nenhuma ideia encontrada para este colaborador.', person.nome); return '<div class="empty-search">Nenhuma ideia encontrada para este colaborador.</div>'; }

async function getPortalData() {
  const stored = localStorage.getItem('programaIdeiasData');
  if (stored) {
    try {
      const data = JSON.parse(stored);
      console.info('Origem dos dados carregada: localStorage');
      return data;
    } catch (error) { console.warn('Os dados locais estão inválidos; tentando dados/ideias.json.', error); }
  }
  try {
    const response = await fetch('dados/ideias.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Falha ao carregar dados/ideias.json: ${response.status}`);
    const data = await response.json();
    console.info('Origem dos dados carregada: ideias.json');
    return data;
  } catch (error) {
    console.error('Não foi possível carregar os dados locais nem dados/ideias.json.', error);
    return PORTAL_FALLBACK;
  }
}

async function getPageData() {
  const loadedData = await getPortalData();
  const data = loadedData && typeof loadedData === 'object' ? loadedData : PORTAL_FALLBACK;
  pageState.metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  pageState.recognitions = data.reconhecidas && typeof data.reconhecidas === 'object' ? data.reconhecidas : { trimestre: [], semestre: [] };
  const cadastro = Array.isArray(data.cadastro) ? data.cadastro : [];
  const dmos = Array.isArray(data.baseDmos) ? data.baseDmos.filter((entry) => entry && typeof entry === 'object') : [];
  const cancelled = Array.isArray(data.canceladas) ? data.canceladas : [];
  const rawIdeas = Array.isArray(data.ideias) ? data.ideias : [];
  const cancelledByNumber = new Map(cancelled.map((entry) => [String(entry?.numero ?? '').trim().toLocaleUpperCase('pt-BR'), entry]).filter(([number]) => number));
  pageState.ideas = rawIdeas.filter((idea) => idea && String(idea.numero ?? '').trim()).map((idea) => {
    const item = idea && typeof idea === 'object' ? idea : {};
    const cancel = cancelledByNumber.get(String(item.numero).trim().toLocaleUpperCase('pt-BR'));
    return cancel ? { ...item, status: 'Cancelado', motivoCancelamento: cancel.motivo || cancel.descricao || cancel.descricaoCurta } : item;
  });
  const statusTotal = (status) => pageState.ideas.filter((idea) => pageNormalize(idea.status) === pageNormalize(status)).length;
  console.info('[Ideias] Quantidade principal:', rawIdeas.length, 'Quantidade TAB.cancelada:', cancelled.length, 'Quantidade Final:', pageState.ideas.length);
  console.info('[Ideias] Canceladas:', statusTotal('Cancelado'), 'Em andamento:', statusTotal('Em andamento'), 'Resolvidas:', statusTotal('Resolvido'), 'Fechadas:', statusTotal('Fechado'), 'Rascunho:', statusTotal('Rascunho'));
  const activePeople = cadastro.filter((person) => person && typeof person === 'object' && pageNormalize(person.status) === 'ativo');
  const peopleByOfficialName = new Map();
  activePeople.forEach((person) => {
    const key = normalizedPersonName(person.nome);
    if (!peopleByOfficialName.has(key)) peopleByOfficialName.set(key, []);
    peopleByOfficialName.get(key).push(person);
  });
  const ideasByPerson = new Map(activePeople.map((person) => [person, []]));
  const relationshipResults = pageState.ideas.map((idea) => {
    const sender = idea.enviadoPor || idea.autor;
    const dmosMatches = dmos.filter((entry) => samePerson(sender, entry.baseDmos));
    const officialNames = [...new Set(dmosMatches.map((entry) => normalizedPersonName(entry.nome)).filter(Boolean))];
    const matchedPeople = officialNames.length === 1 ? (peopleByOfficialName.get(officialNames[0]) || []) : [];
    if (matchedPeople.length === 1) ideasByPerson.get(matchedPeople[0]).push(idea);
    return { idea, sender, dmosMatches, matchedPeople };
  });
  pageState.people = activePeople.map((person) => ({ ...person, dmos: dmos.find((entry) => samePerson(entry.nome, person.nome)), ideas: ideasByPerson.get(person) || [] }));
  const unmatchedIdeas = relationshipResults.filter((result) => !result.matchedPeople.length);
  console.info('[Relacionamento] Total ideias:', pageState.ideas.length);
  console.info('[Relacionamento] Total colaboradores:', activePeople.length);
  console.info('[Relacionamento] Total ideias associadas:', relationshipResults.length - unmatchedIdeas.length);
  console.info('[Relacionamento] Total ideias sem associação:', unmatchedIdeas.length);
  console.table(unmatchedIdeas.slice(0, 50).map(({ idea, sender, dmosMatches }) => ({ numero: idea.numero, enviadoPor: sender, baseDMOS: dmosMatches.map((entry) => entry.baseDmos || '').filter(Boolean).join(' | '), nomesOficiais: dmosMatches.map((entry) => entry.nome || '').filter(Boolean).join(' | '), resultado: 'Sem associação no CADASTRO' })));
  return data;
}
window.addEventListener('storage', (event) => {
  if (event.key === 'programaIdeiasData') location.reload();
});
function pageHeader(active) { return `<header class="topbar"><a class="brand" href="colaboradores.html" aria-label="Ir para colaboradores"><span class="brand-mark">+</span><span>Programa de<br><strong>Ideias</strong></span></a><nav class="topnav" aria-label="Navegação principal"><a class="nav-link ${active === 'people' ? 'active' : ''}" href="colaboradores.html">Colaboradores</a><a class="nav-link ${active === 'recognition' ? 'active' : ''}" href="reconhecimento.html">Reconhecimento</a><a class="nav-link ${active === 'coordinators' ? 'active' : ''}" href="coordenadores.html">Coordenadores</a></nav><a class="admin-link ${active === 'admin' ? 'active' : ''}" href="admin.html"><span class="lock-icon">▣</span> Administração</a></header>`; }
function pageFooter(active) { const update = pageState.metadata.updatedAt ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(pageState.metadata.updatedAt)) : 'Não informado'; const totals = active === 'people' ? '' : `<span><strong>${pageState.ideas.length}</strong> ideias carregadas · <strong>${pageState.people.length}</strong> colaboradores ativos</span>`; return `<footer class="site-footer"><span><span class="footer-dot"></span> Última atualização: <strong>${update}</strong></span>${totals}<span>v1.0.0</span></footer>`; }
function pageLayout(content, active) {
  document.body.innerHTML = `${pageHeader(active)}<main class="site-main page-main">${content}</main>${pageFooter(active)}`;
  if (active !== 'recognition') return;
  const recognitions = [...(pageState.recognitions.trimestre || []), ...(pageState.recognitions.semestre || [])];
  document.querySelectorAll('.recognition-feature').forEach((card) => {
    const title = card.querySelector('h2')?.textContent;
    const recognition = recognitions.find((item) => (item.titulo || item.descricaoCurta || 'Ideia reconhecida') === title);
    if (recognition?.subcategoria) {
      const detail = document.createElement('p');
      detail.className = 'recognition-subcategory';
      detail.textContent = `Subcategoria: ${recognition.subcategoria}`;
      card.querySelector('div:last-child')?.append(detail);
    }
  });
  const ranking = [...document.querySelectorAll('.recognition-card')].find((card) => card.querySelector('h3')?.textContent === 'Onde as ideias nascem');
  if (ranking) {
    const subcategories = Object.entries(countBy(pageState.ideas, 'subcategoria')).sort((left, right) => right[1] - left[1]).slice(0, 5);
    ranking.innerHTML = `<span class="section-kicker">TOP SUBCATEGORIAS</span><h3>Classificações mais frequentes</h3>${subcategories.map(([name, count], index) => `<div class="leader"><span class="leader-rank">${index + 1}.</span><span class="leader-name">${pageEsc(name)}</span><span class="leader-value">${count}</span></div>`).join('') || '<div class="empty-search">Sem subcategorias registradas.</div>'}`;
  }
}
function relativeUpdated(value) { const date = pageDateValue(value); if (!date) return 'Atualização não informada'; const days = Math.max(0, Math.floor((Date.now() - date) / 86400000)); return days === 0 ? 'Atualizado hoje' : days === 1 ? 'Atualizado há 1 dia' : `Atualizado há ${days} dias`; }
function ideaSummaryCard(idea, personName) { return `<a class="idea-summary-card" href="colaboradores.html?person=${encodeURIComponent(personName)}&idea=${encodeURIComponent(idea.numero)}"><span class="idea-number">${pageEsc(idea.numero)}</span><h3>${pageEsc(idea.descricaoCurta || 'Ideia sem título')}</h3><div class="idea-summary-meta"><span class="status-pill ${pageStatusClass(idea.status)}">${pageEsc(idea.status)}</span><span>${pageDate(idea.criada)}</span><span>${relativeUpdated(idea.atualizado)}</span></div><span class="idea-summary-open">Ver detalhes&nbsp; →</span></a>`; }
function ideaDetail(idea, personName) { return `<a class="back-link" href="colaboradores.html?person=${encodeURIComponent(personName)}">← Voltar para as ideias de ${pageEsc(personName.split(' ')[0])}</a><article class="idea-detail"><div class="idea-detail-heading"><div><span class="idea-number">${pageEsc(idea.numero)}</span><h2>${pageEsc(idea.descricaoCurta || 'Ideia sem título')}</h2></div><span class="status-pill ${pageStatusClass(idea.status)}">${pageEsc(idea.status)}</span></div><section class="idea-detail-description"><span class="field-label">Descrição</span><p>${pageEsc(idea.descricao || idea.descricaoDuvida || 'Não informado')}</p></section><div class="idea-detail-fields"><div class="idea-subcategory-field"><span class="field-label">Subcategoria</span><strong>${pageEsc(idea.subcategoria || 'Não informado')}</strong></div><div><span class="field-label">Área de trabalho</span><strong>${pageEsc(idea.areaTrabalho || idea.grupo || 'Não informado')}</strong></div><div><span class="field-label">Criada</span><strong>${pageDate(idea.criada)}</strong></div><div><span class="field-label">Atualizada</span><strong>${pageDate(idea.atualizado)}</strong></div><div><span class="field-label">Atribuído a</span><strong>${pageEsc(idea.atribuidoA || 'Não informado')}</strong></div><div><span class="field-label">Grupo de atribuição</span><strong>${pageEsc(idea.grupoAtribuicao || 'Não informado')}</strong></div><div><span class="field-label">Status final</span><strong>${pageEsc(idea.status)}</strong></div></div>${idea.status === 'Cancelado' ? `<div class="cancel-note"><strong>Motivo do cancelamento:</strong> ${pageEsc(idea.motivoCancelamento || idea.descricaoCancelamento || idea.descricaoCurta || 'Não informado')}<br><span>Atualizado em ${pageDate(idea.atualizado)}</span></div>` : ''}</article>`; }
function countBy(items, key) { return items.reduce((acc, item) => { const value = item[key] || 'Não informado'; acc[value] = (acc[value] || 0) + 1; return acc; }, {}); }

async function renderPeople() {
  await getPageData();
  pageLayout(`<div class="page-heading page-heading-compact"><div><span class="section-kicker">REDE DE IDEIAS</span><h1>Colaboradores</h1><p>Pesquise pelo nome do colaborador.</p></div><span class="heading-mark">✦</span></div><div class="page-toolbar"><div class="search-box"><span class="search-icon">⌕</span><input id="people-search" type="search" placeholder="Buscar pelo nome do colaborador" autocomplete="off"></div><span class="toolbar-count" id="people-count">Pesquise para começar</span></div><div id="people-grid" class="people-grid"></div>`, 'people');
  const draw = () => {
    const term = normalizedPersonName(page$('#people-search').value);
    const people = term ? pageState.people.filter((person) => normalizedPersonName(person.nome).includes(term)) : [];
    console.log('Campo utilizado para busca: Nome');
    console.log('Quantidade encontrada:', people.length);
    page$('#people-count').textContent = term ? `${people.length} colaboradores encontrados` : 'Pesquise para começar';
    page$('#people-grid').innerHTML = term ? (people.length ? people.map((person) => `<a class="person-card" href="colaboradores.html?person=${encodeURIComponent(person.nome)}"><div class="person-card-top"><span class="avatar">${pageInitials(person.nome)}</span><span class="card-arrow">↗</span></div><h2>${pageEsc(person.nome)}</h2><p>${pageEsc(person.area)} · Coord. ${pageEsc(person.coordenador)} · ${pageEsc(person.funcao)}</p><div class="person-card-footer"><strong>${person.ideas.length}</strong><span>${person.ideas.length === 1 ? 'ideia registrada' : 'ideias registradas'}</span></div></a>`).join('') : '<div class="empty-search">Nenhum colaborador encontrado.</div>') : '<div class="empty-search"><span class="empty-icon">⌕</span><p>Digite o nome de um colaborador para começar.</p></div>';
  };
  page$('#people-search').addEventListener('input', draw);
  draw();
}
async function renderPerson(personName) { await getPageData(); const person = pageState.people.find((item) => pageNormalize(item.nome) === pageNormalize(personName)); if (!person) return renderPeople(); pageLayout(`<a class="back-link" href="colaboradores.html">← Todos os colaboradores</a><div class="person-header"><span class="avatar">${pageInitials(person.nome)}</span><div><h1>${pageEsc(person.nome)}</h1><p>${pageEsc(person.funcao)} · ${pageEsc(person.area)} · Coord. ${pageEsc(person.coordenador)}</p></div></div><div class="ideas-heading"><h2>Ideias abertas por ${pageEsc(person.nome.split(' ')[0])}</h2></div>${person.ideas.length ? person.ideas.map(ideaCardPage).join('') : '<div class="empty-search">Nenhuma ideia encontrada.</div>'}`, 'people'); }

async function renderRecognitionPage() { const data = await getPageData(); const recognized = data.reconhecidas || { trimestre: [], semestre: [] }; const cards = (items, empty) => items.length ? items.map((item) => `<article class="recognition-feature"><div class="recognition-photo">${item.foto ? `<img src="${pageEsc(item.foto)}" alt="${pageEsc(item.titulo || 'Ideia reconhecida')}">` : '<span>✦</span>'}</div><div><span class="section-kicker">IDEIA RECONHECIDA</span><h2>${pageEsc(item.titulo || item.descricaoCurta || 'Ideia reconhecida')}</h2><p>${pageEsc(item.autor || item.colaborador || 'Colaborador')} · ${pageEsc(item.area || 'Área não informada')}</p></div></article>`).join('') : `<div class="empty-search">${empty}</div>`; const topPeople = [...pageState.people].sort((a, b) => b.ideas.length - a.ideas.length).slice(0, 5); const areas = countBy(pageState.ideas, 'grupo'); pageLayout(`<div class="page-heading page-heading-compact"><div><span class="section-kicker">RECONHECIMENTO</span><h1>Quem faz acontecer</h1><p>Ideias que ganharam destaque e pessoas que movimentam a fábrica.</p></div><span class="heading-mark">✦</span></div><section class="recognition-section"><div class="recognition-section-heading"><h2>Ideias vencedoras do trimestre</h2><span class="section-kicker">DESTAQUES RECENTES</span></div><div class="recognition-feature-grid">${cards(recognized.trimestre, 'Nenhuma ideia cadastrada neste trimestre.')}</div></section><section class="recognition-section"><div class="recognition-section-heading"><h2>Ideias vencedoras do semestre</h2><span class="section-kicker">VISÃO SEMESTRAL</span></div><div class="recognition-feature-grid">${cards(recognized.semestre, 'Nenhuma ideia cadastrada neste semestre.')}</div></section><div class="recognition-ranking-grid"><article class="recognition-card featured"><span class="section-kicker">TOP COLABORADORES</span><h3>Quem mais contribui</h3>${topPeople.map((person, index) => `<div class="leader"><span class="avatar">${pageInitials(person.nome)}</span><span class="leader-name">${index + 1}. ${pageEsc(person.nome)}</span><span class="leader-value">${person.ideas.length}</span></div>`).join('')}</article><article class="recognition-card"><span class="section-kicker">TOP ÁREAS</span><h3>Onde as ideias nascem</h3>${Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([area, amount]) => `<div class="leader"><span class="leader-name">${pageEsc(area)}</span><span class="leader-value">${amount}</span></div>`).join('')}</article></div>`, 'recognition'); }

function coordinatorBars(title, entries) {
  try {
    const safeEntries = Object.entries(entries || {}).filter(([label, value]) => label && Number.isFinite(Number(value)) && Number(value) >= 0).sort((left, right) => Number(right[1]) - Number(left[1]));
    const max = Math.max(...safeEntries.map(([, value]) => Number(value)), 1);
    const rows = safeEntries.length ? safeEntries.map(([label, value]) => `<div class="bar-line"><span>${pageEsc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Number(value) / max * 100}%"></div></div><strong>${Number(value)}</strong></div>`).join('') : '<div class="empty-search">Sem dados para exibir.</div>';
    return `<div class="chart-card fixed-scroll"><h3>${pageEsc(title)}</h3><div class="chart-rows">${rows}</div></div>`;
  } catch (error) {
    console.error(`[Coordenadores] Falha ao renderizar gráfico "${title}".`, error);
    return `<div class="chart-card"><h3>${pageEsc(title)}</h3><div class="empty-search">Este gráfico não pôde ser carregado.</div></div>`;
  }
}
function coordinatorCountBy(items, selector) {
  return (Array.isArray(items) ? items : []).reduce((counts, item) => {
    try {
      const label = String(selector(item) ?? '').trim() || 'Não informado';
      counts[label] = (counts[label] || 0) + 1;
    } catch (error) { console.error('[Coordenadores] Não foi possível contar um registro.', error); }
    return counts;
  }, {});
}
const coordinatorMonthOptions = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2026, index, 1)) }));
function coordinatorMultiSelectSlicer(container, label, options, onChange) {
  const values = options.map((option) => typeof option === 'string' ? { value: option, label: option } : option);
  const selected = new Set();
  container.className = 'filter-slicer';
  container.innerHTML = `<details><summary>${pageEsc(label)} <span class="slicer-selection">Todos</span></summary><div class="slicer-menu"><input class="slicer-search" type="search" placeholder="Pesquisar ${pageEsc(label.toLowerCase())}" aria-label="Pesquisar ${pageEsc(label.toLowerCase())}"><div class="slicer-actions"><button type="button" data-slicer-action="all">Selecionar tudo</button><button type="button" data-slicer-action="clear">Limpar seleção</button></div><div class="slicer-options"></div></div></details>`;
  const details = container.querySelector('details');
  const summary = container.querySelector('.slicer-selection');
  const optionsContainer = container.querySelector('.slicer-options');
  const search = container.querySelector('.slicer-search');
  const updateSummary = () => { summary.textContent = selected.size === 0 || selected.size === values.length ? 'Todos' : `${selected.size} selecionado(s)`; };
  const renderOptions = () => {
    const term = pageNormalize(search.value);
    optionsContainer.innerHTML = values.filter((option) => pageNormalize(option.label).includes(term)).map((option) => `<label class="slicer-option"><input type="checkbox" value="${pageEsc(option.value)}" ${selected.has(option.value) ? 'checked' : ''}><span>${pageEsc(option.label)}</span></label>`).join('') || '<span class="slicer-empty">Nenhum resultado</span>';
  };
  optionsContainer.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    updateSummary();
    renderOptions();
    onChange();
  });
  container.querySelector('[data-slicer-action="all"]').addEventListener('click', () => {
    values.forEach((option) => selected.add(option.value));
    updateSummary();
    renderOptions();
    onChange();
  });
  container.querySelector('[data-slicer-action="clear"]').addEventListener('click', () => {
    selected.clear();
    updateSummary();
    renderOptions();
    onChange();
  });
  search.addEventListener('input', renderOptions);
  renderOptions();
  updateSummary();
  return { selected: () => selected.size === 0 || selected.size === values.length ? null : new Set(selected) };
}
function buildCoordinatorDashboard(ideas, people) {
  try {
    const areas = coordinatorCountBy(ideas, (idea) => idea.areaTrabalho || idea.grupo);
    const subcategories = coordinatorCountBy(ideas, (idea) => idea.subcategoria);
    const statuses = coordinatorCountBy(ideas, (idea) => idea.status);
    const coordinatorByIdea = new Map(people.flatMap((person) => person.ideas.map((idea) => [idea.numero, person.coordenador || 'Não informado'])));
    const coordinators = coordinatorCountBy(ideas, (idea) => coordinatorByIdea.get(idea.numero) || 'Sem associação');
    const months = coordinatorCountBy(ideas, (idea) => {
      const date = pageDateValue(idea.criada);
      return date ? new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '') : 'Data não informada';
    });
    const personByIdeaNumber = new Map(people.flatMap((person) => person.ideas.map((idea) => [String(idea.numero), person])));
    const peopleCounts = coordinatorCountBy(ideas, (idea) => personByIdeaNumber.get(String(idea.numero))?.nome || 'Sem associação');
    const topPeople = Object.fromEntries(Object.entries(peopleCounts).sort((left, right) => right[1] - left[1]));
    const topAreas = Object.fromEntries(Object.entries(areas).sort((left, right) => right[1] - left[1]).slice(0, 10));
    const topSubcategories = Object.fromEntries(Object.entries(subcategories).sort((left, right) => right[1] - left[1]));
    return { areas, subcategories, statuses, coordinators, months, topPeople, topAreas, topSubcategories };
  } catch (error) {
    console.error('[Coordenadores] Falha ao consolidar dados do dashboard.', error);
    return { areas: {}, subcategories: {}, statuses: {}, coordinators: {}, months: {}, topPeople: {}, topAreas: {}, topSubcategories: {} };
  }
}
function renderCoordinatorCharts(dashboardData) {
  try {
    const charts = [
      ['Ideias por Área', dashboardData.areas],
      ['Ideias por Coordenador', dashboardData.coordinators],
      ['Ideias por Mês', dashboardData.months],
      ['Ideias por Subcategoria', dashboardData.subcategories],
      ['Ideias por Status', dashboardData.statuses],
      ['Top Colaboradores', dashboardData.topPeople],
      ['Top Áreas', dashboardData.topAreas],
      ['Top Subcategorias', dashboardData.topSubcategories]
    ];
    return charts.map(([title, entries]) => {
      try { return coordinatorBars(title, entries); }
      catch (error) {
        console.error(`[Coordenadores] Falha isolada no gráfico "${title}".`, error);
        return `<div class="chart-card"><h3>${pageEsc(title)}</h3><div class="empty-search">Este gráfico não pôde ser carregado.</div></div>`;
      }
    }).join('');
  } catch (error) {
    console.error('[Coordenadores] Falha ao preparar gráficos.', error);
    return '<div class="chart-card"><h3>Indicadores</h3><div class="empty-search">Os gráficos não puderam ser preparados.</div></div>';
  }
}
function renderCoordinatorDashboard() {
  try {
    const ideas = Array.isArray(pageState.ideas) ? pageState.ideas.filter((idea) => idea && typeof idea === 'object') : [];
    const people = Array.isArray(pageState.people) ? pageState.people.filter((person) => person && typeof person === 'object') : [];
    const dashboardData = buildCoordinatorDashboard(ideas, people);
    console.log('Ideias:', ideas.length);
    console.log('Áreas:', Object.keys(dashboardData.areas).length);
    console.log('Coordenadores:', Object.keys(dashboardData.coordinators).length);
    console.log('Subcategorias:', Object.keys(dashboardData.subcategories).length);
    console.log('Status:', Object.keys(dashboardData.statuses).length);
    console.log('Dados filtros:', { ideias: ideas.length, areas: Object.keys(dashboardData.areas).length, subcategorias: Object.keys(dashboardData.subcategories).length, status: Object.keys(dashboardData.statuses).length });
    const implemented = (dashboardData.statuses.Fechado || 0) + (dashboardData.statuses.Resolvido || 0);
    const content = page$('#coordinator-content');
    if (!content) throw new Error('Contêiner do dashboard de coordenadores não encontrado.');
    content.classList.remove('hidden');
    content.innerHTML = `<div class="dashboard-header"><div><span class="section-kicker">VISÃO DOS COORDENADORES</span><h1>Indicadores operacionais</h1><p>Dados consolidados após autenticação.</p></div></div><div class="coordinator-filters"><label>Área<select id="coord-area"><option value="Todos">Todas</option></select></label><label>Coordenador<select id="coord-coordinator"><option value="Todos">Todos</option></select></label><label>Status<select id="coord-status"><option value="Todos">Todos</option><option>Rascunho</option><option>Em andamento</option><option>Resolvido</option><option>Fechado</option><option>Cancelado</option></select></label><label>Subcategoria<select id="coord-subcategory"><option value="Todos">Todas</option></select></label><div id="coord-year-slicer"></div><div id="coord-month-slicer"></div></div><div class="dashboard-kpis"><div class="kpi"><span>Total de ideias</span><strong id="coord-total">0</strong></div><div class="kpi"><span>Implementadas</span><strong id="coord-implemented">0</strong></div><div class="kpi"><span>Canceladas</span><strong id="coord-cancelled">0</strong></div><div class="kpi"><span>Colaboradores ativos</span><strong id="coord-people">0</strong></div></div><div id="coord-charts" class="charts-row"></div>`;
    const addOptions = (selector, values) => {
      const select = page$(selector);
      [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'pt-BR')).forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      });
    };
    addOptions('#coord-area', ideas.map((idea) => idea.areaTrabalho || idea.grupo || 'Não informado'));
    addOptions('#coord-coordinator', people.map((person) => person.coordenador || 'Não informado'));
    addOptions('#coord-subcategory', ideas.map((idea) => idea.subcategoria || 'Não informado'));
    const personByIdeaNumber = new Map(people.flatMap((person) => person.ideas.map((idea) => [String(idea.numero), person])));
    const years = [...new Set(ideas.map((idea) => pageDateValue(idea.criada)?.getFullYear()).filter(Number.isInteger))].sort((left, right) => right - left).map(String);
    let updateDashboard = () => {};
    const yearSlicer = coordinatorMultiSelectSlicer(page$('#coord-year-slicer'), 'Ano', years, () => updateDashboard());
    const monthSlicer = coordinatorMultiSelectSlicer(page$('#coord-month-slicer'), 'Mês', coordinatorMonthOptions, () => updateDashboard());
    updateDashboard = () => {
      try {
        const coordinatorFilter = page$('#coord-coordinator').value;
        const selectedYears = yearSlicer.selected();
        const selectedMonths = monthSlicer.selected();
        const filtered = ideas.filter((idea) => {
          const person = personByIdeaNumber.get(String(idea.numero));
          const created = pageDateValue(idea.criada);
          return (page$('#coord-area').value === 'Todos' || (idea.areaTrabalho || idea.grupo || 'Não informado') === page$('#coord-area').value)
            && (coordinatorFilter === 'Todos' || (person?.coordenador || 'Não informado') === coordinatorFilter)
            && (page$('#coord-subcategory').value === 'Todos' || (idea.subcategoria || 'Não informado') === page$('#coord-subcategory').value)
            && (page$('#coord-status').value === 'Todos' || pageNormalize(idea.status) === pageNormalize(page$('#coord-status').value))
            && (!selectedYears || (created && selectedYears.has(String(created.getFullYear()))))
            && (!selectedMonths || (created && selectedMonths.has(String(created.getMonth() + 1))));
        });
        const hasActiveFilters = page$('#coord-area').value !== 'Todos' || coordinatorFilter !== 'Todos' || page$('#coord-subcategory').value !== 'Todos' || page$('#coord-status').value !== 'Todos' || Boolean(selectedYears || selectedMonths);
        const filteredPeople = hasActiveFilters ? [...new Set(filtered.map((idea) => personByIdeaNumber.get(String(idea.numero))).filter(Boolean))] : people;
        const filteredCounts = coordinatorCountBy(filtered, (idea) => pageNormalize(idea.status));
        page$('#coord-total').textContent = String(filtered.length);
        page$('#coord-implemented').textContent = String((filteredCounts.fechado || 0) + (filteredCounts.resolvido || 0));
        page$('#coord-cancelled').textContent = String(filteredCounts.cancelado || 0);
        page$('#coord-people').textContent = String(filteredPeople.length);
        page$('#coord-charts').innerHTML = renderCoordinatorCharts(buildCoordinatorDashboard(filtered, filteredPeople));
        page$('#coord-charts').querySelectorAll('.chart-rows').forEach((rows) => { rows.scrollTop = 0; });
        console.log('Dados filtros:', filtered);
      } catch (error) {
        console.error('[Coordenadores] Falha ao atualizar filtros/indicadores.', error);
        const charts = page$('#coord-charts');
        if (charts) charts.innerHTML = '<div class="chart-card"><h3>Indicadores</h3><p>Não foi possível atualizar os filtros. Os demais dados continuam disponíveis.</p></div>';
      }
    };
    ['#coord-area', '#coord-coordinator', '#coord-subcategory', '#coord-status'].forEach((selector) => page$(selector).addEventListener('change', updateDashboard));
    updateDashboard();
  } catch (error) {
    console.error('[Coordenadores] Falha ao montar dashboard.', error);
    const content = page$('#coordinator-content');
    if (content) {
      content.classList.remove('hidden');
      content.innerHTML = '<div class="empty-search"><p>O painel não pôde ser carregado. Os detalhes do erro estão no console.</p><button type="button" class="primary-button" onclick="location.reload()">Tentar novamente</button></div>';
    }
  }
}
async function renderCoordinatorsPage() {
  try {
    await getPageData();
    pageLayout('<div id="coordinator-gate" class="access-gate"><div class="gate-icon">▣</div><span class="section-kicker">ÁREA RESTRITA</span><h1>Coordenadores</h1><p>Indicadores operacionais do Programa de Ideias.</p><form id="coordinator-pin-form"><input id="coordinator-pin" type="password" placeholder="Digite o PIN de acesso"><button class="primary-button" type="submit">Entrar <span>→</span></button><small id="coordinator-pin-error" class="form-error"></small></form></div><div id="coordinator-content" class="hidden"></div>', 'coordinators');
    page$('#coordinator-pin-form').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        if (page$('#coordinator-pin').value !== 'JDEPIU') {
          page$('#coordinator-pin-error').textContent = 'PIN incorreto. Tente novamente.';
          return;
        }
        page$('#coordinator-gate').classList.add('hidden');
        renderCoordinatorDashboard();
      } catch (error) {
        console.error('[Coordenadores] Falha ao autenticar/renderizar dashboard.', error);
        renderCoordinatorDashboard();
      }
    });
  } catch (error) {
    console.error('[Coordenadores] Falha ao preparar página.', error);
    document.body.innerHTML = '<main class="site-main page-main"><div class="empty-search"><p>Não foi possível preparar o painel de coordenadores.</p></div></main>';
  }
}

async function initializePortalPage() {
  const pageName = document.body.dataset.page;
  const query = new URLSearchParams(location.search);
  const queryPerson = query.get('person');
  const queryIdea = query.get('idea');
  try {
    if (pageName === 'people') await (queryPerson ? renderPerson2(queryPerson, queryIdea) : renderPeople());
    if (pageName === 'recognition') await renderRecognitionPage();
    if (pageName === 'coordinators') await renderCoordinatorsPage();
  } catch (error) {
    console.error('[Portal] Falha ao renderizar a página; exibindo alternativa segura.', error);
    try {
      document.body.innerHTML = '<main class="site-main page-main"><div class="empty-search"><p>Não foi possível carregar esta página.</p><a href="colaboradores.html">Voltar para colaboradores</a></div></main>';
    } catch (renderError) {
      document.body.textContent = 'Não foi possível carregar esta página. Volte para colaboradores.';
    }
  }
}
initializePortalPage();
