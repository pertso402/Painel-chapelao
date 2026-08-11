/* ═══════════════════════════════════════════════════
   RESTAURANTE CHAPELÃO — PAINEL DE PEDIDOS
═══════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://qlswjefuinhbtlhauhgj.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsc3dqZWZ1aW5oYnRsaGF1aGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTA5NDIsImV4cCI6MjA5Njg4Njk0Mn0.szmmoTuCHdhLP2jp-oY8ZBTaJLFqj-KBWYyQhGQqCBY'

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

const FLUXO_STATUS = ['pendente', 'preparando', 'pronto', 'saiu_entrega', 'entregue']

const P = {
  pedidos: [],
  alertas: [],
  taxas: [],
  tabAtiva: 'pendente',
  lojaAberta: true,
  midiaBuffet: null,
  cardapioHoje: false
}

/* ─── INIT PAINEL ───────────────────────────────── */
async function iniciarPainel() {
  await carregarPedidos()
  await carregarLojaStatus()
  await carregarMidiaBuffet()
  await carregarStatusCardapio()
  await carregarAlertas()
  await carregarTaxas()
  subscribeRealtime()

  // O contador de 5 minutos precisa andar sozinho na tela: quem está com o
  // painel aberto tem que ver o tempo diminuindo, não um número congelado.
  setInterval(carregarTaxas, 15_000)

  // O agente abre a loja sozinho às 11h e fecha depois das 14h. Sem esta
  // releitura, o painel ficaria a tarde inteira mostrando "Aberta" enquanto o
  // WhatsApp já estaria respondendo que está fechado — e ninguém entenderia
  // por quê. 60s é frequente o bastante e custa uma consulta minúscula.
  setInterval(carregarLojaStatus, 60_000)
}

async function carregarLojaStatus() {
  const { data } = await sb.from('info_restaurante')
    .select('valor').eq('chave', 'loja_aberta').maybeSingle()
  P.lojaAberta = data?.valor !== 'false'
  atualizarToggleLoja()
}

/* ─── CARREGAR PEDIDOS ──────────────────────────── */
async function carregarPedidos() {
  // Janela ampla (60 dias) para nunca esconder pedido ativo por virada de dia/fuso.
  // As abas separam por status; o resumo "do dia" é calculado à parte (hoje local).
  const desde = new Date(Date.now() - 60 * 864e5).toISOString()

  const { data } = await sb
    .from('pedidos')
    .select(`
      id, numero_pedido, status, tipo_entrega, endereco_entrega,
      forma_pagamento, troco_para, subtotal, taxa_entrega, desconto, total, observacao, canal,
      created_at, updated_at,
      clientes ( id, nome, telefone ),
      itens_pedido ( nome_produto, quantidade, preco_unitario, total, observacao )
    `)
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(400)

  P.pedidos = data || []
  renderPedidos()
  atualizarBadges()
  atualizarResumo()
}

/* ─── REALTIME ──────────────────────────────────── */
function subscribeRealtime() {
  sb.channel('painel-live')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'pedidos'
    }, async payload => {
      tocaSom()
      await carregarPedidos()
      notificar(`🔔 Novo pedido #${payload.new.numero_pedido}!`)
    })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'pedidos'
    }, async () => {
      await carregarPedidos()
    })
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'atendimento_alertas'
    }, async payload => {
      const ehTaxa = String(payload.new.motivo || '').startsWith('TAXA DE ENTREGA:')
      // Taxa tem alarme próprio, disparado por carregarTaxas — tocar os dois
      // ao mesmo tempo vira barulho indistinguível.
      if (!ehTaxa) tocaSomAlerta()
      await carregarAlertas()
      await carregarTaxas()
      notificar(ehTaxa
        ? `🚴 Calcular entrega de ${payload.new.nome_cliente || 'um cliente'} — 5 min`
        : `🆘 ${payload.new.nome_cliente || 'Cliente'} precisa de ajuda!`)
    })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'atendimento_alertas'
    }, async () => {
      await carregarAlertas()
    })
    .subscribe()
}

/* ─── ÁUDIO ─────────────────────────────────────────
   O navegador só deixa tocar som depois que alguém clicou em alguma coisa na
   página (política de autoplay). Num painel que fica aberto o dia inteiro numa
   TV ou num PC do balcão, isso significa alarme mudo sem ninguém perceber —
   por isso o contexto é criado uma vez, destravado no primeiro clique/tecla, e
   o painel AVISA na tela enquanto o som estiver bloqueado. */
let audioCtx = null
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

function destravarAudio() {
  getAudio()
  atualizarAvisoDeSom()
}
document.addEventListener('click', destravarAudio)
document.addEventListener('keydown', destravarAudio)

function somDestravado() {
  return !!audioCtx && audioCtx.state === 'running'
}

function atualizarAvisoDeSom() {
  const el = document.getElementById('aviso-som')
  if (!el) return
  // Só cobra o clique quando existe alarme tocando: fora disso é ruído visual.
  el.style.display = (!somDestravado() && P.taxas?.length) ? 'block' : 'none'
}

/* Bipe genérico: um oscilador, uma frequência, uma duração. */
function bipe(freq, inicio, duracao, volume = 0.3, tipo = 'sine') {
  const ctx = getAudio()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = tipo
  osc.frequency.setValueAtTime(freq, ctx.currentTime + inicio)
  gain.gain.setValueAtTime(volume, ctx.currentTime + inicio)
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + inicio + duracao)
  osc.start(ctx.currentTime + inicio)
  osc.stop(ctx.currentTime + inicio + duracao)
}

/* Som da taxa de entrega: sirene de dois tons, alta e insistente. É o único
   alarme do painel que cobra uma AÇÃO com prazo (5 minutos), então precisa
   soar diferente de pedido novo e de pedido de socorro — quem está na cozinha
   tem que saber o que fazer só de ouvir, sem olhar a tela. */
function tocaSomTaxa() {
  try {
    for (let i = 0; i < 4; i++) {
      bipe(988, i * 0.34, 0.16, 0.35, 'triangle')  // si
      bipe(1319, i * 0.34 + 0.17, 0.16, 0.35, 'triangle')  // mi agudo
    }
  } catch (e) {}
}

/* Enquanto houver taxa esperando, o alarme REPETE. Tocar uma vez só não
   resolve: a atendente pode estar servindo o buffet quando o pedido chega, e
   o cliente fica esperando o valor da entrega. Para sozinho quando a fila
   zera — ninguém precisa "desligar o alarme". */
let alarmeTaxaTimer = null
function sincronizarAlarmeDeTaxa() {
  const temFila = !!P.taxas?.length

  if (temFila && !alarmeTaxaTimer) {
    tocaSomTaxa()
    alarmeTaxaTimer = setInterval(tocaSomTaxa, 20_000)
  } else if (!temFila && alarmeTaxaTimer) {
    clearInterval(alarmeTaxaTimer)
    alarmeTaxaTimer = null
  }
  atualizarAvisoDeSom()
}

function tocaSom() {
  try {
    const ctx = getAudio()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch (e) {}
}

/* Som de alerta de atendimento — diferente do som de pedido novo (3 bips
   agudos em vez de 1 sequência curta), pra ninguém confundir os dois. */
function tocaSomAlerta() {
  try {
    const ctx = getAudio()
    const tempos = [0, 0.28, 0.56]
    tempos.forEach(t => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(1400, ctx.currentTime + t)
      gain.gain.setValueAtTime(0.25, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + t + 0.2)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.2)
    })
  } catch (e) {}
}

function notificar(msg) {
  if (Notification.permission === 'granted') {
    new Notification('Chapelão Pedidos', { body: msg, icon: '🎩' })
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission()
  }
}

/* ─── TABS ──────────────────────────────────────── */
function selecionarTab(status, btn) {
  P.tabAtiva = status
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  renderPedidos()
}

/* ─── RENDER PEDIDOS ────────────────────────────── */
function renderPedidos() {
  const filtrados = P.pedidos.filter(p => normStatus(p.status) === P.tabAtiva)
  const grid = document.getElementById('pedidos-grid')
  const vazio = document.getElementById('pedidos-vazio')
  const loading = document.getElementById('loading-pedidos')

  loading.style.display = 'none'

  if (filtrados.length === 0) {
    grid.style.display = 'none'
    vazio.style.display = 'flex'
    return
  }

  vazio.style.display = 'none'
  grid.style.display = 'grid'
  grid.innerHTML = filtrados.map(p => cardPedido(p)).join('')
}

