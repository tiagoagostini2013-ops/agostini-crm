"""Navegador real (Playwright) — automação do acompanhamento v3, contra o monday SIMULADO. Dados fictícios.
Uso: python3 tests/e2e/run_e2e_v3.py <token-admin> [pasta-de-screenshots]
Pré-requisito: mock em :4010 e app em :3100 (start-app.sh)."""
import json, sys, urllib.request, urllib.error, datetime, re, subprocess, uuid
from playwright.sync_api import sync_playwright

TOKEN = sys.argv[1]
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
APP, MOCK = 'http://localhost:3100', 'http://localhost:4010'
results = []

def check(name, cond, detail=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''))

def api(method, path, body=None, base=APP, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Cookie': f'agostini_crm_session={token or TOKEN}'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b'{}')

def mock(path, body=None):
    return api('POST' if body is not None else 'GET', path, body, MOCK)

def hoje(): return (datetime.datetime.utcnow() - datetime.timedelta(hours=3)).date()
def dia(n): return (hoje() + datetime.timedelta(days=n)).isoformat()
def proximo_sabado():
    d = hoje()
    while d.weekday() != 5: d += datetime.timedelta(days=1)
    return d.isoformat()

TOKEN_BRUNO = subprocess.check_output(['node', 'tests/e2e/gerar-token.mjs', 'Bruno Teste', '0'], text=True).strip()

mock('/__reset', {})
api('PATCH', '/api/automacao/config', {'config': {'ativo': True, 'regras': {'A': True, 'B': True, 'D': True, 'E': True, 'F': True}, 'feriadosExtras': []}})

def novo(nome, cols=None, files=None):
    c = {'estagio': 'Proposta Enviada', 'empresa': nome + ' Fict.', 'pessoas': ['101'], 'ultimoContato': dia(-1)}
    c.update(cols or {})
    return mock('/__seed', {'name': nome, 'cols': c, 'createdOffset': -20, 'files': files})['id']

def com_envio(nome, envio, cols=None):
    i = novo(nome, cols)
    v = api('GET', f'/api/items/{i}/propostas')
    api('POST', f'/api/items/{i}/propostas', {'expectedRev': v['rev'], 'op': {'acao': 'registrar', 'numero': '2026-777', 'revisao': 'A', 'situacao': 'enviada', 'envioEm': envio, 'arquivos': []}})
    return i

def estado_lead(nome):
    return next(l for l in mock('/__state') if l['name'] == nome)

def notas(nome):
    return [u['text'] for u in estado_lead(nome)['updates']]

U1 = com_envio('Cliente UI Um', dia(-1))
U2 = com_envio('Cliente UI Dois', dia(-1))
U3 = com_envio('Cliente UI Tres', dia(-1))
U4 = com_envio('Cliente UI Quatro', dia(-1))
U5 = com_envio('Cliente UI Cinco', dia(-1))
U6 = com_envio('Cliente UI Seis', dia(-1))
UB = com_envio('Cliente UI do Bruno', dia(-1), {'pessoas': ['102']})
UR = novo('Cliente UI Rascunho', files=[{'assetId': '9001', 'name': 'Proposta UI.pdf'}])
v = api('GET', f'/api/items/{UR}/propostas')
api('POST', f'/api/items/{UR}/propostas', {'expectedRev': v['rev'], 'op': {'acao': 'registrar', 'numero': '2026-888', 'revisao': 'A', 'situacao': 'rascunho', 'arquivos': ['9001']}})

IGNORAR = re.compile(r'409|500|502|Failed to load resource')

with sync_playwright() as p:
    browser = p.chromium.launch()
    def contexto(token):
        ctx = browser.new_context(viewport={'width': 1400, 'height': 1000})
        ctx.add_cookies([{'name': 'agostini_crm_session', 'value': token, 'url': APP}])
        return ctx
    ctx = contexto(TOKEN)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and not IGNORAR.search(m.text) else None)
    page.goto(APP)
    page.wait_for_selector('.lead-card')

    def abrir_agenda():
        page.locator('.view-toggle button', has_text='Agenda').click()
        page.wait_for_selector('[data-testid="sugestoes"]')
    def cartao(nome, regra='A'):
        return page.locator(f'[data-testid="sugestao"][data-regra="{regra}"]', has_text=nome)

    # ---------------- Agenda: sugestão visível com origem e justificativa ----------------
    abrir_agenda()
    c1 = cartao('Cliente UI Um')
    c1.wait_for()
    txt = c1.inner_text()
    check('Agenda mostra a sugestão com origem "Sugerida por regra"', 'Sugerida por regra' in txt, txt)
    check('Sugestão traz justificativa curta e a data do evento', 'envio registrado' in txt and 'Evento: Envio da proposta' in txt, txt)
    check('Sugestão avisa que o horário é lembrete interno (monday guarda só a data)', 'lembrete interno' in txt and '09:00' in txt, txt)
    check('Texto do modo sugestão: nada é criado antes de aceitar, nada é enviado ao cliente', 'nada é criado até você aceitar' in page.locator('[data-testid="sugestoes"]').inner_text().lower().replace('modo sugestão: ', '') or 'nenhuma mensagem é enviada ao cliente' in page.locator('[data-testid="sugestoes"]').inner_text())
    check('Nada foi gravado só por exibir a sugestão', json.loads(estado_lead('Cliente UI Um')['cols'].get('planoAcao') or '{}').get('vendas') is None)
    page.screenshot(path=f'{SHOTS}/v3-01-agenda-sugestoes.png')

    # ---------------- Aceitar ----------------
    c1.get_by_test_id('sug-aceitar').click()
    c1.wait_for(state='detached')
    plano = json.loads(estado_lead('Cliente UI Um')['cols']['planoAcao'])
    check('Aceitar grava a ação com origem de sugestão aceita e horário 09:00', plano['vendas']['origem'] == 'sugestao' and plano['vendas']['hora'] == '09:00', plano)
    check('Histórico do monday registra o aceite (sem enviar nada ao cliente)', any('Sugestão aceita por Ana Teste' in n for n in notas('Cliente UI Um')))
    linha = page.locator('.agenda-row', has_text='Cliente UI Um')
    linha.first.wait_for()
    check('Linha da Agenda mostra a origem "Criada a partir de sugestão aceita" e o lembrete 09:00', 'Criada a partir de sugestão aceita' in linha.first.inner_text() and '09:00' in linha.first.inner_text(), linha.first.inner_text())
    page.reload()
    page.wait_for_selector('.lead-card')
    abrir_agenda()
    check('Após recarregar: ação aceita continua na Agenda e a sugestão não volta', page.locator('.agenda-row', has_text='Cliente UI Um').count() >= 1 and cartao('Cliente UI Um').count() == 0)

    # ---------------- Ajustar + dia não útil com confirmação ----------------
    c2 = cartao('Cliente UI Dois')
    c2.get_by_test_id('sug-ajustar').click()
    sab = proximo_sabado()
    c2.get_by_label('Data ajustada').fill(sab)
    c2.get_by_label('Ação ajustada').fill('Ligar para validar a proposta (ajustada)')
    c2.get_by_test_id('sug-aceitar-ajustada').click()
    c2.get_by_test_id('sug-confirmar').wait_for()
    check('Fim de semana pede confirmação explícita (mostra o próximo dia útil)', 'não é dia útil' in c2.get_by_test_id('sug-confirmar').inner_text(), c2.get_by_test_id('sug-confirmar').inner_text())
    check('Nada gravado enquanto não confirma', json.loads(estado_lead('Cliente UI Dois')['cols'].get('planoAcao') or '{}').get('vendas') is None)
    c2.get_by_test_id('sug-confirmar-sim').click()
    c2.wait_for(state='detached')
    st2 = estado_lead('Cliente UI Dois')
    check('Ajuste confirmado grava a data e o texto ajustados', st2['cols'].get('proximoFollowUp') == sab and json.loads(st2['cols']['planoAcao'])['vendas']['acao'].endswith('(ajustada)'), st2['cols'])

    # ---------------- Dispensar ----------------
    c3 = cartao('Cliente UI Tres')
    c3.get_by_test_id('sug-dispensar').click()
    c3.wait_for(state='detached')
    check('Dispensar a sugestão A deixa a pendência D ("sem próxima ação") visível, pois o lead continua sem ação', cartao('Cliente UI Tres', 'D').count() == 1)
    check('Dispensar registra no histórico e grava a decisão', any('Sugestão dispensada' in n for n in notas('Cliente UI Tres')) and json.loads(estado_lead('Cliente UI Tres')['cols']['planoAcao'])['sg'][0][1] == 'd')
    page.reload(); page.wait_for_selector('.lead-card'); abrir_agenda()
    check('Dispensada não reaparece após recarregar', cartao('Cliente UI Tres').count() == 0)

    # ---------------- Falha no monday: erro visível, nada gravado, repetir funciona ----------------
    c4 = cartao('Cliente UI Quatro')
    mock('/__fail', {'match': 'change_multiple_column_values', 'n': 1})
    c4.get_by_test_id('sug-aceitar').click()
    c4.get_by_role('alert').wait_for()
    check('Falha ao gravar: mensagem de erro e a sugestão continua na tela', 'Não foi possível gravar' in c4.get_by_role('alert').inner_text() and cartao('Cliente UI Quatro').count() == 1)
    check('Falha ao gravar: nada foi salvo (sem falso sucesso)', json.loads(estado_lead('Cliente UI Quatro')['cols'].get('planoAcao') or '{}').get('vendas') is None and not any('Sugestão aceita' in n for n in notas('Cliente UI Quatro')))
    page.screenshot(path=f'{SHOTS}/v3-02-falha.png')
    c4.get_by_test_id('sug-aceitar').click()
    c4.wait_for(state='detached')
    check('Repetir depois da falha grava uma vez só', len([n for n in notas('Cliente UI Quatro') if 'Sugestão aceita' in n]) == 1)

    # ---------------- Gaveta da oportunidade ----------------
    page.locator('.view-toggle button', has_text='Kanban').click() if page.locator('.view-toggle button', has_text='Kanban').count() else None
    page.wait_for_selector('.lead-card')
    page.locator('.lead-card', has_text='Cliente UI Cinco').first.click()
    drawer = page.locator('.drawer')
    drawer.locator('[data-testid="sugestoes"]').wait_for()
    check('Gaveta mostra as sugestões só daquela oportunidade', drawer.locator('[data-testid="sugestao"]').count() == 1 and 'Follow-up da proposta' in drawer.inner_text())
    drawer.get_by_test_id('sug-aceitar').click()
    drawer.locator('[data-testid="opp-origem"]').wait_for()
    resumo = drawer.locator('[data-testid="opp-resumo"]').inner_text()
    check('Resumo da oportunidade mostra origem e horário da ação aceita', 'Origem: Criada a partir de sugestão aceita' in resumo and '09:00' in resumo, resumo)
    page.screenshot(path=f'{SHOTS}/v3-03-gaveta.png')
    drawer.get_by_role('button', name='Fechar').click()

    # ---------------- Registrar envio pela tela de propostas ----------------
    page.locator('.lead-card', has_text='Cliente UI Rascunho').first.click()
    drawer = page.locator('.drawer')
    prop = drawer.locator('[data-testid="secao-propostas"]')
    prop.get_by_test_id('prop-registrar-envio').wait_for()
    check('Rascunho/arquivo anexado não gera sugestão de follow-up (regra A)', drawer.locator('[data-testid="sugestao"][data-regra="A"]').count() == 0)
    prop.get_by_test_id('prop-registrar-envio').click()
    check('Formulário de envio explica o que NÃO conta como envio', 'não' in prop.get_by_test_id('prop-form-envio').inner_text() and 'gerar PDF' in prop.get_by_test_id('prop-form-envio').inner_text())
    prop.get_by_test_id('prop-confirmar-envio').click()
    prop.get_by_text(re.compile('Envio registrado em')).wait_for()
    drawer.locator('[data-testid="sugestao"][data-regra="A"]').first.wait_for(timeout=15000)
    check('Envio explícito registrado → sugestão de follow-up aparece na gaveta', drawer.locator('[data-testid="sugestao"][data-regra="A"]').count() == 1)
    drawer.get_by_role('button', name='Fechar').click()

    # ---------------- Gerencial: visão semanal e configurações ----------------
    page.locator('.view-toggle button', has_text='Gerencial').click()
    page.wait_for_selector('[data-testid="semana-gestor"]')
    semana = page.locator('[data-testid="semana-gestor"]')
    semana.get_by_test_id('semana-semProximaAcao').wait_for()
    semana.get_by_test_id('semana-criterio').wait_for()
    check('Visão semanal traz as seis listas e o critério escrito', all(semana.get_by_test_id(f'semana-{k}').count() == 1 for k in ['semProximaAcao', 'compromissosVencidos', 'propostasSemAvanco', 'compras30', 'compras60', 'passagemPosVenda']) and 'Critério:' in semana.inner_text())
    semana.get_by_test_id('semana-propostasSemAvanco').click()
    check('Critério de propostas sem avanço não afirma ausência de atendimento', 'não prova que não houve atendimento' in semana.get_by_test_id('semana-criterio').inner_text())
    semana.get_by_label('Filtrar visão semanal por responsável').select_option(label='Bruno Teste')
    page.wait_for_timeout(600)
    check('Filtro por responsável na visão semanal', 'Cliente UI Um' not in semana.inner_text())
    page.screenshot(path=f'{SHOTS}/v3-04-gerencial.png')

    cfg = page.locator('[data-testid="automacao-config"]')
    cfg.get_by_label('Regra A').uncheck()
    cfg.get_by_test_id('automacao-salvar').click()
    cfg.get_by_text('Configurações salvas.').wait_for()
    page.locator('.view-toggle button', has_text='Agenda').click()
    page.wait_for_selector('[data-testid="sugestoes"]')
    check('Regra A desligada: sugestões de follow-up somem da Agenda (sem apagar nada)', cartao('Cliente UI Seis').count() == 0 and page.locator('.agenda-row', has_text='Cliente UI Um').count() >= 1)
    page.locator('.view-toggle button', has_text='Gerencial').click()
    cfg = page.locator('[data-testid="automacao-config"]')
    check('Configuração persiste ao reabrir', not cfg.get_by_label('Regra A').is_checked())
    cfg.get_by_label('Regra A').check()
    cfg.get_by_label('Automação ligada').uncheck()
    cfg.get_by_test_id('automacao-salvar').click()
    cfg.get_by_text('Configurações salvas.').wait_for()
    page.locator('.view-toggle button', has_text='Agenda').click()
    page.wait_for_selector('[data-testid="sugestoes-desativadas"]')
    check('Interruptor geral: Agenda informa que está desativada e nada foi apagado', 'desativada' in page.locator('[data-testid="sugestoes-desativadas"]').inner_text() and page.locator('.agenda-row', has_text='Cliente UI Um').count() >= 1)
    page.locator('.view-toggle button', has_text='Gerencial').click()
    cfg = page.locator('[data-testid="automacao-config"]')
    cfg.get_by_label('Automação ligada').check()
    cfg.get_by_test_id('automacao-salvar').click()
    cfg.get_by_text('Configurações salvas.').wait_for()

    # ---------------- Análise prévia: exige responsável ----------------
    mock('/__seed', {'name': 'Cliente UI Antigo', 'cols': {'estagio': 'Fechado', 'pessoas': ['101'], 'dataFechamento': dia(-120), 'empresa': 'Cliente UI Antigo Fict.'}, 'createdOffset': -200})
    page.locator('.view-toggle button', has_text='Agenda').click()
    page.wait_for_selector('[data-testid="sugestoes"]')
    page.locator('.agenda-tracks button', has_text='Pós-venda').click()
    page.get_by_test_id('sug-analise-toggle').click()
    check('Análise prévia só lista depois de escolher um responsável', cartao('Cliente UI Antigo', 'F').count() == 0)
    page.get_by_label('Responsável da análise prévia').select_option(label='Ana Teste')
    cartao('Cliente UI Antigo', 'F').wait_for()
    check('Análise prévia lista o fechado antigo, individualmente (sem ação em massa)', cartao('Cliente UI Antigo', 'F').count() == 1 and 'evento antigo' in cartao('Cliente UI Antigo', 'F').inner_text() and page.get_by_text(re.compile('aceitar todas', re.I)).count() == 0)
    page.screenshot(path=f'{SHOTS}/v3-05-analise-previa.png')

    # ---------------- Não-admin ----------------
    ctxb = contexto(TOKEN_BRUNO)
    pb = ctxb.new_page()
    errb = []
    pb.on('pageerror', lambda e: errb.append(str(e)))
    pb.goto(APP)
    pb.wait_for_selector('.lead-card')
    check('Não-admin não vê a aba Gerencial', pb.locator('.view-toggle button', has_text='Gerencial').count() == 0)
    pb.locator('.view-toggle button', has_text='Agenda').click()
    pb.wait_for_selector('[data-testid="sugestoes"]')
    pb.locator('[data-testid="sugestao"]', has_text='Cliente UI do Bruno').first.wait_for()
    check('Não-admin vê só as sugestões das próprias oportunidades', pb.locator('[data-testid="sugestao"]', has_text='Cliente UI Seis').count() == 0 and pb.locator('[data-testid="sugestao"]', has_text='Cliente UI do Bruno').count() >= 1)
    ctxb.close()

    check('Sem erros inesperados no console/página', not errors, errors[:3])
    browser.close()

print(f"\n{sum(results)}/{len(results)} verificações passaram")
sys.exit(0 if all(results) else 1)
