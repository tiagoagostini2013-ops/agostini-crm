"""Testes de API da v2 (Atendimento e oportunidades) contra o monday SIMULADO.
Dados 100% fictícios. Uso: python3 tests/e2e/api_v2.py <token>
Pré-requisito: mock em :4010 e app em :3100 (start-app.sh, V2=1)."""
import json, sys, urllib.request, urllib.error, datetime, uuid

TOKEN = sys.argv[1]
APP, MOCK = 'http://localhost:3100', 'http://localhost:4010'
res = []

def chk(nome, cond, det=''):
    res.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + nome + (f'  [{det}]' if det and not cond else ''))

def call(method, path, body=None, base=APP):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Cookie': f'agostini_crm_session={TOKEN}'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def mock(path, body=None):
    return call('POST' if body is not None else 'GET', path, body, MOCK)[1]

def hoje():
    return (datetime.datetime.utcnow() - datetime.timedelta(hours=3)).date()
def dia(n): return (hoje() + datetime.timedelta(days=n)).isoformat()
FERIADOS = {'2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25', '2026-10-12'}
def prox_util(d):
    d = datetime.date.fromisoformat(d)
    while d.weekday() >= 5 or d.isoformat() in FERIADOS: d += datetime.timedelta(days=1)
    return d.isoformat()

mock('/__reset', {})
st, itens = call('GET', '/api/items')
por = {i['name']: i for i in itens['items']}
silo, formas, sem = por['Silo de Teste Alfa'], por['Formas Alfa Teste'], por['Lead Sem Empresa Teste']

# ---- 1. empresa × contatos × oportunidades -----------------------------------------
chk('empresa vinculada exibe o nome do board Empresas', silo['empresa'] == 'Alfa Concreto Fictícia' and silo['empresaId'] == '7001')
chk('duas oportunidades independentes na mesma empresa', formas['empresaId'] == '7001' and silo['id'] != formas['id'] and silo['produtoInteresse'] != formas['produtoInteresse'])
chk('cada oportunidade tem valor e estágio próprios', silo['valorEstimado'] != formas['valorEstimado'] and silo['estagio'] != formas['estagio'])
chk('contatos vinculados por oportunidade (2 na central, 1 nas formas)', silo['oportunidade']['contatoIds'] == ['7101', '7102'] and formas['oportunidade']['contatoIds'] == ['7101'])
chk('lead sem empresa identificada/CNPJ/e-mail existe e abre', sem['empresaId'] is None and not sem.get('empresa'))
st, emp = call('GET', '/api/empresas')
chk('GET /api/empresas lista empresas e contatos', st == 200 and len(emp['empresas']) == 2 and len(emp['contatos']) == 3 and emp['configurado'])

# ---- 2. histórico unificado ----------------------------------------------------------
st, h = call('GET', f"/api/items/{silo['id']}/historico")
ev = h['eventos']
envios = [e for e in ev if e['tipo'] == 'proposta_envio']
chk('histórico: envio do PDF aparece UMA vez (nota + rastreio fundidos)', st == 200 and len(envios) == 1, [e['id'] for e in envios])
chk('histórico: atendimento antigo preservado com autor do texto e sem "quando aconteceu"', any(e['tipo'] == 'atendimento' and e['autor'] == 'Ana Teste' and e['ocorreuEm'] is None and e['categoria'] == 'efetivo' for e in ev))
chk('histórico: anotação interna classificada e autor reconhecido', any(e['categoria'] == 'interno' and e['autor'] == 'Bruno Teste' for e in ev))
chk('histórico: anotação sem assinatura NÃO inventa autor', any(e['conteudo'] == 'Contato via feira, pediu catálogo' and e['autor'] is None for e in ev))
chk('histórico: visualização é "estimada" e não é contato', any(e['tipo'] == 'proposta_visualizacao' and 'estimada' in e['conteudo'] and e['categoria'] == 'sistema' for e in ev))
def _t(e):
    v = e.get('ocorreuEm') or e.get('registradoEm') or ''
    return datetime.datetime.fromisoformat((v + 'T15:00:00+00:00') if len(v) == 10 else v.replace('Z', '+00:00')).timestamp()
