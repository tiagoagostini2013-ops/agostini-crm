'use client';

import { useMemo, useRef, useState } from 'react';
import {
  CANAIS_ATIVIDADE,
  CANAL_INTERNO,
  ACAO_MAX,
  RESULTADO_NOTA_MAX,
  TRILHA_LABEL,
  trilhaDoItem,
  getAcao,
  dataDaTrilha,
  responsavelEfetivo,
  addDaysStr,
  fmtDataBR,
} from '../lib/agenda.js';
import { hojeSP, agoraLocalSP, somaDiasUteis, proximoDiaUtilOuIgual, ehDiaUtil } from '../lib/tempo.js';

// REGISTRAR ATENDIMENTO: o que aconteceu (resultado), quando, por qual canal, se
// foi contato EFETIVO ou tentativa sem resposta, e qual é o próximo passo.
// Reaproveita o formulário de atividades da v1. Só aqui (ou numa anotação
// marcada como contato) o "Último contato" é atualizado — e só quando a pessoa
// confirma que falou com o cliente. Nada aqui envia mensagem ao cliente.
//
// Datas sugeridas caem sempre em DIA ÚTIL (fim de semana e feriado nacional
// são pulados) e nunca preenchem sozinhas por cima de uma data combinada com o
// cliente: se já existe um compromisso futuro, o campo de data começa vazio e
// o servidor ainda exige confirmação para trocá-lo.
const SUGESTOES_DIAS = {
  vendas: [1, 3, 7, 15],
  reativacao: [30, 60, 90],
  posVenda: [7, 15, 30, 60],
};

const PLACEHOLDER_ACAO = {
  vendas: 'Ex: Confirmar dimensões das placas · Validar financiamento · Apresentar condições ao decisor',
  reativacao: 'Ex: Retomar contato quando a obra reabrir',
  posVenda: 'Ex: Checar satisfação após a entrega · Oferecer kit de peças de reposição',
};

function novoRequestId() {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 14) : Math.random().toString(36).slice(2, 16);
  return `r${rnd}`;
}

// Sugestão de data: dias úteis para vendas/pós-venda; para reativação (prazos
// longos) a data de calendário é ajustada para o próximo dia útil.
function sugerirData(trilha, n, hoje) {
  return trilha === 'reativacao' ? proximoDiaUtilOuIgual(addDaysStr(hoje, n)) : somaDiasUteis(hoje, n);
}