function cardPedido(p) {
  const cliente = p.clientes
  const itens = p.itens_pedido || []
  const mins = Math.floor((Date.now() - new Date(p.created_at)) / 60000)
  const tempo = mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h${mins % 60}m`
  const status = p.status?.toLowerCase() || 'pendente'
  const cls = statusClass(status)

  // Urgência: pedidos ativos parados há 20min+ piscam em vermelho
  const ativo = cls === 'novo' || cls === 'preparando'
  const urgente = ativo && mins >= 20 ? ' urgente' : ''

  const itensTexto = itens.map(i => `<b>${i.quantidade}x</b> ${i.nome_produto}`).join(' · ')
  const pgto = p.forma_pagamento?.toLowerCase() || ''
  const tipo = p.tipo_entrega?.toLowerCase() || ''

  const acoes = botoesAcao(p)

  // Dinheiro é o único caso em que o entregador precisa sair com troco no
  // bolso. Fica em destaque no card pra ninguém descobrir na porta do cliente.
  const troco = (pgto === 'dinheiro' && Number(p.troco_para) > 0)
    ? `<div class="pc-troco">💵 Troco para R$ ${fmt(p.troco_para)} · levar R$ ${fmt(Number(p.troco_para) - Number(p.total))}</div>`
    : (pgto === 'dinheiro' ? `<div class="pc-troco">💵 Dinheiro · sem troco anotado</div>` : '')

  return `
    <div class="pedido-card ${cls}" data-pedido-id="${p.id}" onclick="abrirDetalhes('${p.id}')">
      <div class="pc-header">
        <span class="pc-numero">#${p.numero_pedido}</span>
        <span class="pc-tempo${urgente}">⏱ ${tempo}</span>
      </div>
      <span class="pc-status-pill">${statusLabel(status)}</span>
      <div class="pc-cliente">👤 ${cliente?.nome || 'Cliente'}</div>
      <div class="pc-info">
        <span class="pc-badge ${tipo === 'delivery' ? 'delivery' : ''}">${tipo === 'delivery' ? '🛵 Delivery' : '🏃 Retirada'}</span>
        <span class="pc-badge ${pgto === 'pix' ? 'pix' : ''}">${pgtoLabel(pgto)}</span>
        <span class="pc-badge">${canalLabel(p.canal)}</span>
      </div>
      ${troco}
      <div class="pc-itens">${itensTexto || '—'}</div>
      <div class="pc-total">R$ ${fmt(p.total)}</div>
      <div class="pc-actions" onclick="event.stopPropagation()">
        ${acoes}
      </div>
    </div>`
}

// Rótulo do canal de origem do pedido — pra medir depois de onde vem cada
// venda (anúncio, recompra, whatsapp orgânico, instagram, balcão).
function canalLabel(c) {
  switch ((c || '').toLowerCase()) {
    case 'whatsapp_anuncio':   return '📢 Anúncio'
    case 'recompra':           return '🔁 Recompra'
    case 'whatsapp_organico':  return '💬 WhatsApp'
    case 'instagram':          return '📸 Instagram'
    case 'balcao':             return '🏠 Balcão'
    case 'painel':             return '🏠 Balcão'  // valor antigo, antes do canal ser escolhido
    default:                   return c || '—'
  }
}

function statusLabel(s) {
  const t = (s || '').toLowerCase()
  if (/cancel/.test(t)) return 'Cancelado'
  if (/entreg/.test(t)) return 'Finalizado'
  if (/saiu/.test(t)) return 'Saiu p/ entrega'
  if (/pronto/.test(t)) return 'Pronto'
  if (/aguardando_prepar/.test(t)) return 'Pago · preparar'  // PIX confirmado
  if (/confirm/.test(t)) return 'Confirmado'
  if (/pend/.test(t)) return 'Novo pedido'
  if (/prepar/.test(t)) return 'Preparando'
  return s
}

/* Normaliza QUALQUER status do banco para uma das abas.
   IMPORTANTE: checar 'aguardando_preparo' antes de 'prepar' (ele contém "preparo"). */
function normStatus(s) {
  const t = (s || '').toLowerCase()
  if (/cancel/.test(t)) return 'cancelado'
  if (/entreg/.test(t)) return 'entregue'
  if (/pronto|saiu/.test(t)) return 'pronto'
  if (/aguard|pend|confirm/.test(t)) return 'pendente'  // novos: pendente, confirmado, aguardando_preparo
  if (/prepar/.test(t)) return 'preparando'
  return t
}

function statusClass(s) {
  const n = normStatus(s)
  return n === 'pendente' ? 'novo' : n
}

function pgtoLabel(p) {
  if (/pix/i.test(p)) return '💸 PIX'
  if (/dinheiro/i.test(p)) return '💵 Dinheiro'
  if (/cart/i.test(p)) return '💳 Cartão'
  return p || '—'
}

function botoesAcao(p) {
  const s = p.status?.toLowerCase() || ''
  const id = p.id
  let html = ''

  if (/pend/i.test(s)) {
    html += `<button class="btn-status confirmar" onclick="mudarStatus('${id}','preparando')">✓ Confirmar</button>`
    html += `<button class="btn-status cancelar" onclick="mudarStatus('${id}','cancelado')">✕ Cancelar</button>`
  } else if (/prepar/i.test(s)) {
    html += `<button class="btn-status confirmar" onclick="mudarStatus('${id}','pronto')">✓ Pronto</button>`
  } else if (/pronto/i.test(s)) {
    html += `<button class="btn-status confirmar" onclick="mudarStatus('${id}','saiu_entrega')">🛵 Saiu</button>`
    html += `<button class="btn-status confirmar" onclick="mudarStatus('${id}','entregue')">✓ Entregue</button>`
  } else if (/saiu/i.test(s)) {
    html += `<button class="btn-status confirmar" onclick="mudarStatus('${id}','entregue')">✓ Entregue</button>`
  }

  html += `<button class="btn-status imprimir" onclick="imprimirPedido('${id}')">🖨️</button>`
  return html
}

/* ─── MUDAR STATUS ──────────────────────────────── */
// Antes esta função ignorava o retorno do Supabase por completo. Quando o
// UPDATE falhava (era o caso: um trigger de notificação abortava a transação),
// a tela simplesmente recarregava e o pedido continuava onde estava — sem
// erro, sem aviso, sem nada. A pessoa clicava "Confirmar" de novo achando que
// não tinha pegado o clique.
//
// Agora: `.select()` faz o UPDATE devolver as linhas afetadas. Zero linha =
// falhou, e isso vira um aviso na tela em vez de silêncio.
async function mudarStatus(id, novoStatus) {
  const botoes = document.querySelectorAll(`[data-pedido-id="${id}"] .btn-status`)
  botoes.forEach(b => { b.disabled = true; b.style.opacity = '.5' })

  try {
    const { data, error } = await sb
      .from('pedidos')
      .update({ status: novoStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status')

    if (error) throw error
    if (!data || !data.length) {
      throw new Error('O banco não confirmou a alteração (nenhuma linha atualizada).')
    }

    await carregarPedidos()
  } catch (e) {
    console.error('Falha ao mudar status', e)
    avisar(`❌ Não consegui mudar o pedido para "${statusLabel(novoStatus)}".\n\n${e.message || e}\n\nTente de novo. Se continuar, avise o suporte.`, 'erro')
    botoes.forEach(b => { b.disabled = false; b.style.opacity = '1' })
  }
}

/* Aviso visual não-bloqueante (o alert() nativo trava a cozinha inteira até
   alguém clicar OK). Some sozinho, mas fica 8s se for erro. */
function avisar(msg, tipo = 'ok') {
  let el = document.getElementById('toast-painel')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast-painel'
    document.body.appendChild(el)
  }
  el.className = `toast-painel ${tipo}`
  el.textContent = msg
  el.style.display = 'block'
  clearTimeout(el._timer)
  el._timer = setTimeout(() => { el.style.display = 'none' }, tipo === 'erro' ? 8000 : 3500)
}

/* ─── ALERTAS DE ATENDIMENTO HUMANO ─────────────── */
async function carregarAlertas() {
  const { data } = await sb
    .from('atendimento_alertas')
    .select('id, telefone, nome_cliente, motivo, criado_em')
    .eq('status', 'aberto')
    .order('criado_em', { ascending: false })

  // Pedido de cálculo de taxa tem banner próprio, com campo de valor. Se
  // aparecesse aqui viria com botão "Resolver" e a frase "atendimento pausado",
  // que é falsa nesse caso — o agente segue conversando enquanto a taxa sai.
  P.alertas = (data || []).filter(a => !String(a.motivo || '').startsWith('TAXA DE ENTREGA:'))
  renderAlertas()
  atualizarTituloAba()
}

/* ─── TAXA DE ENTREGA A CALCULAR ────────────────────
   Cada endereço custa um valor diferente, calculado à mão numa plataforma
   externa — qual delas depende da forma de pagamento (PIX vai pelo iFood, que
   chega mais rápido; dinheiro/cartão vai por outra). Por isso o card mostra a
   forma de pagamento junto do endereço: sem ela não dá pra cotar.

   O relógio importa: se ninguém digitar em 5 minutos, o agente assume o valor
   padrão e avisa o cliente sozinho, pra ninguém ficar esperando no vácuo.

   A leitura e a escrita passam por RPC (taxas_pendentes / definir_taxa_entrega)
   porque a chave deste painel é pública: abrir pedido_rascunho exporia endereço
   e telefone de todo mundo em atendimento para qualquer um. */
const TAXA_TIMEOUT_MIN = 5

async function carregarTaxas() {
  const { data, error } = await sb.rpc('taxas_pendentes')
  if (error) { console.error('taxas_pendentes', error); return }
  P.taxas = data || []
  renderTaxas()
  sincronizarAlarmeDeTaxa()
}

function renderTaxas() {
  const banner = document.getElementById('taxas-banner')
  if (!banner) return
  if (!P.taxas?.length) {
    banner.style.display = 'none'
    banner.innerHTML = ''
    return
  }

  banner.style.display = 'flex'
  banner.innerHTML = P.taxas.map(t => {
    const segs = Math.floor((Date.now() - new Date(t.solicitada_em)) / 1000)
    const restam = TAXA_TIMEOUT_MIN * 60 - segs
    const prazo = restam > 0
      ? `⏱ ${Math.floor(restam / 60)}min${String(restam % 60).padStart(2, '0')}s para responder`
      : '⚠️ prazo estourado — o agente já mandou o valor padrão'
    const tel = String(t.telefone).replace(/\D/g, '')
    return `
      <div class="taxa-card${restam > 0 ? '' : ' estourado'}">
        <span class="alerta-icone">🚴</span>
        <div class="alerta-corpo">
          <div class="alerta-titulo">Calcular entrega — <b>${t.nome_cliente || 'Cliente'}</b> (${t.telefone})</div>
          <div class="alerta-motivo">📍 ${t.endereco || '(sem endereço)'}</div>
          <div class="alerta-motivo">💳 Pagamento: <b>${(t.forma_pagamento || '—').toUpperCase()}</b></div>
          <div class="alerta-tempo">${prazo}</div>
        </div>
        <div class="alerta-acoes">
          <input class="taxa-input" id="taxa-${tel}" type="number" inputmode="decimal"
                 step="0.5" min="0" placeholder="R$" onkeydown="if(event.key==='Enter')definirTaxa('${tel}')">
          <button class="btn-alerta resolver" onclick="definirTaxa('${tel}')">✅ Pronto</button>
        </div>
      </div>`
  }).join('')
}

async function definirTaxa(telefone) {
  const campo = document.getElementById(`taxa-${telefone}`)
  const valor = Number(String(campo?.value || '').replace(',', '.'))

  if (!campo?.value.trim() || !Number.isFinite(valor) || valor < 0) {
    avisar('Digite o valor da entrega (ex: 12,50).', 'erro')
    campo?.focus()
    return
  }

  const { data, error } = await sb.rpc('definir_taxa_entrega', { p_telefone: telefone, p_valor: valor })
  if (error) {
    avisar(`Não consegui salvar a taxa: ${error.message}`, 'erro')
    return
  }
  // 0 linhas = o prazo estourou entre abrir a tela e clicar, e o agente já
  // mandou o valor padrão pro cliente. Mudar agora faria o total contradizer
  // a mensagem que ele já leu — melhor a pessoa resolver no WhatsApp.
  if (!data) {
    avisar('Esse pedido não está mais esperando: o prazo estourou e o valor padrão já foi enviado ao cliente. Fale com ele pelo WhatsApp se precisar ajustar.', 'erro')
    await carregarTaxas()
    return
  }

  avisar('Taxa enviada — o agente já está avisando o cliente. ✅')
  await carregarTaxas()
  await carregarAlertas()
}

function renderAlertas() {
  const banner = document.getElementById('alertas-banner')
  if (!P.alertas.length) {
    banner.style.display = 'none'
    banner.innerHTML = ''
    return
  }

  banner.style.display = 'flex'
  banner.innerHTML = P.alertas.map(a => {
    const mins = Math.floor((Date.now() - new Date(a.criado_em)) / 60000)
    const tempo = mins < 1 ? 'agora mesmo' : mins < 60 ? `há ${mins}min` : `há ${Math.floor(mins / 60)}h${mins % 60}m`
    return `
      <div class="alerta-card">
        <span class="alerta-icone">🆘</span>
        <div class="alerta-corpo">
          <div class="alerta-titulo"><b>${a.nome_cliente || 'Cliente'}</b> (${a.telefone}) precisa de ajuda</div>
          <div class="alerta-motivo">${a.motivo}</div>
          <div class="alerta-tempo">⏱ ${tempo} · atendimento automático pausado</div>
        </div>
        <div class="alerta-acoes">
          <button class="btn-alerta whatsapp" onclick="abrirWhatsApp('${a.telefone}')">💬 WhatsApp</button>
          <button class="btn-alerta resolver" onclick="resolverAlerta('${a.id}','${a.telefone}')">✅ Resolver</button>
        </div>
      </div>`
  }).join('')
}

async function resolverAlerta(id, telefone) {
  await sb.from('atendimento_alertas')
    .update({ status: 'resolvido', resolvido_em: new Date().toISOString() })
    .eq('id', id)
  // Libera o atendimento automático NA HORA, sem esperar o timeout de 1h da pausa.
  await sb.from('agente_pausas').delete().eq('telefone', telefone)
  await carregarAlertas()
}

/* Pisca o título da aba enquanto tem alerta aberto — chama atenção mesmo
   se o painel estiver numa aba de fundo do navegador. */
let tituloOriginal = document.title
let tituloTimer = null
function atualizarTituloAba() {
  if (P.alertas.length && !tituloTimer) {
    tituloTimer = setInterval(() => {
      document.title = document.title === tituloOriginal ? `🆘 (${P.alertas.length}) Precisa de ajuda!` : tituloOriginal
    }, 1000)
  } else if (!P.alertas.length && tituloTimer) {
    clearInterval(tituloTimer)
    tituloTimer = null
    document.title = tituloOriginal
  }
}

/* ─── BADGES & RESUMO ───────────────────────────── */
function atualizarBadges() {
  const tabs = ['pendente', 'preparando', 'pronto', 'entregue', 'cancelado']
  tabs.forEach(tab => {
    const count = P.pedidos.filter(p => normStatus(p.status) === tab).length
    const el = document.getElementById('badge-' + tab)
    if (el) el.textContent = count
  })
}

function atualizarResumo() {
  // Resumo "do dia" = pedidos criados HOJE (horário local), exceto cancelados
  const hojeStr = new Date().toDateString()
  const doDia = P.pedidos.filter(p =>
    new Date(p.created_at).toDateString() === hojeStr && !/cancel/i.test(p.status)
  )
  const total = doDia.reduce((a, p) => a + parseFloat(p.total || 0), 0)
  document.getElementById('qt-pedidos').textContent = doDia.length
  document.getElementById('total-dia').textContent = `R$ ${fmt(total)}`
}

/* ─── DETALHES DO PEDIDO ────────────────────────── */
function abrirDetalhes(id) {
  const p = P.pedidos.find(x => x.id === id)
  if (!p) return

  const cliente = p.clientes
  const itens = p.itens_pedido || []
  const sub = parseFloat(p.subtotal || 0)
  const taxa = parseFloat(p.taxa_entrega || 0)

  const modal = document.getElementById('modal-pedido')
  document.getElementById('modal-pedido-card').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 style="font-size:20px;font-weight:900;color:var(--amarelo)">Pedido #${p.numero_pedido}</h2>
      <button class="btn-sair" onclick="fecharModal()">✕ Fechar</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--text-muted)">
      <span><strong style="color:var(--text)">👤 Cliente:</strong> ${cliente?.nome || '—'}</span>
      <span><strong style="color:var(--text)">📱 WhatsApp:</strong> ${cliente?.telefone || '—'}</span>
      <span><strong style="color:var(--text)">🛵 Entrega:</strong> ${p.tipo_entrega === 'delivery' ? 'Delivery' : 'Retirada'}</span>
      ${p.endereco_entrega ? `<span><strong style="color:var(--text)">📍 Endereço:</strong> ${p.endereco_entrega}</span>` : ''}
      <span><strong style="color:var(--text)">💳 Pagamento:</strong> ${pgtoLabel(p.forma_pagamento)}</span>
      <span><strong style="color:var(--text)">🔖 Canal:</strong> ${canalLabel(p.canal)}</span>
      ${p.troco_para ? `<span><strong style="color:var(--text)">💵 Troco para:</strong> R$ ${fmt(p.troco_para)}</span>` : ''}
      ${p.observacao ? `<span><strong style="color:var(--text)">📝 Obs:</strong> ${p.observacao}</span>` : ''}
    </div>
    <div style="background:var(--bg-card2);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px">
      ${itens.map(i => `
        <div>
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span>${i.quantidade}x ${i.nome_produto}</span>
            <span style="color:var(--amarelo);font-weight:700">R$ ${fmt(i.total)}</span>
          </div>
          ${i.observacao ? `<div style="font-size:11.5px;color:var(--text-muted);padding-left:12px;margin-top:2px">↳ ${i.observacao}</div>` : ''}
        </div>`).join('')}
      <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px;display:flex;flex-direction:column;gap:4px">
        ${taxa > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)"><span>Taxa</span><span>R$ ${fmt(taxa)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800">
          <span>Total</span><span style="color:var(--amarelo)">R$ ${fmt(p.total)}</span>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${botoesAcao(p)}
      ${cliente?.telefone ? `<button class="btn-status" style="background:rgba(74,222,128,.1);border-color:rgba(74,222,128,.3);color:#4ADE80" onclick="abrirWhatsApp('${cliente.telefone}')">💬 WhatsApp</button>` : ''}
    </div>`

  modal.classList.add('open')
}

