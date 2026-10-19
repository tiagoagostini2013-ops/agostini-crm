'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MONDAY_ACCOUNT_URL, BOARD_ID_PUBLIC } from '../lib/publicConfig';
import { uploadWithRetry } from '../lib/blobUpload';
import ProposalViewerModal from './ProposalViewerModal';
import HandoffModal from './HandoffModal';
import OportunidadeResumo from './OportunidadeResumo';
import HistoricoOportunidade from './HistoricoOportunidade';
import PropostasPanel from './PropostasPanel';
import EmpresaContatosPanel from './EmpresaContatosPanel';
import { hojeSP, somaDiasUteis, proximoDiaUtilOuIgual } from '../lib/tempo.js';
import { statusLeituraRegistro, STATUS_LEITURA, STATUS_LEITURA_COR } from '../lib/proposalTrackStatus';
import {
  TRILHAS,
  TRILHA_LABEL,
  TRILHA_CAMPO_DATA,
  ACAO_MAX,
  trilhaDoItem,
  getAcao,
  dataDaTrilha,
  responsavelPadrao,
  pendenciasProximaAcao,
  addDaysStr,
  diasDesde,
  dateOnly,
  fmtDataBR,
  toLocalDateStr,
} from '../lib/agenda.js';

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('pt-BR');
  } catch {
    return d;
  }
}

