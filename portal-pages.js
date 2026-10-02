async function renderPerson2(personName, ideaNumber) {
  await getPageData();
  const person = pageState.people.find((item) => pageNormalize(item.nome) === pageNormalize(personName));
  if (!person) return renderPeople();
  const selectedIdea = ideaNumber ? person.ideas.find((idea) => String(idea.numero) === String(ideaNumber)) : person.ideas.length === 1 ? person.ideas[0] : null;
  const personSummary = `<div class="person-header"><span class="avatar">${pageInitials(person.nome)}</span><div><h1>${pageEsc(person.nome)}</h1><p>Área: ${pageEsc(person.area || 'Não informada')} · Função: ${pageEsc(person.funcao || 'Não informada')} · Coordenador: ${pageEsc(person.coordenador || 'Não informado')}</p></div></div>`;
  if (selectedIdea) {
    pageLayout(`${personSummary}${ideaDetail(selectedIdea, person.nome)}`, 'people');
    return;
  }
  const emptyMessage = person.ideas.length ? '' : emptyPersonIdeas(person);
  pageLayout(`<a class="back-link" href="colaboradores.html">← Todos os colaboradores</a>${personSummary}<div class="ideas-heading"><h2>Ideias de ${pageEsc(person.nome.split(' ')[0])}</h2></div>${person.ideas.length ? `<div class="ideas-summary-list">${person.ideas.map((idea) => ideaSummaryCard(idea, person.nome)).join('')}</div>` : emptyMessage}`, 'people');
}