chk('histórico ordenado do mais recente ao mais antigo', all(_t(ev[i]) >= _t(ev[i+1]) for i in range(len(ev)-1)))
chk('último contato efetivo vem do registro ficha/coluna (não de visualização)', h['ultimoContatoEfetivo'] and h['ultimoContatoEfetivo']['data'] == dia(-2))
ids = [e['id'] for e in ev]
chk('sem ids repetidos no histórico', len(ids) == len(set(ids)))

# ---- 3. propostas: arquivos DOCX/PDF, revisão, vigente, persistência ---------------------
st, pr = call('GET', f"/api/items/{silo['id']}/propostas")
sug = {s['chave']: s for s in pr['sugestoes']}
chk('sugestão agrupa DOCX+PDF da mesma proposta (3 grupos, não 5 arquivos)', len(pr['sugestoes']) == 3 and any(len(s['arquivos']) == 2 for s in pr['sugestoes']))
chk('sem registro: nada marcado como vigente/enviado/aceito por presunção', pr['vigente'] is None and pr['docs'] == [] and pr['aceitas'] == 0)
rev0 = pr['rev']
st, r = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': rev0, 'op': {'acao': 'registrar', 'numero': '2026-045', 'revisao': 'A', 'situacao': 'enviada', 'valor': 600000, 'arquivos': ['5001', '5002'], 'data': dia(-6)}})
chk('registrar proposta rev A (DOCX+PDF = 1 documento)', st == 200 and len(r['docs']) == 1 and sorted(r['docs'][0]['formatos']) == ['DOCX', 'PDF'], r.get('error'))
idA = r['docs'][0]['id']
chk('rastreio vinculado ao PDF da rev A (envio rastreado, visualização estimada)', r['docs'][0]['envioRastreado'] and r['docs'][0]['envioRastreado']['visualizacoes'] == 2)
st, r = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': r['rev'], 'op': {'acao': 'vigente', 'id': idA}})
st, r = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': r['rev'], 'op': {'acao': 'nova_revisao', 'baseId': idA, 'revisao': 'B', 'arquivos': ['5003', '5004'], 'data': dia(-1)}})
chk('revisão B criada como RASCUNHO, sem herdar o valor', st == 200 and r['docs'][1]['situacao'] == 'rascunho' and r['docs'][1]['valor'] is None, r.get('error'))
idB = r['docs'][1]['id']
st, rd = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': r['rev'], 'op': {'acao': 'registrar', 'numero': '9', 'situacao': 'rascunho', 'arquivos': ['5003']}})
chk('arquivo não pode ir para dois documentos', st == 400 and 'já está registrado' in rd['error'])
st, r = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': r['rev'], 'op': {'acao': 'atualizar', 'id': idB, 'campos': {'situacao': 'enviada'}}})
st, r = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': r['rev'], 'op': {'acao': 'vigente', 'id': idB}})
chk('nova vigente substitui a revisão anterior da MESMA proposta', st == 200 and r['vigente']['revisao'] == 'B' and r['docs'][0]['situacao'] == 'substituida' and r['efeitos'], r.get('error'))
st, alt = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': r['rev'], 'op': {'acao': 'registrar', 'tipo': 'alternativa', 'rotulo': 'com esteira', 'numero': '2026-045', 'situacao': 'enviada', 'valor': 700000, 'arquivos': ['5005']}})
chk('alternativa técnica é separada; vigente não muda; valores não somados', st == 200 and alt['vigente']['revisao'] == 'B' and len(alt['docs']) == 3 and 'total' not in alt, alt.get('error'))
st, pr2 = call('GET', f"/api/items/{silo['id']}/propostas")
chk('PERSISTÊNCIA: vigente recuperada após recarregar', pr2['vigente'] and pr2['vigente']['id'] == idB and pr2['rev'] == alt['rev'])
st, it2 = call('GET', '/api/items')
silo2 = [i for i in it2['items'] if i['name'] == silo['name']][0]
chk('vincular/classificar proposta NÃO altera o valor da oportunidade', silo2['valorEstimado'] == silo['valorEstimado'])
st, conf = call('POST', f"/api/items/{silo['id']}/propostas", {'expectedRev': rev0, 'op': {'acao': 'remover', 'id': idA}})
chk('edição sobre revisão desatualizada → 409 sem sobrescrever', st == 409 and conf['conflito'])
chk('arquivos anexados continuam todos lá (nada excluído)', len(pr2['arquivos']) == 5)
st, h2 = call('GET', f"/api/items/{silo['id']}/historico")
chk('ações de proposta entram no histórico (📑)', sum(1 for e in h2['eventos'] if e['tipo'] == 'proposta' and '📑' in e['conteudo']) >= 4)

