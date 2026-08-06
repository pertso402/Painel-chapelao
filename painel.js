/* ═══════════════════════════════════════════════════
   RESTAURANTE CHAPELÃO — PAINEL DE PEDIDOS
═══════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://qlswjefuinhbtlhauhgj.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsc3dqZWZ1aW5oYnRsaGF1aGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTA5NDIsImV4cCI6MjA5Njg4Njk0Mn0.szmmoTuCHdhLP2jp-oY8ZBTaJLFqj-KBWYyQhGQqCBY'

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

const FLUXO_STATUS = ['pendente', 'preparando', 'pronto', 'saiu_entrega', 'entregue']

const P = {
  pedidos: [],
  tabAtiva: 'pendente',
  lojaAberta: true,
  midiaBuffet: null
}

/* ─── INIT PAINEL ───────────────────────────────── */
async function iniciarPainel() {
  await carregarPedidos()
  await carregarLojaStatus()
  await carregarMidiaBuffet()
  subscribeRealtime()
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

/* ─── START ──────────────────────────────────────── */
// Sem tela de login: o painel é interno e abre direto.
document.addEventListener('DOMContentLoaded', () => {
  try { Notification.requestPermission().catch(() => {}) } catch (e) {}
  iniciarPainel()
})
