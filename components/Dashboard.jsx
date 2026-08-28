'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import LeadDrawer from './LeadDrawer';
import NewLeadModal from './NewLeadModal';
import Metrics from './Metrics';
import Agenda, { computeAgenda } from './Agenda';
import PosVenda from './PosVenda';
import Gerencial from './Gerencial';
import PainelVendas from './PainelVendas';
import { ultimoEnvio, statusLeituraRegistro, STATUS_LEITURA_LABEL, STATUS_LEITURA_COR } from '../lib/proposalTrackStatus';
import { DATE_FIELDS } from '../lib/config';

// Filtros padrão da barra superior — pedido do Tiago em 27/08/2026: filtro de
// período por data de conferência, com o campo de data escolhido na hora
// (criação, qualificação, proposta, negociação, fechamento ou perda), usado
// pra bater números com o monday.com num intervalo específico.
const DEFAULT_FILTERS = { responsavel: '', segmento: '', canal: '', search: '', dataCampo: 'createdAt', dataInicio: '', dataFim: '' };

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function dateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDatePt(dateStr) {
  const d = dateOnly(dateStr);
  if (!d) return '';
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}

// Selo de follow-up mostrado no rodapé do card — dá pra "ver" o mesmo
// critério usado em comparePriority, então a ordem dos cards na coluna faz
// sentido visualmente (quem tem selo vermelho/atrasado no topo, depois quem
// tem follow-up mais próximo, por último quem não tem nada marcado).
function followUpInfo(item) {
  const today = todayStr();
  const fu = dateOnly(item.proximoFollowUp);
  if (fu) {
    if (fu < today) return { text: `⚠ follow-up atrasado ${daysSince(item.proximoFollowUp)}d`, className: 'stale' };
    if (fu === today) return { text: '📅 follow-up hoje', className: 'due-today' };
    return { text: `📅 follow-up em ${fmtDatePt(fu)}`, className: 'due-future' };
  }
  const dias = daysSince(item.ultimoContato);
  if (dias === null) return { text: '⚠ sem contato e sem follow-up marcado', className: 'stale' };
  if (dias > 5) return { text: `⚠ ${dias} dias sem contato, sem follow-up marcado`, className: 'stale' };
  // Contato recente mas sem follow-up agendado — não é urgente feito os
  // casos acima, mas merece um lembrete visual (pedido do Tiago em
  // 27/08/2026) numa cor diferente do vermelho de "atrasado/negligenciado",
  // pro vendedor lembrar de marcar a próxima data antes que vire atraso.
  return { text: '🔔 marcar follow-up', className: 'no-followup' };
}

// Ordena os cards de cada etapa por prioridade de atendimento, não por data
// de criação (pedido do Tiago em 27/08/2026 — um CRM deve mostrar primeiro
// quem precisa de atenção agora). Regra: quem tem follow-up mais atrasado
// vem primeiro; sem atraso, quem tem o follow-up mais próximo vem primeiro
// (as duas comparações são a mesma ordenação cronológica ascendente — uma
// data no passado já "vence" uma no futuro nessa ordem, então não precisa de
// lógica separada pra atrasado vs. não atrasado). Quem não tem follow-up
// marcado fica por último, ordenado por quem está há mais tempo sem contato
// — mesmo critério já usado no grupo "sem follow-up agendado" da Agenda.
function comparePriority(a, b) {
  const fuA = dateOnly(a.proximoFollowUp);
  const fuB = dateOnly(b.proximoFollowUp);
  if (fuA && fuB) return fuA.localeCompare(fuB);
  if (fuA && !fuB) return -1;
  if (!fuA && fuB) return 1;
  const diasA = daysSince(a.ultimoContato);
  const diasB = daysSince(b.ultimoContato);
  const va = diasA === null ? Infinity : diasA;
  const vb = diasB === null ? Infinity : diasB;
  return vb - va;
}