# ---- 4. registro de atendimento -----------------------------------------------------------
def atv(item, extra=None, **kw):
    corpo = {'trilha': 'vendas', 'canal': 'Ligação', 'contatoRealizado': True, 'resultado': 'Conversamos sobre prazo', 'concluiuAcaoPlanejada': True,
             'acaoConcluida': 'Validar', 'requestId': 'req' + uuid.uuid4().hex[:12], 'expectedRev': None,
             'proximoPasso': {'acao': 'Enviar minuta', 'data': prox_util(dia(3)), 'responsavelId': '101', 'compromissoCliente': False}}
    corpo.update(kw)
    if extra: corpo.update(extra)
    corpo = {k: v for k, v in corpo.items() if not (k == 'expectedRev' and v is None)}
    return call('POST', f"/api/items/{item['id']}/atividades", corpo)

moldes = por['Moldes Beta Teste']   # último contato = hoje-3
uc0 = moldes['ultimoContato']
st, r = atv(moldes, contatoRealizado=False, resultado='Liguei, caixa postal', concluiuAcaoPlanejada=False)
st2, it3 = call('GET', '/api/items')
m3 = [i for i in it3['items'] if i['name'] == moldes['name']][0]
chk('TENTATIVA sem resposta não atualiza o último contato efetivo', st == 200 and m3['ultimoContato'] == uc0 and r['ultimoContato'] is None and r['contatoEfetivo'] is False, (m3['ultimoContato'], uc0))
chk('tentativa com ação mantida: próxima ação/data preservadas', m3['proximoFollowUp'] == moldes['proximoFollowUp'] and m3['planoAcao']['vendas']['acao'] == 'Validar financiamento')
st, h = call('GET', f"/api/items/{moldes['id']}/historico")
tent = [e for e in h['eventos'] if e['tipo'] == 'atendimento']
chk('tentativa aparece no histórico como tentativa, com autor da SESSÃO e "quando"', tent and tent[0]['categoria'] == 'tentativa' and tent[0]['autor'] == 'Ana Teste' and tent[0]['ocorreuEm'])
chk('último contato efetivo do histórico não mudou com a tentativa', h['ultimoContatoEfetivo']['data'] == uc0)

