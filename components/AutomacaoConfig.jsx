'use client';

import { useEffect, useState } from 'react';

// Controle ADMINISTRATIVO da automação: liga/desliga geral e por regra, dias sem
// contato, janela da análise prévia, horário do follow-up e feriados extras.
// Desligar nunca apaga ações aceitas, dispensas nem histórico.
export default function AutomacaoConfig() {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [novoFeriado, setNovoFeriado] = useState('');

  async function carregar() {
    try {
      const res = await fetch('/api/automacao/config');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setInfo(j);
      setForm(j.config);
      setErro('');
    } catch (e) {
      setErro(e.message);
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  async function salvar() {
    setSalvando(true);
    setErro('');
    setOk('');
    try {
      const res = await fetch('/api/automacao/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: form }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Não foi possível salvar.');
      setForm(j.config);
      setOk('Configurações salvas.');
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  if (!form) return erro ? <div className="schema-warning">{erro}</div> : null;
  const set = (campo, valor) => setForm({ ...form, [campo]: valor });

  return (
    <div className="metrics-section" data-testid="automacao-config">
      <h3>Automação do acompanhamento — configurações</h3>
      <p className="acao-help">
        Modo sugestão: o CRM propõe próximos passos e você decide. Desativar uma regra (ou tudo) não apaga ações aceitas, dispensas nem histórico.
      </p>
      {info.desativadaPeloAmbiente && <div className="pend-box">A automação está desativada pela variável de ambiente AUTOMACAO_DESATIVADA — remova-a na hospedagem para reativar.</div>}
      {!info.gravavel && (
        <div className="pend-box" data-testid="config-somente-leitura">
          As configurações estão somente leitura: falta informar <code>MONDAY_AUTOMACAO_SETTINGS_ITEM_ID</code> (item do quadro Configurações). Valem os padrões. Veja o README, seção "Automação do acompanhamento".
        </div>
      )}
      {info.erro && <div className="pend-box">{info.erro}</div>}
      <label className="check-line">
        <input type="checkbox" checked={form.ativo} disabled={!info.gravavel} onChange={(e) => set('ativo', e.target.checked)} aria-label="Automação ligada" /> Automação ligada
      </label>
      <div className="cfg-grid">
        {info.regras.map((r) => (
          <label key={r.id} className="check-line">
            <input type="checkbox" checked={!!form.regras[r.id]} disabled={!info.gravavel} onChange={(e) => set('regras', { ...form.regras, [r.id]: e.target.checked })} aria-label={`Regra ${r.id}`} /> {r.id} — {r.nome}
          </label>
        ))}
      </div>
      <div className="cfg-grid">
        <div className="field"><label>Dias sem contato efetivo (oportunidade parada)</label><input type="number" min="1" max="90" value={form.diasParada} disabled={!info.gravavel} onChange={(e) => set('diasParada', Number(e.target.value))} aria-label="Dias sem contato" /></div>
        <div className="field"><label>Janela de eventos recentes (dias)</label><input type="number" min="1" max="365" value={form.janelaRecenteDias} disabled={!info.gravavel} onChange={(e) => set('janelaRecenteDias', Number(e.target.value))} aria-label="Janela recente" /></div>
        <div className="field"><label>Proposta sem avanço (dias, visão do gestor)</label><input type="number" min="1" max="90" value={form.diasPropostaSemAvanco} disabled={!info.gravavel} onChange={(e) => set('diasPropostaSemAvanco', Number(e.target.value))} aria-label="Dias proposta sem avanço" /></div>
        <div className="field"><label>Horário do lembrete de follow-up</label><input type="time" value={form.horaFollowUp} disabled={!info.gravavel} onChange={(e) => set('horaFollowUp', e.target.value)} aria-label="Horário do follow-up" /><div className="opp-sub">Lembrete interno: o monday guarda só a data.</div></div>
      </div>
      <div className="field">
        <label>Feriados extras (além dos nacionais)</label>
        <div className="quick-dates">
          {form.feriadosExtras.map((d) => (
            <span key={d} className="prop-chip">
              {d.split('-').reverse().join('/')}{' '}
              <button type="button" className="btn-link" disabled={!info.gravavel} onClick={() => set('feriadosExtras', form.feriadosExtras.filter((x) => x !== d))} aria-label={`Remover feriado ${d}`}>×</button>
            </span>
          ))}
          {form.feriadosExtras.length === 0 && <span className="opp-sub">nenhum</span>}
        </div>
        <div className="field-row">
          <input type="date" value={novoFeriado} disabled={!info.gravavel} onChange={(e) => setNovoFeriado(e.target.value)} aria-label="Novo feriado" />
          <button type="button" className="btn btn-secondary" disabled={!info.gravavel || !novoFeriado || form.feriadosExtras.includes(novoFeriado)} onClick={() => { set('feriadosExtras', [...form.feriadosExtras, novoFeriado].sort()); setNovoFeriado(''); }}>Adicionar feriado</button>
        </div>
      </div>
      {erro && <div className="schema-warning" role="alert">{erro}</div>}
      {ok && <div className="pend-box" style={{ background: '#e3f7ee', color: '#00724a', borderColor: '#b9e8d3' }}>{ok}</div>}
      <div className="prop-botoes">
        <button type="button" className="btn btn-primary" disabled={salvando || !info.gravavel} onClick={salvar} data-testid="automacao-salvar">Salvar configurações</button>
      </div>
      {info.config.atualizadoPor && <div className="opp-sub">Última alteração: {info.config.atualizadoPor}{info.config.atualizadoEm ? ` em ${new Date(info.config.atualizadoEm).toLocaleString('pt-BR')}` : ''}</div>}
    </div>
  );
}