function formatMoney(v) {
  const n = Number(v);
  if (!v || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export default function Dashboard() {
  const router = useRouter();
  const [meta, setMeta] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('kanban');
  const [showNewLead, setShowNewLead] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  // Aviso de follow-up atrasado/sem data — fechável (pedido do Tiago: ele tem
  // TOC e TDAH, um banner fixo que não fecha é ruim pra ele), mas volta a
  // aparecer a cada atualização do CRM (loadAll), não só uma vez por sessão.
  const [bannerDismissed, setBannerDismissed] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError('');
    setBannerDismissed(false);
    try {
      const [metaRes, itemsRes] = await Promise.all([fetch('/api/meta'), fetch('/api/items')]);
      const metaData = await metaRes.json();
      const itemsData = await itemsRes.json();
      if (!metaRes.ok) throw new Error(metaData.error || 'Erro ao carregar configuração.');
      if (!itemsRes.ok) throw new Error(itemsData.error || 'Erro ao carregar leads.');
      setMeta(metaData);
      setItems(itemsData.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMe() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) setCurrentUser(await res.json());
    } catch {
      // silencioso — não é crítico pra usar o painel
    }
  }

  useEffect(() => {
    loadAll();
    loadMe();
  }, []);

  // Usa a lista completa (todos os setores) só pra resolver nomes — assim
  // leads antigos que ainda apontam pra alguém fora do time de vendas
  // continuam mostrando o nome certo, mesmo que essa pessoa não apareça mais
  // no filtro nem no seletor de responsável (ver /api/meta).
  const usersById = useMemo(() => {
    const map = {};
    (meta?.allUsers || meta?.users || []).forEach((u) => (map[String(u.id)] = u));
    return map;
  }, [meta]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => {
      if (filters.responsavel && !it.responsavelIds.includes(filters.responsavel)) return false;
      if (filters.segmento && it.segmento !== filters.segmento) return false;
      if (filters.canal && it.canalOrigem !== filters.canal) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const haystack = `${it.name} ${it.empresa || ''} ${it.telefone || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filters.dataInicio || filters.dataFim) {
        // Compara só "YYYY-MM-DD": createdAt vem em ISO completo do monday,
        // as demais datas de estágio já vêm como texto "YYYY-MM-DD" — os 10
        // primeiros caracteres bastam pros dois casos e a comparação de
        // string funciona igual à cronológica nesse formato.
        const raw = it[filters.dataCampo];
        const val = raw ? String(raw).slice(0, 10) : null;
        if (!val) return false;
        if (filters.dataInicio && val < filters.dataInicio) return false;
        if (filters.dataFim && val > filters.dataFim) return false;
      }
      return true;
    });
  }, [items, filters]);

  const agenda = useMemo(() => computeAgenda(items || []), [items]);
  const alertCount = agenda.atrasados.length + agenda.semData.length;

  const grouped = useMemo(() => {
    const map = {};
    (meta?.stages || []).forEach((s) => (map[s.value] = []));
    const outros = [];
    for (const it of filteredItems) {
      if (it.estagio && map[it.estagio]) map[it.estagio].push(it);
      else outros.push(it);
    }
    Object.values(map).forEach((arr) => arr.sort(comparePriority));
    return { map, outros };
  }, [filteredItems, meta]);

  function updateLocalItem(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function handleDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;

    const newStage = destination.droppableId;
    const previousStage = source.droppableId;
    updateLocalItem(draggableId, { estagio: newStage });

    try {
      const res = await fetch(`/api/items/${draggableId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estagio: newStage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao mover o lead.');
      }
    } catch (err) {
      updateLocalItem(draggableId, { estagio: previousStage });
      setError(err.message);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const selectedItem = items && selectedId ? items.find((it) => it.id === selectedId) : null;

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Agostini" />
          CRM Agostini — Funil de Vendas
        </div>
        <div className="actions">
          <div className="view-toggle">
            <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}>
              Kanban
            </button>
            <button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>
              Agenda{alertCount > 0 && <span className="toggle-badge">{alertCount}</span>}
            </button>
            <button className={view === 'metrics' ? 'active' : ''} onClick={() => setView('metrics')}>
              Métricas
            </button>
            <button className={view === 'posvenda' ? 'active' : ''} onClick={() => setView('posvenda')}>
              Pós-venda
            </button>
            {currentUser?.admin && (
              <button className={view === 'gerencial' ? 'active' : ''} onClick={() => setView('gerencial')}>
                Gerencial
              </button>
            )}
            {currentUser?.admin && (
              <button className={view === 'painelVendas' ? 'active' : ''} onClick={() => setView('painelVendas')}>
                Painel de Vendas
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setShowNewLead(true)}>
            + Novo lead
          </button>
          <a href={`https://agostini-team.monday.com/boards/18404435549`} target="_blank" rel="noreferrer" className="logout">
            Ver no monday.com ↗
          </a>
          <a href="/ferramentas" className="logout">
            Ferramentas ↗
          </a>
          <button className="btn btn-secondary" onClick={loadAll} disabled={loading}>
            {loading ? 'Atualizando...' : '↻ Atualizar'}
          </button>
          {currentUser?.admin && (
            <a className="logout" href="/admin/users">
              Gerenciar usuários
            </a>
          )}
          {currentUser?.name && <span className="current-user">Olá, {currentUser.name}</span>}
          <a className="logout" href="#" onClick={(e) => { e.preventDefault(); logout(); }}>
            Sair
          </a>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {!error && alertCount > 0 && view !== 'agenda' && !bannerDismissed && (
        <div className="banner banner-warning banner-dismissible">
          <span>
            ⚠ {agenda.atrasados.length > 0 && <>{agenda.atrasados.length} lead(s) com follow-up atrasado</>}
            {agenda.atrasados.length > 0 && agenda.semData.length > 0 && ' e '}
            {agenda.semData.length > 0 && <>{agenda.semData.length} sem follow-up agendado</>} precisam de atenção.{' '}
            <button className="btn-link" onClick={() => setView('agenda')}>
              Ver agenda →
            </button>
          </span>
          <button
            className="banner-close"
            onClick={() => setBannerDismissed(true)}
            aria-label="Fechar aviso"
            title="Fechar (volta a aparecer na próxima atualização)"
          >
            ×
          </button>
        </div>
      )}

      {meta && (
        <div className="filters">
          <select value={filters.responsavel} onChange={(e) => setFilters((f) => ({ ...f, responsavel: e.target.value }))}>
            <option value="">Todos os responsáveis</option>
            {meta.users.map((u) => (
              <option key={u.id} value={String(u.id)}>
                {u.name}
              </option>
            ))}
          </select>
          <select value={filters.segmento} onChange={(e) => setFilters((f) => ({ ...f, segmento: e.target.value }))}>
            <option value="">Todos os segmentos</option>
            {meta.segmentos.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={filters.canal} onChange={(e) => setFilters((f) => ({ ...f, canal: e.target.value }))}>
            <option value="">Todos os canais</option>
            {meta.canais.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="search"
            type="text"
            placeholder="Buscar por nome, empresa ou telefone..."
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <select
            value={filters.dataCampo}
            onChange={(e) => setFilters((f) => ({ ...f, dataCampo: e.target.value }))}
            title="Campo de data usado no filtro de período abaixo"
          >
            {DATE_FIELDS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dataInicio}
            onChange={(e) => setFilters((f) => ({ ...f, dataInicio: e.target.value }))}
            title="De (data inicial)"
          />
          <input
            type="date"
            value={filters.dataFim}
            onChange={(e) => setFilters((f) => ({ ...f, dataFim: e.target.value }))}
            title="Até (data final)"
          />
          {(filters.responsavel ||
            filters.segmento ||
            filters.canal ||
            filters.search ||
            filters.dataInicio ||
            filters.dataFim) && (
            <button className="clear-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Limpar filtros
            </button>
          )}
          <span className="count">{filteredItems.length} lead(s)</span>
        </div>
      )}

      {loading && !items && <div className="loading-screen">Carregando o funil...</div>}

      {meta && items && view === 'metrics' && (
        <div className="metrics-scroll">
          <Metrics items={filteredItems} meta={meta} usersById={usersById} currentUser={currentUser} onSelect={setSelectedId} />
        </div>
      )}

      {meta && items && view === 'agenda' && (
        <div className="metrics-scroll">
          <Agenda items={filteredItems} usersById={usersById} onSelect={setSelectedId} />
        </div>
      )}

      {meta && items && view === 'posvenda' && (
        <div className="metrics-scroll">
          <PosVenda items={filteredItems} usersById={usersById} onSelect={setSelectedId} />
        </div>
      )}

      {meta && items && view === 'gerencial' && currentUser?.admin && (
        <div className="metrics-scroll">
          <Gerencial
            items={filteredItems}
            usersById={usersById}
            onSelect={setSelectedId}
            hasActiveFilter={Boolean(
              filters.responsavel || filters.segmento || filters.canal || filters.search || filters.dataInicio || filters.dataFim
            )}
            onClearFilters={() => setFilters(DEFAULT_FILTERS)}
          />
        </div>
      )}

      {view === 'painelVendas' && currentUser?.admin && (
        <div className="metrics-scroll">
          <PainelVendas />
        </div>
      )}

      {meta && items && view === 'kanban' && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="board-scroll">
            <div className="board-columns">
              {meta.stages.map((stage) => (
                <div className="stage-column" key={stage.value}>
                  <div className="stage-header" style={{ background: stage.color, color: stage.textColor }}>
                    <span>{stage.value}</span>
                    <span className="badge">{grouped.map[stage.value]?.length || 0}</span>
                  </div>
                  <Droppable droppableId={stage.value}>
                    {(provided, snapshot) => (
                      <div
                        className={`stage-body${snapshot.isDraggingOver ? ' drag-over' : ''}`}
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        {(grouped.map[stage.value] || []).map((item, index) => (
                          <Draggable draggableId={item.id} index={index} key={item.id}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`lead-card${snapshot.isDragging ? ' dragging' : ''}`}
                                onClick={() => setSelectedId(item.id)}
                              >
                                <h4>{item.name}</h4>
                                {item.empresa && <div className="empresa">{item.empresa}</div>}
                                <div className="meta-row">
                                  {item.segmento && <span className="chip">{item.segmento}</span>}
                                  {item.canalOrigem && <span className="chip">{item.canalOrigem}</span>}
                                  {item.propostas && item.propostas.length > 0 && (
                                    <span className="chip" title="Arquivos anexados (propostas, orçamentos, layouts...)">
                                      📄 {item.propostas.length}
                                    </span>
                                  )}
                                  {(() => {
                                    const ultimo = ultimoEnvio(item.rastreioPropostas);
                                    if (!ultimo) return null;
                                    const statusLeitura = statusLeituraRegistro(ultimo);
                                    return (
                                      <span className="proposta-status-group">
                                        <span
                                          className="proposta-status-dot"
                                          title={STATUS_LEITURA_LABEL[statusLeitura]}
                                          style={{ background: STATUS_LEITURA_COR[statusLeitura] }}
                                        />
                                        {ultimo.downloadCount > 0 && (
                                          <span
                                            className="proposta-download-icon"
                                            title={`Baixada ${ultimo.downloadCount}x pelo botão da página`}
                                          >
                                            ⬇
                                          </span>
                                        )}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="footer-row">
                                  <span>
                                    {item.responsavelIds
                                      .map((id) => usersById[id]?.name)
                                      .filter(Boolean)
                                      .join(', ') || 'Sem responsável'}
                                  </span>
                                  {formatMoney(item.valorEstimado) && (
                                    <span className="valor">{formatMoney(item.valorEstimado)}</span>
                                  )}
                                </div>
                                {(() => {
                                  const info = followUpInfo(item);
                                  if (!info) return null;
                                  return (
                                    <div className="footer-row" style={{ marginTop: 4 }}>
                                      <span className={info.className}>{info.text}</span>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {(grouped.map[stage.value] || []).length === 0 && (
                          <div className="empty-col">Nenhum lead aqui.</div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </div>
        </DragDropContext>
      )}

      {selectedItem && (
        <LeadDrawer
          item={selectedItem}
          meta={meta}
          currentUser={currentUser}
          onClose={() => setSelectedId(null)}
          onSaved={(id, patch) => updateLocalItem(id, patch)}
        />
      )}

      {showNewLead && (
        <NewLeadModal
          meta={meta}
          onClose={() => setShowNewLead(false)}
          onCreated={() => {
            setShowNewLead(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}