req = 'reqDUPLO' + uuid.uuid4().hex[:8]
st, a1 = atv(moldes, requestId=req, resultado='Falei com o decisor', expectedRev=m3['planoAcao']['vendas']['rev'])
st, a2 = atv(moldes, requestId=req, resultado='Falei com o decisor', expectedRev=m3['planoAcao']['vendas']['rev'])
chk('registro efetivo grava; repetição (duplo clique) é ignorada', st == 200 and a1['ok'] and a1['ultimoContato'] == dia(0) and a2.get('duplicado') is True)
st, h = call('GET', f"/api/items/{moldes['id']}/historico")
chk('exatamente UM atendimento efetivo no histórico após o duplo clique', len([e for e in h['eventos'] if e['tipo'] == 'atendimento' and e['categoria'] == 'efetivo']) == 1)
st, it4 = call('GET', '/api/items'); m4 = [i for i in it4['items'] if i['name'] == moldes['name']][0]
chk('PERSISTÊNCIA: próximo passo, data, responsável e último contato após recarregar', m4['planoAcao']['vendas']['acao'] == 'Enviar minuta' and m4['proximoFollowUp'] == prox_util(dia(3)) and m4['ultimoContato'] == dia(0) and m4['planoAcao']['vendas']['responsavelId'] == '101')

st, r = atv(moldes, extra={'ocorreuEm': dia(-30) + 'T10:00', 'expectedRev': m4['planoAcao']['vendas']['rev']}, resultado='Registro tardio de contato antigo')
st3, it5 = call('GET', '/api/items'); m5 = [i for i in it5['items'] if i['name'] == moldes['name']][0]
chk('registro atrasado NÃO recua o último contato', st == 200 and m5['ultimoContato'] == dia(0))
st, r = atv(moldes, extra={'ocorreuEm': dia(2) + 'T10:00'})
chk('atendimento no futuro é recusado', st == 400)

silo_rev = silo['planoAcao']['vendas']['rev']
st, r = atv(silo, extra={'expectedRev': silo_rev, 'proximoPasso': {'acao': 'Reunião combinada', 'data': prox_util(dia(9)), 'compromissoCliente': True}})
chk('(preparo) registra próximo passo combinado com o cliente para data futura', st == 200, r)
rev2 = r['planoAcao']['vendas']['rev']
st, r = atv(silo, extra={'expectedRev': rev2, 'proximoPasso': {'acao': 'Outra coisa', 'data': prox_util(dia(12))}})
chk('data combinada com o cliente (ainda futura) NÃO é sobrescrita sem confirmação', st == 409 and r.get('codigo') == 'compromisso_cliente' and r['dataAtual'] == prox_util(dia(9)), r)
st, r = atv(silo, extra={'expectedRev': rev2, 'confirmaSubstituirCompromisso': True, 'proximoPasso': {'acao': 'Outra coisa', 'data': prox_util(dia(12))}})
chk('com confirmação explícita o combinado é substituído', st == 200 and r['data'] == prox_util(dia(12)), r)
st, r = atv(silo, extra={'concluiuAcaoPlanejada': False, 'contatoRealizado': False}, concluiuAcaoPlanejada=False, resultado='Tentativa, ação mantida')
st, itx = call('GET', '/api/items'); sx = [i for i in itx['items'] if i['name'] == silo['name']][0]
chk('ação mantida (não concluída) preserva a data agendada', st == 200 and sx['proximoFollowUp'] == prox_util(dia(12)))
kappa = por['Kappa Pequeno Combinado']  # compromisso, data = hoje (não futura) → permitido
sab = dia(((5 - hoje().weekday()) % 7) or 7)  # próximo sábado
st, r = atv(kappa, extra={'expectedRev': kappa['planoAcao']['vendas']['rev'], 'proximoPasso': {'acao': 'Ligar', 'data': sab, 'compromissoCliente': False}})
chk('data fora de dia útil pede confirmação e sugere o próximo dia útil', st == 409 and r.get('codigo') == 'dia_nao_util' and r['sugestao'] == prox_util(sab), r)
st, r = atv(kappa, extra={'expectedRev': kappa['planoAcao']['vendas']['rev'], 'confirmaDiaNaoUtil': True, 'proximoPasso': {'acao': 'Ligar', 'data': sab}})
chk('com confirmação explícita a data fora de dia útil é aceita', st == 200)
gama = por['Gama Pavimentos Teste']
st, r = atv(gama, proximoPasso=None)
chk('concluir em vendas SEM próximo passo exige confirmação (não conclui em silêncio)', st == 409 and r.get('codigo') == 'sem_proximo_passo', r)
st, r = atv(gama, proximoPasso=None, confirmaSemProximoPasso=True)
chk('com confirmação grava e sinaliza pendência', st == 200 and r['pendencia'] == 'sem_proximo_passo')
st, h = call('GET', f"/api/items/{gama['id']}/historico")
chk('histórico marca atendimento sem próximo passo', h['atendimentoSemProximoPasso'] is True)
st, r = atv(por['Delta Lead Novo Teste'], extra={'requestId': 'x'})
chk('requestId inválido é recusado', st == 400)

