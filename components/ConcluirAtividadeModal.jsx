'use client';

import { useMemo, useState } from 'react';
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
  toLocalDateStr,
  fmtDataBR,
} from '../lib/agenda.js';

// Registrar uma ATIVIDADE REALIZADA: o que aconteceu (resultado), por qual
// canal, se houve contato EFETIVO com o cliente e qual é o próximo passo.
// Diferente de editar o cadastro: só aqui (ou numa anotação marcada como
// contato) o "Último contato" é atualizado — e só quando a pessoa confirma que
// falou com o cliente. Tentativa sem resposta fica registrada, mas não conta.
// Nada aqui envia mensagem ao cliente — é só registro.
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

export default function ConcluirAtividadeModal({ item, meta, currentUser, onClose, onDone }) {
  const trilha = trilhaDoItem(item);
  const planejada = getAcao(item, trilha);
  const dataPlanejada = dataDaTrilha(item, trilha);
  const users = meta?.users || [];

  const [concluiuAcao, setConcluiuAcao] = useState(true);
  const [canal, setCanal] = useState('');
  const [contato, setContato] = useState(''); // '' | 'sim' | 'nao'
  const [resultado, setResultado] = useState('');
  const [proximo, setProximo] = useState({
    acao: '',
    responsavelId: responsavelEfetivo(item, trilha) || '',
    data: '',
    compromissoCliente: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const interno = canal === CANAL_INTERNO;
  const hoje = useMemo(() => toLocalDateStr(), []);

  const podeSalvar =
    !saving && canal && resultado.trim() && (interno || contato === 'sim' || contato === 'nao');

  const nomeResp = (id) => users.find((u) => String(u.id) === String(id))?.name || '';

  async function submit() {
    if (!podeSalvar) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${item.id}/atividades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trilha,
          acaoConcluida: planejada.acao,
          concluiuAcaoPlanejada: concluiuAcao,
          canal,
          contatoRealizado: interno ? false : contato === 'sim',
          resultado: resultado.trim(),
          proximoPasso: concluiuAcao
            ? { ...proximo, responsavelNome: nomeResp(proximo.responsavelId) }
            : null,
          expectedRev: planejada.rev,
          autor: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível registrar a atividade.');
      onDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const semProximoEmVendas = concluiuAcao && trilha === 'vendas' && (!proximo.acao.trim() || !proximo.data);

  return (
    <div className="proposal-viewer-backdrop" onClick={saving ? undefined : onClose}>
      <div
        className="proposal-viewer-modal"
        role="dialog"
        aria-label="Registrar atividade realizada"
        style={{ width: 'min(560px, 100%)', height: 'auto', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="proposal-viewer-header">
          <span>✅ Registrar atividade — {item.name}</span>
          <div className="proposal-viewer-actions">
            <button className="close" onClick={onClose} disabled={saving} aria-label="Fechar">
              ×
            </button>
          </div>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          <p className="acao-help" style={{ marginTop: 0 }}>
            {TRILHA_LABEL[trilha]} ·{' '}
            {planejada.acao ? (
              <>
                ação planejada: <strong>{planejada.acao}</strong>
                {dataPlanejada ? ` (${fmtDataBR(dataPlanejada)})` : ''}
              </>
            ) : (
              'nenhuma ação planejada registrada para este lead.'
            )}
          </p>

          {error && <div className="banner banner-error" style={{ borderRadius: 8, marginBottom: 12 }}>{error}</div>}

          <div className="field-row">
            <div className="field">
              <label>Canal da atividade</label>
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
              <label>Houve contato efetivo com o cliente?</label>
              {interno ? (
                <div className="acao-help" style={{ margin: '8px 0 0' }}>
                  Atividade interna não conta como contato.
                </div>
              ) : (
                <div>
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

          {concluiuAcao && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 10 }}>
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
                    onChange={(e) => setProximo((p) => ({ ...p, data: e.target.value }))}
                    aria-label="Data do próximo passo"
                  />
                  <div className="quick-dates">
                    {SUGESTOES_DIAS[trilha].map((d) => (
                      <button
                        type="button"
                        key={d}
                        onClick={() => setProximo((p) => ({ ...p, data: addDaysStr(hoje, d) }))}
                      >
                        +{d}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {trilha !== 'reativacao' && (
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={proximo.compromissoCliente}
                    onChange={(e) => setProximo((p) => ({ ...p, compromissoCliente: e.target.checked }))}
                  />
                  Combinado com o cliente (ele espera esse retorno nessa data)
                </label>
              )}
              {semProximoEmVendas && (
                <div className="pend-box">
                  Sem ação e data, este lead ficará marcado como registro incompleto. Você pode salvar assim mesmo e
                  completar depois.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={!podeSalvar}>
              {saving ? 'Salvando...' : 'Registrar atividade'}
            </button>
          </div>
          <p className="acao-help" style={{ marginTop: 10 }}>
            Isto só grava no CRM e no histórico do monday.com — nenhuma mensagem é enviada ao cliente.
          </p>
        </div>
      </div>
    </div>
  );
}
