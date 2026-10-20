'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtDataBR } from '../lib/agenda.js';

// SUGESTÕES DE PRÓXIMOS PASSOS (v3, modo sugestão).
//
// Mostra o que o servidor calculou (GET /api/automacao/sugestoes) dentro da
// Agenda existente e da tela da oportunidade — não é uma segunda agenda nem um
// segundo sistema de tarefas: aceitar grava a ação no MESMO plano de ação que a
// Agenda já lê. Nada é criado até alguém aceitar e nada é enviado ao cliente.
// Aceitar agenda a ação; só o registro do atendimento a dá como realizada.

const CONFIRMA_POR_CODIGO = {
  substituir: 'substituir',
  compromisso_cliente: 'substituirCompromisso',
  dia_nao_util: 'diaNaoUtil',
};

function novoPedido() {
  return `ui${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function Cartao({ s, usersById, onSelect, onDecidir, mostrarLead }) {
  const [modo, setModo] = useState('ver'); // ver | ajustar
  const [ajuste, setAjuste] = useState(null);
  const [pedido, setPedido] = useState(null); // { codigo, erro, sugestaoData? }
  const [confirmas, setConfirmas] = useState({}); // confirmações já dadas nesta tentativa
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const p = s.acaoProposta;
  const respNome = p?.responsavelId ? usersById?.[p.responsavelId]?.name || `#${p.responsavelId}` : null;

  async function enviar(decisao, extra = {}) {
    if (busyRef.current) return; // trava duplo clique
    busyRef.current = true;
    setBusy(true);
    setErro('');
    try {
      const r = await onDecidir(s, decisao, { ...extra, ...(decisao === 'aceitar' ? { confirma: { ...confirmas, ...(extra.confirma || {}) } } : {}) });
      if (r.codigo && CONFIRMA_POR_CODIGO[r.codigo]) {
        setPedido(r);
      } else if (!r.ok) {
        setErro(r.error || 'Não foi possível concluir.');
        setPedido(null);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const ajusteAtual = ajuste || { acao: p?.acao || '', data: p?.data || '', hora: p?.hora || '', responsavelId: p?.responsavelId || '' };

  return (
    <div className={`sug-card sug-${s.tipo}`} data-testid="sugestao" data-regra={s.regra} data-chave={s.chave}>
      <div className="sug-top">
        {mostrarLead && (
          <button type="button" className="sug-lead" onClick={() => onSelect?.(s.itemId)}>
            {s.itemNome}
          </button>
        )}
        <span className="prop-chip">{s.regraNome}</span>
        <span className="prop-chip sug-origem" data-testid="sug-origem">{s.origemRotulo}</span>
        {s.antiga && <span className="prop-chip alt">evento antigo</span>}
      </div>
      <div className="sug-titulo">{s.titulo}</div>
      <div className="sug-just" data-testid="sug-justificativa">{s.justificativa}</div>
      {p && modo === 'ver' && (
        <div className="sug-prop">
          Ação proposta: <strong>{p.acao}</strong> — <strong>{fmtDataBR(p.data)}</strong>
          {p.hora ? ` às ${p.hora}` : ''} · Responsável: {respNome || 'a definir'}
          {p.hora && <div className="opp-sub">O horário é um lembrete interno do CRM; o monday.com guarda só a data.</div>}
        </div>
      )}
      <div className="opp-sub">
        {s.evento?.data ? `Evento: ${s.evento.rotulo} em ${fmtDataBR(s.evento.data)}` : `Evento: ${s.evento?.rotulo || ''}`}
        {s.dataProgramada ? ` · programada para ${fmtDataBR(s.dataProgramada)}` : ''}
      </div>
      {s.substitui && (
        <div className="pend-box" style={{ marginTop: 6 }}>
          Já existe nesta trilha: {s.substitui.acao || '(sem texto)'}{s.substitui.data ? ` — ${fmtDataBR(s.substitui.data)}` : ''} ({s.substitui.origem}). Aceitar pede confirmação para substituí-la.
        </div>
      )}

      {modo === 'ajustar' && p && (
        <div className="prop-form">
          <div className="field"><label>Ação</label><input maxLength={140} value={ajusteAtual.acao} onChange={(e) => setAjuste({ ...ajusteAtual, acao: e.target.value })} aria-label="Ação ajustada" /></div>
          <div className="field-row">
            <div className="field"><label>Data</label><input type="date" value={ajusteAtual.data} onChange={(e) => setAjuste({ ...ajusteAtual, data: e.target.value })} aria-label="Data ajustada" /></div>
            <div className="field"><label>Horário (lembrete interno)</label><input type="time" value={ajusteAtual.hora} onChange={(e) => setAjuste({ ...ajusteAtual, hora: e.target.value })} aria-label="Horário ajustado" /></div>
            <div className="field">
              <label>Responsável</label>
              <select value={ajusteAtual.responsavelId || ''} onChange={(e) => setAjuste({ ...ajusteAtual, responsavelId: e.target.value })} aria-label="Responsável ajustado">
                <option value="">(a definir)</option>
                {Object.values(usersById || {}).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {pedido && (
        <div className="pend-box" data-testid="sug-confirmar" style={{ marginTop: 6 }}>
          {pedido.erro}
          <div className="prop-botoes" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                const novas = { ...confirmas, [CONFIRMA_POR_CODIGO[pedido.codigo]]: true };
                setConfirmas(novas);
                setPedido(null);
                enviar('aceitar', { ajuste: modo === 'ajustar' ? ajusteAtual : undefined, confirma: novas });
              }}
              data-testid="sug-confirmar-sim">
              Confirmar mesmo assim
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPedido(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {erro && <div className="schema-warning" role="alert" style={{ marginTop: 6 }}>{erro}</div>}

      <div className="prop-botoes" style={{ marginTop: 8 }}>
        {s.tipo === 'acao' && modo === 'ver' && (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => enviar('aceitar')} data-testid="sug-aceitar">Aceitar</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setAjuste(null); setModo('ajustar'); }} data-testid="sug-ajustar">Ajustar</button>
          </>
        )}
        {s.tipo === 'acao' && modo === 'ajustar' && (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => enviar('aceitar', { ajuste: ajusteAtual })} data-testid="sug-aceitar-ajustada">Aceitar com ajustes</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setModo('ver'); setPedido(null); }}>Voltar</button>
          </>
        )}
        {s.tipo === 'destaque' && (
          <button type="button" className="btn btn-primary" onClick={() => onSelect?.(s.itemId)} data-testid="sug-abrir">
            {s.semProximoPasso || s.motivoD === 'sem_proxima_acao' ? 'Abrir e definir próximo passo' : 'Abrir oportunidade'}
          </button>
        )}
        {s.regra === 'F' && (
          <button type="button" className="btn btn-secondary" onClick={() => onSelect?.(s.itemId)}>Abrir oportunidade</button>
        )}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => enviar('dispensar')} data-testid="sug-dispensar">Dispensar</button>
      </div>
    </div>
  );
}