# falha de sincronização
mock('/__fail', {'match': 'change_multiple_column_values', 'n': 1})
iota = por['Iota Alto Valor Sem Compromisso']
st, r = atv(iota, extra={'expectedRev': iota['planoAcao']['vendas']['rev']})
st2, hi = call('GET', f"/api/items/{iota['id']}/historico")
chk('falha ao gravar colunas → erro 502 claro, nada no histórico (sem falso sucesso)', st == 502 and r.get('gravado') is False and not any(e['tipo'] == 'atendimento' for e in hi['eventos']), r)
mock('/__fail', {'match': 'create_update', 'n': 1})
st, r = atv(iota, extra={'expectedRev': iota['planoAcao']['vendas']['rev']})
chk('falha só no histórico → dado gravado, aviso explícito e texto para reenviar', st == 200 and r['notaRegistrada'] is False and 'Ref:' in r['textoHistorico'] and r.get('avisoNota'), r)
st, rr = call('POST', f"/api/items/{iota['id']}/notes", {'text': r['textoHistorico'], 'contato': False})
st, rr2 = call('POST', f"/api/items/{iota['id']}/notes", {'text': r['textoHistorico'], 'contato': False})
chk('reenvio do histórico grava uma vez (Ref impede duplicar)', st == 200 and rr2.get('duplicado') is True)

# ---- 5. empresa: criar sem duplicar, vincular sem copiar, conflito -------------------------
st, d = call('POST', '/api/empresas', {'nome': 'ALFA concreto fictícia ltda'})
chk('empresa de nome equivalente → 409 com a existente (não duplica nem agrupa sozinho)', st == 409 and d['duplicada'] and d['existentes'][0]['id'] == '7001')
st, d = call('POST', '/api/empresas', {'nome': 'Nova Empresa Teste'})
chk('cadastrar empresa sem CNPJ funciona', st == 200 and d['empresa']['cnpj'] is None)
nova = d['empresa']['id']
st, d = call('POST', '/api/empresas', {'nome': 'Outra', 'cnpj': '123'})
chk('CNPJ preenchido e inválido é recusado (em branco é permitido)', st == 400)
st, d = call('PUT', f"/api/items/{sem['id']}/empresa", {'empresaId': nova, 'expectedEmpresaId': None})
chk('vincular lead sem empresa → empresa nova', st == 200 and d['empresaNome'] == 'Nova Empresa Teste', d)
st, d = call('PUT', f"/api/items/{sem['id']}/empresa", {'empresaId': '7002', 'expectedEmpresaId': None})
chk('vínculo alterado por outra pessoa → 409 (não sobrescreve)', st == 409 and d['conflito'])
bm = mock('/__state'); semm = [i for i in bm if i['name'] == sem['name']][0]
chk('vincular grava só o id (texto antigo de empresa intocado, nenhum valor copiado)', semm['cols'].get('empresaId') == nova and semm['cols'].get('empresa') in (None, '') and semm['cols'].get('valorEstimado') in (None, ''))
st, it6 = call('GET', '/api/items'); s6 = [i for i in it6['items'] if i['name'] == sem['name']][0]
chk('PERSISTÊNCIA: nome da empresa exibido após recarregar', s6['empresa'] == 'Nova Empresa Teste')
st, d = call('PUT', f"/api/items/{sem['id']}/empresa", {'empresaId': 'NAO-EXISTE'})
chk('empresa inexistente é recusada', st == 404)

