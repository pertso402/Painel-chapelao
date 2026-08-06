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
  midiaBuffet: null,
  cardapioHoje: false
}

/* ─── INIT PAINEL ───────────────────────────────── */
async function iniciarPainel() {
  await carregarPedidos()
  await carregarLojaStatus()
  await carregarMidiaBuffet()
  await carregarStatusCardapio()
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
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        line-height: 1.4;
        width: ${LARGURA_PAPEL_TERMICO};
        margin: 0;
        padding: 6px 8px;
      }
      h2 { text-align: center; font-size: 14px; margin: 4px 0; }
      p { margin: 3px 0; word-wrap: break-word; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      .row span:first-child { word-break: break-word; }
      .total { font-size: 14px; font-weight: bold; }
    </style></head><body>
    <h2>RESTAURANTE CHAPELAO</h2>
    <p style="text-align:center">Pedido #${p.numero_pedido}</p>
    <hr>
    <p><b>Cliente:</b> ${cliente?.nome || '-'}</p>
    <p><b>Tel:</b> ${cliente?.telefone || '-'}</p>
    <p><b>Entrega:</b> ${p.tipo_entrega === 'delivery' ? 'Delivery' : 'Retirada'}</p>
    ${p.endereco_entrega ? `<p><b>End:</b> ${p.endereco_entrega}</p>` : ''}
    <p><b>Pgto:</b> ${p.forma_pagamento || '-'}</p>
    ${p.observacao ? `<p><b>Obs:</b> ${p.observacao}</p>` : ''}
    <hr>
    ${itens.map(i => `<div class="row"><span>${i.quantidade}x ${i.nome_produto}</span><span>R$ ${fmt(i.total)}</span></div>`).join('')}
    <hr>
    ${taxa > 0 ? `<div class="row"><span>Taxa</span><span>R$ ${fmt(taxa)}</span></div>` : ''}
    <div class="row total"><span>TOTAL</span><span>R$ ${fmt(p.total)}</span></div>
    <hr>
    <p style="text-align:center;font-size:10px">${new Date(p.created_at).toLocaleString('pt-BR')}</p>
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

/* ─── START ──────────────────────────────────────── */
// Sem tela de login: o painel é interno e abre direto.
document.addEventListener('DOMContentLoaded', () => {
  try { Notification.requestPermission().catch(() => {}) } catch (e) {}
  iniciarPainel()
})