function fecharModal() {
  document.getElementById('modal-pedido').classList.remove('open')
}

document.getElementById('modal-pedido').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-pedido')) fecharModal()
})

function abrirWhatsApp(tel) {
  const num = tel.replace(/\D/g, '')
  const wpp = num.startsWith('55') ? num : '55' + num
  window.open(`https://wa.me/${wpp}`, '_blank')
}

/* ─── IMPRIMIR ──────────────────────────────────── */
// Largura do rolo da impressora térmica. 80mm é o mais comum em impressoras
// de restaurante (Elgin i9, Bematech, Epson TM-T20); troque pra '58mm' aqui
// se a impressora da cozinha for a bobina estreita.
const LARGURA_PAPEL_TERMICO = '80mm'

function imprimirPedido(id) {
  const p = P.pedidos.find(x => x.id === id)
  if (!p) return

  const cliente = p.clientes
  const itens = p.itens_pedido || []
  const taxa = parseFloat(p.taxa_entrega || 0)

  // Sem emoji no conteúdo impresso: impressoras térmicas com driver ESC/POS
  // simples (texto cru, sem GDI/rasterização) costumam não ter esses
  // glifos e imprimem caractere quebrado ou nada no lugar. Emoji continua
  // só na tela (abrirDetalhes), nunca no que sai no papel.
  // Pagamento é a informação que mais gera problema na porta do cliente, então
  // sai num quadro próprio, em corpo grande — não numa linha perdida no meio.
  // Em dinheiro, o troco a levar já vem CALCULADO: ninguém faz conta de
  // cabeça segurando marmita.
  const pgto = (p.forma_pagamento || '').toLowerCase()
  const rotuloPgto = pgto === 'pix' ? 'PIX' : pgto === 'dinheiro' ? 'DINHEIRO' : pgto === 'cartao' ? 'CARTAO' : (p.forma_pagamento || '-').toUpperCase()
  const trocoPara = Number(p.troco_para || 0)
  const levarTroco = trocoPara > 0 ? trocoPara - Number(p.total) : 0

  let blocoPagamento = `<div class="pgto-box"><div class="pgto-tipo">PAGAMENTO: ${rotuloPgto}</div>`
  if (pgto === 'dinheiro') {
    blocoPagamento += trocoPara > 0
      ? `<div class="pgto-linha">Cliente paga com: R$ ${fmt(trocoPara)}</div>
         <div class="pgto-troco">LEVAR TROCO: R$ ${fmt(levarTroco)}</div>`
      : `<div class="pgto-troco">SEM TROCO ANOTADO — CONFIRMAR</div>`
  } else if (pgto === 'pix') {
    blocoPagamento += `<div class="pgto-linha">PIX ja confirmado no atendimento</div>`
  } else if (pgto === 'cartao') {
    blocoPagamento += `<div class="pgto-linha">Levar maquininha</div>`
  }
  blocoPagamento += `</div>`

  const win = window.open('', '_blank', 'width=400,height=600')
  win.document.write(`
    <html><head><title>Pedido #${p.numero_pedido}</title>
    <style>
      /* @page controla o tamanho da PÁGINA que o navegador manda pro driver
         de impressão — sem isso ele assume A4/Carta e a impressora térmica
         corta ou sobra papel em branco. 'auto' na altura deixa o rolo
         continuar até o conteúdo acabar, em vez de forçar altura fixa. */
      @page { size: ${LARGURA_PAPEL_TERMICO} auto; margin: 0; }
      * { box-sizing: border-box; }
      /* Impressora térmica ESC/POS recebe o texto como imagem rasterizada
         pelo driver do Windows. Cinza-antialiasado vira ponto falhado no
         papel — por isso tudo aqui é preto puro e em negrito (traço mais
         grosso segura melhor no rolo), nunca peso normal/fino. */
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body {
        font-family: 'Courier New', monospace;
        font-weight: bold;
        font-size: 13px;
        line-height: 1.45;
        width: ${LARGURA_PAPEL_TERMICO};
        margin: 0;
        padding: 6px 8px;
        color: #000;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      h2 { text-align: center; font-size: 14px; margin: 4px 0; }
      p { margin: 3px 0; word-wrap: break-word; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      .row span:first-child { word-break: break-word; }
      .total { font-size: 14px; font-weight: bold; }
      .obs-item { font-size: 11px; padding-left: 10px; font-style: italic; }
      .entrega { text-align: center; font-size: 13px; font-weight: bold;
                 border: 1px solid #000; padding: 2px; margin: 4px 0; }
      /* Quadro de pagamento: borda grossa e corpo maior porque é o campo que
         o entregador precisa achar de relance. */
      .pgto-box { border: 2px solid #000; padding: 5px; margin: 6px 0; text-align: center; }
      .pgto-tipo { font-size: 16px; font-weight: bold; }
      .pgto-linha { font-size: 11px; margin-top: 2px; }
      .pgto-troco { font-size: 15px; font-weight: bold; margin-top: 3px;
                    border-top: 1px dashed #000; padding-top: 3px; }
    </style></head><body>
    <h2>RESTAURANTE CHAPELAO</h2>
    <p style="text-align:center">Pedido #${p.numero_pedido}</p>
    <div class="entrega">${p.tipo_entrega === 'delivery' ? '** ENTREGA **' : '** RETIRADA **'}</div>
    <hr>
    <p><b>Cliente:</b> ${cliente?.nome || '-'}</p>
    <p><b>Tel:</b> ${cliente?.telefone || '-'}</p>
    ${p.endereco_entrega ? `<p><b>End:</b> ${p.endereco_entrega}</p>` : ''}
    ${p.observacao ? `<p><b>Obs:</b> ${p.observacao}</p>` : ''}
    <hr>
    ${itens.map(i => `
      <div class="row"><span>${i.quantidade}x ${i.nome_produto}</span><span>R$ ${fmt(i.total)}</span></div>
      ${i.observacao ? `<div class="obs-item">> ${i.observacao}</div>` : ''}
    `).join('')}
    <hr>
    ${Number(p.subtotal) ? `<div class="row"><span>Subtotal</span><span>R$ ${fmt(p.subtotal)}</span></div>` : ''}
    ${taxa > 0 ? `<div class="row"><span>Taxa de entrega</span><span>R$ ${fmt(taxa)}</span></div>` : ''}
    ${Number(p.desconto) > 0 ? `<div class="row"><span>Desconto</span><span>-R$ ${fmt(p.desconto)}</span></div>` : ''}
    <div class="row total"><span>TOTAL</span><span>R$ ${fmt(p.total)}</span></div>
    ${blocoPagamento}
    <p style="text-align:center;font-size:10px">${new Date(p.created_at).toLocaleString('pt-BR')}</p>
    <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`)
  win.document.close()
}