# ---- 6. contatos --------------------------------------------------------------------------
st, d = call('POST', '/api/contatos', {'nome': 'Carlos Outro', 'telefone': '+55 47 99912 3456'})
chk('contato com telefone já cadastrado → 409 com o existente', st == 409 and d['duplicado'] and d['existentes'][0]['id'] == '7101')
st, d = call('POST', '/api/contatos', {'nome': 'Pessoa sem empresa Teste'})
chk('contato SEM empresa, telefone ou e-mail é permitido', st == 200 and d['contato']['empresaId'] is None)
novo_ct = d['contato']['id']
st, d = call('POST', '/api/contatos', {'nome': 'X', 'papel': 'Rei'})
chk('papel fora da lista é recusado', st == 400)
st, d = call('PATCH', '/api/contatos/7101', {'papel': 'Influenciador', 'base': {'papel': 'Compras'}})
chk('edição de contato com base desatualizada → 409', st == 409 and d['conflito'])
st, d = call('PATCH', '/api/contatos/7101', {'papel': 'Influenciador', 'base': {'papel': 'Decisor'}})
chk('edição de contato com base atual funciona', st == 200)

# ---- 7. oportunidade ↔ contatos -----------------------------------------------------------
st, o = call('GET', f"/api/items/{formas['id']}/oportunidade")
st, d = call('PUT', f"/api/items/{formas['id']}/oportunidade", {'expectedRev': o['oportunidade']['rev'], 'adicionarContatoId': novo_ct})
chk('vincular contato à oportunidade (sem duplicar o contato)', st == 200 and d['oportunidade']['contatoIds'] == ['7101', novo_ct], d)
st, d2 = call('PUT', f"/api/items/{formas['id']}/oportunidade", {'expectedRev': o['oportunidade']['rev'], 'nome': 'Outro nome'})
chk('oportunidade editada por outra pessoa → 409', st == 409 and d2['conflito'])
st, o2 = call('GET', f"/api/items/{silo['id']}/oportunidade")
chk('a OUTRA oportunidade da mesma empresa não foi afetada', o2['oportunidade']['contatoIds'] == ['7101', '7102'])
st, d = call('PUT', f"/api/items/{formas['id']}/oportunidade", {'expectedRev': d['oportunidade']['rev'], 'adicionarContatoId': 'NAO'})
chk('contato inexistente é recusado', st == 404)

# ---- 8. rastreio truncado + sugestões (somente leitura) -----------------------------------
tr = por['Truncado Rastreio Teste']
chk('rastreio truncado: registros inteiros recuperados e aviso ligado', tr['rastreioTruncado'] is True and 0 < len(tr['rastreioPropostas']) < 14, len(tr['rastreioPropostas']))
estado_antes = json.dumps(mock('/__state'), sort_keys=True)
st, sg = call('GET', '/api/vinculos/sugestoes')
estado_depois = json.dumps(mock('/__state'), sort_keys=True)
chk('sugestões de vínculo são só leitura (nenhum dado mudou)', st == 200 and sg['somenteLeitura'] and estado_antes == estado_depois)
chk('sugestão: lead com texto "Gama Fictícia" ↔ empresa "Gama Pavimentos Fictícia Ltda" para REVISÃO', any(v['empresaId'] == '7002' and v['confianca'] == 'media' for v in sg['vinculosEmpresa']))
chk('sugestão: contatos legados cruzados com o board Contatos', isinstance(sg['contatosLegados'], list))

print(f"\n{sum(res)}/{len(res)} verificações OK")
sys.exit(0 if all(res) else 1)
