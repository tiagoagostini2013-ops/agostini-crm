"""Teste de ponta a ponta (navegador real) contra o monday SIMULADO — dados fictícios.

Pré-requisitos (não são dependências do projeto):
  - `npm run build` feito;  - Playwright para Python + Chromium instalados.
Subir antes:  node tests/e2e/mock-monday.mjs 4010   e   tests/e2e/start-app.sh 3100
Rodar:        python3 tests/e2e/run_e2e.py <token-de-sessão> [pasta-de-screenshots]
O token é um cookie de sessão assinado com SESSION_SECRET=segredo-de-teste (ver
README do teste). Nada aqui toca o monday real.
"""
import json, sys, urllib.request, datetime, re
from playwright.sync_api import sync_playwright, expect

TOKEN = sys.argv[1]
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
APP = 'http://localhost:3100'
MOCK = 'http://localhost:4010'

def mock_state():
    return {i['name']: i for i in json.load(urllib.request.urlopen(MOCK + '/__state'))}

def mock_reset():
    urllib.request.urlopen(urllib.request.Request(MOCK + '/__reset', method='POST', data=b'{}'))

def today():
    return (datetime.datetime.utcnow() - datetime.timedelta(hours=3)).date()

def day(offset):
    return (today() + datetime.timedelta(days=offset)).isoformat()

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''))