// Formata uma data "pura" (YYYY-MM-DD, sem hora) sem passar por new Date() —
// o construtor interpreta "2026-09-08" como meia-noite UTC, e num fuso
// negativo (Brasil) isso pode voltar pro dia anterior na hora de exibir.
// Vendas adicionais só guardam data (sem hora), então formatamos na unha.
function fmtDateOnly(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

// Valor de uma venda adicional pode vir null (registro sem valor informado).
function fmtValor(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Formata milissegundos acumulados de visualização como "Xmin" (ou "Xs" se
// menos de 1 minuto) — não precisa de mais precisão que isso pra uma
// estimativa de tempo de leitura.
function fmtDuration(ms) {
  if (!ms || ms < 1000) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.round(totalSec / 60)}min`;
}

const QUALIFY_FIELDS = [
  { key: 'produtoInteresse', label: 'Aplicação / produto de interesse' },
  { key: 'cargoDecisor', label: 'Decisor identificado' },
  { key: 'segmento', label: 'Fit (segmento)' },
  { key: 'valorEstimado', label: 'Investimento estimado' },
  // Urgência agora vem do PRAZO PREVISTO DE COMPRA — antes era o "próximo
  // follow-up", mas são conceitos diferentes: follow-up é quando a equipe volta
  // a falar com o cliente; prazo de compra é quando o cliente pretende comprar.
  { key: 'prazoCompra', label: 'Urgência (prazo previsto de compra)' },
];

// Campos que o SERVIDOR atualiza por rotas dedicadas (plano de ação, datas das
// trilhas, último contato, vendas adicionais) — quando o item muda por causa
// delas, o formulário adota o valor novo em vez de preservar o antigo.
const CAMPOS_GERIDOS_PELO_SERVIDOR = [
  'planoAcao',
  'vendasAdicionais',
  'proximoFollowUp',
  'dataReativacao',
  'proximoContatoPosVenda',
  'ultimoContato',
];

const IMPEDIMENTOS_SUGERIDOS = [
  'Aguardando financiamento',
  'Decisão depende de sócio/diretoria',
  'Comparando com concorrente',
  'Preço acima do orçamento',
  'Aguardando projeto/layout',
  'Prazo de entrega',
  'Sem urgência no momento',
];

export default function LeadDrawer({
  item,
  meta,
  currentUser,
  onClose,
  onSaved,
  onClosedDeal,
  onConcluirAtividade,
  activityTick = 0,
  irmas = [],
  onAbrirOportunidade,
}) {
  const [form, setForm] = useState(() => ({ ...item }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Histórico unificado (anotações + atendimentos + propostas + estágio): lido
  // pela rota /historico. Substitui a lista antiga de anotações.
  const [historico, setHistorico] = useState({ carregando: true, eventos: [] });
  const [expandirHistorico, setExpandirHistorico] = useState(false);
  const [visaoPropostas, setVisaoPropostas] = useState(null);
  const [arquivosReloadKey, setArquivosReloadKey] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showFollowUpNudge, setShowFollowUpNudge] = useState(false);
  const [settingFollowUp, setSettingFollowUp] = useState(false);
  const [viewingProposal, setViewingProposal] = useState(null);
  const [arquivos, setArquivos] = useState(item.propostas || []);
  const [uploadingFile, setUploadingFile] = useState(null); // { name, status } | null
  const [deletingAssetId, setDeletingAssetId] = useState(null);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef(null);
  const cancelUploadControllerRef = useRef(null);
  const [pendingCloseChanges, setPendingCloseChanges] = useState(null); // mudanças pendentes até confirmar o handoff
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  // Rastreio de leitura de propostas (PDF gerado pelo suplemento do Word) —
  // só leitura aqui, o registro em si é criado em
  // app/api/word-addin/finalize/route.js. `copyingSendId` controla o botão
  // "copiar link de novo" de cada envio individualmente.
  const rastreioPropostas = item.rastreioPropostas || [];
  const [copyingSendId, setCopyingSendId] = useState(null);
  const [copiedSendId, setCopiedSendId] = useState(null);

  // Vendas adicionais (recompras diretas — ex: reposição de peças) do
  // cliente já fechado. Mesmo padrão de `arquivos`: estado local próprio,
  // sincronizado com o item no useEffect abaixo e atualizado a partir da
  // resposta da rota dedicada (não do PATCH genérico — ver
  // app/api/items/[id]/vendas-adicionais/route.js).
  const [vendasAdicionais, setVendasAdicionais] = useState(item.vendasAdicionais || []);
  const [novaVenda, setNovaVenda] = useState({
    data: new Date().toISOString().slice(0, 10),
    descricao: '',
    valor: '',
  });
  const [addingVenda, setAddingVenda] = useState(false);
  const [removingVendaId, setRemovingVendaId] = useState(null);
  const [vendaError, setVendaError] = useState('');

  // ---- Próxima ação (v1 prioridades) ----
  // A trilha vem do estágio SALVO do lead (item), não do que está sendo
  // editado no formulário — o plano de ação pertence ao que já está gravado.
  const trilha = trilhaDoItem(item);
  const acaoSalva = getAcao(item, trilha);
  const dataSalva = dataDaTrilha(item, trilha) || '';
  const assinaturaAcao = JSON.stringify([trilha, acaoSalva, dataSalva]);
  const [acaoDraft, setAcaoDraft] = useState(() => ({
    acao: acaoSalva.acao,
    responsavelId: acaoSalva.responsavelId || '',
    data: dataSalva,
    compromissoCliente: acaoSalva.compromissoCliente,
  }));
  const [salvandoAcao, setSalvandoAcao] = useState(false);
  const [acaoMsg, setAcaoMsg] = useState({ tipo: '', texto: '' });
  const [conflitoAcao, setConflitoAcao] = useState(null);
  const [editarUltimoContato, setEditarUltimoContato] = useState(false);
  // Anotação: por padrão conta como contato (comportamento de 21/08/2026), mas
  // dá pra marcar como interna — fica no histórico sem carimbar "Último contato".
  const [noteEhContato, setNoteEhContato] = useState(true);
  const colunasProntas = meta?.colunasNovas?.pronto !== false;
  const colunasFaltando = meta?.colunasNovas?.faltando || [];
  const prevItemRef = useRef(item);

  async function handleCopyTrackLink(sendId) {
    setCopyingSendId(sendId);
    try {
      const res = await fetch(`/api/proposals/track/${item.id}/${sendId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível gerar o link.');
      await navigator.clipboard.writeText(data.url);
      setCopiedSendId(sendId);
      setTimeout(() => setCopiedSendId((cur) => (cur === sendId ? null : cur)), 2000);
    } catch (err) {
      setFileError(err.message);
    } finally {
      setCopyingSendId(null);
    }
  }

  useEffect(() => {
    // Preserva o que a pessoa já digitou e ainda não salvou quando o item é
    // atualizado por outro caminho (ex: registrar anotação ou próxima ação) —
    // antes isso apagava as edições pendentes do formulário.
    setForm((f) => {
      const prev = prevItemRef.current;
      const merged = { ...item };
      if (prev && prev.id === item.id) {
        for (const k of Object.keys(f)) {
          if (CAMPOS_GERIDOS_PELO_SERVIDOR.includes(k)) continue;
          if (JSON.stringify(f[k]) !== JSON.stringify(prev[k])) merged[k] = f[k];
        }
      }
      return merged;
    });
    prevItemRef.current = item;
    setError('');
    setArquivos(item.propostas || []);
    setVendasAdicionais(item.vendasAdicionais || []);
  }, [item]);

  // O rascunho da próxima ação só volta ao valor salvo quando o valor SALVO
  // muda (salvou, registrou atividade, ou alguém alterou) — não a cada
  // re-render do item.
  useEffect(() => {
    setAcaoDraft({
      acao: acaoSalva.acao,
      responsavelId: acaoSalva.responsavelId || '',
      data: dataSalva,
      compromissoCliente: acaoSalva.compromissoCliente,
    });
    setConflitoAcao(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, assinaturaAcao]);

  const carregarHistorico = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${item.id}/historico`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar o histórico.');
      setHistorico({ carregando: false, ...data });
    } catch (err) {
      setHistorico((h) => ({ ...h, carregando: false, erro: err.message }));
    }
  }, [item.id]);

  useEffect(() => {
    setHistorico({ carregando: true, eventos: [] });
    setExpandirHistorico(false);
    carregarHistorico();
  }, [item.id, activityTick, carregarHistorico]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function diff() {
    const changed = {};
    for (const key of Object.keys(form)) {
      if (JSON.stringify(form[key]) !== JSON.stringify(item[key])) {
        changed[key] = form[key];
      }
    }
    return changed;
  }

  // Devolve true/false pra quem chamou saber se salvou de verdade — o fluxo
  // de handoff obrigatório (ver handleConfirmHandoff) só deve registrar a
  // anotação de entrega depois de confirmar que a troca de responsável e o
  // estágio "Fechado" foram salvos com sucesso no monday.com.
  async function save(extra, opts) {
    const changed = { ...diff(), ...(extra || {}) };
    if (Object.keys(changed).length === 0) return true;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar.');
      onSaved(item.id, { ...form, ...extra });
      return true;
    } catch (err) {
      setError(err.message);
      return opts?.returnErrorMessage ? err.message : false;
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    // O monday.com sempre registra a atualização como vindo da conta dona do
    // token de API — então, pra saber de verdade quem escreveu, colocamos o
    // nome de quem está logado no próprio texto da anotação.
    const authorName = currentUser?.name;
    const rotulo = noteEhContato ? '' : ' (anotação interna)';
    const fullText = authorName ? `${authorName}${rotulo}: ${noteText.trim()}` : `${rotulo ? 'Anotação interna: ' : ''}${noteText.trim()}`;
    setAddingNote(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${item.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `contato: false` = anotação interna: fica no histórico mas não
        // carimba "Último contato" (ver app/api/items/[id]/notes/route.js).
        body: JSON.stringify({ text: fullText, contato: noteEhContato }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar anotação.');
      setNoteText('');
      carregarHistorico();

      // Escrever uma anotação carimba "Data Último Contato" automaticamente
      // no servidor (ver app/api/items/[id]/notes/route.js) — sincroniza
      // aqui pro card já refletir sem precisar recarregar a página.
      if (data.ultimoContato) {
        update('ultimoContato', data.ultimoContato);
        onSaved(item.id, { ultimoContato: data.ultimoContato });
      }

      // "Próximo follow-up" continua exigindo uma decisão do vendedor, então
      // não é automático — mas se estiver vazio ou já vencido, oferece um
      // atalho de 1 clique bem na hora em que ele acabou de registrar o
      // contato (pedido do Tiago em 21/08/2026).
      // O atalho só faz sentido na trilha de vendas e quando a anotação foi um
      // contato de verdade com o cliente.
      const hojeStr = toLocalDateStr();
      const followUpAtual = form.proximoFollowUp ? isoDateOnly(form.proximoFollowUp) : '';
      if (noteEhContato && trilha === TRILHAS.VENDAS && (!followUpAtual || followUpAtual < hojeStr)) {
        setShowFollowUpNudge(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingNote(false);
    }
  }

  // Reaproveita save() (mesma função usada pelo resto do formulário) em vez
  // de duplicar a chamada de PATCH — herda de graça o tratamento de erro e o
  // estado de "salvando" já testados no resto do drawer.
  async function quickSetFollowUp(days) {
    setSettingFollowUp(true);
    try {
      // Data local (não UTC) — à noite o toISOString() já viraria o dia seguinte.
      const proximoFollowUp = somaDiasUteis(hojeSP(), days);
      update('proximoFollowUp', proximoFollowUp);
      const ok = await save({ proximoFollowUp });
      if (ok) setShowFollowUpNudge(false);
    } finally {
      setSettingFollowUp(false);
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;

    setFileError('');
    const fileSizeMb = file.size / (1024 * 1024);
    setUploadingFile({ name: file.name, status: `Enviando (${fileSizeMb.toFixed(1)}MB)... 0%` });
    const cancelController = new AbortController();
    cancelUploadControllerRef.current = cancelController;

    try {
      // Mesma checagem do suplemento do Word: sem isso, se o Vercel Blob não
      // estiver configurado no servidor, o erro que aparece é um genérico
      // "Failed to retrieve the client token" que não ajuda ninguém.
      const statusRes = await fetch(`/api/word-addin/blob-status?t=${Date.now()}`, { cache: 'no-store' });
      const statusData = await statusRes.json().catch(() => ({ configured: true }));
      if (statusRes.ok && statusData.configured === false) {
        throw new Error(
          'O envio de arquivos ainda não está configurado neste servidor (peça para o administrador do painel criar o Blob Store na Vercel).'
        );
      }

      const blobResult = await uploadWithRetry(file.name, file, {
        handleUploadUrl: '/api/files/blob-upload',
        contentType: file.type || 'application/octet-stream',
        externalSignal: cancelController.signal,
        onStatus: ({ percentage, attempt, retrying, elapsedSeconds }) => {
          setUploadingFile({
            name: file.name,
            status: retrying
              ? `Conexão travou perto do fim. Tentando de novo (tentativa ${attempt}/4)...`
              : `Enviando (${fileSizeMb.toFixed(1)}MB)... ${percentage}%${attempt > 1 ? ` (tentativa ${attempt}/4)` : ''}` +
                (elapsedSeconds != null ? ` — ${elapsedSeconds}s` : ''),
          });
        },
      });

      setUploadingFile({ name: file.name, status: 'Vinculando ao lead...' });
      const res = await fetch(`/api/items/${item.id}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blobUrl: blobResult.url, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao anexar o arquivo.');
      setArquivos(data.arquivos || []);
      setArquivosReloadKey((k) => k + 1);
      carregarHistorico();
    } catch (err) {
      setFileError(`Falha ao enviar "${file.name}": ${err.message}`);
    } finally {
      setUploadingFile(null);
      cancelUploadControllerRef.current = null;
    }
  }

  function handleCancelFileUpload() {
    cancelUploadControllerRef.current?.abort();
  }

  async function handleDeleteFile(file) {
    if (!window.confirm(`Remover "${file.name}" deste lead? Essa ação não pode ser desfeita.`)) return;
    setFileError('');
    setDeletingAssetId(file.assetId);
    try {
      const res = await fetch(`/api/items/${item.id}/files/${file.assetId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao remover o arquivo.');
      setArquivos(data.arquivos || []);
      setArquivosReloadKey((k) => k + 1);
      carregarHistorico();
    } catch (err) {
      setFileError(`Falha ao remover "${file.name}": ${err.message}`);
    } finally {
      setDeletingAssetId(null);
    }
  }

  // Registra uma venda adicional (recompra) pro cliente já fechado — não
  // mexe no PATCH genérico nem no estágio/funil, só chama a rota dedicada
  // (leitura-modificação-escrita no servidor, ver
  // app/api/items/[id]/vendas-adicionais/route.js). Pedido do Tiago em
  // 08/09/2026: peças de reposição etc. são vendas diretas, sem passar pelo
  // funil, e ficam vinculadas só ao card do cliente na aba Pós-venda.
  async function handleAddVenda() {
    const descricaoLimpa = novaVenda.descricao.trim();
    if (!descricaoLimpa) {
      setVendaError('Descreva o que foi vendido.');
      return;
    }
    setAddingVenda(true);
    setVendaError('');
    try {
      const res = await fetch(`/api/items/${item.id}/vendas-adicionais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descricao: descricaoLimpa,
          valor: novaVenda.valor,
          data: novaVenda.data,
          // Mesmo motivo de addNote(): o monday.com sempre atribui a escrita
          // à conta dona do token de API, então quem registrou de verdade
          // vai como dado, não como autoria automática do servidor.
          registradoPor: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar venda.');
      setVendasAdicionais(data.vendasAdicionais || []);
      onSaved(item.id, { vendasAdicionais: data.vendasAdicionais || [] });
      // Registrar uma venda também carimba "Último contato" no servidor
      // (mesmo princípio de addNote) — sincroniza aqui pro card refletir
      // sem precisar recarregar.
      if (data.ultimoContato) {
        update('ultimoContato', data.ultimoContato);
        onSaved(item.id, { ultimoContato: data.ultimoContato });
      }
      setNovaVenda({ data: new Date().toISOString().slice(0, 10), descricao: '', valor: '' });
    } catch (err) {
      setVendaError(err.message);
    } finally {
      setAddingVenda(false);
    }
  }

  async function handleRemoveVenda(venda) {
    if (!window.confirm(`Remover o registro "${venda.descricao}"? Essa ação não pode ser desfeita.`)) return;
    setVendaError('');
    setRemovingVendaId(venda.id);
    try {
      const res = await fetch(`/api/items/${item.id}/vendas-adicionais`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendaId: venda.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao remover venda.');
      setVendasAdicionais(data.vendasAdicionais || []);
      onSaved(item.id, { vendasAdicionais: data.vendasAdicionais || [] });
    } catch (err) {
      setVendaError(err.message);
    } finally {
      setRemovingVendaId(null);
    }
  }

  // Salva a próxima ação da trilha atual (ação concreta + responsável + data +
  // "combinado com o cliente") pela rota dedicada — com controle de revisão pra
  // não sobrescrever o que outra pessoa salvou nesse meio tempo. Editar o plano
  // NÃO conta como contato com o cliente.
  async function salvarProximaAcao() {
    setSalvandoAcao(true);
    setAcaoMsg({ tipo: '', texto: '' });
    setConflitoAcao(null);
    try {
      const res = await fetch(`/api/items/${item.id}/proxima-acao`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trilha,
          ...acaoDraft,
          expectedRev: acaoSalva.rev,
          autor: currentUser?.name,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflito) setConflitoAcao(data.atual || {});
      if (!res.ok) throw new Error(data.error || 'Não foi possível salvar a próxima ação.');
      onSaved(item.id, { planoAcao: data.planoAcao, [data.campoData]: data.data });
      setAcaoMsg({ tipo: 'ok', texto: '✅ Próxima ação salva.' });
    } catch (err) {
      setAcaoMsg({ tipo: 'erro', texto: err.message });
    } finally {
      setSalvandoAcao(false);
    }
  }

  // Conflito: adota o valor que a outra pessoa salvou (e a revisão dele).
  function usarValorAtual() {
    const atual = conflitoAcao || null;
    onSaved(item.id, { planoAcao: { ...(item.planoAcao || {}), [trilha]: atual && atual.acao !== undefined ? atual : null } });
    setConflitoAcao(null);
    setAcaoMsg({ tipo: '', texto: '' });
  }

  // Modo compatível (colunas novas ainda não criadas no monday): só a data da
  // trilha de vendas, pelo PATCH de sempre.
  async function salvarDataCompat() {
    const ok = await save({ proximoFollowUp: acaoDraft.data || '' });
    if (ok) setAcaoMsg({ tipo: 'ok', texto: '✅ Data salva.' });
  }

  function irPara(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function abrirPropostaVigente() {
    const vig = visaoPropostas?.vigente;
    if (!vig) return;
    const ativos = vig.arquivosInfo.filter((a) => !a.removido);
    const f = ativos.find((a) => /\.pdf$/i.test(a.name)) || ativos[0];
    if (f) setViewingProposal({ assetId: f.assetId, name: f.name });
  }
  const estruturaV2 = meta?.estruturaV2;
  const contatosEstruturados = !!estruturaV2?.contatos?.pronto;
  const empresasEstruturadas = !!estruturaV2?.empresas?.pronto;
  const [nomeOpp, setNomeOpp] = useState(item.oportunidade?.nome || '');
  const [salvandoNomeOpp, setSalvandoNomeOpp] = useState(false);
  const [msgNomeOpp, setMsgNomeOpp] = useState('');
  useEffect(() => {
    setNomeOpp(item.oportunidade?.nome || '');
    setMsgNomeOpp('');
  }, [item.id, item.oportunidade?.nome]);
  async function salvarNomeOpp() {
    setSalvandoNomeOpp(true);
    setMsgNomeOpp('');
    try {
      const res = await fetch(`/api/items/${item.id}/oportunidade`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRev: item.oportunidade?.rev || 0, nome: nomeOpp }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.conflito) onSaved(item.id, { oportunidade: data.atual });
        throw new Error(data.error || 'Não foi possível salvar o nome.');
      }
      onSaved(item.id, { oportunidade: data.oportunidade });
      setMsgNomeOpp('✅ Nome salvo.');
    } catch (err) {
      setMsgNomeOpp(err.message);
    } finally {
      setSalvandoNomeOpp(false);
    }
  }

  const pendencias = pendenciasProximaAcao(item);
  const ultimoResultado = item.planoAcao?.ultimoResultado || null;
  const followUpAntigo = trilha !== TRILHAS.VENDAS && !dataSalva ? dateOnly(item.proximoFollowUp) : null;
  const acaoDirty =
    acaoDraft.acao !== acaoSalva.acao ||
    (acaoDraft.responsavelId || '') !== (acaoSalva.responsavelId || '') ||
    acaoDraft.data !== dataSalva ||
    acaoDraft.compromissoCliente !== acaoSalva.compromissoCliente;
  const respPadraoId = responsavelPadrao(item, trilha);
  const respPadraoNome = respPadraoId ? (meta.users || []).find((u) => String(u.id) === String(respPadraoId))?.name : null;
  const sugestoesDias = trilha === TRILHAS.REATIVACAO ? [30, 60, 90] : trilha === TRILHAS.POS_VENDA ? [7, 15, 30, 60] : [1, 3, 7, 15];
  const hojeStr = hojeSP();
  const diasUltimoContato = diasDesde(form.ultimoContato, hojeStr);

  const qualifyCount = QUALIFY_FIELDS.filter((f) => form[f.key]).length;
  const isDirty = Object.keys(diff()).length > 0;
  const responsavelIds = form.responsavelIds || [];

  function toggleResponsavel(idStr) {
    const set = new Set(responsavelIds);
    if (set.has(idStr)) set.delete(idStr);
    else set.add(idStr);
    update('responsavelIds', Array.from(set));
  }

  const contatos = form.contatos || [];

  function updateContato(index, key, value) {
    const next = contatos.map((c, i) => (i === index ? { ...c, [key]: value } : c));
    update('contatos', next);
  }

  function addContato() {
    update('contatos', [...contatos, { name: '', role: '', phone: '' }]);
  }

  function removeContato(index) {
    update('contatos', contatos.filter((_, i) => i !== index));
  }

  // Intercepta o clique de "Salvar alterações": se a mudança envolve virar o
  // lead para "Fechado", não salva direto — abre o handoff obrigatório (ver
  // Processo Comercial - Fábrica de Vendas: toda entrega exige adicionar o
  // vendedor secundário como responsável + registrar o contexto da venda).
  function handleSaveClick() {
    const changed = diff();
    if (changed.name !== undefined && !changed.name.trim()) {
      setError('O nome não pode ficar em branco.');
      return;
    }
    if (changed.estagio === 'Fechado' && item.estagio !== 'Fechado') {
      setHandoffError('');
      setPendingCloseChanges(changed);
      return;
    }
    save();
  }

  async function handleConfirmHandoff({ secondaryId, note }) {
    setHandoffError('');
    setHandoffSaving(true);
    try {
      const mergedIds = Array.from(new Set([...responsavelIds, String(secondaryId)]));
      // Além de somar o secundário em "Responsável" (como já era), grava os
      // dois campos estruturados que alimentam o Kanban de Pós-venda e a
      // limpeza do card de vendas (ver lib/config.js) — sem isso o sistema
      // nunca saberia distinguir quem é principal e quem é secundário.
      const result = await save(
        {
          ...pendingCloseChanges,
          responsavelIds: mergedIds,
          vendedorPosVenda: String(secondaryId),
          // "Aguardando Entrega", não "Entregue" — o fechamento da venda no
          // CRM não significa que a máquina já chegou ao cliente (ajustado
          // em 04/09/2026, ver lib/config.js). O card só vira "Entregue" de
          // verdade quando alguém arrasta ele no Kanban de Pós-venda.
          estagioPosVenda: 'Aguardando Entrega',
        },
        { returnErrorMessage: true }
      );
      if (result !== true) {
        // refletimos o erro no próprio modal, pra não obrigar a pessoa a
        // fechar o modal só pra ver o motivo da falha.
        setHandoffError(result || 'Não foi possível salvar. Tente novamente.');
        return;
      }

      // Handoff confirmado com sucesso = o negócio virou "Fechado" de
      // verdade — pedido do Tiago em 31/08/2026, comemora aqui.
      onClosedDeal?.({ empresa: item.empresa, valorEstimado: form.valorEstimado ?? item.valorEstimado });

      const secondaryUser = (meta.users || []).find((u) => String(u.id) === String(secondaryId));
      const authorName = currentUser?.name || 'Vendedor';
      const noteBody = `🤝 Handoff de entrega registrado por ${authorName}. Vendedor secundário: ${
        secondaryUser?.name || secondaryId
      }. Contexto: ${note}`;

      try {
        const res = await fetch(`/api/items/${item.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: noteBody }),
        });
        await res.json().catch(() => ({}));
        if (res.ok) carregarHistorico();
      } catch {
        // A entrega já foi salva com sucesso — se só a anotação falhar, não
        // travamos o fluxo por isso (mesma lógica de addNote/handleFileSelected).
      }

      setPendingCloseChanges(null);
    } finally {
      setHandoffSaving(false);
    }
  }

  function handleCancelHandoff() {
    // Desfaz a escolha de "Fechado" no formulário — sem o handoff confirmado,
    // o estágio não muda.
    update('estagio', item.estagio);
    setPendingCloseChanges(null);
    setHandoffError('');
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Editável (pedido do Tiago em 31/08/2026 — bug real: nomes
                capturados errado pela extensão do WhatsApp, ex:
                "luizmoreiraandre430", não tinham NENHUM jeito de ser
                corrigidos, nem aqui nem na extensão). Mesmo botão "Salvar
                alterações" do resto do formulário — não é um campo separado. */}
            <input
              className="drawer-title-input"
              value={form.name || ''}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Nome do lead"
              aria-label="Nome do lead"
              title="Clique para corrigir o nome"
            />
            <div className="empresa">{item.empresa || 'Sem empresa cadastrada'}</div>
          </div>
          <button className="close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <OportunidadeResumo
          item={item}
          meta={meta}
          historico={historico}
          propostas={visaoPropostas}
          onRegistrar={() => onConcluirAtividade?.(item.id)}
          onAgendar={() => irPara('secao-proxima-acao')}
          onAbrirProposta={abrirPropostaVigente}
          onHistorico={() => {
            setExpandirHistorico(true);
            irPara('secao-historico');
          }}
        />

        <div id="secao-proxima-acao" className={`drawer-section acao-section ${trilha}`} data-testid="secao-proxima-acao">
          <h3>Próxima ação — {TRILHA_LABEL[trilha]}</h3>

          {!colunasProntas && (
            <div className="schema-warning">
              Colunas novas ainda não criadas no monday.com deste ambiente ({colunasFaltando.join(', ')}). Rode o script
              <code> scripts/criar-colunas-monday.mjs</code> e configure as variáveis <code>MONDAY_COL_*</code> (ver README).
              Enquanto isso, só a data de follow-up de vendas pode ser editada aqui.
            </div>
          )}

          {pendencias.length > 0 && (
            <div className="pend-box" data-testid="pendencia-acao">
              ⚠ Registro incompleto: falta {pendencias.join(', ')}. Você pode consultar e editar o lead normalmente —
              preencha quando puder.
            </div>
          )}

          {trilha === TRILHAS.REATIVACAO && (
            <p className="acao-help">
              Negócio perdido: a reativação tem agendamento próprio e <strong>não gera alerta</strong> de follow-up
              comercial vencido.
            </p>
          )}
          {trilha === TRILHAS.POS_VENDA && (
            <p className="acao-help">
              Cliente fechado: atividades de pós-venda. Responsável padrão: o vendedor de pós-venda do handoff.
            </p>
          )}

          {followUpAntigo && (
            <p className="acao-help" data-testid="followup-antigo">
              Agendamento comercial anterior preservado: <strong>{fmtDataBR(followUpAntigo)}</strong> (sem alertas).{' '}
              <button
                type="button"
                className="btn-link"
                onClick={() => setAcaoDraft((d) => ({ ...d, data: followUpAntigo }))}
                disabled={!colunasProntas}
              >
                Usar como data desta trilha
              </button>
            </p>
          )}

          {colunasProntas ? (
            <>
              <div className="field">
                <label>
                  Ação concreta ({acaoDraft.acao.length}/{ACAO_MAX})
                </label>
                <input
                  value={acaoDraft.acao}
                  maxLength={ACAO_MAX}
                  placeholder={
                    trilha === TRILHAS.REATIVACAO
                      ? 'Ex: Retomar contato quando a obra reabrir'
                      : trilha === TRILHAS.POS_VENDA
                        ? 'Ex: Checar satisfação após a entrega'
                        : 'Ex: Confirmar dimensões das placas · Validar financiamento · Apresentar condições ao decisor'
                  }
                  onChange={(e) => setAcaoDraft((d) => ({ ...d, acao: e.target.value }))}
                  aria-label="Ação concreta"
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Responsável pela ação</label>
                  <select
                    value={acaoDraft.responsavelId}
                    onChange={(e) => setAcaoDraft((d) => ({ ...d, responsavelId: e.target.value }))}
                    aria-label="Responsável pela ação"
                  >
                    <option value="">{respPadraoNome ? `Padrão: ${respPadraoNome}` : 'Sem responsável'}</option>
                    {(meta.users || []).map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{trilha === TRILHAS.REATIVACAO ? 'Reativar em' : 'Data da ação'}</label>
                  <input
                    type="date"
                    value={acaoDraft.data}
                    onChange={(e) => setAcaoDraft((d) => ({ ...d, data: e.target.value }))}
                    aria-label="Data da ação"
                  />
                  <div className="quick-dates">
                    {sugestoesDias.map((n) => (
                      <button
                        type="button"
                        key={n}
                        title="Conta só dias úteis (sem fim de semana e feriado nacional)"
                        onClick={() =>
                          setAcaoDraft((d) => ({
                            ...d,
                            data: trilha === TRILHAS.REATIVACAO ? proximoDiaUtilOuIgual(addDaysStr(hojeStr, n)) : somaDiasUteis(hojeStr, n),
                          }))
                        }
                      >
                        {trilha === TRILHAS.REATIVACAO ? `+${n}d` : `+${n} d.u.`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {trilha !== TRILHAS.REATIVACAO && (
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={acaoDraft.compromissoCliente}
                    onChange={(e) => setAcaoDraft((d) => ({ ...d, compromissoCliente: e.target.checked }))}
                  />
                  Combinado com o cliente (ele espera esse retorno nessa data) — pesa mais nas prioridades
                </label>
              )}
              {acaoMsg.texto && (
                <div
                  className={acaoMsg.tipo === 'erro' ? 'banner banner-error' : 'banner banner-info'}
                  style={{ borderRadius: 8, margin: '8px 0' }}
                >
                  {acaoMsg.texto}
                  {conflitoAcao && (
                    <>
                      {' '}
                      {conflitoAcao.acao ? <>Valor atual: “{conflitoAcao.acao}”. </> : null}
                      <button type="button" className="btn-link" onClick={usarValorAtual}>
                        Usar o valor atual
                      </button>
                    </>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button className="btn btn-primary" disabled={!acaoDirty || salvandoAcao} onClick={salvarProximaAcao}>
                  {salvandoAcao ? 'Salvando...' : 'Salvar próxima ação'}
                </button>
                <button className="btn btn-secondary" onClick={() => onConcluirAtividade?.(item.id)}>
                  ✅ Registrar atividade realizada…
                </button>
              </div>
            </>
          ) : (
            trilha === TRILHAS.VENDAS && (
              <div className="field-row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Data do próximo follow-up</label>
                  <input
                    type="date"
                    value={acaoDraft.data}
                    onChange={(e) => setAcaoDraft((d) => ({ ...d, data: e.target.value }))}
                  />
                </div>
                <button className="btn btn-primary" disabled={acaoDraft.data === dataSalva || saving} onClick={salvarDataCompat}>
                  Salvar data
                </button>
              </div>
            )
          )}

        </div>

        <EmpresaContatosPanel
          item={item}
          meta={meta}
          irmas={irmas}
          onSaved={(id, patch) => {
            if (patch.empresa !== undefined) update('empresa', patch.empresa);
            onSaved(id, patch);
          }}
          onAbrirOportunidade={onAbrirOportunidade}
        />

        <div className="drawer-section">
          <h3>Contato principal desta conversa</h3>
          {!empresasEstruturadas && (
            <div className="field">
              <label>Empresa</label>
              <input value={form.empresa || ''} onChange={(e) => update('empresa', e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>Telefone / WhatsApp</label>
            <input value={form.telefone || ''} onChange={(e) => update('telefone', e.target.value)} />
          </div>
          <details className="sec-recolhida">
            <summary>Mais dados do contato</summary>
            <div className="field">
              <label>Tipo de contato</label>
              <select value={form.tipoContato || ''} onChange={(e) => update('tipoContato', e.target.value)}>
                <option value="">—</option>
                {meta.tipos.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </details>
          <a
            className="btn-link"
            style={{ display: 'block', marginTop: 10 }}
            href={`${MONDAY_ACCOUNT_URL}/boards/${BOARD_ID_PUBLIC}/pulses/${item.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Abrir no monday.com ↗
          </a>
        </div>

        {!contatosEstruturados && (
          <div className="drawer-section">
            <h3>Contatos e papéis de decisão</h3>
            {contatos.length === 0 && (
              <div style={{ color: '#8a97a3', fontSize: '0.85rem', marginBottom: 8 }}>
                Nenhum contato cadastrado. Registre quem aprova orçamento, quem exige especificação técnica etc.
              </div>
            )}
            {contatos.map((c, i) => (
              <div key={i} className="field-row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Nome</label>
                  <input value={c.name || ''} onChange={(e) => updateContato(i, 'name', e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Papel na decisão</label>
                  <input
                    value={c.role || ''}
                    placeholder="Ex: aprova orçamento, exige spec técnica..."
                    onChange={(e) => updateContato(i, 'role', e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, maxWidth: 130 }}>
                  <label>Telefone</label>
                  <input value={c.phone || ''} onChange={(e) => updateContato(i, 'phone', e.target.value)} />
                </div>
                <button
                  type="button"
                  className="proposta-delete-btn"
                  title="Remover contato"
                  style={{ marginBottom: 0 }}
                  onClick={() => removeContato(i)}
                >
                  🗑️
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={addContato}>
              + Adicionar contato
            </button>
          </div>
        )}

        {fileError && <div className="banner banner-error">{fileError}</div>}
        <PropostasPanel
            itemId={item.id}
            pronto={!!estruturaV2?.propostas?.pronto}
            faltando={estruturaV2?.propostas?.faltando || []}
            arquivos={arquivos}
            reloadKey={arquivosReloadKey}
            onOpenFile={(f) => setViewingProposal(f)}
            onDeleteFile={handleDeleteFile}
            deletingAssetId={deletingAssetId}
            onVisao={setVisaoPropostas}
            uploadSlot={
              <>
        {uploadingFile && (
          <div style={{ color: '#037f4c', fontSize: '0.85rem', margin: '4px 0 8px' }}>
            {uploadingFile.name}: {uploadingFile.status}{' '}
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: '0.85rem' }}
              onClick={handleCancelFileUpload}
            >
              Cancelar envio
            </button>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileSelected}
          disabled={Boolean(uploadingFile)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={Boolean(uploadingFile)}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadingFile ? 'Enviando...' : '+ Adicionar arquivo'}
        </button>
              </>
            }
          />

        <details className="drawer-section sec-recolhida" data-testid="rastreio-propostas">
          <summary>
            <h3 style={{ display: 'inline' }}>Rastreio de propostas enviadas ({rastreioPropostas.length})</h3>
          </summary>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
            "Visualizada" só conta quando o link é aberto de verdade num navegador — colar num grupo/conversa do
            WhatsApp não conta, só o clique do cliente. Ainda assim é uma estimativa, não uma confirmação de leitura
            atenta: o tempo somado só conta enquanto a aba fica em primeiro plano, e reabrir o mesmo link soma no
            mesmo registro. 🔴 não visualizada · 🟠 visualizada com pouco tempo de leitura (menos de 4min) · ✅
            leitura completa (4min ou mais) — a mesma cor aparece no card do lead no Kanban, referente ao envio mais
            recente. "Baixada" conta cliques no botão "⬇ Baixar PDF" da própria página — não cobre quem salva pelo
            visualizador nativo do navegador, isso não gera nenhum aviso pra gente.
          </p>
          {rastreioPropostas.length === 0 ? (
            <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
              Nenhuma proposta em PDF enviada com rastreio ainda — gere uma pelo suplemento do Word ("Vincular
              proposta ao CRM").
            </div>
          ) : (
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Enviada</th>
                  <th>Status</th>
                  <th>Tempo total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...rastreioPropostas]
                  .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
                  .map((r) => (
                    <tr key={r.sendId}>
                      <td>
                        {r.fileName}
                        {r.sentBy && <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>por {r.sentBy}</div>}
                      </td>
                      <td>{fmtDate(r.sentAt)}</td>
                      <td>
                        {(() => {
                          const status = statusLeituraRegistro(r);
                          if (status === STATUS_LEITURA.NAO_LIDA) {
                            return <span style={{ color: STATUS_LEITURA_COR[status] }}>🔴 Ainda não visualizada</span>;
                          }
                          const icone = status === STATUS_LEITURA.LIDA_BASTANTE ? '✅' : '🟠';
                          return (
                            <span style={{ color: STATUS_LEITURA_COR[status] }}>
                              {icone} Visualizada em {fmtDate(r.firstViewedAt)} ({r.viewCount}x)
                            </span>
                          );
                        })()}
                        {r.downloadCount > 0 && (
                          <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem', marginTop: 2 }}>
                            ⬇ Baixada {r.downloadCount}x pelo botão da página (última em {fmtDate(r.lastDownloadedAt)})
                          </div>
                        )}
                      </td>
                      <td>{fmtDuration(r.totalViewMs)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          style={{ fontSize: '0.8rem' }}
                          disabled={copyingSendId === r.sendId}
                          onClick={() => handleCopyTrackLink(r.sendId)}
                        >
                          {copiedSendId === r.sendId ? '✅ Copiado' : copyingSendId === r.sendId ? '...' : '📋 Copiar link'}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </details>

        <div className="drawer-section">
          <h3>Dados da oportunidade e qualificação</h3>
          <div className="qualify-panel">
            <h4>
              {qualifyCount}/5 critérios preenchidos
            </h4>
            <div className="qualify-grid">
              {QUALIFY_FIELDS.map((f) => (
                <div key={f.key} className={form[f.key] ? 'yes' : 'missing'}>
                  {form[f.key] ? '✅' : '⬜'} {f.label}
                </div>
              ))}
            </div>
          </div>

          <div className="field" data-testid="campo-nome-oportunidade">
            <label>Nome da oportunidade (assunto)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={nomeOpp}
                maxLength={120}
                placeholder={form.produtoInteresse ? `Ex: ${form.produtoInteresse}` : 'Ex: Máquina de corte — linha 2'}
                onChange={(e) => setNomeOpp(e.target.value)}
                aria-label="Nome da oportunidade"
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={salvandoNomeOpp || nomeOpp.trim() === (item.oportunidade?.nome || '')}
                onClick={salvarNomeOpp}
              >
                {salvandoNomeOpp ? '...' : 'Salvar nome'}
              </button>
            </div>
            {!estruturaV2?.oportunidade?.pronto && (
              <div className="schema-warning">
                A coluna "Oportunidade (JSON)" ainda não existe neste ambiente — o nome não pode ser salvo (ver README).
              </div>
            )}
            {msgNomeOpp && <div className="contato-info">{msgNomeOpp}</div>}
          </div>
          <div className="field">
            <label>Necessidade — produto / aplicação de interesse</label>
            <input
              value={form.produtoInteresse || ''}
              onChange={(e) => update('produtoInteresse', e.target.value)}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Valor estimado (R$)</label>
              <input
                type="number"
                value={form.valorEstimado || ''}
                onChange={(e) => update('valorEstimado', e.target.value)}
              />
            </div>
          </div>
          <details className="sec-recolhida">
            <summary>Segmento, cargo do decisor e canal de origem</summary>
          <div className="field-row">
            <div className="field">
              <label>Segmento</label>
              <select value={form.segmento || ''} onChange={(e) => update('segmento', e.target.value)}>
                <option value="">—</option>
                {meta.segmentos.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cargo do decisor</label>
              <select value={form.cargoDecisor || ''} onChange={(e) => update('cargoDecisor', e.target.value)}>
                <option value="">—</option>
                {meta.cargos.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <div className="field">
              <label>Canal de origem</label>
              <select value={form.canalOrigem || ''} onChange={(e) => update('canalOrigem', e.target.value)}>
                <option value="">—</option>
                {meta.canais.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          </details>
          {!colunasProntas && (
            <div className="schema-warning">
              Prazo de compra e impedimento ficam disponíveis assim que as colunas novas forem criadas no monday.com
              (ver o aviso em "Próxima ação").
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <label>Prazo previsto de compra</label>
              <input
                type="date"
                disabled={!colunasProntas}
                value={form.prazoCompra ? isoDateOnly(form.prazoCompra) : ''}
                onChange={(e) => update('prazoCompra', e.target.value)}
                aria-label="Prazo previsto de compra"
              />
              <div className="quick-dates">
                {[30, 60, 90, 180].map((n) => (
                  <button
                    type="button"
                    key={n}
                    disabled={!colunasProntas}
                    onClick={() => update('prazoCompra', addDaysStr(hojeStr, n))}
                  >
                    +{n}d
                  </button>
                ))}
                {form.prazoCompra && colunasProntas && (
                  <button type="button" onClick={() => update('prazoCompra', '')}>
                    limpar
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label>Principal impedimento para avançar</label>
              <input
                list="impedimentos-sugeridos"
                maxLength={200}
                disabled={!colunasProntas}
                value={form.principalImpedimento || ''}
                placeholder="Ex: Aguardando financiamento"
                onChange={(e) => update('principalImpedimento', e.target.value)}
                aria-label="Principal impedimento"
              />
              <datalist id="impedimentos-sugeridos">
                {IMPEDIMENTOS_SUGERIDOS.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="field">
            <label>Último contato efetivo com o cliente</label>
            <input
              type="date"
              disabled={!editarUltimoContato}
              value={form.ultimoContato ? isoDateOnly(form.ultimoContato) : ''}
              onChange={(e) => update('ultimoContato', e.target.value)}
              aria-label="Último contato"
            />
          </div>
          <div className="contato-info" data-testid="contato-info">
            {form.ultimoContato
              ? `Último contato efetivo há ${diasUltimoContato} dia(s). `
              : 'Nenhum contato efetivo registrado. '}
            Editar o cadastro não conta como contato: use "Registrar atividade realizada" ou uma anotação marcada como
            contato.{' '}
            {!editarUltimoContato && (
              <button type="button" className="btn-link" onClick={() => setEditarUltimoContato(true)}>
                Corrigir a data manualmente
              </button>
            )}
          </div>

          {qualifyCount >= 4 && form.estagio === 'Lead' && (
            <button
              className="btn btn-primary"
              style={{ marginBottom: 8 }}
              disabled={saving}
              onClick={() => save({ estagio: 'Qualificado' })}
            >
              ✅ Marcar como Qualificado e distribuir
            </button>
          )}
        </div>

        <div className="drawer-section">
          <h3>Estágio &amp; responsável</h3>
          <div className="field-row">
            <div className="field">
              <label>Estágio de vendas</label>
              <select value={form.estagio || ''} onChange={(e) => update('estagio', e.target.value)}>
                <option value="">—</option>
                {meta.stages.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.value}
                  </option>
                ))}
              </select>
            </div>
            {form.estagio === 'Perdido' && (
              <div className="field">
                <label>Motivo da perda</label>
                <select value={form.motivoPerda || ''} onChange={(e) => update('motivoPerda', e.target.value)}>
                  <option value="">—</option>
                  {meta.motivos.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="field">
            <label>Responsável(is)</label>
            <div className="contato-info" style={{ marginTop: 0 }}>
              O primeiro selecionado é o <strong>responsável principal</strong>; os demais aparecem como participantes.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {meta.users.map((u) => (
                <label
                  key={u.id}
                  className="chip"
                  style={{
                    cursor: 'pointer',
                    background: responsavelIds.includes(String(u.id)) ? '#007eb5' : '#eef2f5',
                    color: responsavelIds.includes(String(u.id)) ? '#fff' : 'inherit',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ display: 'none' }}
                    checked={responsavelIds.includes(String(u.id))}
                    onChange={() => toggleResponsavel(String(u.id))}
                  />
                  {u.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        {item.estagio === 'Fechado' && (
          <div className="drawer-section">
            <h3>Vendas adicionais (recompras)</h3>
            <p style={{ color: 'var(--ink-soft)', fontSize: '0.8rem', marginTop: -6, marginBottom: 12 }}>
              Pra vendas diretas a este cliente depois do fechamento (ex: reposição de peças) — não passa pelo funil
              nem abre um card novo no Kanban de vendas, fica só registrado aqui no histórico do cliente.
            </p>
            {vendaError && <div className="banner banner-error">{vendaError}</div>}
            {vendasAdicionais.length === 0 ? (
              <div style={{ color: '#8a97a3', fontSize: '0.85rem', marginBottom: 8 }}>
                Nenhuma venda adicional registrada ainda.
              </div>
            ) : (
              <div className="propostas-list" style={{ marginBottom: 12 }}>
                {[...vendasAdicionais]
                  .sort((a, b) => new Date(b.data) - new Date(a.data))
                  .map((v) => (
                    <div key={v.id} className="proposta-item-row">
                      <div style={{ flex: 1, padding: '6px 4px' }}>
                        <div>
                          {fmtDateOnly(v.data)} — {v.descricao}
                          {fmtValor(v.valor) ? ` (${fmtValor(v.valor)})` : ''}
                        </div>
                        {v.registradoPor && (
                          <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>
                            registrado por {v.registradoPor}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="proposta-delete-btn"
                        title="Remover registro"
                        disabled={removingVendaId === v.id}
                        onClick={() => handleRemoveVenda(v)}
                      >
                        {removingVendaId === v.id ? '...' : '🗑️'}
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <div className="field-row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ maxWidth: 150, marginBottom: 0 }}>
                <label>Data</label>
                <input
                  type="date"
                  value={novaVenda.data}
                  onChange={(e) => setNovaVenda((v) => ({ ...v, data: e.target.value }))}
                />
              </div>
              <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                <label>O que foi vendido</label>
                <input
                  placeholder="Ex: kit de peças de reposição"
                  value={novaVenda.descricao}
                  onChange={(e) => setNovaVenda((v) => ({ ...v, descricao: e.target.value }))}
                />
              </div>
              <div className="field" style={{ maxWidth: 130, marginBottom: 0 }}>
                <label>Valor (R$)</label>
                <input
                  type="number"
                  value={novaVenda.valor}
                  onChange={(e) => setNovaVenda((v) => ({ ...v, valor: e.target.value }))}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 10 }}
              disabled={addingVenda}
              onClick={handleAddVenda}
            >
              {addingVenda ? 'Salvando...' : '+ Registrar venda adicional'}
            </button>
          </div>
        )}

        <div className="drawer-section" id="secao-historico">
          <h3>Registrar anotação e histórico</h3>
          <textarea
            className="note-textarea"
            placeholder="Anotação livre (para registrar uma ligação ou visita, use Registrar atendimento)..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <div className="note-actions" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <label className="check-line" style={{ margin: 0 }}>
              <input type="checkbox" checked={noteEhContato} onChange={(e) => setNoteEhContato(e.target.checked)} />
              Foi um contato com o cliente (atualiza "Último contato")
            </label>
            <button
              className="btn btn-secondary"
              disabled={addingNote || !noteText.trim()}
              onClick={addNote}
            >
              {addingNote ? 'Salvando...' : 'Adicionar anotação'}
            </button>
          </div>

          {showFollowUpNudge && (
            <div className="followup-nudge">
              <span>
                ✅ "Último contato" atualizado pra hoje. Já sabe quando volta a falar com o cliente?
              </span>
              <div className="followup-nudge-actions">
                <button className="btn-link" disabled={settingFollowUp} onClick={() => quickSetFollowUp(3)}>
                  +3 dias
                </button>
                <button className="btn-link" disabled={settingFollowUp} onClick={() => quickSetFollowUp(7)}>
                  +7 dias
                </button>
                <button className="btn-link" disabled={settingFollowUp} onClick={() => quickSetFollowUp(15)}>
                  +15 dias
                </button>
                <button
                  className="btn-link"
                  style={{ color: 'var(--ink-soft)' }}
                  disabled={settingFollowUp}
                  onClick={() => setShowFollowUpNudge(false)}
                >
                  Agora não
                </button>
              </div>
            </div>
          )}

          <HistoricoOportunidade
            historico={historico}
            expandido={expandirHistorico}
            onToggleExpandido={() => setExpandirHistorico((v) => !v)}
          />
        </div>

        <div className="save-bar" data-testid="barra-salvar">
          <span className="save-bar-msg">{isDirty ? 'Há alterações não salvas' : 'Nenhuma alteração pendente'}</span>
          <button className="btn btn-primary" disabled={!isDirty || saving} onClick={handleSaveClick}>
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      {viewingProposal && (
        <ProposalViewerModal
          proposal={viewingProposal}
          fallbackUrl={`${MONDAY_ACCOUNT_URL}/boards/${BOARD_ID_PUBLIC}/pulses/${item.id}`}
          onClose={() => setViewingProposal(null)}
        />
      )}

      {pendingCloseChanges && (
        <HandoffModal
          item={item}
          meta={meta}
          currentResponsavelIds={responsavelIds}
          saving={handoffSaving}
          error={handoffError}
          onConfirm={handleConfirmHandoff}
          onCancel={handleCancelHandoff}
        />
      )}
    </>
  );
}

function isoDateOnly(value) {
  // aceita "2026-08-20" ou "2026-08-20 10:00:00" vindos do monday
  return String(value).slice(0, 10);
}