const PORTAL_FALLBACK = { cadastro: [], baseDmos: [], ideias: [], canceladas: [], reconhecidas: { trimestre: [], semestre: [] } };
const pageState = { people: [], ideas: [], metadata: {} };
const page$ = (selector) => document.querySelector(selector);
const pageNormalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const pageEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const pageInitials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const pageDateValue = (value) => { if (value === null || value === undefined || value === '') return null; const date = typeof value === 'number' ? new Date(Date.UTC(1899, 11, 30) + value * 86400000) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value); return Number.isNaN(date.getTime()) ? null : date; };
const pageDate = (value) => { const date = pageDateValue(value); return date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '') : 'Não informado'; };
const pageStatusClass = (status) => `status-${pageNormalize(status).replaceAll(' ', '-')}`;
const nameTokens = (value) => pageNormalize(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 1);
function samePerson(left, right) { const a = nameTokens(left); const b = nameTokens(right); if (!a.length || !b.length) return false; if (a.join(' ') === b.join(' ')) return true; const firstMatches = a[0] === b[0] || a[0][0] === b[0][0]; const lastMatches = a[a.length - 1] === b[b.length - 1]; return firstMatches && lastMatches; }
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
  const cadastro = Array.isArray(data.cadastro) ? data.cadastro : [];
  const dmos = Array.isArray(data.baseDmos) ? data.baseDmos.filter((entry) => entry && typeof entry === 'object') : [];
  const cancelled = Array.isArray(data.canceladas) ? data.canceladas : [];
  const rawIdeas = Array.isArray(data.ideias) ? data.ideias : [];
  pageState.ideas = rawIdeas.map((idea) => {
    const item = idea && typeof idea === 'object' ? idea : {};
    const cancel = cancelled.find((entry) => entry && String(entry.numero).trim() === String(item.numero).trim());
    return cancel ? { ...item, status: 'Cancelado', motivoCancelamento: cancel.motivo || cancel.descricao || cancel.descricaoCurta } : item;
  });
  const activePeople = cadastro.filter((person) => person && typeof person === 'object' && pageNormalize(person.status) === 'ativo');
  const ideasByPerson = new Map(activePeople.map((person) => [person, []]));
  const relationshipResults = pageState.ideas.map((idea) => {
    const sender = idea.enviadoPor || idea.autor;
    const exactDmosMatches = dmos.filter((entry) => pageNormalize(sender) === pageNormalize(entry.baseDmos));
    const dmosMatches = exactDmosMatches.length ? exactDmosMatches : dmos.filter((entry) => samePerson(sender, entry.baseDmos));
    const officialNames = dmosMatches.map((entry) => entry.nome).filter(Boolean);
    let matchedPeople = activePeople.filter((person) => officialNames.some((name) => pageNormalize(name) === pageNormalize(person.nome)));
    if (!matchedPeople.length) matchedPeople = activePeople.filter((person) => officialNames.some((name) => samePerson(name, person.nome)));
    if (!matchedPeople.length) matchedPeople = activePeople.filter((person) => samePerson(sender, person.nome) || samePerson(idea.autor, person.nome));
    matchedPeople.forEach((person) => ideasByPerson.get(person).push(idea));
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
function pageLayout(content, active) { document.body.innerHTML = `${pageHeader(active)}<main class="site-main page-main">${content}</main>${pageFooter(active)}`; }
function relativeUpdated(value) { const date = pageDateValue(value); if (!date) return 'Atualização não informada'; const days = Math.max(0, Math.floor((Date.now() - date) / 86400000)); return days === 0 ? 'Atualizado hoje' : days === 1 ? 'Atualizado há 1 dia' : `Atualizado há ${days} dias`; }
function ideaSummaryCard(idea, personName) { return `<a class="idea-summary-card" href="colaboradores.html?person=${encodeURIComponent(personName)}&idea=${encodeURIComponent(idea.numero)}"><span class="idea-number">${pageEsc(idea.numero)}</span><h3>${pageEsc(idea.descricaoCurta || 'Ideia sem título')}</h3><div class="idea-summary-meta"><span class="status-pill ${pageStatusClass(idea.status)}">${pageEsc(idea.status)}</span><span>${pageDate(idea.criada)}</span><span>${relativeUpdated(idea.atualizado)}</span></div><span class="idea-summary-open">Ver detalhes&nbsp; →</span></a>`; }
function ideaDetail(idea, personName) { return `<a class="back-link" href="colaboradores.html?person=${encodeURIComponent(personName)}">← Voltar para as ideias de ${pageEsc(personName.split(' ')[0])}</a><article class="idea-detail"><div class="idea-detail-heading"><div><span class="idea-number">${pageEsc(idea.numero)}</span><h2>${pageEsc(idea.descricaoCurta || 'Ideia sem título')}</h2></div><span class="status-pill ${pageStatusClass(idea.status)}">${pageEsc(idea.status)}</span></div><section class="idea-detail-description"><span class="field-label">Descrição</span><p>${pageEsc(idea.descricao || idea.descricaoDuvida || 'Não informado')}</p></section><div class="idea-detail-fields"><div><span class="field-label">Categoria</span><strong>${pageEsc(idea.categoria || 'Não informado')}</strong></div><div><span class="field-label">Sub categoria</span><strong>${pageEsc(idea.subcategoria || 'Não informado')}</strong></div><div><span class="field-label">Área de trabalho</span><strong>${pageEsc(idea.areaTrabalho || idea.grupo || 'Não informado')}</strong></div><div><span class="field-label">Criada</span><strong>${pageDate(idea.criada)}</strong></div><div><span class="field-label">Atualizada</span><strong>${pageDate(idea.atualizado)}</strong></div><div><span class="field-label">Atribuído a</span><strong>${pageEsc(idea.atribuidoA || 'Não informado')}</strong></div><div><span class="field-label">Grupo de atribuição</span><strong>${pageEsc(idea.grupoAtribuicao || 'Não informado')}</strong></div><div><span class="field-label">Status final</span><strong>${pageEsc(idea.status)}</strong></div></div>${idea.status === 'Cancelado' ? `<div class="cancel-note"><strong>Motivo do cancelamento:</strong> ${pageEsc(idea.motivoCancelamento || idea.descricaoCancelamento || idea.descricaoCurta || 'Não informado')}<br><span>Atualizado em ${pageDate(idea.atualizado)}</span></div>` : ''}</article>`; }
function countBy(items, key) { return items.reduce((acc, item) => { const value = item[key] || 'Não informado'; acc[value] = (acc[value] || 0) + 1; return acc; }, {}); }

async function renderPeople() {
  await getPageData();
  pageLayout(`<div class="page-heading page-heading-compact"><div><span class="section-kicker">REDE DE IDEIAS</span><h1>Colaboradores</h1><p>Pesquise para consultar apenas as ideias de um colaborador.</p></div><span class="heading-mark">✦</span></div><div class="page-toolbar"><div class="search-box"><span class="search-icon">⌕</span><input id="people-search" type="search" placeholder="Buscar por nome, área, coordenador ou função" autocomplete="off"></div><span class="toolbar-count" id="people-count">Pesquise para começar</span></div><div id="people-grid" class="people-grid"></div>`, 'people');
  const draw = () => {
    const term = pageNormalize(page$('#people-search').value);
    const people = term ? pageState.people.filter((person) => [person.nome, person.area, person.coordenador, person.funcao].some((value) => pageNormalize(value).includes(term))) : [];
    page$('#people-count').textContent = term ? `${people.length} colaboradores encontrados` : 'Pesquise para começar';
    page$('#people-grid').innerHTML = term ? (people.length ? people.map((person) => `<a class="person-card" href="colaboradores.html?person=${encodeURIComponent(person.nome)}"><div class="person-card-top"><span class="avatar">${pageInitials(person.nome)}</span><span class="card-arrow">↗</span></div><h2>${pageEsc(person.nome)}</h2><p>${pageEsc(person.area || 'Área não informada')} · Coord. ${pageEsc(person.coordenador || 'Não informado')} · ${pageEsc(person.funcao || 'Função não informada')}</p><div class="person-card-footer"><strong>${person.ideas.length}</strong><span>${person.ideas.length === 1 ? 'ideia registrada' : 'ideias registradas'}</span></div></a>`).join('') : '<div class="empty-search">Nenhum colaborador encontrado.</div>') : '<div class="empty-search"><span class="empty-icon">⌕</span><p>Digite um nome, área, coordenador ou função para começar.</p></div>';
  };
  page$('#people-search').addEventListener('input', draw);
  draw();
}
async function renderPerson(personName) { await renderPerson2(personName, null); }

async function renderRecognitionPage() { const data = await getPageData(); const recognized = data.reconhecidas || { trimestre: [], semestre: [] }; const cards = (items, empty) => items.length ? items.map((item) => `<article class="recognition-feature"><div class="recognition-photo">${item.foto ? `<img src="${pageEsc(item.foto)}" alt="${pageEsc(item.titulo || 'Ideia reconhecida')}">` : '<span>✦</span>'}</div><div><span class="section-kicker">IDEIA RECONHECIDA</span><h2>${pageEsc(item.titulo || item.descricaoCurta || 'Ideia reconhecida')}</h2><p>${pageEsc(item.autor || item.colaborador || 'Colaborador')} · ${pageEsc(item.area || 'Área não informada')}</p></div></article>`).join('') : `<div class="empty-search">${empty}</div>`; const topPeople = [...pageState.people].sort((a, b) => b.ideas.length - a.ideas.length).slice(0, 5); const areas = countBy(pageState.ideas, 'grupo'); pageLayout(`<div class="page-heading page-heading-compact"><div><span class="section-kicker">RECONHECIMENTO</span><h1>Quem faz acontecer</h1><p>Ideias que ganharam destaque e pessoas que movimentam a fábrica.</p></div><span class="heading-mark">✦</span></div><section class="recognition-section"><div class="recognition-section-heading"><h2>Ideias vencedoras do trimestre</h2><span class="section-kicker">DESTAQUES RECENTES</span></div><div class="recognition-feature-grid">${cards(recognized.trimestre, 'Nenhuma ideia cadastrada neste trimestre.')}</div></section><section class="recognition-section"><div class="recognition-section-heading"><h2>Ideias vencedoras do semestre</h2><span class="section-kicker">VISÃO SEMESTRAL</span></div><div class="recognition-feature-grid">${cards(recognized.semestre, 'Nenhuma ideia cadastrada neste semestre.')}</div></section><div class="recognition-ranking-grid"><article class="recognition-card featured"><span class="section-kicker">TOP COLABORADORES</span><h3>Quem mais contribui</h3>${topPeople.map((person, index) => `<div class="leader"><span class="avatar">${pageInitials(person.nome)}</span><span class="leader-name">${index + 1}. ${pageEsc(person.nome)}</span><span class="leader-value">${person.ideas.length}</span></div>`).join('')}</article><article class="recognition-card"><span class="section-kicker">TOP ÁREAS</span><h3>Onde as ideias nascem</h3>${Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([area, amount]) => `<div class="leader"><span class="leader-name">${pageEsc(area)}</span><span class="leader-value">${amount}</span></div>`).join('')}</article></div>`, 'recognition'); }

function averageImplementation(ideas) {
  const durations = ideas.filter((idea) => idea.criada && idea.fechado).map((idea) => {
    const created = pageDateValue(idea.criada);
    const closed = pageDateValue(idea.fechado);
    return created && closed ? (closed - created) / 86400000 : NaN;
  }).filter((days) => Number.isFinite(days) && days >= 0);
  return durations.length ? `${Math.round(durations.reduce((sum, days) => sum + days, 0) / durations.length)} dias` : 'Não informado';
}
function coordinatorBars(title, entries) { const max = Math.max(...Object.values(entries), 1); return `<div class="chart-card"><h3>${title}</h3>${Object.entries(entries).map(([key, value]) => `<div class="bar-line"><span>${pageEsc(key)}</span><div class="bar-track"><div class="bar-fill" style="width:${value / max * 100}%"></div></div><strong>${value}</strong></div>`).join('')}</div>`; }
async function renderCoordinatorsPage() {
  await getPageData();
  pageLayout(`<div id="coordinator-gate" class="access-gate"><div class="gate-icon">▣</div><span class="section-kicker">ÁREA RESTRITA</span><h1>Coordenadores</h1><p>Indicadores operacionais do Programa de Ideias.</p><form id="coordinator-pin-form"><input id="coordinator-pin" type="password" placeholder="Digite o PIN de acesso"><button class="primary-button" type="submit">Entrar <span>→</span></button><small id="coordinator-pin-error" class="form-error"></small></form></div><div id="coordinator-content" class="hidden"></div>`, 'coordinators');
  page$('#coordinator-pin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (page$('#coordinator-pin').value !== 'JDEPIU') {
      page$('#coordinator-pin-error').textContent = 'PIN incorreto. Tente novamente.';
      return;
    }
    try {
      page$('#coordinator-gate').classList.add('hidden');
      renderCoordinatorDashboard();
    } catch (error) {
      console.error('[Coordenadores] Falha ao montar o painel.', error);
      const content = page$('#coordinator-content');
      if (content) {
        content.classList.remove('hidden');
        content.innerHTML = '<div class="empty-search"><p>Não foi possível carregar os indicadores agora.</p><button type="button" class="primary-button" onclick="location.reload()">Tentar novamente</button></div>';
      }
    }
  });
}
function renderCoordinatorDashboard() {
  const areas = countBy(pageState.ideas, 'grupo');
  const categories = countBy(pageState.ideas, 'categoria');
  const statuses = countBy(pageState.ideas, 'status');
  const coordinators = countBy(pageState.people.map((person) => ({ value: person.coordenador })), 'value');
  const months = countBy(pageState.ideas.map((idea) => {
    const date = pageDateValue(idea.criada);
    return { value: date ? new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '') : 'N/D' };
  }), 'value');
  const topPeople = Object.fromEntries([...pageState.people].sort((a, b) => b.ideas.length - a.ideas.length).slice(0, 10).map((person) => [person.nome, person.ideas.length]));
  const implemented = (statuses.Fechado || 0) + (statuses.Resolvido || 0);
  const content = page$('#coordinator-content');
  if (!content) throw new Error('Painel dos coordenadores indisponível.');
  content.classList.remove('hidden');
  content.innerHTML = `<div class="dashboard-header"><div><span class="section-kicker">VISÃO DOS COORDENADORES</span><h1>Indicadores operacionais</h1><p>Dados consolidados após autenticação.</p></div></div><div class="coordinator-filters"><label>Área<select id="coord-area"><option>Todos</option>${Object.keys(areas).map((value) => `<option>${pageEsc(value)}</option>`).join('')}</select></label><label>Categoria<select id="coord-category"><option>Todos</option>${Object.keys(categories).map((value) => `<option>${pageEsc(value)}</option>`).join('')}</select></label><label>Status<select id="coord-status"><option>Todos</option>${Object.keys(statuses).map((value) => `<option>${pageEsc(value)}</option>`).join('')}</select></label></div><div class="dashboard-kpis"><div class="kpi"><span>Total de ideias</span><strong id="coord-total">${pageState.ideas.length}</strong></div><div class="kpi"><span>Implementadas</span><strong>${implemented}</strong></div><div class="kpi"><span>Tempo médio</span><strong>${averageImplementation(pageState.ideas)}</strong></div><div class="kpi"><span>Colaboradores ativos</span><strong>${pageState.people.length}</strong></div></div><div id="coord-charts" class="charts-row">${coordinatorBars('Ideias por área', areas)}${coordinatorBars('Ideias por coordenador', coordinators)}${coordinatorBars('Ideias por mês', months)}${coordinatorBars('Ideias por categoria', categories)}${coordinatorBars('Ideias por status', statuses)}${coordinatorBars('Top colaboradores', topPeople)}</div>`;
  ['coord-area', 'coord-category', 'coord-status'].forEach((id) => page$(`#${id}`).addEventListener('change', () => {
    const filtered = pageState.ideas.filter((idea) => (page$('#coord-area').value === 'Todos' || idea.grupo === page$('#coord-area').value) && (page$('#coord-category').value === 'Todos' || idea.categoria === page$('#coord-category').value) && (page$('#coord-status').value === 'Todos' || idea.status === page$('#coord-status').value));
    page$('#coord-total').textContent = filtered.length;
  }));
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
function showPortalRuntimeError(error) {
  console.error('[Portal] Erro inesperado durante a exibição.', error);
  document.body.innerHTML = '<main class="site-main page-main"><div class="empty-search"><p>Ocorreu um erro ao carregar esta página.</p><a href="colaboradores.html">Voltar para colaboradores</a></div></main>';
}
window.addEventListener('error', (event) => {
  if (event.error) showPortalRuntimeError(event.error);
});
window.addEventListener('unhandledrejection', (event) => showPortalRuntimeError(event.reason));
initializePortalPage();