export default function SugestoesAcompanhamento({
  trilha = null, // filtra pela trilha (lista da Agenda)
  itemId = null, // modo "uma oportunidade" (gaveta)
  usersById = {},
  admin = false,
  responsavelFiltro = '',
  onSelect,
  onAplicado, // (itemId, patch) → reflete o plano/data na tela sem recarregar tudo
  refreshKey = 0,
  titulo = 'Próximos passos sugeridos',
}) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [analise, setAnalise] = useState({ aberta: false, responsavel: '', itens: null, carregando: false });
  const [limite, setLimite] = useState(25); // evita despejar centenas de cartões de uma vez

  const carregar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (itemId) qs.set('itemId', String(itemId));
      else if (admin && responsavelFiltro) qs.set('responsavelId', responsavelFiltro);
      const res = await fetch(`/api/automacao/sugestoes?${qs.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Não foi possível carregar as sugestões.');
      setDados(j);
      setErro('');
    } catch (e) {
      setErro(e.message);
    }
  }, [itemId, admin, responsavelFiltro]);

  useEffect(() => {
    carregar();
  }, [carregar, refreshKey]);

  async function carregarAnalise(responsavel) {
    setAnalise((a) => ({ ...a, responsavel, carregando: true }));
    try {
      const qs = new URLSearchParams({ analise: '1' });
      if (responsavel) qs.set('responsavelId', responsavel);
      const res = await fetch(`/api/automacao/sugestoes?${qs.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setAnalise((a) => ({ ...a, itens: j.antigas || [], carregando: false, exigeResponsavel: j.analiseExigeResponsavel }));
    } catch (e) {
      setAnalise((a) => ({ ...a, carregando: false, itens: [] }));
      setErro(e.message);
    }
  }

  async function decidir(s, decisao, extra = {}) {
    try {
      const res = await fetch(`/api/automacao/sugestoes/${s.itemId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: novoPedido(), chave: s.chave, decisao, impressao: s.fp, ...extra }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        if (j.planoAcao && decisao === 'aceitar') {
          const patch = { planoAcao: j.planoAcao };
          if (j.campoData && j.data) patch[j.campoData] = j.data;
          onAplicado?.(s.itemId, patch);
        } else if (j.planoAcao) {
          onAplicado?.(s.itemId, { planoAcao: j.planoAcao });
        }
        const partes = [];
        if (j.duplicado && j.aviso) partes.push(j.aviso);
        if (j.avisoNota) partes.push(j.avisoNota);
        setAviso(partes.join(' '));
        await carregar();
        if (analise.aberta && analise.responsavel) await carregarAnalise(analise.responsavel);
        return { ok: true };
      }
      if (res.status === 409 && (j.codigo === 'obsoleta' || j.codigo === 'estagnada' || j.codigo === 'regra_desativada')) {
        setAviso(j.error);
        await carregar();
        return { ok: false, error: j.error };
      }
      return { ok: false, codigo: j.codigo, error: j.error, erro: j.error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  const filtra = (l) => (l || []).filter((s) => (trilha ? s.trilha === trilha : true));
  const lista = filtra(dados?.sugestoes);
  const antigasTotal = dados ? (trilha ? null : dados.totalAntigas) : 0;
  const mostrarLead = !itemId;

  if (erro && !dados) return <div className="schema-warning" role="alert">Sugestões indisponíveis: {erro}</div>;
  if (!dados) return null;
  if (!dados.ativo) {
    return (
      <div className="metrics-section sug-section" data-testid="sugestoes-desativadas">
        <h3>{titulo}</h3>
        <div className="agenda-empty">
          {dados.desativadaPeloAmbiente ? 'A automação está desativada no ambiente (AUTOMACAO_DESATIVADA).' : 'A automação de sugestões está desativada pelo administrador.'} Nenhuma ação ou histórico foi apagado.
        </div>
      </div>
    );
  }

  return (
    <div className="metrics-section sug-section" data-testid="sugestoes">
      <h3>
        {titulo} {lista.length > 0 && <span className="agenda-count">{lista.length}</span>}
      </h3>
      <p className="acao-help">
        Modo sugestão: nada é criado até você aceitar, e nenhuma mensagem é enviada ao cliente. Aceitar <strong>agenda</strong> a ação — ela só conta como feita quando você registra o atendimento.
      </p>
      {dados.aviso && <div className="pend-box">{dados.aviso}</div>}
      {dados.configAviso && <div className="pend-box">{dados.configAviso}</div>}
      {aviso && <div className="pend-box" data-testid="sug-aviso">{aviso}</div>}
      {erro && <div className="schema-warning" role="alert">{erro}</div>}
      {lista.length === 0 && <div className="agenda-empty">Nenhuma sugestão no momento. 🎉</div>}
      {lista.slice(0, limite).map((s) => (
        <Cartao key={s.chave + s.itemId} s={s} usersById={usersById} onSelect={onSelect} onDecidir={decidir} mostrarLead={mostrarLead} />
      ))}
      {lista.length > limite && (
        <button type="button" className="btn btn-secondary" onClick={() => setLimite((l) => l + 25)} data-testid="sug-mostrar-mais">
          Mostrar mais ({lista.length - limite} restantes)
        </button>
      )}

      {(dados.avisos || []).filter((a) => !itemId || a.itemId === String(itemId)).map((a) => (
        <div key={`${a.itemId}-${a.trilha}`} className="pend-box" data-testid="sug-aviso-compromisso">
          <strong>{a.itemNome}:</strong> {a.mensagem}
        </div>
      ))}

      {!itemId && (
        <div className="sug-analise">
          <button
            type="button"
            className="btn-link"
            onClick={() => setAnalise((a) => ({ ...a, aberta: !a.aberta }))}
            aria-expanded={analise.aberta}
            data-testid="sug-analise-toggle"
          >
            {analise.aberta ? '▾' : '▸'} Análise prévia de oportunidades antigas{antigasTotal ? ` (${antigasTotal})` : ''}
          </button>
          {analise.aberta && (
            <div>
              <p className="acao-help">
                Eventos antigos (fora da janela recente) <strong>não</strong> viram sugestões automáticas. Escolha um responsável para revisar, um a um — não existe ação em massa.
              </p>
              {admin ? (
                <div className="field-row">
                  <div className="field">
                    <label>Responsável</label>
                    <select value={analise.responsavel} onChange={(e) => carregarAnalise(e.target.value)} aria-label="Responsável da análise prévia">
                      <option value="">Escolha…</option>
                      {Object.values(usersById || {}).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => carregarAnalise('')} disabled={analise.carregando}>Carregar minhas oportunidades antigas</button>
              )}
              {analise.carregando && <div className="agenda-empty">Carregando…</div>}
              {analise.itens && filtra(analise.itens).length === 0 && !analise.carregando && <div className="agenda-empty">Nada para revisar com este filtro.</div>}
              {analise.itens && filtra(analise.itens).map((s) => (
                <Cartao key={`ant-${s.chave}${s.itemId}`} s={s} usersById={usersById} onSelect={onSelect} onDecidir={decidir} mostrarLead />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