/* ─── LOJA TOGGLE ───────────────────────────────── */
// Este botão é a CHAVE MESTRA do atendimento automático: o agente do WhatsApp
// lê `loja_aberta` a cada mensagem. Fechado aqui = ele responde o horário e
// não monta pedido. Aberto = ele atende, mesmo fora das 11h–14h (é assim que
// dá pra testar o atendimento de manhã).
//
// O agente abre sozinho às 11h e fecha sozinho depois das 14h, então o valor
// muda sem ninguém clicar — por isso a tela recarrega o estado de tempos em
// tempos (ver abaixo), senão o botão passaria a tarde mentindo "Aberta".
async function toggleLoja() {
  const novo = !P.lojaAberta

  const { data, error } = await sb.from('info_restaurante')
    .update({ valor: novo ? 'true' : 'false' })
    .eq('chave', 'loja_aberta')
    .select('chave')

  if (error || !data?.length) {
    avisar(`❌ Não consegui ${novo ? 'abrir' : 'fechar'} a loja.\n\n${error?.message || 'O banco não confirmou a alteração.'}`, 'erro')
    return
  }

  P.lojaAberta = novo
  atualizarToggleLoja()
  avisar(novo
    ? '🟢 Loja ABERTA — o agente do WhatsApp está atendendo.'
    : '🔴 Loja FECHADA — o agente vai responder o horário e não monta pedido.')
}

function atualizarToggleLoja() {
  const btn = document.getElementById('loja-toggle')
  const label = document.getElementById('loja-toggle-label')
  if (P.lojaAberta) {
    label.textContent = '🟢 Aberta'
    btn.classList.remove('fechada')
  } else {
    label.textContent = '🔴 Fechada'
    btn.classList.add('fechada')
  }
}

/* ─── HELPERS ────────────────────────────────────── */
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* ─── VÍDEO DO BUFFET DO DIA ─────────────────────── */
// O agente de recompra usa este vídeo na campanha do almoço (11h–14h) e não
// dispara sem ele. Por isso o upload fica aqui, no painel que a equipe já
// abre todo dia, e o botão avisa quando o vídeo de hoje ainda não subiu.

const BUCKET_BUFFET = 'buffet-videos'
const TAMANHO_MAX_BUFFET = 50 * 1024 * 1024

// Data no fuso do restaurante: usar UTC faria a mídia "virar o dia" às 21h.
function hojeLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

async function carregarMidiaBuffet() {
  const { data } = await sb.from('midia_do_dia')
    .select('*').eq('data', hojeLocal()).eq('ativo', true).maybeSingle()
  P.midiaBuffet = data || null
  atualizarBotaoBuffet()
}

function atualizarBotaoBuffet() {
  const btn = document.getElementById('btn-buffet')
  if (!btn) return
  const ok = Boolean(P.midiaBuffet)
  btn.textContent = ok ? '🍽️ Buffet ✅' : '🍽️ Buffet ⚠️'
  btn.classList.toggle('pendente', !ok)
  btn.title = ok
    ? 'Vídeo do buffet de hoje já enviado'
    : 'Falta enviar o vídeo do buffet de hoje — a campanha não roda sem ele'
}

