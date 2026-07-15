/* ═══════════════════════════════════════════════════
   RESTAURANTE CHAPELÃO — PAINEL DE PEDIDOS
═══════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://qlswjefuinhbtlhauhgj.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsc3dqZWZ1aW5oYnRsaGF1aGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTA5NDIsImV4cCI6MjA5Njg4Njk0Mn0.szmmoTuCHdhLP2jp-oY8ZBTaJLFqj-KBWYyQhGQqCBY'

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

const SENHA_PADRAO = '0402'
const FLUXO_STATUS = ['pendente', 'preparando', 'pronto', 'saiu_entrega', 'entregue']

const P = {
  pedidos: [],
  tabAtiva: 'pendente',
  lojaAberta: true,
  senhaAdmin: SENHA_PADRAO
}

/* ─── LOGIN ─────────────────────────────────────── */
function fazerLogin() {
  const senha = document.getElementById('login-senha').value
  const correta = P.senhaAdmin || SENHA_PADRAO
  if (senha === correta) {
    sessionStorage.setItem('painel_auth', '1')
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('painel-app').style.display = 'flex'
    document.getElementById('painel-app').style.flexDirection = 'column'
    // Pede permissão de notificação no gesto do usuário (boa prática)
    try { Notification.requestPermission().catch(() => {}) } catch (e) {}
    iniciarPainel()
  } else {
    document.getElementById('login-erro').textContent = 'Senha incorreta!'
    document.getElementById('login-senha').value = ''
  }
}

function sair() {
  sessionStorage.removeItem('painel_auth')
  location.reload()
}

document.getElementById('login-senha')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin()
})

/* ─── INIT PAINEL ───────────────────────────────── */
async function iniciarPainel() {
  await carregarSenha()
  await carregarPedidos()
  await carregarLojaStatus()
  subscribeRealtime()
}

async function carregarSenha() {
  const { data } = await sb.from('info_restaurante')
    .select('valor').eq('chave', 'senha_admin').maybeSingle()
  if (data) P.senhaAdmin = data.valor
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
      forma_pagamento, subtotal, taxa_entrega, total, observacao,
      created_at, updated_at,
      clientes ( id, nome, telefone ),
      itens_pedido ( nome_produto, quantidade, preco_unitario, total )
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
    .subscribe()
}

function tocaSom() {
  try {
    const ctx = new AudioContext()
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

  return `
    <div class="pedido-card ${cls}" onclick="abrirDetalhes('${p.id}')">
      <div class="pc-header">
        <span class="pc-numero">#${p.numero_pedido}</span>
        <span class="pc-tempo${urgente}">⏱ ${tempo}</span>
      </div>
      <span class="pc-status-pill">${statusLabel(status)}</span>
      <div class="pc-cliente">👤 ${cliente?.nome || 'Cliente'}</div>
      <div class="pc-info">
        <span class="pc-badge ${tipo === 'delivery' ? 'delivery' : ''}">${tipo === 'delivery' ? '🛵 Delivery' : '🏃 Retirada'}</span>
        <span class="pc-badge ${pgto === 'pix' ? 'pix' : ''}">${pgtoLabel(pgto)}</span>
      </div>
      <div class="pc-itens">${itensTexto || '—'}</div>
      <div class="pc-total">R$ ${fmt(p.total)}</div>
      <div class="pc-actions" onclick="event.stopPropagation()">
        ${acoes}
      </div>
    </div>`
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
async function mudarStatus(id, novoStatus) {
  await sb.from('pedidos').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', id)
  await carregarPedidos()
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
      ${p.troco_para ? `<span><strong style="color:var(--text)">💵 Troco para:</strong> R$ ${fmt(p.troco_para)}</span>` : ''}
      ${p.observacao ? `<span><strong style="color:var(--text)">📝 Obs:</strong> ${p.observacao}</span>` : ''}
    </div>
    <div style="background:var(--bg-card2);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px">
      ${itens.map(i => `
        <div style="display:flex;justify-content:space-between;font-size:13px">
          <span>${i.quantidade}x ${i.nome_produto}</span>
          <span style="color:var(--amarelo);font-weight:700">R$ ${fmt(i.total)}</span>
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
function imprimirPedido(id) {
  const p = P.pedidos.find(x => x.id === id)
  if (!p) return

  const cliente = p.clientes
  const itens = p.itens_pedido || []
  const taxa = parseFloat(p.taxa_entrega || 0)

  const win = window.open('', '_blank', 'width=400,height=600')
  win.document.write(`
    <html><head><title>Pedido #${p.numero_pedido}</title>
    <style>
      body { font-family: monospace; font-size: 13px; padding: 16px; }
      h2 { text-align: center; font-size: 16px; }
      hr { margin: 8px 0; }
      .row { display: flex; justify-content: space-between; }
      .total { font-size: 15px; font-weight: bold; }
    </style></head><body>
    <h2>🎩 RESTAURANTE CHAPELÃO</h2>
    <p style="text-align:center">Pedido #${p.numero_pedido}</p>
    <hr>
    <p><b>Cliente:</b> ${cliente?.nome || '—'}</p>
    <p><b>Tel:</b> ${cliente?.telefone || '—'}</p>
    <p><b>Entrega:</b> ${p.tipo_entrega === 'delivery' ? 'Delivery' : 'Retirada'}</p>
    ${p.endereco_entrega ? `<p><b>End:</b> ${p.endereco_entrega}</p>` : ''}
    <p><b>Pgto:</b> ${p.forma_pagamento || '—'}</p>
    ${p.observacao ? `<p><b>Obs:</b> ${p.observacao}</p>` : ''}
    <hr>
    ${itens.map(i => `<div class="row"><span>${i.quantidade}x ${i.nome_produto}</span><span>R$ ${fmt(i.total)}</span></div>`).join('')}
    <hr>
    ${taxa > 0 ? `<div class="row"><span>Taxa</span><span>R$ ${fmt(taxa)}</span></div>` : ''}
    <div class="row total"><span>TOTAL</span><span>R$ ${fmt(p.total)}</span></div>
    <hr>
    <p style="text-align:center;font-size:11px">${new Date(p.created_at).toLocaleString('pt-BR')}</p>
    <script>window.onload=()=>{window.print();window.close()}<\/script>
    </body></html>`)
  win.document.close()
}

/* ─── LOJA TOGGLE ───────────────────────────────── */
async function toggleLoja() {
  P.lojaAberta = !P.lojaAberta
  await sb.from('info_restaurante')
    .update({ valor: P.lojaAberta ? 'true' : 'false' })
    .eq('chave', 'loja_aberta')
  atualizarToggleLoja()
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

/* ─── AUTO-CHECK AUTH ────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('painel_auth') === '1') {
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('painel-app').style.display = 'flex'
    document.getElementById('painel-app').style.flexDirection = 'column'
    iniciarPainel()
  }
})
