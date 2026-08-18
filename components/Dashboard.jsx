'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import LeadDrawer from './LeadDrawer';
import NewLeadModal from './NewLeadModal';
import Metrics from './Metrics';
import Agenda, { computeAgenda } from './Agenda';

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
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
  const [filters, setFilters] = useState({ responsavel: '', segmento: '', canal: '', search: '' });
  const [view, setView] = useState('kanban');
  const [showNewLead, setShowNewLead] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  async function loadAll() {
    setLoading(true);
    setError('');
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
          <span className="dot" />
          🏭 CRM Agostini — Funil de Vendas
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
          </div>
          <button className="btn btn-primary" onClick={() => setShowNewLead(true)}>
            + Novo lead
          </button>
          <a href={`https://agostini-team.monday.com/boards/18404435549`} target="_blank" rel="noreferrer" className="logout">
            Ver no monday.com ↗
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

      {!error && alertCount > 0 && view !== 'agenda' && (
        <div className="banner banner-warning">
          ⚠ {agenda.atrasados.length > 0 && <>{agenda.atrasados.length} lead(s) com follow-up atrasado</>}
          {agenda.atrasados.length > 0 && agenda.semData.length > 0 && ' e '}
          {agenda.semData.length > 0 && <>{agenda.semData.length} sem follow-up agendado</>} precisam de atenção.{' '}
          <button className="btn-link" onClick={() => setView('agenda')}>
            Ver agenda →
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
          {(filters.responsavel || filters.segmento || filters.canal || filters.search) && (
            <button
              className="clear-btn"
              onClick={() => setFilters({ responsavel: '', segmento: '', canal: '', search: '' })}
            >
              Limpar filtros
            </button>
          )}
          <span className="count">{filteredItems.length} lead(s)</span>
        </div>
      )}

      {loading && !items && <div className="loading-screen">Carregando o funil...</div>}

      {meta && items && view === 'metrics' && (
        <div className="metrics-scroll">
          <Metrics items={filteredItems} meta={meta} usersById={usersById} />
        </div>
      )}

      {meta && items && view === 'agenda' && (
        <div className="metrics-scroll">
          <Agenda items={filteredItems} usersById={usersById} onSelect={setSelectedId} />
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
                                {daysSince(item.ultimoContato) !== null && daysSince(item.ultimoContato) > 5 && (
                                  <div className="footer-row" style={{ marginTop: 4 }}>
                                    <span className="stale">
                                      ⚠ {daysSince(item.ultimoContato)} dias sem contato
                                    </span>
                                  </div>
                                )}
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