function abrirBuffet() {
  const m = P.midiaBuffet

  document.getElementById('modal-buffet-card').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 style="font-size:20px;font-weight:900;color:var(--amarelo)">🍽️ Buffet de hoje</h2>
      <button class="btn-sair" onclick="fecharBuffet()">✕ Fechar</button>
    </div>
    <p style="font-size:13px;font-weight:600;color:${m ? '#4ADE80' : 'var(--red-2)'}">
      ${m
        ? 'Vídeo enviado. A campanha do almoço vai usar ele.'
        : 'Nenhum vídeo hoje. Sem ele a campanha das 11h às 14h não dispara.'}
    </p>
    ${m ? `<video src="${m.video_url}" controls playsinline
              style="width:100%;max-height:340px;border-radius:10px;background:#000"></video>` : ''}
    <label class="btn-status" id="buffet-label"
           style="display:block;text-align:center;cursor:pointer">
      <span id="buffet-label-txt">${m ? '🔄 Trocar vídeo de hoje' : '📹 Enviar vídeo do buffet'}</span>
      <input type="file" accept="video/*,image/*" capture="environment"
             onchange="enviarBuffet(this.files[0])" style="display:none">
    </label>
    <p id="buffet-erro" style="font-size:12px;color:var(--red-2);font-weight:600;min-height:16px"></p>`

  document.getElementById('modal-buffet').classList.add('open')
}

function fecharBuffet() {
  document.getElementById('modal-buffet').classList.remove('open')
}

document.getElementById('modal-buffet').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-buffet')) fecharBuffet()
})

async function enviarBuffet(arquivo) {
  if (!arquivo) return

  const erro = document.getElementById('buffet-erro')
  const txt = document.getElementById('buffet-label-txt')
  const label = document.getElementById('buffet-label')
  erro.textContent = ''

  if (arquivo.size > TAMANHO_MAX_BUFFET) {
    erro.textContent = `Vídeo de ${(arquivo.size / 1048576).toFixed(1)}MB passa do limite de 50MB. Grave um vídeo mais curto.`
    return
  }

  label.style.opacity = '.6'
  txt.textContent = '⏳ Enviando...'

  try {
    const dia = hojeLocal()
    const ext = (arquivo.name.split('.').pop() || 'mp4').toLowerCase()
    const caminho = `${dia}/buffet-${Date.now()}.${ext}`

    const up = await sb.storage.from(BUCKET_BUFFET)
      .upload(caminho, arquivo, { contentType: arquivo.type, upsert: true })
    if (up.error) throw up.error

    const { data: pub } = sb.storage.from(BUCKET_BUFFET).getPublicUrl(caminho)

    const { data, error } = await sb.from('midia_do_dia')
      .upsert({
        data: dia,
        video_url: pub.publicUrl,
        tipo: arquivo.type.startsWith('video/') ? 'video' : 'image',
        ativo: true
      }, { onConflict: 'data' })
      .select().single()
    if (error) throw error

    P.midiaBuffet = data
    atualizarBotaoBuffet()
    abrirBuffet() // redesenha o modal já com o preview do vídeo novo
  } catch (e) {
    erro.textContent = e.message || 'Erro ao enviar o vídeo. Tente de novo.'
    label.style.opacity = '1'
    txt.textContent = '📹 Tentar de novo'
  }
}

/* ─── CARDÁPIO DO DIA (marmitex: misturas + acompanhamentos) ───── */
// O agente de atendimento lê `itens_do_dia` sempre que alguém pergunta pela
// marmitex (tool buscar_itens_do_dia). Este modal é a forma rápida de marcar,
// todo dia, quais carnes e quais acompanhamentos estão de pé — sem entrar na
// tela cheia de Porcionamento do ERP.
//
// Sem limite de quantidade aqui: o chefe pode preparar quantas carnes quiser
// num dia. O limite de "o cliente escolhe até 2" é regra do PEDIDO, aplicada
// na hora de montar a marmitex — não faz sentido travar o que o cardápio do
// dia oferece.

// inventory_items/itens_do_dia usam o RBAC do ERP (exige usuário autenticado
// com permissão de porcionamento) — a chave anon deste painel não passa por
// ali. Por isso o acesso é só via estas funções RPC de escopo estreito
// (cardapio_dia_*), que não expõem custo de estoque nem outras colunas.
async function buscarItensPorcionaveis() {
  const { data, error } = await sb.rpc('cardapio_dia_listar_itens')
  if (error) throw error
  return {
    carnes: (data || []).filter(i => i.porc_categoria === 'carne'),
    acompanhamentos: (data || []).filter(i => i.porc_categoria === 'acompanhamento')
  }
}

async function carregarStatusCardapio() {
  const { data, error } = await sb.rpc('cardapio_dia_status_hoje')
  if (error) { console.error(error); return }
  P.cardapioHoje = Boolean(data)
  atualizarBotaoCardapio()
}

function atualizarBotaoCardapio() {
  const btn = document.getElementById('btn-cardapio')
  if (!btn) return
  btn.textContent = P.cardapioHoje ? '🍲 Cardápio ✅' : '🍲 Cardápio ⚠️'
  btn.classList.toggle('pendente', !P.cardapioHoje)
  btn.title = P.cardapioHoje
    ? 'Cardápio de hoje já configurado'
    : 'Marque as misturas e acompanhamentos de hoje — some à meia-noite'
}

// preSelecao: quando informado (Set de ids), sobrepõe o estado salvo no
// banco — usado ao reabrir o modal depois de editar/excluir/adicionar item,
// pra não perder marcações que a pessoa já tinha feito e ainda não salvou.
async function abrirCardapio(preSelecao) {
  const card = document.getElementById('modal-cardapio-card')
  card.innerHTML = `<p style="text-align:center;padding:20px;color:var(--text-muted)">Carregando cardápio...</p>`
  document.getElementById('modal-cardapio').classList.add('open')

  let carnes, acompanhamentos, ativosHoje
  try {
    const r = await buscarItensPorcionaveis()
    carnes = r.carnes
    acompanhamentos = r.acompanhamentos

    if (preSelecao) {
      ativosHoje = preSelecao
    } else {
      const { data } = await sb.rpc('cardapio_dia_ativos_hoje')
      ativosHoje = new Set((data || []).filter(r => r.ativo).map(r => r.inventory_item_id))
    }
  } catch (e) {
    card.innerHTML = `<p style="text-align:center;padding:20px;color:var(--red-2)">Erro ao carregar: ${e.message}</p>`
    return
  }

  const linhaItem = (item, marcado) => `
    <div style="display:flex;align-items:center;gap:6px;padding:6px 4px;font-size:13.5px">
      <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;min-width:0">
        <input type="checkbox" class="chk-cardapio" data-categoria="${item.porc_categoria}"
               value="${item.id}" ${marcado ? 'checked' : ''}>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.nome}</span>
      </label>
      <button onclick="editarItemCardapio('${item.id}','${item.nome.replace(/'/g, "\\'")}')"
              title="Editar nome" style="background:none;border:none;cursor:pointer;font-size:14px;padding:4px">✏️</button>
      <button onclick="excluirItemCardapio('${item.id}','${item.nome.replace(/'/g, "\\'")}')"
              title="Remover do cardápio" style="background:none;border:none;cursor:pointer;font-size:14px;padding:4px">🗑️</button>
    </div>`

  const linhaAdicionar = (categoria) => `
    <div style="display:flex;gap:6px;margin-top:6px">
      <input type="text" id="novo-item-${categoria}" placeholder="Nome do item novo..."
             style="flex:1;padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card2);color:var(--text);font-size:13px">
      <button onclick="adicionarItemCardapio('${categoria}')"
              style="padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);cursor:pointer;font-size:13px">+ Add</button>
    </div>`

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2 style="font-size:20px;font-weight:900;color:var(--amarelo)">🍲 Cardápio de hoje</h2>
      <button class="btn-sair" onclick="fecharCardapio()">✕ Fechar</button>
    </div>
    <p style="font-size:12px;color:var(--text-muted)">
      A seleção vale só pra hoje — some à meia-noite. Itens novos (✏️/🗑️/+ Add) ficam salvos pro cardápio.
    </p>

    <div>
      <h3 style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:2px">
        🥩 Misturas (carnes)
      </h3>
      <div id="cardapio-carnes" style="display:flex;flex-direction:column">
        ${carnes.map(c => linhaItem(c, ativosHoje.has(c.id))).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nenhuma carne cadastrada.</p>'}
      </div>
      ${linhaAdicionar('carne')}
    </div>

    <div>
      <h3 style="font-size:13px;font-weight:800;color:var(--text);margin:12px 0 2px">🍟 Acompanhamentos</h3>
      <div id="cardapio-acomp" style="display:flex;flex-direction:column">
        ${acompanhamentos.map(a => linhaItem(a, ativosHoje.has(a.id))).join('') || '<p style="font-size:12px;color:var(--text-muted)">Nenhum acompanhamento cadastrado.</p>'}
      </div>
      ${linhaAdicionar('acompanhamento')}
    </div>

    <p id="cardapio-erro" style="font-size:12px;color:var(--red-2);font-weight:600;min-height:16px;margin-top:8px"></p>
    <button class="btn-status" id="btn-salvar-cardapio" onclick="salvarCardapio()"
            style="width:100%;text-align:center;cursor:pointer">💾 Salvar cardápio de hoje</button>`

}

function fecharCardapio() {
  document.getElementById('modal-cardapio').classList.remove('open')
}

document.getElementById('modal-cardapio').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-cardapio')) fecharCardapio()
})

async function salvarCardapio() {
  const btn = document.getElementById('btn-salvar-cardapio')
  const erro = document.getElementById('cardapio-erro')
  const marcados = [...document.querySelectorAll('.chk-cardapio:checked')].map(c => c.value)

  btn.disabled = true
  btn.textContent = '⏳ Salvando...'
  erro.textContent = ''

  try {
    // cardapio_dia_salvar grava TODO item porcionável (marcado vira ativo,
    // o resto vira inativo) e confere de novo o limite de 2 carnes no banco
    // — a trava do checkbox no navegador é só conveniência, não segurança.
    const { error } = await sb.rpc('cardapio_dia_salvar', { p_ids_ativos: marcados })
    if (error) throw error

    P.cardapioHoje = marcados.length > 0
    atualizarBotaoCardapio()
    fecharCardapio()
  } catch (e) {
    erro.textContent = e.message || 'Erro ao salvar. Tente de novo.'
  } finally {
    btn.disabled = false
    btn.textContent = '💾 Salvar cardápio de hoje'
  }
}

function capturarSelecaoCardapio() {
  return new Set([...document.querySelectorAll('.chk-cardapio:checked')].map(c => c.value))
}

async function editarItemCardapio(id, nomeAtual) {
  const novoNome = prompt('Novo nome do item:', nomeAtual)
  if (!novoNome || !novoNome.trim() || novoNome.trim() === nomeAtual) return

  const selecao = capturarSelecaoCardapio()
  try {
    const { error } = await sb.rpc('cardapio_dia_renomear_item', { p_id: id, p_novo_nome: novoNome.trim() })
    if (error) throw error
  } catch (e) {
    alert('Erro ao renomear: ' + e.message)
  }
  abrirCardapio(selecao)
}

async function excluirItemCardapio(id, nome) {
  const ok = confirm(`Remover "${nome}" do cardápio?\n\nEle deixa de aparecer como opção pra escolher — não some do histórico de dias já registrados.`)
  if (!ok) return

  const selecao = capturarSelecaoCardapio()
  selecao.delete(id) // item removido não pode continuar "selecionado" na tela
  try {
    const { error } = await sb.rpc('cardapio_dia_excluir_item', { p_id: id })
    if (error) throw error
  } catch (e) {
    alert('Erro ao remover: ' + e.message)
  }
  abrirCardapio(selecao)
}

async function adicionarItemCardapio(categoria) {
  const input = document.getElementById(`novo-item-${categoria}`)
  const nome = input.value.trim()
  if (!nome) { input.focus(); return }

  const selecao = capturarSelecaoCardapio()
  try {
    const { error } = await sb.rpc('cardapio_dia_criar_item', { p_nome: nome, p_categoria: categoria })
    if (error) throw error
  } catch (e) {
    alert('Erro ao adicionar: ' + e.message)
    abrirCardapio(selecao)
    return
  }
  abrirCardapio(selecao)
}