export default function ConcluirAtividadeModal({ item, meta, currentUser, onClose, onDone }) {
  const trilha = trilhaDoItem(item);
  const planejada = getAcao(item, trilha);
  const dataPlanejada = dataDaTrilha(item, trilha);
  const users = meta?.users || [];
  const hoje = useMemo(() => hojeSP(), []);
  // Compromisso combinado com o cliente que ainda não chegou: não pré-preencher
  // data nenhuma por cima dele.
  const compromissoFuturo = planejada.compromissoCliente && dataPlanejada && dataPlanejada > hoje ? dataPlanejada : null;

  // Um requestId por abertura do formulário: reenvios (duplo clique, retry)
  // carregam o mesmo id e o servidor ignora a repetição.
  const requestIdRef = useRef(novoRequestId());

  const [concluiuAcao, setConcluiuAcao] = useState(true);
  const [canal, setCanal] = useState('');
  const [contato, setContato] = useState(''); // '' | 'sim' | 'nao'
  const [resultado, setResultado] = useState('');
  const [quando, setQuando] = useState(() => agoraLocalSP());
  const [proximo, setProximo] = useState({
    acao: '',
    responsavelId: responsavelEfetivo(item, trilha) || '',
    data: '',
    compromissoCliente: false,
  });
  const [confirmacoes, setConfirmacoes] = useState({}); // flags enviadas ao servidor depois de pedir confirmação
  const [pendenteConfirmar, setPendenteConfirmar] = useState(null); // { codigo, error, sugestao?, dataAtual? }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resultadoGravado, setResultadoGravado] = useState(null); // resposta quando só o histórico falhou

  const interno = canal === CANAL_INTERNO;
  const podeSalvar = !saving && canal && resultado.trim() && (interno || contato === 'sim' || contato === 'nao') && quando;
  const nomeResp = (id) => users.find((u) => String(u.id) === String(id))?.name || '';
  const semProximoEmVendas = concluiuAcao && trilha === 'vendas' && !proximo.acao.trim() && !proximo.data;
  const dataNaoUtil = concluiuAcao && proximo.data && !ehDiaUtil(proximo.data) && !proximo.compromissoCliente;

  async function submit(extraConfirm = {}) {
    if (!podeSalvar) return;
    setSaving(true);
    setError('');
    setPendenteConfirmar(null);
    const conf = { ...confirmacoes, ...extraConfirm };
    setConfirmacoes(conf);
    try {
      const res = await fetch(`/api/items/${item.id}/atividades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: requestIdRef.current,
          trilha,
          acaoConcluida: planejada.acao,
          concluiuAcaoPlanejada: concluiuAcao,
          canal,
          contatoRealizado: interno ? false : contato === 'sim',
          ocorreuEm: quando,
          resultado: resultado.trim(),
          proximoPasso: concluiuAcao ? { ...proximo, responsavelNome: nomeResp(proximo.responsavelId) } : null,
          expectedRev: planejada.rev,
          ...conf,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && ['sem_proximo_passo', 'dia_nao_util', 'compromisso_cliente'].includes(data.codigo)) {
        setPendenteConfirmar(data);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Não foi possível registrar o atendimento.');
      if (data.notaRegistrada === false) {
        // O atendimento já está gravado; só o texto do histórico falhou.
        setResultadoGravado(data);
        onDone(data, { manterAberto: true });
        return;
      }
      onDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function reenviarHistorico() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${item.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: resultadoGravado.textoHistorico, contato: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ainda não foi possível gravar o histórico.');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="proposal-viewer-backdrop" onClick={saving ? undefined : onClose}>
      <div
        className="proposal-viewer-modal"
        role="dialog"
        aria-label="Registrar atendimento"
        style={{ width: 'min(580px, 100%)', height: 'auto', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="proposal-viewer-header">
          <span>✅ Registrar atendimento — {item.name}</span>
          <div className="proposal-viewer-actions">
            <button className="close" onClick={onClose} disabled={saving} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          {resultadoGravado ? (
            <div data-testid="historico-falhou">
              <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 12 }}>
                O atendimento foi gravado (próximo passo, datas e contato já estão salvos), mas o texto do histórico no
                monday.com <strong>não</strong> foi gravado. {resultadoGravado.avisoNota}
              </div>
              {error && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 12 }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                  Fechar
                </button>
                <button className="btn btn-primary" onClick={reenviarHistorico} disabled={saving}>
                  {saving ? 'Gravando...' : 'Tentar gravar histórico de novo'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="acao-help" style={{ marginTop: 0 }}>
                {TRILHA_LABEL[trilha]} ·{' '}
                {planejada.acao ? (
                  <>
                    ação planejada: <strong>{planejada.acao}</strong>
                    {dataPlanejada ? ` (${fmtDataBR(dataPlanejada)}${planejada.compromissoCliente ? ', combinado com o cliente' : ''})` : ''}
                  </>
                ) : (
                  'nenhuma ação planejada registrada para este lead.'
                )}
              </p>

              {error && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 12 }}>{error}</div>}

              {pendenteConfirmar && (
                <div className="pend-box" data-testid="confirmacao-pendente" style={{ marginBottom: 12 }}>
                  <div>{pendenteConfirmar.error}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {pendenteConfirmar.codigo === 'dia_nao_util' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setProximo((p) => ({ ...p, data: pendenteConfirmar.sugestao }));
                            setPendenteConfirmar(null);
                          }}
                        >
                          Usar {fmtDataBR(pendenteConfirmar.sugestao)}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => submit({ confirmaDiaNaoUtil: true })}>
                          Manter esta data
                        </button>
                      </>
                    )}
                    {pendenteConfirmar.codigo === 'sem_proximo_passo' && (
                      <>
                        <button type="button" className="btn btn-secondary" onClick={() => setPendenteConfirmar(null)}>
                          Definir o próximo passo
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => submit({ confirmaSemProximoPasso: true })}>
                          Registrar sem próximo passo (ficará pendente)
                        </button>
                      </>
                    )}
                    {pendenteConfirmar.codigo === 'compromisso_cliente' && (
                      <>
                        <button type="button" className="btn btn-secondary" onClick={() => setPendenteConfirmar(null)}>
                          Voltar
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => submit({ confirmaSubstituirCompromisso: true })}>
                          O combinado mudou — substituir
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label>Canal</label>
                  <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Canal da atividade">
                    <option value="">Escolha…</option>
                    {CANAIS_ATIVIDADE.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Quando aconteceu (horário de Brasília)</label>
                  <input
                    type="datetime-local"
                    value={quando}
                    max={agoraLocalSP()}
                    onChange={(e) => setQuando(e.target.value)}
                    aria-label="Quando aconteceu"
                  />
                </div>
              </div>

              <div className="field">
                <label>Houve contato efetivo com o cliente?</label>
                {interno ? (
                  <div className="acao-help" style={{ margin: '4px 0 0' }}>
                    Atividade interna não conta como contato com o cliente.
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                    <label className="check-line">
                      <input type="radio" name="contato" checked={contato === 'sim'} onChange={() => setContato('sim')} />
                      Sim — falei com o cliente
                    </label>
                    <label className="check-line">
                      <input type="radio" name="contato" checked={contato === 'nao'} onChange={() => setContato('nao')} />
                      Não — tentativa sem resposta
                    </label>
                  </div>
                )}
              </div>

              <div className="field">
                <label>
                  Resultado — o que aconteceu? ({resultado.length}/{RESULTADO_NOTA_MAX})
                </label>
                <textarea
                  value={resultado}
                  maxLength={RESULTADO_NOTA_MAX}
                  onChange={(e) => setResultado(e.target.value)}
                  placeholder="Ex: Cliente confirmou as dimensões e pediu a condição de pagamento por escrito."
                  aria-label="Resultado da atividade"
                />
              </div>

              <label className="check-line">
                <input type="checkbox" checked={concluiuAcao} onChange={(e) => setConcluiuAcao(e.target.checked)} />
                Isto conclui a ação planejada — vou definir o próximo passo
              </label>
              {!concluiuAcao && planejada.acao && (
                <p className="acao-help" style={{ marginTop: 4 }}>
                  A ação planejada continua ativa (“{planejada.acao}”) com a mesma data. Nada será dado como concluído.
                </p>
              )}

              {concluiuAcao && (
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 10 }}>
                  {compromissoFuturo && (
                    <div className="pend-box" style={{ marginBottom: 10 }}>
                      Havia um retorno combinado com o cliente para <strong>{fmtDataBR(compromissoFuturo)}</strong>, que ainda não chegou. A data
                      abaixo não foi preenchida sozinha: escolha uma nova só se o combinado mudou.
                    </div>
                  )}
                  <div className="field">
                    <label>
                      Próximo passo — ação concreta ({proximo.acao.length}/{ACAO_MAX})
                    </label>
                    <input
                      value={proximo.acao}
                      maxLength={ACAO_MAX}
                      placeholder={PLACEHOLDER_ACAO[trilha]}
                      onChange={(e) => setProximo((p) => ({ ...p, acao: e.target.value }))}
                      aria-label="Próximo passo"
                    />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Responsável</label>
                      <select
                        value={proximo.responsavelId}
                        onChange={(e) => setProximo((p) => ({ ...p, responsavelId: e.target.value }))}
                        aria-label="Responsável pelo próximo passo"
                      >
                        <option value="">—</option>
                        {users.map((u) => (
                          <option key={u.id} value={String(u.id)}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>{trilha === 'reativacao' ? 'Reativar em' : 'Data'}</label>
                      <input
                        type="date"
                        value={proximo.data}
                        min={hoje}
                        onChange={(e) => setProximo((p) => ({ ...p, data: e.target.value }))}
                        aria-label="Data do próximo passo"
                      />
                      <div className="quick-dates">
                        {SUGESTOES_DIAS[trilha].map((d) => (
                          <button
                            type="button"
                            key={d}
                            title="Conta só dias úteis (sem fim de semana e feriado nacional)"
                            onClick={() => setProximo((p) => ({ ...p, data: sugerirData(trilha, d, hoje) }))}
                          >
                            {trilha === 'reativacao' ? `+${d}d` : `+${d} d.u.`}
                          </button>
                        ))}
                      </div>
                      {dataNaoUtil && (
                        <div className="acao-help" style={{ marginTop: 4 }}>
                          ⚠ {fmtDataBR(proximo.data)} não é dia útil.
                        </div>
                      )}
                    </div>
                  </div>
                  {trilha !== 'reativacao' && (
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={proximo.compromissoCliente}
                        onChange={(e) => setProximo((p) => ({ ...p, compromissoCliente: e.target.checked }))}
                      />
                      Combinado com o cliente (ele espera esse retorno nessa data — a data não é ajustada para dia útil)
                    </label>
                  )}
                  {semProximoEmVendas && (
                    <div className="pend-box">
                      Sem ação e data, este lead ficará marcado como <strong>pendente</strong> (sem próximo passo). O sistema vai pedir
                      sua confirmação antes de gravar assim.
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                  Cancelar
                </button>
                <button className="btn btn-primary" onClick={() => submit()} disabled={!podeSalvar}>
                  {saving ? 'Salvando...' : 'Registrar atendimento'}
                </button>
              </div>
              <p className="acao-help" style={{ marginTop: 10 }}>
                Isto só grava no CRM e no histórico do monday.com — nenhuma mensagem é enviada ao cliente.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