mock_reset()

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1400, 'height': 1000})
    ctx.add_cookies([{'name': 'agostini_crm_session', 'value': TOKEN, 'url': APP}])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(APP)
    page.wait_for_selector('.lead-card')

    # ---------------- Kanban: alertas por trilha ----------------
    card = lambda name: page.locator('.lead-card', has_text=name)
    check('Perdido com follow-up antigo NÃO mostra alerta de atraso', 'follow-up atrasado' not in card('Épsilon Perdido Antigo').inner_text()
          and 'sem contato' not in card('Épsilon Perdido Antigo').inner_text(), card('Épsilon Perdido Antigo').inner_text())
    check('Fechado com follow-up antigo NÃO mostra alerta de atraso', 'follow-up atrasado' not in card('Theta Fechado Follow-up Antigo').inner_text()
          and 'sem contato' not in card('Theta Fechado Follow-up Antigo').inner_text(), card('Theta Fechado Follow-up Antigo').inner_text())
    check('Perdido com reativação própria mostra o aviso de reativação', 'reativação prevista há 5d' in card('Zeta Perdido').inner_text(), card('Zeta Perdido').inner_text())
    check('Fechado mostra aviso de pós-venda atrasado', 'pós-venda atrasado 3d' in card('Eta Fechado Pós-venda').inner_text(), card('Eta Fechado Pós-venda').inner_text())
    check('Vendas mantém aviso antigo de follow-up atrasado', 'follow-up atrasado 1d' in card('Silo de Teste Alfa').inner_text())
    check('Card mostra a próxima ação concreta', 'Apresentar condições ao decisor' in card('Silo de Teste Alfa').inner_text())
    check('Card incompleto mostra a pendência (sem bloquear)', 'definir: ação concreta, data' in card('Gama Pavimentos').inner_text(), card('Gama Pavimentos').inner_text())

    banner = page.locator('.banner-warning').first.inner_text()
    check('Banner informa o escopo (equipe inteira) e que perdidos não alertam', 'escopo: equipe inteira' in banner and 'Negócios perdidos não geram' in banner, banner)
    badge = page.locator('.view-toggle button', has_text='Agenda').locator('.toggle-badge').inner_text()
    check('Selo da aba = vendas atrasadas(1) + vendas sem data(2) + pós-venda atrasado(1) = 4', badge == '4', badge)
    page.screenshot(path=f'{SHOTS}/01-kanban.png')

    # ---------------- Agenda ----------------
    page.locator('.view-toggle button', has_text='Agenda').click()
    page.wait_for_selector('[data-testid="agenda-escopo"]')
    check('Agenda declara o escopo', 'Escopo: equipe inteira' in page.locator('[data-testid="agenda-escopo"]').inner_text())
    tabs = page.locator('.agenda-tracks button')
    check('Aba Vendas ativas = 3', '3' in tabs.nth(0).inner_text(), tabs.nth(0).inner_text())
    check('Aba Reativação = 1 (vencida)', '1' in tabs.nth(1).inner_text(), tabs.nth(1).inner_text())
    check('Aba Pós-venda = 1', '1' in tabs.nth(2).inner_text(), tabs.nth(2).inner_text())

    prio = page.locator('[data-testid="prioridades-hoje"]')
    check('Prioridades: título de equipe quando sem filtro', 'equipe inteira' in prio.locator('h3').inner_text(), prio.locator('h3').inner_text())
    nomes = [n.strip() for n in prio.locator('.prio-name').all_inner_texts()]
    check('Prioridades: 1º = Silo (vencido + combinado + proposta aberta)', nomes and nomes[0] == 'Silo de Teste Alfa', str(nomes))
    check('Prioridades: pequeno com retorno combinado (Kappa) vem antes do negócio de R$5mi sem compromisso (Iota)',
          'Kappa Pequeno Combinado' in nomes and 'Iota Alto Valor Sem Compromisso' in nomes and nomes.index('Kappa Pequeno Combinado') < nomes.index('Iota Alto Valor Sem Compromisso'), str(nomes))
    check('Prioridades: perdidos e fechados não aparecem', not any(n in nomes for n in ['Épsilon Perdido Antigo', 'Zeta Perdido Reativar', 'Eta Fechado Pós-venda']), str(nomes))
    check('Prioridades: lead novo sem contato com SLA vencido entra', 'Delta Lead Novo Teste' in nomes, str(nomes))
    check('Prioridades: lead calmo (Gama) não entra', 'Gama Pavimentos Teste' not in nomes, str(nomes))
    silo = prio.locator('.prio-card', has_text='Silo de Teste Alfa').inner_text()
    check('Motivos do Silo exibidos', 'Combinado com o cliente' in silo and 'abriu a proposta' in silo and 'Próxima ação vencida há 1 dia' in silo, silo)
    beta = prio.locator('.prio-card', has_text='Moldes Beta Teste').inner_text()
    check('Campo ausente aparece como "não informado" (prazo), sem inventar', 'Não informado: Prazo de compra' in beta, beta)
    delta = prio.locator('.prio-card', has_text='Delta Lead Novo Teste').inner_text()
    check('Valor ausente aparece como "valor não informado"', 'valor não informado' in delta and 'Falta definir a próxima ação' in delta, delta)
    page.screenshot(path=f'{SHOTS}/02-agenda-prioridades.png', full_page=True)

    # reativação / pós-venda
    tabs.nth(1).click()
    txt = page.locator('.agenda-view').inner_text()
    check('Reativação lista Zeta como prevista', 'Zeta Perdido Reativar' in txt)
    check('Reativação não lista nada de vendas', 'Silo de Teste Alfa' not in txt)
    check('Agendamento antigo de perdido fica numa seção informativa (recolhida), preservado', 'agendamento comercial antigo (perdidos) — sem alertas' in txt.lower() and 'Épsilon' not in txt)
    page.get_by_role('button', name=re.compile('Expandir grupo Agendamento comercial antigo')).click()
    check('Ao expandir, o follow-up antigo aparece com a data original', 'follow-up antigo:' in page.locator('.agenda-view').inner_text() and 'Épsilon Perdido Antigo' in page.locator('.agenda-view').inner_text())
    page.screenshot(path=f'{SHOTS}/03-agenda-reativacao.png', full_page=True)
    tabs.nth(2).click()
    txt = page.locator('.agenda-view').inner_text()
    check('Pós-venda lista Eta atrasado e não lista o fechado só com follow-up antigo', 'Eta Fechado Pós-venda' in txt and 'Theta' not in txt)

    # ---------------- Filtro por usuário: contadores e listas no mesmo escopo ----------------
    page.locator('.filters select').first.select_option(label='Bruno Teste')
    page.wait_for_timeout(300)
    check('Escopo muda para o usuário', 'Escopo: Bruno Teste' in page.locator('[data-testid="agenda-escopo"]').inner_text())
    badge = page.locator('.view-toggle button', has_text='Agenda').locator('.toggle-badge')
    badge_txt = badge.inner_text() if badge.count() else '0'
    check('Selo respeita o filtro (Bruno: só pós-venda atrasado = 1)', badge_txt == '1', badge_txt)
    tabs.nth(0).click()
    check('Aba Vendas respeita o filtro (Bruno tem 0 alertas de vendas)', tabs.nth(0).inner_text().strip().endswith('0'), tabs.nth(0).inner_text())
    nomes = [n.strip() for n in page.locator('[data-testid="prioridades-hoje"] .prio-name').all_inner_texts()]
    check('Prioridades do Bruno só têm leads do Bruno', set(nomes) <= {'Moldes Beta Teste', 'Kappa Pequeno Combinado'} and len(nomes) == 2, str(nomes))
    check('Título cita o usuário filtrado', 'Prioridades de hoje — Bruno Teste' in page.locator('[data-testid="prioridades-hoje"] h3').inner_text())
    page.locator('.filters select').first.select_option(label='Todos os responsáveis')
    page.get_by_role('button', name='Ver só as minhas').click()
    page.wait_for_timeout(300)
    check('"Ver só as minhas" aplica o filtro e muda o título', 'Minhas prioridades de hoje' in page.locator('[data-testid="prioridades-hoje"] h3').inner_text()
          and 'Escopo: Ana Teste' in page.locator('[data-testid="agenda-escopo"]').inner_text())
    page.screenshot(path=f'{SHOTS}/04-minhas-prioridades.png', full_page=True)
    page.get_by_role('button', name='Ver equipe inteira').click()

    # ---------------- Registrar atividade: contato efetivo ----------------
    prio = page.locator('[data-testid="prioridades-hoje"]')
    prio.locator('.prio-card', has_text='Moldes Beta Teste').get_by_role('button', name=re.compile('Registrar atividade')).click()
    modal = page.get_by_role('dialog', name='Registrar atividade realizada')
    modal.get_by_label('Canal da atividade').select_option(label='WhatsApp')
    modal.get_by_label('Resultado da atividade').fill('Cliente confirmou o financiamento aprovado.')
    check('Botão fica desabilitado sem informar se houve contato efetivo', modal.get_by_role('button', name='Registrar atividade').is_disabled())
    modal.get_by_label('Sim — falei com o cliente').check()
    modal.get_by_label('Próximo passo', exact=True).fill('Confirmar dimensões das placas')
    modal.get_by_label('Responsável pelo próximo passo').select_option(label='Ana Teste')
    modal.get_by_label('Data do próximo passo').fill(day(3))
    page.screenshot(path=f'{SHOTS}/05-modal-atividade.png')
    modal.get_by_role('button', name='Registrar atividade').click()
    page.wait_for_selector('[role="dialog"]', state='detached')
    st = mock_state()['Moldes Beta Teste']
    plano = json.loads(st['cols']['planoAcao'])
    check('Atividade com contato efetivo carimba Último contato (hoje)', st['cols'].get('ultimoContato') == day(0), str(st['cols'].get('ultimoContato')))
    check('Próximo passo gravado (ação, responsável, rev+1)', plano['vendas']['acao'] == 'Confirmar dimensões das placas' and plano['vendas']['responsavelId'] == '101' and plano['vendas']['rev'] == 2, str(plano))
    check('Data do próximo follow-up atualizada', st['cols'].get('proximoFollowUp') == day(3), str(st['cols'].get('proximoFollowUp')))
    check('Resultado guardado no plano', plano['ultimoResultado']['contatoRealizado'] is True and 'financiamento' in plano['ultimoResultado']['resumo'])
    check('Histórico registrado como atualização no monday', any('Atividade registrada por Ana Teste' in u['text'] and 'Cliente confirmou' in u['text'] for u in st['updates']), str(st['updates']))
    check('Primeiro contato carimbado só se vazio (já havia último contato, não deve mudar)', st['cols'].get('dataPrimeiroContato') in (None, day(0)))
    check('Lead sai das prioridades de hoje (follow-up agora em 3 dias)', 'Moldes Beta Teste' not in [n.strip() for n in page.locator('[data-testid="prioridades-hoje"] .prio-name').all_inner_texts()])

    # ---------------- Tentativa sem resposta NÃO conta como contato ----------------
    mock_before = mock_state()['Delta Lead Novo Teste']
    page.locator('[data-testid="prioridades-hoje"] .prio-card', has_text='Delta Lead Novo Teste').get_by_role('button', name=re.compile('Registrar atividade')).click()
    modal = page.get_by_role('dialog', name='Registrar atividade realizada')
    modal.get_by_label('Canal da atividade').select_option(label='Ligação')
    modal.get_by_label('Não — tentativa sem resposta').check()
    modal.get_by_label('Resultado da atividade').fill('Liguei duas vezes, caixa postal.')
    modal.get_by_label('Próximo passo', exact=True).fill('Tentar WhatsApp amanhã')
    modal.get_by_label('Data do próximo passo').fill(day(1))
    modal.get_by_role('button', name='Registrar atividade').click()
    page.wait_for_selector('[role="dialog"]', state='detached')
    st = mock_state()['Delta Lead Novo Teste']
    plano = json.loads(st['cols']['planoAcao'])
    check('Tentativa sem resposta NÃO carimba Último contato', st['cols'].get('ultimoContato') is None and st['cols'].get('dataPrimeiroContato') is None, str(st['cols']))
    check('Tentativa fica registrada (contatoRealizado=false) e no histórico', plano['ultimoResultado']['contatoRealizado'] is False and any('Contato efetivo com o cliente: não' in u['text'] for u in st['updates']))

    # ---------------- Atividade interna: nunca é contato ----------------
    page.get_by_role('button', name=re.compile('Ver todas')).click() if page.get_by_role('button', name=re.compile('Ver todas')).count() else None
    page.locator('.agenda-view .view-toggle').count()
    page.goto(APP); page.wait_for_selector('.lead-card')
    card('Gama Pavimentos').click()
    page.wait_for_selector('[data-testid="secao-proxima-acao"]')
    drawer = page.locator('.drawer')
    check('Drawer: pendência de registro incompleto visível, sem bloquear consulta', 'falta ação concreta, data' in drawer.locator('[data-testid="pendencia-acao"]').inner_text())
    check('Resumo de qualificação mostra campos ausentes como "não informado"', 'não informada' in drawer.locator('[data-testid="resumo-qualificacao"]').inner_text() and 'não informado' in drawer.locator('[data-testid="resumo-qualificacao"]').inner_text())
    drawer.get_by_role('button', name=re.compile('Registrar atividade realizada')).click()
    modal = page.get_by_role('dialog', name='Registrar atividade realizada')
    modal.get_by_label('Canal da atividade').select_option(label='Interno (sem contato com o cliente)')
    check('Canal interno desabilita a pergunta de contato efetivo', 'Atividade interna não conta como contato' in modal.inner_text())
    modal.get_by_label('Resultado da atividade').fill('Revisei o histórico; falta confirmar necessidade.')
    check('Aviso de registro incompleto ao não definir próximo passo', 'registro incompleto' in modal.inner_text())
    modal.get_by_role('button', name='Registrar atividade').click()
    page.wait_for_selector('[role="dialog"]', state='detached')
    st = mock_state()['Gama Pavimentos Teste']
    check('Atividade interna NÃO altera Último contato', st['cols'].get('ultimoContato') == day(-10), str(st['cols'].get('ultimoContato')))
    page.wait_for_timeout(500)
    notes_txt = drawer.locator('.notes-list').inner_text()
    check('Histórico recarregado no drawer após registrar', 'Atividade registrada por Ana Teste' in notes_txt, notes_txt[:200])

    # ---------------- Próxima ação pelo drawer + qualificação ----------------
    drawer.get_by_label('Ação concreta').fill('Confirmar dimensões das placas')
    drawer.get_by_label('Responsável pela ação').select_option(label='Carla Teste')
    drawer.get_by_label('Data da ação').fill(day(2))
    drawer.get_by_role('checkbox', name=re.compile('Combinado com o cliente')).check()
    drawer.get_by_role('button', name='Salvar próxima ação').click()
    page.wait_for_selector('text=Próxima ação salva')
    st = mock_state()['Gama Pavimentos Teste']
    plano = json.loads(st['cols']['planoAcao'])
    check('Próxima ação salva: ação, responsável, combinado e data nativa', plano['vendas']['acao'] == 'Confirmar dimensões das placas' and plano['vendas']['responsavelId'] == '103' and plano['vendas']['compromissoCliente'] is True and st['cols']['proximoFollowUp'] == day(2), str(plano))
    check('Editar a próxima ação NÃO conta como contato', st['cols'].get('ultimoContato') == day(-10))
    check('Pendência some depois de completar', drawer.locator('[data-testid="pendencia-acao"]').count() == 0)
    # qualificação nova: prazo + impedimento, salvando pelo botão de sempre
    drawer.get_by_label('Prazo previsto de compra').fill(day(45))
    drawer.get_by_label('Principal impedimento').fill('Aguardando financiamento')
    drawer.get_by_role('button', name='Salvar alterações').click()
    page.wait_for_timeout(700)
    st = mock_state()['Gama Pavimentos Teste']
    check('Prazo de compra e impedimento gravados em colunas próprias (follow-up intacto)', st['cols'].get('prazoCompra') == day(45) and st['cols'].get('principalImpedimento') == 'Aguardando financiamento' and st['cols']['proximoFollowUp'] == day(2), str(st['cols']))
    page.screenshot(path=f'{SHOTS}/06-drawer.png', full_page=True)
    page.locator('.drawer .close').click()
    cg = card('Gama Pavimentos').inner_text()
    check('Cartão mostra resumo: impedimento, prazo e próxima ação', 'Aguardando financiamento' in cg and 'compra' in cg and 'Confirmar dimensões das placas' in cg, cg)

    # ---------------- Anotação interna x contato ----------------
    card('Kappa Pequeno').click()
    page.wait_for_selector('[data-testid="secao-proxima-acao"]')
    before = mock_state()['Kappa Pequeno Combinado']['cols'].get('ultimoContato')
    drawer.locator('.note-textarea').fill('Lembrete interno: revisar condição com o Tiago.')
    drawer.get_by_role('checkbox', name=re.compile('Foi um contato com o cliente')).uncheck()
    drawer.get_by_role('button', name='Adicionar anotação').click()
    page.wait_for_timeout(700)
    st = mock_state()['Kappa Pequeno Combinado']
    check('Anotação interna não altera Último contato', st['cols'].get('ultimoContato') == before, f"{before} -> {st['cols'].get('ultimoContato')}")
    check('Anotação interna fica identificada no histórico', any('(anotação interna)' in u['text'] for u in st['updates']))
    drawer.locator('.note-textarea').fill('Falei com o cliente por telefone.')
    drawer.get_by_role('checkbox', name=re.compile('Foi um contato com o cliente')).check()
    drawer.get_by_role('button', name='Adicionar anotação').click()
    page.wait_for_timeout(700)
    check('Anotação marcada como contato carimba Último contato (comportamento mantido)', mock_state()['Kappa Pequeno Combinado']['cols'].get('ultimoContato') == day(0))
    page.locator('.drawer .close').click()

    # ---------------- Perdido: agendamento antigo preservado + reativação própria ----------------
    card('Épsilon Perdido').click()
    page.wait_for_selector('[data-testid="secao-proxima-acao"]')
    check('Perdido: drawer mostra o agendamento antigo preservado', drawer.locator('[data-testid="followup-antigo"]').count() == 1)
    fu_before = mock_state()['Épsilon Perdido Antigo']['cols']['proximoFollowUp']
    drawer.get_by_role('button', name='Usar como data desta trilha').click()
    drawer.get_by_label('Ação concreta').fill('Retomar contato após fechamento do trimestre')
    drawer.get_by_role('button', name='Salvar próxima ação').click()
    page.wait_for_selector('text=Próxima ação salva')
    st = mock_state()['Épsilon Perdido Antigo']
    plano = json.loads(st['cols']['planoAcao'])
    check('Reativação gravada em coluna PRÓPRIA; follow-up comercial antigo NÃO foi apagado', st['cols']['dataReativacao'] == fu_before and st['cols']['proximoFollowUp'] == fu_before and plano['reativacao']['acao'].startswith('Retomar'), str(st['cols']))
    page.locator('.drawer .close').click()

    # ---------------- Conflito de edição ----------------
    card('Silo de Teste Alfa').click()
    page.wait_for_selector('[data-testid="secao-proxima-acao"]')
    # outra pessoa salva a mesma trilha enquanto o drawer está aberto
    req = urllib.request.Request(APP + '/api/items/1001/proxima-acao', method='PUT', headers={'Content-Type': 'application/json', 'Cookie': 'agostini_crm_session=' + TOKEN},
                                 data=json.dumps({'trilha': 'vendas', 'acao': 'Mudança feita por outra pessoa', 'responsavelId': '102', 'data': day(5), 'expectedRev': 2, 'autor': 'Bruno Teste'}).encode())
    urllib.request.urlopen(req)
    drawer.get_by_label('Ação concreta').fill('Minha edição concorrente')
    drawer.get_by_role('button', name='Salvar próxima ação').click()
    page.wait_for_selector('text=Outra pessoa alterou esta ação')
    st = mock_state()['Silo de Teste Alfa']
    check('Conflito: edição da outra pessoa NÃO foi sobrescrita', json.loads(st['cols']['planoAcao'])['vendas']['acao'] == 'Mudança feita por outra pessoa')
    check('Conflito: UI oferece o valor atual', 'Usar o valor atual' in drawer.inner_text() and 'Mudança feita por outra pessoa' in drawer.inner_text())
    page.screenshot(path=f'{SHOTS}/07-conflito.png', full_page=True)
    page.locator('.drawer .close').click()

    erros_reais = [e for e in errors if '409' not in str(e)]  # o 409 é o conflito provocado de propósito
    check('Sem erros de JavaScript no navegador (exceto o 409 provocado)', not erros_reais, str(erros_reais[:3]))
    browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} verificações passaram')
sys.exit(1 if fails else 0)