/* ─── NOVO PEDIDO MANUAL ─────────────────────────── */
// Pra clientes que respondem ao disparo de recompra num número que ainda
// não tem atendimento automático: o atendente monta o pedido aqui. Preço
// vem do banco (produtos), e o cupom (desconto ou brinde) é validado e
// aplicado por painel_criar_pedido — a mesma trava de "só os itens
// permitidos" do agente de atendimento vale aqui também, no servidor,
// não só na tela.
//
// A versão anterior jogava os 138 produtos num único <select> com optgroups.
// Achar "Coca-Cola Lata 350ml" no meio de 51 bebidas dentro de um dropdown,
// com o telefone tocando, era o gargalo. Agora: categorias em abas na ordem
// de uso real (marmitex primeiro, bebidas e doces por último), busca que
// filtra tudo de uma vez, e grade de botões grandes o bastante pra tocar no
// tablet da cozinha.

const NP = {
  produtos: [],
  itens: [],
  cupom: null,
  clienteId: null,
  categoriaAtiva: null,
  busca: '',
  // Cardápio do dia (carnes/acompanhamentos ativos hoje), carregado sob
  // demanda na primeira marmitex do pedido.
  cardapio: null,
  // Marmitex sendo montada agora (null = nenhuma). Fica fora de NP.itens
  // porque só entra no pedido depois de confirmar as escolhas.
  montando: null,
  form: { telefone: '', nome: '', endereco: '', tipoEntrega: 'delivery', pagamento: 'pix', trocoPara: '', observacao: '', aplicarCupom: true, canal: 'balcao', taxaEntrega: '' }
}

// Canais de origem do pedido — pra medir depois de onde vem cada venda.
// whatsapp_organico/whatsapp_anuncio/recompra também existem (setados
// automaticamente pelo agente de atendimento), mas aqui no painel o
// atendente escolhe manualmente de onde esse pedido específico veio.
const NP_CANAIS = [
  { valor: 'balcao', label: '🏠 Balcão' },
  { valor: 'whatsapp_organico', label: '💬 WhatsApp' },
  { valor: 'instagram', label: '📸 Instagram' },
  { valor: 'whatsapp_anuncio', label: '📢 Anúncio' },
  { valor: 'recompra', label: '🔁 Recompra' },
]

// Ordem em que as categorias aparecem. Pedida assim: marmitas bem em cima,
// bebidas embaixo e depois os doces. O que não estiver mapeado cai no meio,
// antes das bebidas.
const NP_ORDEM_CATEGORIAS = [
  'Marmitex', 'Refeições', 'Esfirras', 'Outros', 'Bebidas', 'Sorvetes', 'Doces'
]
const NP_ICONE_CATEGORIA = {
  'Marmitex': '🍱', 'Refeições': '🍛', 'Esfirras': '🥟', 'Outros': '🍟',
  'Bebidas': '🥤', 'Sorvetes': '🍦', 'Doces': '🍬'
}

// Limites da marmitex — os mesmos que o agente de atendimento aplica no
// WhatsApp. Se mudar lá, muda aqui.
const NP_MAX_CARNES = 2
const NP_MAX_ACOMP = 6

function npOrdemCategoria(cat) {
  const i = NP_ORDEM_CATEGORIAS.indexOf(cat)
  return i === -1 ? NP_ORDEM_CATEGORIAS.indexOf('Outros') : i
}

function npCategorias() {
  const cats = [...new Set(NP.produtos.map(p => (p.categoria || 'Outros').trim()))]
  return cats.sort((a, b) => npOrdemCategoria(a) - npOrdemCategoria(b) || a.localeCompare(b))
}

function ehMarmitex(produto) {
  return (produto.categoria || '').trim().toLowerCase() === 'marmitex'
}

// Normaliza pra busca: sem acento, minúsculo. Assim "acai" acha "Açaí" e
// "marmitex media" acha "Marmitex Média".
function npNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()
}

// Lê os valores atuais da tela pro estado, ANTES de um re-render que vai
// substituir o HTML e perder o que a pessoa digitou.
function npCapturarForm() {
  const val = (id) => document.getElementById(id)?.value
  NP.form.telefone = val('np-telefone') ?? NP.form.telefone
  NP.form.nome = val('np-nome') ?? NP.form.nome
  NP.form.endereco = val('np-endereco') ?? NP.form.endereco
  NP.form.tipoEntrega = val('np-tipo-entrega') ?? NP.form.tipoEntrega
  NP.form.pagamento = val('np-pagamento') ?? NP.form.pagamento
  NP.form.canal = val('np-canal') ?? NP.form.canal
  NP.form.taxaEntrega = val('np-taxa-entrega') ?? NP.form.taxaEntrega
  NP.form.trocoPara = val('np-troco') ?? NP.form.trocoPara
  NP.form.observacao = val('np-observacao') ?? NP.form.observacao
  NP.busca = val('np-busca') ?? NP.busca
  const chk = document.getElementById('np-aplicar-cupom')
  if (chk) NP.form.aplicarCupom = chk.checked
}

async function abrirNovoPedido() {
  const card = document.getElementById('modal-novo-pedido-card')
  card.innerHTML = `<p style="text-align:center;padding:20px;color:var(--text-muted)">Carregando cardápio...</p>`
  document.getElementById('modal-novo-pedido').classList.add('open')

  NP.itens = []
  NP.cupom = null
  NP.clienteId = null
  NP.montando = null
  NP.busca = ''
  NP.form = { telefone: '', nome: '', endereco: '', tipoEntrega: 'delivery', pagamento: 'pix', trocoPara: '', observacao: '', aplicarCupom: true, canal: 'balcao', taxaEntrega: '' }

  if (!NP.produtos.length) {
    const { data, error } = await sb.from('produtos')
      .select('id, nome, preco, preco_delivery, preco_promocional, categoria')
      .eq('disponivel', true)
      .order('categoria').order('nome')
    if (error) {
      card.innerHTML = `<p style="text-align:center;padding:20px;color:var(--red-2)">Erro ao carregar cardápio: ${error.message}</p>`
      return
    }
    NP.produtos = data || []
  }

  NP.categoriaAtiva = npCategorias()[0] || null
  renderNovoPedido()
}

function precoProduto(p) {
  return Number(p.preco_promocional ?? p.preco_delivery ?? p.preco)
}

/* ─── CARDÁPIO DO DIA (carnes e acompanhamentos da marmitex) ─────── */
// Mesma fonte que o agente usa no WhatsApp: só entra na marmitex o que a
// cozinha marcou como ativo HOJE. Antes não havia como escolher isso no
// painel — o pedido manual saía sem mistura e a cozinha tinha que adivinhar.
async function npCarregarCardapioDia() {
  if (NP.cardapio) return NP.cardapio

  const [itens, ativos] = await Promise.all([
    sb.rpc('cardapio_dia_listar_itens'),
    sb.rpc('cardapio_dia_ativos_hoje')
  ])
  if (itens.error) throw itens.error
  if (ativos.error) throw ativos.error

  const ativosHoje = new Set((ativos.data || []).filter(r => r.ativo).map(r => r.inventory_item_id))
  const listaAtiva = (itens.data || []).filter(i => ativosHoje.has(i.id))

  NP.cardapio = {
    carnes: listaAtiva.filter(i => i.porc_categoria === 'carne').map(i => i.nome),
    acompanhamentos: listaAtiva.filter(i => i.porc_categoria !== 'carne').map(i => i.nome)
  }
  return NP.cardapio
}

/* ─── MONTAGEM DA MARMITEX ───────────────────────── */

async function npIniciarMarmitex(produtoId) {
  npCapturarForm()
  const produto = NP.produtos.find(p => p.id === produtoId)
  if (!produto) return

  NP.montando = { produto, carnes: [], acompanhamentos: [], erro: '', carregando: true }
  renderNovoPedido()

  try {
    await npCarregarCardapioDia()
    NP.montando.carregando = false
  } catch (e) {
    NP.montando.carregando = false
    NP.montando.erro = `Não consegui carregar o cardápio de hoje: ${e.message}`
  }
  renderNovoPedido()
}

function npToggleMistura(tipo, nome) {
  const m = NP.montando
  if (!m) return
  const lista = tipo === 'carne' ? m.carnes : m.acompanhamentos
  const max = tipo === 'carne' ? NP_MAX_CARNES : NP_MAX_ACOMP
  const idx = lista.indexOf(nome)

  if (idx >= 0) {
    lista.splice(idx, 1)
    m.erro = ''
  } else if (lista.length >= max) {
    m.erro = tipo === 'carne'
      ? `Máximo de ${NP_MAX_CARNES} carnes. Desmarque uma pra trocar.`
      : `Máximo de ${NP_MAX_ACOMP} acompanhamentos. Desmarque um pra trocar.`
  } else {
    lista.push(nome)
    m.erro = ''
  }
  renderNovoPedido()
}

function npCancelarMarmitex() {
  NP.montando = null
  renderNovoPedido()
}

// Formato IDÊNTICO ao que o agente do WhatsApp grava em itens_pedido.observacao,
// pra cozinha ler a mesma coisa venha o pedido de onde vier.
function npObsMarmitex(m) {
  const partes = []
  if (m.carnes.length) partes.push(`Carnes: ${m.carnes.join(', ')}`)
  if (m.acompanhamentos.length) partes.push(`Acompanhamentos: ${m.acompanhamentos.join(', ')}`)
  return partes.join(' | ')
}

function npConfirmarMarmitex() {
  const m = NP.montando
  if (!m) return
  if (!m.carnes.length && !m.acompanhamentos.length) {
    m.erro = 'Escolha pelo menos uma carne ou um acompanhamento.'
    renderNovoPedido()
    return
  }

  // Marmitex com mistura diferente é item diferente: não agrupa com outra.
  NP.itens.push({
    produto_id: m.produto.id,
    nome: m.produto.nome.trim(),
    preco: precoProduto(m.produto),
    quantidade: 1,
    observacao: npObsMarmitex(m)
  })
  NP.montando = null
  renderNovoPedido()
}

/* ─── CARRINHO ───────────────────────────────────── */

