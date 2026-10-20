"""Testes de API da v3 (automação do acompanhamento — modo sugestão) contra o monday SIMULADO.
Dados 100% fictícios. Uso: python3 tests/e2e/api_v3.py <token-admin>
Pré-requisito: mock em :4010 e app em :3100 (start-app.sh). Cada cenário cria seus próprios leads fictícios."""
import json, sys, urllib.request, urllib.error, datetime, uuid, subprocess

TOKEN = sys.argv[1]
APP, MOCK = 'http://localhost:3100', 'http://localhost:4010'
res = []

def chk(nome, cond, det=''):
    res.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + nome + (f'  [{det}]' if det and not cond else ''))

def call(method, path, body=None, base=APP, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Cookie': f'agostini_crm_session={token or TOKEN}'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def mock(path, body=None):
    return call('POST' if body is not None else 'GET', path, body, MOCK)[1]

def tok(nome, admin):
    return subprocess.check_output(['node', 'tests/e2e/gerar-token.mjs', nome, '1' if admin else '0'], text=True).strip()
TOKEN_BRUNO = tok('Bruno Teste', False)

def hoje(): return (datetime.datetime.utcnow() - datetime.timedelta(hours=3)).date()
def dia(n): return (hoje() + datetime.timedelta(days=n)).isoformat()
FERIADOS = {'2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25', '2026-10-12', '2026-12-08x'}
def eh_util(d, extras=()):
    d = datetime.date.fromisoformat(d) if isinstance(d, str) else d
    return d.weekday() < 5 and d.isoformat() not in FERIADOS and d.isoformat() not in extras
def prox_util_ou_igual(d, extras=()):
    d = datetime.date.fromisoformat(d)
    while not eh_util(d, extras): d += datetime.timedelta(days=1)
    return d.isoformat()
def soma_util(d, n, extras=()):
    d = datetime.date.fromisoformat(d)
    while n > 0:
        d += datetime.timedelta(days=1)
        if eh_util(d, extras): n -= 1
    return d.isoformat()
def esperado_A(envio, extras=()):
    bruto = soma_util(envio, 1, extras)
    d = prox_util_ou_igual(bruto, extras)
    return max(d, prox_util_ou_igual(hoje().isoformat(), extras))
def proximo_sabado():
    d = hoje()
    while d.weekday() != 5 or d.isoformat() in FERIADOS: d += datetime.timedelta(days=1)
    return d.isoformat()
rid = lambda: 'tst' + uuid.uuid4().hex[:14]

mock('/__reset', {})
call('PATCH', '/api/automacao/config', {'config': {'ativo': True, 'regras': {'A': True, 'B': True, 'D': True, 'E': True, 'F': True}, 'diasParada': 7, 'feriadosExtras': []}})

def novo(nome, cols=None, criado=-20, files=None):
    c = {'estagio': 'Proposta Enviada', 'empresa': nome + ' Fict.', 'pessoas': ['101'], 'ultimoContato': None}
    c.update(cols or {})
    r = mock('/__seed', {'name': nome, 'cols': c, 'createdOffset': criado, 'files': files})
    return r['id']

def estado(i):
    st, d = call('GET', '/api/items')
    return next((x for x in d['items'] if x['id'] == str(i)), None)

def notas(i):
    lead = next(l for l in mock('/__state') if l['id'] == str(i))
    return [u['text'] for u in lead['updates']]

def sugs(extra='', token=None, debug=False):
    st, d = call('GET', '/api/automacao/sugestoes?' + extra + ('&debug=1' if debug else ''), token=token)
    return d

def minhas(i, d=None, chave_pref=None):
    d = d or sugs()
    return [s for s in d.get('sugestoes', []) if s['itemId'] == str(i) and (not chave_pref or s['chave'].startswith(chave_pref))]

def registrar_prop(i, situacao='rascunho', numero='2026-900', **extra):
    st, v = call('GET', f'/api/items/{i}/propostas')
    op = {'acao': 'registrar', 'numero': numero, 'revisao': 'A', 'situacao': situacao, 'arquivos': []}
    op.update(extra)
    return call('POST', f'/api/items/{i}/propostas', {'expectedRev': v['rev'], 'op': op})

def enviar(i, data):
    st, v = call('GET', f'/api/items/{i}/propostas')
    return call('POST', f'/api/items/{i}/propostas', {'expectedRev': v['rev'], 'op': {'acao': 'enviar', 'id': v['docs'][0]['id'], 'data': data}})

def aceitar(i, s, **extra):
    corpo = {'requestId': rid(), 'chave': s['chave'], 'decisao': 'aceitar', 'impressao': s['fp']}
    corpo.update(extra)
    return call('POST', f'/api/automacao/sugestoes/{i}', corpo)

# ===== 0. configuração e acesso =====================================================
st, cfg = call('GET', '/api/automacao/config')
chk('config: padrão carregado e gravável (item do quadro Configurações informado)', st == 200 and cfg['config']['ativo'] and cfg['gravavel'] and cfg['config']['diasParada'] == 7 and cfg['config']['horaFollowUp'] == '09:00', cfg)
st, _ = call('PATCH', '/api/automacao/config', {'config': {'ativo': False}}, token=TOKEN_BRUNO)
chk('config: não-admin não altera (403)', st == 403)
st, e = call('PATCH', '/api/automacao/config', {'config': {'diasParada': 0}})
chk('config: valor inválido recusado (400), nada gravado', st == 400 and call('GET', '/api/automacao/config')[1]['config']['diasParada'] == 7, e)
st, e = call('PATCH', '/api/automacao/config', {'config': {'feriadosExtras': ['2026-13-40']}})
chk('config: feriado inválido recusado', st == 400, e)
st, _ = call('GET', '/api/automacao/semana', token=TOKEN_BRUNO)
chk('visão do gestor: não-admin recebe 403', st == 403)

# ===== 1. proposta enviada → follow-up no próximo dia útil às 9h =====================
L1 = novo('Cliente V3 Um')
st, r = registrar_prop(L1, 'rascunho')
chk('registrar proposta como rascunho funciona', st == 200 and r['docs'][0]['situacao'] == 'rascunho', r)
chk('rascunho (upload/arquivo/PDF) não gera follow-up', len(minhas(L1, chave_pref='A.')) == 0)
st, r = enviar(L1, dia(-1))
chk('Registrar envio explícito grava situação enviada + data do envio', st == 200 and r['docs'][0]['situacao'] == 'enviada' and r['docs'][0]['envioEm'] == dia(-1), r)
S = minhas(L1, chave_pref='A.')
chk('regra A: uma sugestão após o envio explícito', len(S) == 1, S)
s1 = S[0] if S else {}
chk('regra A: data = próximo dia útil do envio (feriados nacionais), hora 09:00', s1.get('acaoProposta', {}).get('data') == esperado_A(dia(-1)) and s1.get('acaoProposta', {}).get('hora') == '09:00', (s1.get('acaoProposta'), esperado_A(dia(-1))))
chk('sugestão traz origem, justificativa e a data do EVENTO separada da programada', s1.get('origemRotulo') == 'Sugerida por regra' and 'envio registrado' in s1.get('justificativa', '') and s1.get('evento', {}).get('data') == dia(-1), s1)
chk('nada foi gravado só por gerar a sugestão (plano e data intactos)', estado(L1)['planoAcao']['vendas'] is None and estado(L1)['proximoFollowUp'] in (None, ''))

# ===== 2. evento repetido não duplica =====================================================
st, r = enviar(L1, dia(-1))
chk('registrar o mesmo envio de novo não altera nada', st == 200 and r.get('semAlteracao') is True, r)
chk('continua uma única sugestão com a mesma chave', len(minhas(L1, chave_pref='A.')) == 1 and minhas(L1, chave_pref='A.')[0]['chave'] == s1['chave'])
chk('uma só nota de envio no histórico (sem duplicata)', sum('Envio da proposta' in n for n in notas(L1)) == 1, notas(L1))

# ===== 3. aceitar: ação criada com origem; horário persiste; aceitar ≠ realizar ===========
pid = rid()
st, r = call('POST', f'/api/automacao/sugestoes/{L1}', {'requestId': pid, 'chave': s1['chave'], 'decisao': 'aceitar', 'impressao': s1['fp']})
chk('aceitar grava a ação na trilha de vendas e na coluna de data', st == 200 and r['ok'] and r['data'] == s1['acaoProposta']['data'] and r['hora'] == '09:00', r)
e1 = estado(L1)
chk('após recarregar: ação, data, hora e origem persistem', e1['planoAcao']['vendas']['origem'] == 'sugestao' and e1['planoAcao']['vendas']['regra'] == 'A' and e1['planoAcao']['vendas']['hora'] == '09:00' and e1['proximoFollowUp'] == s1['acaoProposta']['data'], e1['planoAcao'])
chk('ação aceita NÃO conta como contato nem como realizada (último contato intacto)', not e1['ultimoContato'])
nt = [n for n in notas(L1) if 'Sugestão aceita' in n]
chk('histórico registra aceite com origem, motivo e Ref', len(nt) == 1 and 'Criada a partir de sugestão aceita' in nt[0] and f'Ref: {pid}' in nt[0] and 'ainda não realizada' in nt[0], nt)
st, r = call('POST', f'/api/automacao/sugestoes/{L1}', {'requestId': pid, 'chave': s1['chave'], 'decisao': 'aceitar', 'impressao': s1['fp']})
chk('mesmo pedido repetido (duplo clique/retry) é ignorado', st == 200 and r.get('duplicado') is True)
st, r = aceitar(L1, s1)
chk('aceitar de novo (outro pedido) não cria nova ação nem nova nota', st == 200 and r.get('duplicado') is True and len([n for n in notas(L1) if 'Sugestão aceita' in n]) == 1, r)
chk('com ação já agendada não há nova sugestão para a oportunidade', len(minhas(L1)) == 0 or all(s['tipo'] == 'destaque' for s in minhas(L1)))

# ===== 4. tentativa sem resposta: B; não atualiza contato efetivo; dispensar =============
L2 = novo('Cliente V3 Dois', {'ultimoContato': dia(-30)})
corpo = lambda resumo: {'requestId': rid(), 'trilha': 'vendas', 'resultado': resumo, 'canal': 'Ligação', 'contatoRealizado': False, 'concluiuAcaoPlanejada': True, 'confirmaSemProximoPasso': True, 'proximoPasso': None}
st, r = call('POST', f'/api/items/{L2}/atividades', corpo('Não atendeu, caixa postal'))
chk('registrar tentativa sem resposta funciona (sem próximo passo, com confirmação)', st == 200 and r['ok'] and not r['ultimoContato'], r)
chk('tentativa NÃO atualiza o último contato efetivo', estado(L2)['ultimoContato'][:10] == dia(-30))
B = minhas(L2, chave_pref='B.')
chk('regra B: sugere nova tentativa em 7 dias corridos (dia útil), sem horário', len(B) == 1 and B[0]['acaoProposta']['data'] == prox_util_ou_igual(dia(7)) and B[0]['acaoProposta']['hora'] is None, B)
chk('regra B: justificativa diz que não é contato efetivo', B and 'não conta como contato efetivo' in B[0]['justificativa'])
chave_b1 = B[0]['chave']
st, r = call('POST', f'/api/automacao/sugestoes/{L2}', {'requestId': rid(), 'chave': chave_b1, 'decisao': 'dispensar', 'motivo': 'cliente viaja'})
chk('dispensar grava e registra no histórico', st == 200 and r['decisao'] == 'dispensada' and any('Sugestão dispensada' in n and 'cliente viaja' in n for n in notas(L2)), r)
chk('dispensada não reaparece (e persiste após recarregar)', len(minhas(L2, chave_pref='B.')) == 0 and any(x[0] == chave_b1 and x[1] == 'd' for x in estado(L2)['planoAcao']['sg']))
st, r = call('POST', f'/api/items/{L2}/atividades', corpo('Nova tentativa: ninguém atendeu de novo'))
B2 = minhas(L2, chave_pref='B.')
chk('novo evento relevante (nova tentativa) gera nova sugestão com chave diferente', st == 200 and len(B2) == 1 and B2[0]['chave'] != chave_b1, B2)
chk('dispensa anterior continua registrada', any(x[0] == chave_b1 for x in estado(L2)['planoAcao']['sg']))

# ===== 5. ação existente / compromisso combinado ==========================================
L3 = novo('Cliente V3 Três')
registrar_prop(L3, 'enviada', envioEm=dia(-1))
st, r = call('PUT', f'/api/items/{L3}/proxima-acao', {'trilha': 'vendas', 'acao': 'Visita combinada na planta', 'data': dia(10), 'responsavelId': '101', 'compromissoCliente': True, 'expectedRev': 0})
chk('compromisso combinado gravado pelo fluxo existente', st == 200, r)
d = sugs(debug=True)
chk('ação existente evita tarefa redundante (sem sugestão A para a oportunidade)', len(minhas(L3, d)) == 0 and any(x['itemId'] == str(L3) and 'combinada com o cliente' in x['motivo'] for x in d['suprimidas']))
e3 = estado(L3)
chk('compromisso intacto: texto, data e marca "combinada com o cliente"', e3['planoAcao']['vendas']['acao'] == 'Visita combinada na planta' and e3['planoAcao']['vendas']['compromissoCliente'] and e3['proximoFollowUp'] == dia(10))
st, r = call('POST', f'/api/automacao/sugestoes/{L3}', {'requestId': rid(), 'chave': f"A.{estado(L3)['propostasRegistro']['docs'][0]['id']}.{dia(-1)}", 'decisao': 'aceitar'})
chk('forçar o aceite por chave não substitui o compromisso (409 obsoleta)', st == 409 and r.get('codigo') == 'obsoleta' and estado(L3)['planoAcao']['vendas']['acao'] == 'Visita combinada na planta', r)

# ===== 6. sugestão obsoleta não sobrescreve ação mais recente =============================
L4 = novo('Cliente V3 Quatro')
registrar_prop(L4, 'enviada', envioEm=dia(-1))
s4 = minhas(L4, chave_pref='A.')[0]
call('PUT', f'/api/items/{L4}/proxima-acao', {'trilha': 'vendas', 'acao': 'Ligar para o decisor', 'data': None, 'responsavelId': '101', 'compromissoCliente': False, 'expectedRev': 0})
st, r = aceitar(L4, s4)
chk('ação criada/alterada depois da geração → aceite recusado (estagnada)', st == 409 and r.get('codigo') == 'estagnada', r)
chk('a ação mais recente continua como estava', estado(L4)['planoAcao']['vendas']['acao'] == 'Ligar para o decisor' and not estado(L4)['planoAcao']['sg'])

# ===== 7. substituir, ajustar, dia não útil =================================================
L5 = novo('Cliente V3 Cinco', {'planoAcao': json.dumps({'v': 1, 'vendas': {'acao': 'Retornar ao cliente (antigo)', 'responsavelId': '101', 'compromissoCliente': False, 'rev': 1}}), 'proximoFollowUp': dia(-5)})
registrar_prop(L5, 'enviada', envioEm=dia(-1))
s5 = minhas(L5, chave_pref='A.')[0]
chk('ação vencida existente: sugestão informa o que seria substituído', s5['substitui'] and s5['substitui']['acao'] == 'Retornar ao cliente (antigo)' and s5['exigeConfirmacaoSubstituir'], s5)
st, r = aceitar(L5, s5)
chk('aceitar sem confirmar a substituição é recusado (409 substituir)', st == 409 and r['codigo'] == 'substituir')
sab = proximo_sabado()
st, r = aceitar(L5, s5, confirma={'substituir': True}, ajuste={'data': sab})
chk('ajustar para sábado exige confirmação de dia não útil (409)', st == 409 and r['codigo'] == 'dia_nao_util' and r['sugestaoData'] == prox_util_ou_igual(sab), r)
st, r = aceitar(L5, s5, confirma={'substituir': True, 'diaNaoUtil': True}, ajuste={'data': sab, 'acao': 'Retornar sobre a proposta (ajustada)', 'hora': '14:30'})
chk('ajuste + confirmações: gravado com data/hora/texto ajustados', st == 200 and r['data'] == sab and r['hora'] == '14:30', r)
n5 = [n for n in notas(L5) if 'Sugestão aceita' in n]
chk('histórico indica ajuste e o que foi substituído', n5 and 'ajustada' in n5[0] and 'Substituiu: Retornar ao cliente (antigo)' in n5[0], n5)
chk('ação ajustada persiste com origem de sugestão aceita', estado(L5)['planoAcao']['vendas']['acao'].startswith('Retornar sobre a proposta') and estado(L5)['planoAcao']['vendas']['hora'] == '14:30')
L5b = novo('Cliente V3 CincoB')
registrar_prop(L5b, 'enviada', envioEm=dia(-1))
s5b = minhas(L5b, chave_pref='A.')[0]
st, r = aceitar(L5b, s5b, ajuste={'data': dia(-3)})
chk('data no passado é recusada (400) e nada é gravado', st == 400 and estado(L5b)['planoAcao']['vendas'] is None, r)

# ===== 8. perdida: sem sugestões de prospecção ==============================================
L6 = novo('Cliente V3 Seis')
registrar_prop(L6, 'enviada', envioEm=dia(-1))
chk('antes: oportunidade ativa tem sugestão', len(minhas(L6)) >= 1)
st, r = call('PATCH', f'/api/items/{L6}', {'estagio': 'Perdido'})
chk('mover para Perdido (fluxo existente)', st == 200, r)
chk('perdida deixa de receber sugestões de prospecção', len(minhas(L6)) == 0 and not any(s['itemId'] == str(L6) for s in sugs().get('antigas', [])))
chk('nada foi apagado do lead perdido (registro de propostas e plano preservados)', len(estado(L6)['propostasRegistro']['docs']) == 1)

# ===== 9. fechada: pendência de passagem sem marcar entrega =================================
L7 = novo('Cliente V3 Sete', {'estagio': 'Fechado', 'dataFechamento': dia(-2)})
F = minhas(L7, chave_pref='F.')
chk('regra F: venda fechada gera sugestão de passagem para pós-venda', len(F) == 1 and F[0]['trilha'] == 'posVenda' and F[0]['semResponsavelPosVenda'], F)
chk('regra F: texto não assume entrega', F and 'não significa "entregue"' in F[0]['justificativa'])
st, r = aceitar(L7, F[0])
e7 = estado(L7)
chk('aceitar F cria a pendência na trilha de pós-venda com a data na coluna própria', st == 200 and e7['planoAcao']['posVenda']['acao'].startswith('Passagem para pós-venda') and e7['proximoContatoPosVenda'] == F[0]['acaoProposta']['data'], r)
chk('fechada NÃO foi marcada como entregue nem teve estágio de pós-venda alterado', not e7.get('dataEntregaEfetiva') and not e7.get('estagioPosVenda'))
chk('não há sugestões de prospecção para a fechada', all(s['regra'] == 'F' for s in sugs().get('sugestoes', []) if s['itemId'] == str(L7)))
chk('depois de aceita, F não reaparece', len(minhas(L7, chave_pref='F.')) == 0)

# ===== 10. D / E ==================================================================================
L8 = novo('Cliente V3 Oito', {'estagio': 'Em Negociação', 'ultimoContato': dia(-12), 'proximoFollowUp': dia(5), 'planoAcao': json.dumps({'v': 1, 'vendas': {'acao': 'Aguardar retorno', 'responsavelId': '101', 'compromissoCliente': False, 'rev': 1}}), 'prazoCompra': dia(15), 'principalImpedimento': 'Aprovação do financiamento'})
D8 = minhas(L8, chave_pref='D.'); E8 = minhas(L8, chave_pref='E.')
chk('D: sem contato efetivo há 12 dias (limite 7) com ação futura → destaque único', len(D8) == 1 and D8[0]['motivoD'] == 'sem_contato' and D8[0]['acaoProposta'] is None, D8)
chk('E: prazo de compra em 15 dias mostra impedimento e próxima ação', len(E8) == 1 and 'Aprovação do financiamento' in E8[0]['justificativa'] and 'Aguardar retorno' in E8[0]['justificativa'] and not E8[0]['semProximoPasso'], E8)
chk('D/E não movem estágio nem declaram perda', estado(L8)['estagio'] == 'Em Negociação')
d1 = minhas(L8, sugs(), 'D.')
d2 = minhas(L8, sugs(), 'D.')
chk('sem alerta repetido: mesma pendência (mesma chave) a cada consulta', len(d1) == 1 and d1[0]['chave'] == d2[0]['chave'])
st, r = call('POST', f'/api/automacao/sugestoes/{L8}', {'requestId': rid(), 'chave': D8[0]['chave'], 'decisao': 'dispensar'})
chk('dispensar o destaque D', st == 200 and len(minhas(L8, chave_pref='D.')) == 0)
st, r = aceitar(L8, E8[0])
chk('destaque (sem ação proposta) não é aceito: orienta a definir pela oportunidade', st == 400 and 'destaque' in r['error'], r)
L9 = novo('Cliente V3 Nove', {'ultimoContato': dia(-1), 'planoAcao': json.dumps({'v': 1, 'vendas': {'acao': 'Retorno futuro combinado', 'responsavelId': '101', 'compromissoCliente': True, 'rev': 1}}), 'proximoFollowUp': dia(40), 'prazoCompra': dia(70)})
chk('retorno futuro combinado e compra a 70 dias: nada a destacar', len(minhas(L9)) == 0)

# ===== 11. retroativo: análise prévia com filtro, sem ação em massa ==================================
L10 = novo('Cliente V3 Dez')
registrar_prop(L10, 'enviada', envioEm=dia(-90))
d = sugs('analise=1')
chk('evento antigo NÃO entra na lista principal', len(minhas(L10, d)) == 0)
chk('análise prévia sem responsável escolhido não lista (exige filtro)', d['analiseExigeResponsavel'] and d['antigas'] == [] and d['totalAntigas'] >= 1)
d = sugs('analise=1&responsavelId=101')
ant = [s for s in d['antigas'] if s['itemId'] == str(L10)]
chk('com responsável escolhido a análise lista o item, com data sugerida a partir de hoje', len(ant) == 1 and ant[0]['antiga'] and ant[0]['acaoProposta']['data'] >= hoje().isoformat(), ant)
st, r = call('POST', '/api/automacao/sugestoes', {'decisao': 'aceitar'})
chk('não existe ação em massa (coleção não aceita POST)', st in (404, 405))

# ===== 12. falha no monday: estado consistente e erro informado ====================================
L11 = novo('Cliente V3 Onze')
registrar_prop(L11, 'enviada', envioEm=dia(-1))
s11 = minhas(L11, chave_pref='A.')[0]
mock('/__fail', {'match': 'change_multiple_column_values', 'n': 1})
st, r = aceitar(L11, s11)
chk('falha ao gravar: erro 502 com gravado=false (sem falso sucesso)', st == 502 and r.get('gravado') is False, r)
chk('estado consistente após a falha: plano, data e histórico intactos', estado(L11)['planoAcao']['vendas'] is None and not [n for n in notas(L11) if 'Sugestão aceita' in n])
st, r = aceitar(L11, s11)
chk('repetir depois da falha grava uma única vez', st == 200 and r['ok'] and len([n for n in notas(L11) if 'Sugestão aceita' in n]) == 1, r)
L12 = novo('Cliente V3 Doze')
registrar_prop(L12, 'enviada', envioEm=dia(-1))
s12 = minhas(L12, chave_pref='A.')[0]
mock('/__fail', {'match': 'create_update', 'n': 1})
st, r = aceitar(L12, s12)
chk('falha só na nota de histórico: ação gravada e aviso explícito', st == 200 and r['notaRegistrada'] is False and r['avisoNota'] and estado(L12)['planoAcao']['vendas'] is not None, r)

# ===== 13. escopo e permissões ======================================================================
LB = novo('Cliente V3 do Bruno', {'pessoas': ['102']})
registrar_prop(LB, 'enviada', envioEm=dia(-1))
LA = novo('Cliente V3 da Ana', {'pessoas': ['101']})
registrar_prop(LA, 'enviada', envioEm=dia(-1))
db = sugs(token=TOKEN_BRUNO)
chk('não-admin vê só as próprias oportunidades', all('102' in s['responsavelIds'] for s in db['sugestoes']) and any(s['itemId'] == str(LB) for s in db['sugestoes']) and not any(s['itemId'] == str(LA) for s in db['sugestoes']))
sA = minhas(LA, chave_pref='A.')[0]
st, r = call('POST', f'/api/automacao/sugestoes/{LA}', {'requestId': rid(), 'chave': sA['chave'], 'decisao': 'aceitar', 'impressao': sA['fp']}, token=TOKEN_BRUNO)
chk('não-admin não decide em oportunidade de outro responsável (403)', st == 403 and estado(LA)['planoAcao']['vendas'] is None, r)
sB = minhas(LB, db, 'A.')[0]
st, r = call('POST', f'/api/automacao/sugestoes/{LB}', {'requestId': rid(), 'chave': sB['chave'], 'decisao': 'aceitar', 'impressao': sB['fp']}, token=TOKEN_BRUNO)
chk('não-admin decide na própria oportunidade; autor vem da sessão', st == 200 and any('Sugestão aceita por Bruno Teste' in n for n in notas(LB)), r)

# ===== 14. feriados configuráveis e desativação ======================================================
LF = novo('Cliente V3 Feriado')
registrar_prop(LF, 'enviada', envioEm=dia(-1))
base = esperado_A(dia(-1))
st, r = call('PATCH', '/api/automacao/config', {'config': {'feriadosExtras': [base]}})
chk('admin configura feriado extra (persistido no item de configuração)', st == 200 and base in call('GET', '/api/automacao/config')[1]['config']['feriadosExtras'], r)
sF = minhas(LF, chave_pref='A.')[0]
chk('feriado extra empurra a data sugerida para o próximo dia útil', sF['acaoProposta']['data'] == esperado_A(dia(-1), (base,)) and sF['acaoProposta']['data'] != base, (sF['acaoProposta'], base))
call('PATCH', '/api/automacao/config', {'config': {'feriadosExtras': []}})
st, r = call('PATCH', '/api/automacao/config', {'config': {'regras': {'A': False}}})
chk('desligar só a regra A é aceito pelo admin', st == 200 and call('GET', '/api/automacao/config')[1]['config']['regras']['A'] is False, r)
dd = sugs()
chk('regra A desligada não gera sugestões A (regrasAtivas atualizado)', 'A' not in dd['regrasAtivas'] and not any(s['regra'] == 'A' for s in dd['sugestoes']), dd['regrasAtivas'])
st, r = call('POST', f'/api/automacao/sugestoes/{LF}', {'requestId': rid(), 'chave': sF['chave'], 'decisao': 'aceitar', 'impressao': sF['fp']})
chk('aceitar com a regra desligada é recusado', st == 409 and r['codigo'] == 'regra_desativada', r)
call('PATCH', '/api/automacao/config', {'config': {'regras': {'A': True}}})
chk('religar a regra restaura as sugestões sem perder histórico', len(minhas(LF, chave_pref='A.')) == 1)
call('PATCH', '/api/automacao/config', {'config': {'ativo': False}})
dd = sugs()
chk('interruptor geral: nenhuma sugestão', dd['ativo'] is False and dd['sugestoes'] == [])
chk('desativar não apaga nada: ações aceitas e histórico continuam', estado(L1)['planoAcao']['vendas']['origem'] == 'sugestao' and any('Sugestão aceita' in n for n in notas(L1)))
call('PATCH', '/api/automacao/config', {'config': {'ativo': True}})

# ===== 15. visão semanal do gestor ====================================================================
st, v = call('GET', '/api/automacao/semana')
chk('visão semanal: seções e critérios presentes', st == 200 and all(k in v for k in ['semProximaAcao', 'compromissosVencidos', 'propostasSemAvanco', 'compras30', 'compras60', 'passagemPosVenda', 'criterios']), list(v))
chk('visão semanal: compras previstas 30 dias traz impedimento e próxima ação', any(x['itemId'] == str(L8) and x['impedimento'] == 'Aprovação do financiamento' and x['proximaAcao'] for x in v['compras30']))
chk('visão semanal: compra a 70 dias não entra em 30/60', not any(x['itemId'] == str(L9) for x in v['compras30'] + v['compras60']))
st, v = call('GET', '/api/automacao/semana?responsavelId=102')
chk('visão semanal: filtro por responsável', st == 200 and all('102' in x['responsavelIds'] for sec in ['semProximaAcao', 'compras30', 'compras60', 'passagemPosVenda'] for x in v[sec]))
chk('texto dos critérios não afirma "ausência comprovada"', 'não prova que não houve atendimento' in v['criterios']['propostasSemAvanco'])

# ===== 16. persistência/consistência final ==============================================================
e = estado(L1)
chk('após recarregar tudo: data e horário da ação aceita continuam', e['proximoFollowUp'] == s1['acaoProposta']['data'] and e['planoAcao']['vendas']['hora'] == '09:00')
est = mock('/__state')
chk('nenhum envio ao cliente: nenhuma nota registra envio de mensagem/e-mail/WhatsApp automático', not any(any(p in n for p in ['mensagem enviada', 'e-mail enviado', 'WhatsApp enviado']) for l in est for n in [u['text'] for u in l['updates']]))

print(f"\n{sum(res)}/{len(res)} verificações passaram")
sys.exit(0 if all(res) else 1)
