'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sugerirVinculosEmpresa, acharContatoEquivalente } from '../lib/empresas.js';

// EMPRESA, CONTATOS E OPORTUNIDADES IRMÃS
//   Empresa  = organização (board Empresas). Vincular grava só o id — nada é
//              copiado para a oportunidade e o texto antigo de "Empresa" fica
//              como está. Nenhum vínculo é feito por semelhança de nome: o painel
//              só SUGERE e a pessoa confirma.
//   Contatos = pessoas (board Contatos): telefone, e-mail (opcional) e papel na
//              decisão. Podem existir sem empresa. Cada oportunidade lista quais
//              contatos participam dela.
//   Irmãs    = outras oportunidades da mesma empresa (negociações independentes,
//              cada uma com seu produto, estágio, valor e propostas).

function waDe(tel) {
  const d = String(tel || '').replace(/\D+/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith('55') && d.length >= 12 ? d : `55${d}`}`;
}

async function chamar(url, metodo, corpo) {
  const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function EmpresaContatosPanel({ item, meta, irmas = [], onSaved, onAbrirOportunidade }) {
  const st = meta?.estruturaV2;
  const empresasOk = st?.empresas?.pronto;
  const contatosOk = st?.contatos?.pronto;
  const [dados, setDados] = useState({ carregando: true, empresas: [], contatos: [], erro: '' });
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [buscaEmp, setBuscaEmp] = useState('');
  const [novaEmp, setNovaEmp] = useState(null); // { nome, cnpj, cidade, existentes? }
  const [buscaCt, setBuscaCt] = useState('');
  const [novoCt, setNovoCt] = useState(null); // { nome, telefone, email, papel, existentes? }
  const [editCt, setEditCt] = useState(null); // { id, nome, telefone, email, papel, base }

  async function carregar() {
    try {
      const { ok, data } = await chamar('/api/empresas', 'GET');
      if (!ok) throw new Error(data.error || 'Erro ao carregar empresas e contatos.');
      setDados({ carregando: false, empresas: data.empresas || [], contatos: data.contatos || [], erro: '' });
    } catch (e) {
      setDados({ carregando: false, empresas: [], contatos: [], erro: e.message });
    }
  }
  useEffect(() => {
    if (empresasOk || contatosOk) carregar();
    else setDados((d) => ({ ...d, carregando: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, empresasOk, contatosOk]);

  async function executar(fn) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMsg({ tipo: '', texto: '' });
    try {
      await fn();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e.message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const empresaAtual = item.empresaId ? dados.empresas.find((e) => e.id === item.empresaId) : null;
  const textoLivre = item.empresaId ? item.empresaLegado : item.empresa;
  const sugestoes = useMemo(
    () => (item.empresaId || !empresasOk ? [] : sugerirVinculosEmpresa([{ id: item.id, name: item.name, empresa: textoLivre }], dados.empresas)),
    [item.id, item.empresaId, textoLivre, dados.empresas, empresasOk]
  );
  const contatosDaOpp = (item.oportunidade?.contatoIds || []).map((id) => dados.contatos.find((c) => c.id === id) || { id, nome: null });

  async function vincular(empresaId) {
    await executar(async () => {
      const { ok, status, data } = await chamar(`/api/items/${item.id}/empresa`, 'PUT', { empresaId, expectedEmpresaId: item.empresaId || null });
      if (!ok) {
        if (status === 409 && data.conflito) onSaved(item.id, { empresaId: data.atual.empresaId, empresa: data.atual.empresaNome || item.empresa });
        throw new Error(data.error || 'Não foi possível vincular.');
      }
      const nome = empresaId ? dados.empresas.find((e) => e.id === empresaId)?.nome : null;
      onSaved(item.id, { empresaId: empresaId || null, empresa: nome || item.empresaLegado || item.empresa, empresaLegado: item.empresaId ? item.empresaLegado : item.empresa });
      setMsg({ tipo: 'ok', texto: empresaId ? `Vinculada à empresa "${nome}". O texto antigo foi preservado.` : 'Vínculo removido. O texto antigo da empresa foi preservado.' });
      setNovaEmp(null);
    });
  }

  async function criarEmpresa(force = false) {
    await executar(async () => {
      const { ok, status, data } = await chamar('/api/empresas', 'POST', { nome: novaEmp.nome, cnpj: novaEmp.cnpj, cidade: novaEmp.cidade, force });
      if (status === 409 && data.duplicada) {
        setNovaEmp({ ...novaEmp, existentes: data.existentes });
        return;
      }
      if (!ok) throw new Error(data.error || 'Não foi possível cadastrar a empresa.');
      setDados((d) => ({ ...d, empresas: [...d.empresas, data.empresa] }));
      const v = await chamar(`/api/items/${item.id}/empresa`, 'PUT', { empresaId: data.empresa.id, expectedEmpresaId: item.empresaId || null });
      if (!v.ok) throw new Error(v.data.error || 'Empresa cadastrada, mas o vínculo falhou.');
      onSaved(item.id, { empresaId: data.empresa.id, empresa: data.empresa.nome, empresaLegado: item.empresaId ? item.empresaLegado : item.empresa });
      setNovaEmp(null);
      setMsg({ tipo: 'ok', texto: `Empresa "${data.empresa.nome}" cadastrada e vinculada.` });
    });
  }

  async function ligarContato(contatoId) {
    await executar(async () => {
      const { ok, status, data } = await chamar(`/api/items/${item.id}/oportunidade`, 'PUT', { expectedRev: item.oportunidade?.rev || 0, adicionarContatoId: contatoId });
      if (!ok) {
        if (status === 409 && data.conflito) onSaved(item.id, { oportunidade: data.atual });
        throw new Error(data.error || 'Não foi possível vincular o contato.');
      }
      onSaved(item.id, { oportunidade: data.oportunidade });
      setBuscaCt('');
    });
  }

  async function desligarContato(contatoId) {
    await executar(async () => {
      const { ok, status, data } = await chamar(`/api/items/${item.id}/oportunidade`, 'PUT', { expectedRev: item.oportunidade?.rev || 0, removerContatoId: contatoId });
      if (!ok) {
        if (status === 409 && data.conflito) onSaved(item.id, { oportunidade: data.atual });
        throw new Error(data.error || 'Não foi possível remover o vínculo.');
      }
      onSaved(item.id, { oportunidade: data.oportunidade });
    });
  }

  async function criarContato(force = false) {
    await executar(async () => {
      const { ok, status, data } = await chamar('/api/contatos', 'POST', { ...novoCt, empresaId: item.empresaId || null, force });
      if (status === 409 && data.duplicado) {
        setNovoCt({ ...novoCt, existentes: data.existentes });
        return;
      }
      if (!ok) throw new Error(data.error || 'Não foi possível cadastrar o contato.');
      setDados((d) => ({ ...d, contatos: [...d.contatos, data.contato] }));
      const v = await chamar(`/api/items/${item.id}/oportunidade`, 'PUT', { expectedRev: item.oportunidade?.rev || 0, adicionarContatoId: data.contato.id });
      if (!v.ok) throw new Error(v.data.error || 'Contato cadastrado, mas o vínculo falhou.');
      onSaved(item.id, { oportunidade: v.data.oportunidade });
      setNovoCt(null);
    });
  }

  async function salvarContato() {
    await executar(async () => {
      const { ok, status, data } = await chamar(`/api/contatos/${editCt.id}`, 'PATCH', { nome: editCt.nome, telefone: editCt.telefone, email: editCt.email, papel: editCt.papel, base: editCt.base });
      if (!ok) {
        if (status === 409 && data.conflito) {
          setDados((d) => ({ ...d, contatos: d.contatos.map((c) => (c.id === editCt.id ? { ...c, ...data.atual } : c)) }));
          setEditCt(null);
        }
        throw new Error(data.error || 'Não foi possível salvar o contato.');
      }
      setDados((d) => ({ ...d, contatos: d.contatos.map((c) => (c.id === editCt.id ? { ...c, nome: editCt.nome, telefone: editCt.telefone, email: editCt.email, papel: editCt.papel } : c)) }));
      setEditCt(null);
    });
  }

  const candidatos = (lista, busca, excluir) =>
    lista
      .filter((x) => !excluir.includes(x.id))
      .filter((x) => !busca.trim() || `${x.nome || ''} ${x.telefone || ''}`.toLowerCase().includes(busca.trim().toLowerCase()))
      .slice(0, 6);

  return (
    <div className="drawer-section" id="secao-empresa" data-testid="secao-empresa">
      <h3>Empresa e contatos</h3>
      {!empresasOk && (
        <div className="schema-warning" data-testid="aviso-estrutura-pendente">
          A separação em empresa e contatos ainda não está configurada neste ambiente (falta: {[...(st?.empresas?.faltando || []), ...(st?.contatos?.faltando || [])].filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'estrutura'}). Veja o README. O cadastro antigo continua funcionando.
        </div>
      )}
      {dados.erro && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 8 }}>{dados.erro}</div>}
      {msg.texto && <div className={msg.tipo === 'erro' ? 'banner banner-error' : 'banner banner-info'} style={{ borderRadius: 8, marginBottom: 8 }} data-testid="empresa-msg">{msg.texto}</div>}

      {empresasOk && (
        <div className="emp-bloco">
          <div className="opp-label">Empresa</div>
          {item.empresaId ? (
            <div data-testid="empresa-vinculada">
              <strong>{empresaAtual?.nome || item.empresa}</strong>
              {empresaAtual?.cnpj && <span className="opp-sub"> · CNPJ {empresaAtual.cnpj}</span>}
              {empresaAtual?.cidade && <span className="opp-sub"> · {empresaAtual.cidade}</span>}
              {item.empresaVinculoQuebrado && <div className="pend-box">O cadastro desta empresa não foi encontrado (id {item.empresaId}). O texto antigo está sendo exibido.</div>}
              {textoLivre && textoLivre !== (empresaAtual?.nome || item.empresa) && <div className="opp-sub">Texto antigo preservado: “{textoLivre}”</div>}
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn-link" disabled={busy} onClick={() => vincular(null)}>Desvincular empresa</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="opp-sub">{textoLivre ? <>Texto livre (não vinculado a uma empresa cadastrada): “{textoLivre}”</> : 'Nenhuma empresa identificada — tudo bem, você pode seguir sem ela.'}</div>
              {sugestoes.length > 0 && (
                <div className="emp-sugestoes" data-testid="empresa-sugestoes">
                  <div className="opp-sub">Sugestão para revisão (nada foi vinculado):</div>
                  {sugestoes.map((s) => (
                    <div key={s.empresaId} className="emp-sug">
                      <span>{s.empresaNome} <span className="opp-tag">{s.confianca === 'alta' ? 'mesmo nome' : 'nome parecido'}</span></span>
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => vincular(s.empresaId)} data-testid="empresa-confirmar-sugestao">Confirmar vínculo</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="field" style={{ marginTop: 8 }}>
                <label>Vincular a uma empresa já cadastrada</label>
                <input value={buscaEmp} placeholder="Digite para buscar…" onChange={(e) => setBuscaEmp(e.target.value)} aria-label="Buscar empresa" />
              </div>
              {buscaEmp.trim() && (
                <div className="emp-lista">
                  {candidatos(dados.empresas, buscaEmp, []).map((e) => (
                    <button key={e.id} type="button" className="emp-opcao" disabled={busy} onClick={() => vincular(e.id)}>{e.nome}{e.cidade ? ` · ${e.cidade}` : ''}</button>
                  ))}
                  {candidatos(dados.empresas, buscaEmp, []).length === 0 && <div className="opp-sub">Nenhuma encontrada.</div>}
                </div>
              )}
              {novaEmp ? (
                <div className="prop-form">
                  <div className="field-row">
                    <div className="field"><label>Nome da empresa</label><input value={novaEmp.nome} onChange={(e) => setNovaEmp({ ...novaEmp, nome: e.target.value, existentes: undefined })} aria-label="Nome da nova empresa" /></div>
                    <div className="field"><label>CNPJ (opcional)</label><input value={novaEmp.cnpj} onChange={(e) => setNovaEmp({ ...novaEmp, cnpj: e.target.value })} /></div>
                    <div className="field"><label>Cidade/UF (opcional)</label><input value={novaEmp.cidade} onChange={(e) => setNovaEmp({ ...novaEmp, cidade: e.target.value })} /></div>
                  </div>
                  {novaEmp.existentes && (
                    <div className="pend-box" data-testid="empresa-duplicada">
                      Já existe empresa com este nome/CNPJ: {novaEmp.existentes.map((e) => e.nome).join(', ')}.
                      <div className="prop-botoes">
                        {novaEmp.existentes.map((e) => (
                          <button key={e.id} type="button" className="btn btn-secondary" disabled={busy} onClick={() => vincular(e.id)}>Usar “{e.nome}”</button>
                        ))}
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => criarEmpresa(true)}>Criar outra mesmo assim</button>
                      </div>
                    </div>
                  )}
                  <div className="prop-botoes">
                    <button type="button" className="btn btn-primary" disabled={busy || !novaEmp.nome.trim()} onClick={() => criarEmpresa(false)} data-testid="empresa-criar">Cadastrar e vincular</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setNovaEmp(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" style={{ marginTop: 6 }} disabled={busy} onClick={() => setNovaEmp({ nome: textoLivre || '', cnpj: '', cidade: '' })} data-testid="empresa-nova">+ Cadastrar nova empresa</button>
              )}
            </div>
          )}
        </div>
      )}

      {contatosOk && (
        <div className="emp-bloco">
          <div className="opp-label">Contatos desta oportunidade</div>
          {contatosDaOpp.length === 0 && <div className="opp-sub">Nenhum contato vinculado a esta oportunidade.</div>}
          {contatosDaOpp.map((c) =>
            c.nome === null ? (
              <div key={c.id} className="pend-box">Contato {c.id} não encontrado no cadastro. <button type="button" className="btn-link" onClick={() => desligarContato(c.id)}>remover vínculo</button></div>
            ) : editCt?.id === c.id ? (
              <div key={c.id} className="prop-form">
                <div className="field-row">
                  <div className="field"><label>Nome</label><input value={editCt.nome} onChange={(e) => setEditCt({ ...editCt, nome: e.target.value })} /></div>
                  <div className="field"><label>Telefone</label><input value={editCt.telefone} onChange={(e) => setEditCt({ ...editCt, telefone: e.target.value })} /></div>
                </div>
                <div className="field-row">
                  <div className="field"><label>E-mail (opcional)</label><input value={editCt.email} onChange={(e) => setEditCt({ ...editCt, email: e.target.value })} /></div>
                  <div className="field">
                    <label>Papel na decisão</label>
                    <select value={editCt.papel} onChange={(e) => setEditCt({ ...editCt, papel: e.target.value })}>
                      <option value="">—</option>
                      {(meta?.papeisDecisao || []).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div className="prop-botoes">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={salvarContato}>Salvar contato</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditCt(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div key={c.id} className="emp-contato" data-testid="contato-vinculado">
                <div>
                  <strong>{c.nome}</strong> {c.papel ? <span className="opp-tag">{c.papel}</span> : <span className="opp-sub">papel não informado</span>}
                  <div className="opp-sub">
                    {c.telefone ? <>{c.telefone}{waDe(c.telefone) && <> · <a href={waDe(c.telefone)} target="_blank" rel="noreferrer">WhatsApp</a></>}</> : 'telefone não informado'}
                    {c.email ? ` · ${c.email}` : ''}
                    {!c.empresaId && ' · sem empresa'}
                  </div>
                </div>
                <div className="prop-botoes" style={{ margin: 0 }}>
                  <button type="button" className="btn-link" onClick={() => setEditCt({ id: c.id, nome: c.nome, telefone: c.telefone || '', email: c.email || '', papel: c.papel || '', base: { nome: c.nome, telefone: c.telefone || '', email: c.email || '', papel: c.papel || '' } })}>editar</button>
                  <button type="button" className="btn-link" disabled={busy} onClick={() => desligarContato(c.id)}>desvincular</button>
                </div>
              </div>
            )
          )}
          <div className="field" style={{ marginTop: 8 }}>
            <label>Vincular contato já cadastrado{empresaAtual ? ` (primeiro os de ${empresaAtual.nome})` : ''}</label>
            <input value={buscaCt} placeholder="Digite nome ou telefone…" onChange={(e) => setBuscaCt(e.target.value)} aria-label="Buscar contato" />
          </div>
          {buscaCt.trim() && (
            <div className="emp-lista">
              {candidatos([...dados.contatos].sort((a, b) => Number(b.empresaId === item.empresaId) - Number(a.empresaId === item.empresaId)), buscaCt, item.oportunidade?.contatoIds || []).map((c) => (
                <button key={c.id} type="button" className="emp-opcao" disabled={busy} onClick={() => ligarContato(c.id)}>{c.nome}{c.telefone ? ` · ${c.telefone}` : ''}</button>
              ))}
            </div>
          )}
          {novoCt ? (
            <div className="prop-form">
              <div className="field-row">
                <div className="field"><label>Nome</label><input value={novoCt.nome} onChange={(e) => setNovoCt({ ...novoCt, nome: e.target.value, existentes: undefined })} aria-label="Nome do novo contato" /></div>
                <div className="field"><label>Telefone (opcional)</label><input value={novoCt.telefone} onChange={(e) => setNovoCt({ ...novoCt, telefone: e.target.value, existentes: undefined })} aria-label="Telefone do novo contato" /></div>
              </div>
              <div className="field-row">
                <div className="field"><label>E-mail (opcional)</label><input value={novoCt.email} onChange={(e) => setNovoCt({ ...novoCt, email: e.target.value })} /></div>
                <div className="field">
                  <label>Papel na decisão</label>
                  <select value={novoCt.papel} onChange={(e) => setNovoCt({ ...novoCt, papel: e.target.value })} aria-label="Papel do novo contato">
                    <option value="">—</option>
                    {(meta?.papeisDecisao || []).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              {novoCt.existentes && (
                <div className="pend-box" data-testid="contato-duplicado">
                  Já existe contato com este telefone: {novoCt.existentes.map((c) => c.nome).join(', ')}.
                  <div className="prop-botoes">
                    {novoCt.existentes.map((c) => (
                      <button key={c.id} type="button" className="btn btn-secondary" disabled={busy} onClick={async () => { await ligarContato(c.id); setNovoCt(null); }}>Usar “{c.nome}”</button>
                    ))}
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => criarContato(true)}>Criar outro mesmo assim</button>
                  </div>
                </div>
              )}
              <div className="prop-botoes">
                <button type="button" className="btn btn-primary" disabled={busy || !novoCt.nome.trim()} onClick={() => criarContato(false)} data-testid="contato-criar">Cadastrar e vincular</button>
                <button type="button" className="btn btn-secondary" onClick={() => setNovoCt(null)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary" style={{ marginTop: 6 }} disabled={busy} onClick={() => setNovoCt({ nome: '', telefone: '', email: '', papel: '' })} data-testid="contato-novo">+ Novo contato</button>
          )}
        </div>
      )}

      {irmas.length > 0 && (
        <div className="emp-bloco" data-testid="oportunidades-irmas">
          <div className="opp-label">Outras oportunidades desta empresa (independentes)</div>
          {irmas.map((o) => (
            <div key={o.id} className="emp-contato">
              <div>
                <strong>{o.assunto || o.name}</strong> <span className="opp-tag">{o.estagio}</span>
                <div className="opp-sub">{o.name}{o.valor ? ` · ${o.valor}` : ''}</div>
              </div>
              <button type="button" className="btn-link" onClick={() => onAbrirOportunidade?.(o.id)}>abrir</button>
            </div>
          ))}
        </div>
      )}

      {(item.contatos || []).length > 0 && (
        <details className="sec-recolhida">
          <summary>Contatos antigos (formato anterior, somente leitura) — {item.contatos.length}</summary>
          <div className="opp-sub">Preservados como estavam. {contatosOk ? 'Para usar no novo cadastro, crie o contato acima (o sistema avisa se o telefone já existir).' : ''}</div>
          {item.contatos.map((c, i) => {
            const eq = contatosOk ? acharContatoEquivalente(c, dados.contatos) : null;
            return (
              <div key={i} className="opp-sub">• {c.name || '(sem nome)'}{c.role ? ` — ${c.role}` : ''}{c.phone ? ` — ${c.phone}` : ''}{eq ? ` (já existe como “${eq.nome}” no cadastro)` : ''}</div>
            );
          })}
        </details>
      )}
    </div>
  );
}