function npAdicionarProduto(produtoId) {
  npCapturarForm()
  const produto = NP.produtos.find(p => p.id === produtoId)
  if (!produto) return

  if (ehMarmitex(produto)) {
    npIniciarMarmitex(produtoId)
    return
  }

  // Item simples agrupa por produto; item com observação nunca agrupa.
  const existente = NP.itens.find(i => i.produto_id === produto.id && !i.observacao)
  if (existente) existente.quantidade++
  else NP.itens.push({ produto_id: produto.id, nome: produto.nome.trim(), preco: precoProduto(produto), quantidade: 1, observacao: null })

  renderNovoPedido()
}

function npAlterarQtd(idx, delta) {
  npCapturarForm()
  const item = NP.itens[idx]
  if (!item) return
  item.quantidade += delta
  if (item.quantidade < 1) NP.itens.splice(idx, 1)
  renderNovoPedido()
}

function npRemoverItem(idx) {
  npCapturarForm()
  NP.itens.splice(idx, 1)
  renderNovoPedido()
}

/* ─── TOTAIS ─────────────────────────────────────── */
// Calculados na tela SÓ para conferência visual. Quem manda no valor gravado
// é painel_criar_pedido no banco — a tela nunca envia preço nem total.
// Taxa de entrega é digitada pelo atendente (varia por bairro); sem valor
// digitado, o banco usa o padrão cadastrado em info_restaurante.
function npTotais() {
  const subtotal = NP.itens.reduce((s, i) => s + i.preco * i.quantidade, 0)
  const taxaDigitada = Number(String(NP.form.taxaEntrega).replace(',', '.'))
  const taxa = NP.form.tipoEntrega === 'delivery'
    ? (Number.isFinite(taxaDigitada) && String(NP.form.taxaEntrega).trim() ? taxaDigitada : 0)
    : 0
  const usarCupom = NP.form.aplicarCupom && NP.cupom
  const desconto = (usarCupom && NP.cupom.tipo !== 'brinde')
    ? Math.round(subtotal * (Number(NP.cupom.desconto_percentual) || 0)) / 100
    : 0
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxa,
    desconto: Math.round(desconto * 100) / 100,
    total: Math.round((subtotal + taxa - desconto) * 100) / 100
  }
}

/* ─── RENDER ─────────────────────────────────────── */

function npAvisoCupomHtml() {
  if (!NP.cupom) return ''
  const desc = NP.cupom.tipo === 'brinde'
    ? (NP.cupom.descricao || 'brinde de primeira compra')
    : `${NP.cupom.desconto_percentual}% de desconto`
  return `
    <label class="np-cupom">
      <input type="checkbox" id="np-aplicar-cupom" ${NP.form.aplicarCupom ? 'checked' : ''}>
      <span>🎁 Cliente tem cupom <b>${NP.cupom.codigo}</b> ativo: ${desc}. Aplicar?</span>
    </label>`
}

function npRenderCatalogo() {
  const busca = npNorm(NP.busca)

  // Buscando: ignora a categoria e procura no cardápio inteiro — quem digita
  // "coca" quer a Coca, não quer saber em que aba ela mora.
  const lista = busca
    ? NP.produtos.filter(p => npNorm(p.nome).includes(busca))
    : NP.produtos.filter(p => (p.categoria || 'Outros').trim() === NP.categoriaAtiva)

  const abas = npCategorias().map(cat => `
    <button type="button" class="np-cat ${!busca && cat === NP.categoriaAtiva ? 'ativa' : ''}"
            onclick="npSelecionarCategoria('${cat.replace(/'/g, "\\'")}')">
      ${NP_ICONE_CATEGORIA[cat] || '🍽️'} ${cat}
    </button>`).join('')

  const cards = lista.map(p => {
    const noCarrinho = NP.itens.filter(i => i.produto_id === p.id).reduce((s, i) => s + i.quantidade, 0)
    return `
      <button type="button" class="np-produto ${noCarrinho ? 'no-carrinho' : ''}" onclick="npAdicionarProduto('${p.id}')">
        ${noCarrinho ? `<span class="np-produto-qtd">${noCarrinho}</span>` : ''}
        <span class="np-produto-nome">${p.nome.trim()}</span>
        <span class="np-produto-preco">R$ ${fmt(precoProduto(p))}</span>
        ${ehMarmitex(p) ? '<span class="np-produto-tag">escolher misturas</span>' : ''}
      </button>`
  }).join('')

  return `
    <div class="np-catalogo">
      <input type="search" id="np-busca" class="np-busca" placeholder="🔎 Buscar em todo o cardápio..."
             value="${NP.busca}" oninput="npBuscar(this.value)" autocomplete="off">
      <div class="np-cats">${abas}</div>
      <div class="np-produtos">
        ${cards || '<p class="np-vazio">Nenhum produto encontrado.</p>'}
      </div>
    </div>`
}

let npBuscaTimer = null
function npBuscar(valor) {
  NP.busca = valor
  // Debounce: sem isso cada tecla redesenha 138 cards e a digitação engasga
  // no tablet.
  clearTimeout(npBuscaTimer)
  npBuscaTimer = setTimeout(() => {
    renderNovoPedido()
    const b = document.getElementById('np-busca')
    if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length) }
  }, 180)
}

function npSelecionarCategoria(cat) {
  npCapturarForm()
  NP.categoriaAtiva = cat
  NP.busca = ''
  renderNovoPedido()
}

function npRenderMontagem() {
  const m = NP.montando
  if (m.carregando) {
    return `<div class="np-montagem"><p class="np-vazio">Carregando cardápio de hoje...</p></div>`
  }

  const c = NP.cardapio || { carnes: [], acompanhamentos: [] }
  const semCardapio = !c.carnes.length && !c.acompanhamentos.length

  const chips = (lista, tipo, escolhidas) => lista.map(nome => `
    <button type="button" class="np-chip ${escolhidas.includes(nome) ? 'on' : ''}"
            onclick="npToggleMistura('${tipo}', ${JSON.stringify(nome).replace(/"/g, '&quot;')})">
      ${escolhidas.includes(nome) ? '✓ ' : ''}${nome}
    </button>`).join('')

  return `
    <div class="np-montagem">
      <div class="np-montagem-head">
        <h3>🍱 ${m.produto.nome.trim()} — o que vai dentro?</h3>
        <button type="button" class="btn-sair" onclick="npCancelarMarmitex()">✕ Cancelar</button>
      </div>

      ${semCardapio ? `
        <p class="np-alerta">⚠️ Nenhum item marcado no cardápio de hoje. Abra <b>🍲 Cardápio</b> no topo do painel e marque as carnes e acompanhamentos do dia — depois volte aqui.</p>
      ` : `
        <div class="np-grupo">
          <div class="np-grupo-titulo">
            <span>🥩 Carnes</span>
            <span class="np-contador ${m.carnes.length >= NP_MAX_CARNES ? 'cheio' : ''}">${m.carnes.length}/${NP_MAX_CARNES}</span>
          </div>
          <div class="np-chips">${chips(c.carnes, 'carne', m.carnes) || '<span class="np-vazio">Nenhuma carne marcada hoje.</span>'}</div>
        </div>

        <div class="np-grupo">
          <div class="np-grupo-titulo">
            <span>🍚 Acompanhamentos</span>
            <span class="np-contador ${m.acompanhamentos.length >= NP_MAX_ACOMP ? 'cheio' : ''}">${m.acompanhamentos.length}/${NP_MAX_ACOMP}</span>
          </div>
          <div class="np-chips">${chips(c.acompanhamentos, 'acomp', m.acompanhamentos) || '<span class="np-vazio">Nenhum acompanhamento marcado hoje.</span>'}</div>
        </div>
      `}

      ${m.erro ? `<p class="np-erro">${m.erro}</p>` : ''}

      <button type="button" class="np-btn-confirmar" onclick="npConfirmarMarmitex()">
        ✅ Adicionar esta marmitex
      </button>
    </div>`
}

function npRenderCarrinho() {
  const t = npTotais()

  const linhas = NP.itens.map((i, idx) => `
    <div class="np-item">
      <div class="np-item-info">
        <span class="np-item-nome">${i.nome}</span>
        ${i.observacao ? `<span class="np-item-obs">${i.observacao}</span>` : ''}
      </div>
      <div class="np-item-dir">
        <div class="np-stepper">
          <button type="button" onclick="npAlterarQtd(${idx}, -1)">−</button>
          <span>${i.quantidade}</span>
          <button type="button" onclick="npAlterarQtd(${idx}, 1)">+</button>
        </div>
        <span class="np-item-preco">R$ ${fmt(i.preco * i.quantidade)}</span>
        <button type="button" class="np-item-lixo" onclick="npRemoverItem(${idx})">🗑️</button>
      </div>
    </div>`).join('')

  return `
    <div class="np-carrinho-itens">
      ${linhas || '<p class="np-vazio">Nenhum item ainda. Toque nos produtos ao lado. →</p>'}
    </div>
    <div class="np-totais">
      <div class="np-total-linha"><span>Subtotal</span><span>R$ ${fmt(t.subtotal)}</span></div>
      ${t.taxa > 0 ? `<div class="np-total-linha"><span>Taxa de entrega</span><span>R$ ${fmt(t.taxa)}</span></div>` : ''}
      ${t.desconto > 0 ? `<div class="np-total-linha desconto"><span>Desconto</span><span>-R$ ${fmt(t.desconto)}</span></div>` : ''}
      <div class="np-total-linha grande"><span>Total</span><span>R$ ${fmt(t.total)}</span></div>
    </div>`
}

