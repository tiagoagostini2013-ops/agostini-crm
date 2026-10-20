'use client';

import { useEffect, useRef, useState } from 'react';
import { SITUACOES, SITUACAO_LABEL } from '../lib/propostas.js';
import { fmtDataBR } from '../lib/agenda.js';
import { fmtDataHoraSP, hojeSP } from '../lib/tempo.js';

// PROPOSTAS E ARQUIVOS — uma seção só (substitui "Arquivos"). O registro NÃO
// guarda arquivos: só CLASSIFICA os que já estão anexados ao lead (DOCX e PDF da
// mesma proposta contam como UM documento). Regras visíveis na tela:
//  - nada é presumido: o arquivo mais recente não vira "enviado" nem "aceito";
//  - revisão (B depois de A) é diferente de alternativa técnica;
//  - valor da proposta é informativo: nunca altera o valor da oportunidade e
//    alternativas nunca são somadas;
//  - visualização do cliente é estimativa; aceite só existe se alguém confirmou;
//  - arquivos nunca são excluídos por causa do registro.

const FORM_VAZIO = { numero: '', revisao: '', situacao: '', tipo: 'principal', rotulo: '', data: '', valor: '' };

function Chip({ children, cls = '' }) {
  return <span className={`prop-chip ${cls}`}>{children}</span>;
}