function npRenderTroco() {
  if (NP.form.pagamento !== 'dinheiro') return ''
  const t = npTotais()
  const para = Number(String(NP.form.trocoPara).replace(',', '.')) || 0
  const levar = para - t.total

  let aviso = '<span class="np-troco-dica">Deixe vazio se o cliente tiver o valor certo.</span>'
  if (para > 0 && levar < 0) {
    aviso = `<span class="np-troco-erro">⚠️ R$ ${fmt(para)} é menos que o total (R$ ${fmt(t.total)}).</span>`
  } else if (para > 0) {
    aviso = `<span class="np-troco-ok">✅ Levar R$ ${fmt(levar)} de troco.</span>`
  }

  return `
    <div class="np-troco">
      <label for="np-troco">💵 Troco para quanto?</label>
      <input type="text" id="np-troco" inputmode="decimal" placeholder="Ex: 100"
             value="${NP.form.trocoPara}" oninput="npCapturarForm(); npAtualizarTroco()">
      <div id="np-troco-aviso">${aviso}</div>
    </div>`
}

// Atualiza só o aviso do troco, sem redesenhar o modal — senão o campo perde
// o foco a cada dígito digitado.
function npAtualizarTroco() {
  const alvo = document.getElementById('np-troco-aviso')
  if (!alvo) return
  const t = npTotais()
  const para = Number(String(NP.form.trocoPara).replace(',', '.')) || 0
  const levar = para - t.total
  if (!para) alvo.innerHTML = '<span class="np-troco-dica">Deixe vazio se o cliente tiver o valor certo.</span>'
  else if (levar < 0) alvo.innerHTML = `<span class="np-troco-erro">⚠️ R$ ${fmt(para)} é menos que o total (R$ ${fmt(t.total)}).</span>`
  else alvo.innerHTML = `<span class="np-troco-ok">✅ Levar R$ ${fmt(levar)} de troco.</span>`
}

function npAtualizarCarrinho() {
  const alvo = document.getElementById('np-bloco-carrinho')
  if (!alvo) return
  alvo.innerHTML = `<h3 class="np-subtitulo">🧾 Pedido</h3>${npRenderCarrinho()}`
  npAtualizarTroco()
}

function renderNovoPedido() {
  const card = document.getElementById('modal-novo-pedido-card')
  const f = NP.form

  card.innerHTML = `
    <div class="np-head">
      <h2>➕ Novo pedido</h2>
      <button type="button" class="btn-sair" onclick="fecharNovoPedido()">✕ Fechar</button>
    </div>

    <div class="np-corpo">
      <!-- COLUNA ESQUERDA: cliente + carrinho -->
      <div class="np-col-esq">
        <div class="np-bloco">
          <input type="text" id="np-telefone" class="np-input" placeholder="📱 Telefone (com DDD)" inputmode="tel" value="${f.telefone}">
          <div id="np-cupom-aviso">${npAvisoCupomHtml()}</div>
          <input type="text" id="np-nome" class="np-input" placeholder="👤 Nome do cliente" value="${f.nome}">

          <div class="np-linha2">
            <select id="np-tipo-entrega" class="np-input" onchange="npCapturarForm(); renderNovoPedido()">
              <option value="delivery" ${f.tipoEntrega === 'delivery' ? 'selected' : ''}>🛵 Delivery</option>
              <option value="retirada" ${f.tipoEntrega === 'retirada' ? 'selected' : ''}>🏃 Retirada</option>
            </select>
            <select id="np-pagamento" class="np-input" onchange="npCapturarForm(); renderNovoPedido()">
              <option value="pix" ${f.pagamento === 'pix' ? 'selected' : ''}>💸 PIX</option>
              <option value="dinheiro" ${f.pagamento === 'dinheiro' ? 'selected' : ''}>💵 Dinheiro</option>
              <option value="cartao" ${f.pagamento === 'cartao' ? 'selected' : ''}>💳 Cartão</option>
            </select>
          </div>

          ${f.tipoEntrega === 'delivery'
            ? `<input type="text" id="np-endereco" class="np-input" placeholder="📍 Endereço de entrega" value="${f.endereco}">
               <input type="text" id="np-taxa-entrega" class="np-input" placeholder="💰 Taxa de entrega (R$)" inputmode="decimal"
                      value="${f.taxaEntrega}" oninput="npCapturarForm(); npAtualizarCarrinho()">`
            : ''}

          <label class="np-label-canal">De onde veio esse pedido?</label>
          <select id="np-canal" class="np-input" onchange="npCapturarForm()">
            ${NP_CANAIS.map(c => `<option value="${c.valor}" ${f.canal === c.valor ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>

          ${npRenderTroco()}
        </div>

        <div class="np-bloco np-bloco-carrinho" id="np-bloco-carrinho">
          <h3 class="np-subtitulo">🧾 Pedido</h3>
          ${npRenderCarrinho()}
        </div>

        <textarea id="np-observacao" class="np-input np-obs" placeholder="📝 Observação geral (ex: sem cebola, tocar a campainha...)">${f.observacao}</textarea>

        <p id="np-erro" class="np-erro"></p>
        <button type="button" class="np-btn-criar" id="np-btn-criar" onclick="npCriarPedido()">✅ Criar pedido</button>
      </div>

      <!-- COLUNA DIREITA: catálogo ou montagem da marmitex -->
      <div class="np-col-dir">
        ${NP.montando ? npRenderMontagem() : npRenderCatalogo()}
      </div>
    </div>`

  const tel = document.getElementById('np-telefone')
  if (tel) tel.addEventListener('blur', npBuscarCliente)
}

async function npBuscarCliente() {
  npCapturarForm()
  const telefone = NP.form.telefone.replace(/\D/g, '')
  const avisoEl = document.getElementById('np-cupom-aviso')
  NP.cupom = null
  NP.clienteId = null
  if (avisoEl) avisoEl.innerHTML = ''
  if (!telefone) return

  const { data: cliente } = await sb.from('clientes')
    .select('id, nome, endereco').eq('telefone', telefone).maybeSingle()

  if (cliente) {
    NP.clienteId = cliente.id
    if (cliente.nome) {
      NP.form.nome = cliente.nome
      const el = document.getElementById('np-nome'); if (el) el.value = cliente.nome
    }
    if (cliente.endereco) {
      NP.form.endereco = cliente.endereco
      const el = document.getElementById('np-endereco'); if (el) el.value = cliente.endereco
    }
  }

  const { data: cupom } = await sb.rpc('painel_cupom_ativo_por_telefone', { p_telefone: telefone })
  if (cupom) {
    NP.cupom = cupom
    NP.form.aplicarCupom = true
    if (avisoEl) avisoEl.innerHTML = npAvisoCupomHtml()
  }
}

function fecharNovoPedido() {
  document.getElementById('modal-novo-pedido').classList.remove('open')
}

document.getElementById('modal-novo-pedido').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-novo-pedido')) fecharNovoPedido()
})

async function npCriarPedido() {
  npCapturarForm()
  const erro = document.getElementById('np-erro')
  const btn = document.getElementById('np-btn-criar')
  erro.textContent = ''

  const f = NP.form
  const telefone = f.telefone.replace(/\D/g, '')
  const nome = f.nome.trim()
  const endereco = f.tipoEntrega === 'delivery' ? (f.endereco || '').trim() : null
  const observacao = (f.observacao || '').trim() || null

  if (!telefone) { erro.textContent = 'Informe o telefone do cliente.'; return }
  if (!nome) { erro.textContent = 'Informe o nome do cliente.'; return }
  if (f.tipoEntrega === 'delivery' && !endereco) { erro.textContent = 'Informe o endereço de entrega.'; return }
  if (!NP.itens.length) { erro.textContent = 'Adicione pelo menos 1 item.'; return }
  if (NP.montando) { erro.textContent = 'Termine de montar a marmitex antes de fechar o pedido.'; return }

  let trocoPara = null
  if (f.pagamento === 'dinheiro' && String(f.trocoPara).trim()) {
    trocoPara = Number(String(f.trocoPara).replace(',', '.'))
    if (!Number.isFinite(trocoPara) || trocoPara <= 0) { erro.textContent = 'Valor do troco inválido.'; return }
    if (trocoPara < npTotais().total) { erro.textContent = 'O valor do troco é menor que o total do pedido.'; return }
  }

  let taxaEntrega = null
  if (f.tipoEntrega === 'delivery' && String(f.taxaEntrega).trim()) {
    taxaEntrega = Number(String(f.taxaEntrega).replace(',', '.'))
    if (!Number.isFinite(taxaEntrega) || taxaEntrega < 0) { erro.textContent = 'Valor da taxa de entrega inválido.'; return }
  }

  btn.disabled = true
  btn.textContent = '⏳ Criando...'

  try {
    const { data, error } = await sb.rpc('painel_criar_pedido', {
      p_cliente_id: NP.clienteId,
      p_nome_cliente: nome,
      p_telefone: telefone,
      p_endereco: endereco,
      p_tipo_entrega: f.tipoEntrega,
      p_forma_pagamento: f.pagamento,
      p_itens: NP.itens.map(i => ({
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        observacao: i.observacao || null
      })),
      p_observacao: observacao,
      p_cupom_codigo: (f.aplicarCupom && NP.cupom) ? NP.cupom.codigo : null,
      p_troco_para: trocoPara,
      p_canal: f.canal || 'balcao',
      p_taxa_entrega: taxaEntrega
    })
    if (error) throw error

    fecharNovoPedido()
    await carregarPedidos()
    const extras = []
    if (data.brindes?.length) extras.push(`Brinde: ${data.brindes.join(' + ')}`)
    if (data.trocoPara) extras.push(`Troco para R$ ${fmt(data.trocoPara)}`)
    avisar(`✅ Pedido #${data.numeroPedido} criado — R$ ${fmt(data.total)}${extras.length ? ' · ' + extras.join(' · ') : ''}`)
  } catch (e) {
    erro.textContent = e.message || 'Erro ao criar pedido.'
  } finally {
    btn.disabled = false
    btn.textContent = '✅ Criar pedido'
  }
}


/* ─── START ──────────────────────────────────────── */
// Sem tela de login: o painel é interno e abre direto.
document.addEventListener('DOMContentLoaded', () => {
  try { Notification.requestPermission().catch(() => {}) } catch (e) {}
  iniciarPainel()
})