export default function PropostasPanel({
  itemId,
  pronto, // coluna de registro configurada neste ambiente?
  faltando = [],
  arquivos, // lista de arquivos do lead (estado do drawer)
  reloadKey, // muda quando arquivos são enviados/removidos
  onOpenFile,
  onDeleteFile,
  deletingAssetId,
  uploadSlot,
  onVisao, // devolve a visão ao drawer (resumo)
}) {
  const [visao, setVisao] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // { modo:'grupo'|'revisao'|'editar', ...campos }
  const busyRef = useRef(false);

  async function carregar() {
    if (!pronto) return;
    try {
      const res = await fetch(`/api/items/${itemId}/propostas`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar propostas.');
      setVisao(data);
      onVisao?.(data);
      setErro('');
    } catch (e) {
      setErro(e.message);
    }
  }

  useEffect(() => {
    setVisao(null);
    setForm(null);
    setAviso('');
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, reloadKey, pronto]);

  async function op(operacao) {
    if (busyRef.current) return false; // trava duplo clique
    busyRef.current = true;
    setBusy(true);
    setErro('');
    setAviso('');
    try {
      const res = await fetch(`/api/items/${itemId}/propostas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRev: visao.rev, op: operacao }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflito) {
        setVisao(data);
        onVisao?.(data);
        setErro(data.error);
        return false;
      }
      if (!res.ok) throw new Error(data.error || 'Não foi possível salvar.');
      setVisao(data);
      onVisao?.(data);
      const partes = [];
      if (data.efeitos?.length) partes.push(...data.efeitos);
      if (data.notaRegistrada === false) partes.push('O registro foi salvo, mas a nota de histórico no monday não (tente uma anotação manual).');
      if (partes.length) setAviso(partes.join(' '));
      setForm(null);
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const docs = visao?.docs || [];
  const idsClassificados = new Set(docs.flatMap((d) => d.arquivos));
  const grupos = (visao?.sugestoes || []).filter((g) => g.arquivos.length > 0);

  return (
    <div className="drawer-section" id="secao-propostas" data-testid="secao-propostas">
      <h3>Propostas e arquivos</h3>
      {!pronto && (
        <div className="schema-warning" data-testid="aviso-propostas-pendente">
          A classificação de propostas depende da coluna <strong>{faltando.join(', ') || 'Propostas — Registro (JSON)'}</strong>, que ainda não
          existe neste ambiente (veja o README). Os arquivos continuam disponíveis abaixo.
        </div>
      )}
      {erro && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 8 }} data-testid="propostas-erro">{erro}</div>}
      {aviso && <div className="banner banner-info" style={{ borderRadius: 8, marginBottom: 8 }}>{aviso}</div>}
      {visao?.corrompido && (
        <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 8 }}>
          O registro de propostas deste lead está ilegível no monday. Nada será regravado por cima — corrija ou limpe a coluna no monday.
        </div>
      )}
      {visao?.rastreioTruncado && (
        <div className="schema-warning">Parte do rastreio de envios foi cortada pelo limite do monday (2.000 caracteres); só os envios inteiros aparecem.</div>
      )}

      {visao && (
        <>
          <div className="prop-vigente" data-testid="prop-vigente">
            {visao.vigente ? (
              <>
                <strong>Referência comercial vigente:</strong> {visao.vigente.titulo} <Chip>{SITUACAO_LABEL[visao.vigente.situacao]}</Chip>
              </>
            ) : docs.length > 0 ? (
              <span className="pend-inline">⚠ Nenhuma proposta marcada como vigente — escolha qual é a referência comercial.</span>
            ) : (
              <span className="opp-sub">Nenhuma proposta registrada ainda.</span>
            )}
          </div>

          {docs.map((d) => {
            const editando = form?.modo === 'editar' && form.id === d.id;
            const novaRev = form?.modo === 'revisao' && form.id === d.id;
            return (
              <div key={d.id} className={`prop-doc${d.id === visao.vigente?.id ? ' vigente' : ''}`} data-testid="prop-doc" data-situacao={d.situacao}>
                <div className="prop-doc-cab">
                  <strong>{d.titulo}</strong>
                  <Chip cls={`sit-${d.situacao}`}>{SITUACAO_LABEL[d.situacao]}</Chip>
                  {d.tipo === 'alternativa' && <Chip cls="alt">Alternativa técnica</Chip>}
                  {d.id === visao.vigente?.id && <Chip cls="vig">Vigente</Chip>}
                  {d.data && <span className="opp-sub">{fmtDataBR(d.data)}</span>}
                  {d.aceitoEm && <Chip cls="sit-aceita">Aceite confirmado em {fmtDataBR(d.aceitoEm)}</Chip>}
                  {d.situacao === 'enviada' && d.envioEm && <Chip cls="sit-enviada" >Envio registrado em {fmtDataBR(d.envioEm)}</Chip>}
                </div>
                {d.situacao === 'enviada' && !d.envioEm && (
                  <div className="opp-sub" data-testid="prop-envio-sem-data">
                    Marcada como enviada, mas sem a <strong>data do envio</strong>. Use "Registrar envio" para informar — só um envio registrado de forma explícita gera a sugestão de follow-up.
                  </div>
                )}
                <div className="prop-arqs">
                  {d.arquivosInfo.map((a) => (
                    <button key={a.assetId} type="button" className="proposta-item" disabled={a.removido} onClick={() => onOpenFile({ assetId: a.assetId, name: a.name })}>
                      📄 {a.name}
                    </button>
                  ))}
                  {d.arquivosInfo.length === 0 && <span className="opp-sub">sem arquivos vinculados</span>}
                  {d.formatos.length > 1 && <span className="opp-sub">({d.formatos.join(' + ')} = mesmo documento)</span>}
                </div>
                {d.valor !== null && (
                  <div className="opp-sub">Valor desta proposta: {d.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (informativo — não altera o valor da oportunidade)</div>
                )}
                {d.obs && <div className="opp-sub">Obs.: {d.obs}</div>}
                {d.envioRastreado && (
                  <div className="opp-sub">
                    Enviada em PDF com rastreio em {fmtDataHoraSP(d.envioRastreado.enviadoEm)} · visualização <em>estimada</em>:{' '}
                    {d.envioRastreado.visualizacoes > 0 ? `${d.envioRastreado.visualizacoes}x (última ${fmtDataHoraSP(d.envioRastreado.ultimaVisualizacao)})` : 'ainda não aberta'}
                    {d.envioRastreado.baixou ? ' · botão "Baixar PDF" clicado' : ''}. Isto não confirma leitura nem aceite.
                  </div>
                )}
                {d.avisoRastreio && <div className="pend-box" style={{ marginTop: 6 }}>{d.avisoRastreio}</div>}

                <div className="prop-botoes">
                  {d.id !== visao.vigente?.id && (
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => op({ acao: 'vigente', id: d.id })} data-testid="prop-marcar-vigente">
                      Marcar como vigente
                    </button>
                  )}
                  {(d.situacao === 'rascunho' || d.situacao === 'enviada') && (
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm({ modo: 'envio', id: d.id, envioEm: d.envioEm || hojeSP() })} data-testid="prop-registrar-envio">
                      Registrar envio
                    </button>
                  )}
                  {d.tipo === 'principal' && (
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm({ modo: 'revisao', id: d.id, revisao: '', data: '' })} data-testid="prop-nova-revisao">
                      Nova revisão
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setForm({ modo: 'editar', id: d.id, situacao: d.situacao, data: d.data || '', valor: d.valor ?? '', obs: d.obs || '', envioEm: d.envioEm || '' })}>
                    Editar
                  </button>
                  {d.situacao !== 'aceita' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Confirmar manualmente que o cliente ACEITOU a proposta ${d.titulo}? O sistema não presume aceite.`)) op({ acao: 'aceitar', id: d.id });
                      }}
                    >
                      Confirmar aceite
                    </button>
                  )}
                  <button
                    type="button"
                    className="proposta-delete-btn"
                    title="Remover só o registro (os arquivos continuam anexados)"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remover o registro da proposta ${d.titulo}? Os arquivos continuam anexados ao lead.`)) op({ acao: 'remover', id: d.id });
                    }}
                  >
                    🗑️
                  </button>
                </div>

                {form?.modo === 'envio' && form.id === d.id && (
                  <div className="prop-form" data-testid="prop-form-envio">
                    <p className="acao-help">Registre aqui quando a proposta foi <strong>enviada ao cliente</strong>. Anexar arquivo, gerar PDF, editar ou o cliente abrir o link <strong>não</strong> contam como envio. Este registro (e só ele) permite ao CRM <em>sugerir</em> um follow-up no próximo dia útil — nada é enviado ao cliente e nada é criado antes de você aceitar.</p>
                    <div className="field-row">
                      <div className="field"><label>Data do envio</label><input type="date" max={hojeSP()} value={form.envioEm} onChange={(e) => setForm({ ...form, envioEm: e.target.value })} aria-label="Data do envio" /></div>
                    </div>
                    <div className="prop-botoes">
                      <button type="button" className="btn btn-primary" disabled={busy || !form.envioEm} onClick={() => op({ acao: 'enviar', id: d.id, data: form.envioEm })} data-testid="prop-confirmar-envio">
                        Confirmar envio
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
                {novaRev && (
                  <div className="prop-form">
                    <p className="acao-help">A nova revisão nasce como <strong>rascunho</strong> e sem valor — o sistema não presume que foi enviada. Escolha os arquivos dela abaixo, em "Arquivos sem classificação", depois de criá-la.</p>
                    <div className="field-row">
                      <div className="field"><label>Revisão (ex.: B)</label><input value={form.revisao} onChange={(e) => setForm({ ...form, revisao: e.target.value })} aria-label="Identificação da nova revisão" /></div>
                      <div className="field"><label>Data</label><input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
                    </div>
                    <div className="field">
                      <label>Arquivos desta revisão (não classificados)</label>
                      {arquivos.filter((a) => !idsClassificados.has(a.assetId)).map((a) => (
                        <label key={a.assetId} className="check-line">
                          <input type="checkbox" checked={(form.arquivos || []).includes(a.assetId)} onChange={(e) => setForm({ ...form, arquivos: e.target.checked ? [...(form.arquivos || []), a.assetId] : (form.arquivos || []).filter((x) => x !== a.assetId) })} />
                          {a.name}
                        </label>
                      ))}
                    </div>
                    <div className="prop-botoes">
                      <button type="button" className="btn btn-primary" disabled={busy || !form.revisao.trim()} onClick={() => op({ acao: 'nova_revisao', baseId: d.id, revisao: form.revisao, data: form.data || null, arquivos: form.arquivos || [] })}>
                        Criar revisão
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
                {editando && (
                  <div className="prop-form">
                    <div className="field-row">
                      <div className="field">
                        <label>Situação</label>
                        <select value={form.situacao} onChange={(e) => setForm({ ...form, situacao: e.target.value })}>
                          {SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}
                        </select>
                      </div>
                      <div className="field"><label>Data</label><input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
                      {form.situacao === 'enviada' && (
                        <div className="field"><label>Data do envio</label><input type="date" max={hojeSP()} value={form.envioEm || ''} onChange={(e) => setForm({ ...form, envioEm: e.target.value })} aria-label="Data do envio da proposta" /></div>
                      )}
                      <div className="field"><label>Valor (informativo)</label><input type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
                    </div>
                    <div className="field"><label>Observação</label><input maxLength={80} value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} /></div>
                    <div className="prop-botoes">
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => op({ acao: 'atualizar', id: d.id, campos: { situacao: form.situacao, data: form.data || null, valor: form.valor === '' ? null : form.valor, obs: form.obs, ...(form.situacao === 'enviada' ? { envioEm: form.envioEm || null } : {}) } })}>
                        Salvar
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {docs.filter((d) => d.tipo === 'alternativa' || docs.some((x) => x.id !== d.id && x.numero && x.numero === d.numero)).length > 1 && (
            <p className="opp-sub">Propostas alternativas ou de números iguais são mostradas separadas; o sistema não soma valores entre elas.</p>
          )}
        </>
      )}

      <h4 className="prop-sub">Arquivos sem classificação</h4>
      {arquivos.length === 0 && <div className="opp-sub">Nenhum arquivo vinculado ainda. Anexe propostas, orçamentos de frete, layouts do cliente etc.</div>}
      {pronto && visao
        ? grupos.map((g) => (
            <div key={g.chave} className="prop-grupo" data-testid="prop-grupo">
              <div className="prop-arqs">
                {g.arquivos.map((a) => (
                  <span key={a.assetId} className="proposta-item-row" style={{ display: 'inline-flex' }}>
                    <button type="button" className="proposta-item" onClick={() => onOpenFile({ assetId: a.assetId, name: a.name })}>
                      📄 {a.name} <Chip>{a.formato}</Chip>
                    </button>
                    <button type="button" className="proposta-delete-btn" title="Remover arquivo do lead" disabled={deletingAssetId === a.assetId} onClick={() => onDeleteFile({ assetId: a.assetId, name: a.name })}>
                      {deletingAssetId === a.assetId ? '...' : '🗑️'}
                    </button>
                  </span>
                ))}
              </div>
              {g.possivelDuplicata && <div className="pend-box" style={{ marginTop: 6 }}>⚠ Possível duplicata: {g.motivoDuplicata} Nenhum arquivo foi excluído — confira antes de remover.</div>}
              {g.arquivos.length > 1 && !g.possivelDuplicata && <div className="opp-sub">Nome equivalente: provavelmente o mesmo documento em formatos diferentes.</div>}
              {form?.modo === 'grupo' && form.chave === g.chave ? (
                <div className="prop-form">
                  <div className="field-row">
                    <div className="field"><label>Nº da proposta</label><input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} aria-label="Número da proposta" /></div>
                    <div className="field"><label>Revisão</label><input value={form.revisao} onChange={(e) => setForm({ ...form, revisao: e.target.value })} aria-label="Revisão" /></div>
                    <div className="field">
                      <label>Situação (obrigatória)</label>
                      <select value={form.situacao} onChange={(e) => setForm({ ...form, situacao: e.target.value, envioEm: e.target.value === 'enviada' ? form.envioEm || hojeSP() : '' })} aria-label="Situação da proposta">
                        <option value="">Escolha…</option>
                        {SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Tipo</label>
                      <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                        <option value="principal">Proposta (ou revisão)</option>
                        <option value="alternativa">Alternativa técnica</option>
                      </select>
                    </div>
                    {form.tipo === 'alternativa' && (
                      <div className="field"><label>Rótulo da alternativa</label><input value={form.rotulo} placeholder="ex.: com esteira" onChange={(e) => setForm({ ...form, rotulo: e.target.value })} aria-label="Rótulo da alternativa" /></div>
                    )}
                    <div className="field"><label>Data</label><input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></div>
                    {form.situacao === 'enviada' && (
                      <div className="field"><label>Data do envio (deixe vazio se não souber)</label><input type="date" max={hojeSP()} value={form.envioEm || ''} onChange={(e) => setForm({ ...form, envioEm: e.target.value })} aria-label="Data do envio da proposta" /></div>
                    )}
                    <div className="field"><label>Valor (informativo)</label><input type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
                  </div>
                  <div className="prop-botoes">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !form.situacao || (form.tipo === 'alternativa' && !form.rotulo.trim())}
                      onClick={() => op({ acao: 'registrar', tipo: form.tipo, rotulo: form.rotulo, numero: form.numero, revisao: form.revisao, situacao: form.situacao, data: form.data || null, valor: form.valor === '' ? null : form.valor, ...(form.situacao === 'enviada' ? { envioEm: form.envioEm || null } : {}), arquivos: g.arquivos.map((a) => a.assetId) })}
                      data-testid="prop-registrar"
                    >
                      Registrar como proposta
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 6 }}
                  disabled={busy}
                  onClick={() => setForm({ ...FORM_VAZIO, modo: 'grupo', chave: g.chave, numero: g.dicas.numero || '', revisao: g.dicas.revisao || '' })}
                  data-testid="prop-classificar"
                >
                  Classificar como proposta…
                </button>
              )}
            </div>
          ))
        : arquivos.map((f) => (
            <div key={f.assetId} className="proposta-item-row">
              <button type="button" className="proposta-item" onClick={() => onOpenFile(f)}>📄 {f.name}</button>
              <button type="button" className="proposta-delete-btn" title="Remover arquivo" disabled={deletingAssetId === f.assetId} onClick={() => onDeleteFile(f)}>
                {deletingAssetId === f.assetId ? '...' : '🗑️'}
              </button>
            </div>
          ))}
      {pronto && visao && grupos.length === 0 && arquivos.length > 0 && <div className="opp-sub">Todos os arquivos estão classificados. Para remover um arquivo classificado, remova antes o registro da proposta.</div>}
      <div style={{ marginTop: 10 }}>{uploadSlot}</div>
    </div>
  );
}
