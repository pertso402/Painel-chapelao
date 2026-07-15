/* ═══════════════════════════════════════════════════
   RESTAURANTE CHAPELÃO — ADMIN PANEL
═══════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://qlswjefuinhbtlhauhgj.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsc3dqZWZ1aW5oYnRsaGF1aGdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTA5NDIsImV4cCI6MjA5Njg4Njk0Mn0.szmmoTuCHdhLP2jp-oY8ZBTaJLFqj-KBWYyQhGQqCBY'

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

const SENHA_PADRAO = '0402'
const CAT_ORDER = ['Marmitex', 'Combos', 'Maioneses', 'Bebidas']

const A = {
  abaAtiva: 'produtos',
  produtos: [],
  info: {},
  mistura: null,
  editando: null,    // produto sendo editado
  imgUpload: null    // File para upload
}

/* ─── LOGIN ─────────────────────────────────────── */
function fazerLogin() {
  const senha = document.getElementById('login-senha').value
  const correta = A.info.senha_admin || SENHA_PADRAO
  if (senha === correta || senha === SENHA_PADRAO) {
    sessionStorage.setItem('admin_auth', '1')
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('admin-app').style.display = 'flex'
    iniciarAdmin()
  } else {
    document.getElementById('login-erro').textContent = 'Senha incorreta!'
    document.getElementById('login-senha').value = ''
  }
}

function sair() {
  sessionStorage.removeItem('admin_auth')
  location.reload()
}

document.getElementById('login-senha')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin()
})

/* ─── INIT ──────────────────────────────────────── */
async function iniciarAdmin() {
  await Promise.all([carregarProdutos(), carregarInfo(), carregarMistura()])
  renderAba()
}

async function carregarProdutos() {
  const { data } = await sb.from('produtos').select('*').order('categoria').order('nome')
  A.produtos = data || []
}

async function carregarInfo() {
  const { data } = await sb.from('info_restaurante').select('chave,valor')
  if (data) A.info = Object.fromEntries(data.map(r => [r.chave, r.valor]))
}

async function carregarMistura() {
  const { data } = await sb.from('misturas_do_dia').select('*')
    .eq('ativo', true).order('created_at', { ascending: false }).limit(1)
  A.mistura = data?.[0] || null
}

/* ─── ABAS ──────────────────────────────────────── */
function mudarAba(aba, btn) {
  A.abaAtiva = aba
  document.querySelectorAll('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  renderAba()
}

function renderAba() {
  const content = document.getElementById('admin-content')
  if (A.abaAtiva === 'produtos') content.innerHTML = renderProdutos()
  else if (A.abaAtiva === 'mistura') content.innerHTML = renderMistura()
  else if (A.abaAtiva === 'info') content.innerHTML = renderInfo()
}

/* ─── ABA PRODUTOS ──────────────────────────────── */
function renderProdutos() {
  const cats = [...new Set(A.produtos.map(p => p.categoria))]
    .sort((a, b) => {
      const ai = CAT_ORDER.indexOf(a), bi = CAT_ORDER.indexOf(b)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    })

  const lista = cats.map(cat => {
    const prods = A.produtos.filter(p => p.categoria === cat)
    return `
      <div style="margin-bottom:24px">
        <h3 style="font-size:14px;font-weight:800;color:var(--amarelo);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">${cat}</h3>
        <div class="produtos-admin-list">
          ${prods.map(p => cardProdutoAdmin(p)).join('')}
        </div>
      </div>`
  }).join('')

  return `
    <div class="section-header">
      <span class="section-title">Produtos</span>
      <button class="btn-novo" onclick="abrirModalProduto(null)">+ Novo Produto</button>
    </div>
    ${lista || '<p style="color:var(--text-muted);text-align:center;padding:40px">Nenhum produto cadastrado</p>'}`
}

function cardProdutoAdmin(p) {
  const img = p.imagem_url
    ? `<img src="${p.imagem_url}" class="prod-admin-img" alt="">`
    : `<div class="prod-admin-img">🍽️</div>`

  return `
    <div class="produto-admin-card">
      ${img}
      <div class="prod-admin-info">
        <div class="prod-admin-nome">${p.nome}</div>
        <div class="prod-admin-cat">${p.categoria}</div>
        <div class="prod-admin-preco">R$ ${fmt(p.preco)}</div>
      </div>
      <button class="toggle-disponivel${p.disponivel ? ' on' : ''}"
        title="${p.disponivel ? 'Disponível' : 'Indisponível'}"
        onclick="toggleDisponivel('${p.id}', ${!p.disponivel})"></button>
      <div class="prod-admin-actions">
        <button class="btn-icon editar" onclick="abrirModalProduto('${p.id}')" title="Editar">✏️</button>
        <button class="btn-icon deletar" onclick="deletarProduto('${p.id}', '${p.nome.replace(/'/g, "\\'")}')" title="Excluir">🗑️</button>
      </div>
    </div>`
}

async function toggleDisponivel(id, disponivel) {
  await sb.from('produtos').update({ disponivel }).eq('id', id)
  await carregarProdutos()
  renderAba()
}

async function deletarProduto(id, nome) {
  if (!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`)) return
  await sb.from('produtos').delete().eq('id', id)
  await carregarProdutos()
  renderAba()
  toast(`"${nome}" excluído`)
}

/* ─── MODAL PRODUTO ─────────────────────────────── */
function abrirModalProduto(id) {
  A.editando = id ? A.produtos.find(p => p.id === id) : null
  A.imgUpload = null
  const p = A.editando || {}

  const cats = [...new Set([...CAT_ORDER, ...A.produtos.map(x => x.categoria)])].filter(Boolean)

  document.getElementById('modal-produto-card').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <h2 style="font-size:18px;font-weight:800;color:var(--amarelo)">${id ? 'Editar Produto' : 'Novo Produto'}</h2>
      <button class="btn-sair" onclick="fecharModalProduto()">✕</button>
    </div>
    <div class="form-produto">
      <div class="input-group">
        <label class="input-label">Nome *</label>
        <input class="input-field" id="p-nome" type="text" placeholder="Ex: Marmitex Grande" value="${p.nome || ''}">
      </div>
      <div class="input-group">
        <label class="input-label">Descrição</label>
        <textarea class="input-field" id="p-desc" placeholder="Ingredientes, tamanho...">${p.descricao || ''}</textarea>
      </div>
      <div class="form-row">
        <div class="input-group">
          <label class="input-label">Categoria *</label>
          <select class="input-field" id="p-cat">
            ${cats.map(c => `<option value="${c}" ${p.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
            <option value="__nova">+ Nova categoria</option>
          </select>
        </div>
        <div class="input-group">
          <label class="input-label">Nova categoria (se selecionado acima)</label>
          <input class="input-field" id="p-cat-nova" type="text" placeholder="Nome da nova categoria">
        </div>
      </div>
      <div class="form-row">
        <div class="input-group">
          <label class="input-label">Preço (R$) *</label>
          <input class="input-field" id="p-preco" type="number" step="0.01" min="0" placeholder="0,00" value="${p.preco || ''}">
        </div>
        <div class="input-group">
          <label class="input-label">Preço promocional (R$)</label>
          <input class="input-field" id="p-promo" type="number" step="0.01" min="0" placeholder="Deixe vazio se não tiver" value="${p.preco_promocional || ''}">
        </div>
      </div>
      <div class="toggle-row">
        <span>Disponível para venda</span>
        <button class="toggle-disponivel${p.disponivel !== false ? ' on' : ''}" id="toggle-disp"
          onclick="this.classList.toggle('on')"></button>
      </div>
      <div class="toggle-row">
        <span>⭐ Produto destaque (aparece em evidência)</span>
        <button class="toggle-disponivel${p.destaque ? ' on' : ''}" id="toggle-dest"
          onclick="this.classList.toggle('on')"></button>
      </div>
      <div class="input-group">
        <label class="input-label">Foto do produto</label>
        <div class="upload-area" onclick="document.getElementById('p-img-input').click()">
          <input type="file" id="p-img-input" accept="image/*" onchange="previewImg(this)">
          ${p.imagem_url ? `<img id="upload-preview" src="${p.imagem_url}" class="upload-preview">` : '<img id="upload-preview" style="display:none" class="upload-preview">'}
          <div style="font-size:28px">📷</div>
          <p>Clique para selecionar uma foto</p>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn-status" style="flex:0" onclick="fecharModalProduto()">Cancelar</button>
      <button class="btn-novo" style="flex:1" onclick="salvarProduto()">
        ${id ? '💾 Salvar Alterações' : '✅ Criar Produto'}
      </button>
    </div>`

  document.getElementById('modal-produto').classList.add('open')
}

function fecharModalProduto() {
  document.getElementById('modal-produto').classList.remove('open')
  A.editando = null
  A.imgUpload = null
}

document.getElementById('modal-produto').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-produto')) fecharModalProduto()
})

function previewImg(input) {
  if (!input.files[0]) return
  A.imgUpload = input.files[0]
  const url = URL.createObjectURL(input.files[0])
  const preview = document.getElementById('upload-preview')
  preview.src = url
  preview.style.display = 'block'
}

async function salvarProduto() {
  const nome = document.getElementById('p-nome').value.trim()
  const desc = document.getElementById('p-desc').value.trim()
  const catSelect = document.getElementById('p-cat').value
  const catNova = document.getElementById('p-cat-nova').value.trim()
  const cat = catSelect === '__nova' ? catNova : catSelect
  const preco = parseFloat(document.getElementById('p-preco').value)
  const promo = document.getElementById('p-promo').value ? parseFloat(document.getElementById('p-promo').value) : null
  const disponivel = document.getElementById('toggle-disp').classList.contains('on')
  const destaque = document.getElementById('toggle-dest').classList.contains('on')

  if (!nome) { toast('Informe o nome do produto', 'error'); return }
  if (!cat) { toast('Informe a categoria', 'error'); return }
  if (!preco || preco <= 0) { toast('Informe um preço válido', 'error'); return }

  const btn = document.querySelector('#modal-produto-card .btn-novo')
  btn.disabled = true
  btn.textContent = 'Salvando...'

  try {
    let imagem_url = A.editando?.imagem_url || null

    if (A.imgUpload) {
      const ext = A.imgUpload.name.split('.').pop()
      const path = `produtos/${Date.now()}.${ext}`
      const { error: uploadErr } = await sb.storage
        .from('produto-fotos')
        .upload(path, A.imgUpload, { upsert: true })

      if (!uploadErr) {
        const { data: urlData } = sb.storage.from('produto-fotos').getPublicUrl(path)
        imagem_url = urlData.publicUrl
      }
    }

    const payload = { nome, descricao: desc || null, categoria: cat, preco, preco_promocional: promo, disponivel, destaque, imagem_url }

    if (A.editando) {
      await sb.from('produtos').update(payload).eq('id', A.editando.id)
      toast('Produto atualizado!')
    } else {
      await sb.from('produtos').insert(payload)
      toast('Produto criado!')
    }

    await carregarProdutos()
    fecharModalProduto()
    renderAba()
  } catch (err) {
    console.error(err)
    toast('Erro ao salvar produto', 'error')
  } finally {
    btn.disabled = false
  }
}

/* ─── ABA MISTURA DO DIA ────────────────────────── */
function renderMistura() {
  const m = A.mistura
  return `
    <div class="section-header">
      <span class="section-title">🌶️ Mistura do Dia</span>
    </div>
    <div class="mistura-editor">
      <div class="mistura-preview">
        <div class="mistura-preview-label">Mistura atual — aparece no cardápio</div>
        <p id="mistura-preview-txt" style="font-size:14px;color:var(--text-muted);margin-top:4px">${m?.descricao || 'Nenhuma mistura definida'}</p>
      </div>
      <div class="input-group">
        <label class="input-label">Descrição da mistura do dia *</label>
        <textarea class="input-field" id="mistura-desc" placeholder="Ex: Feijão tropeiro, arroz branco, bife acebolado e macarrão ao sugo..." rows="4">${m?.descricao || ''}</textarea>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Esta descrição aparece em destaque no topo das marmitas. Atualize diariamente!</p>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn-novo" onclick="salvarMistura()" style="flex:1">💾 Atualizar Mistura</button>
        <button class="btn-status" onclick="limparMistura()">🗑️ Limpar</button>
      </div>
    </div>

    <div style="margin-top:28px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text-muted);margin-bottom:12px">HISTÓRICO</h3>
      <div id="historico-misturas">Carregando...</div>
    </div>`
}

async function salvarMistura() {
  const desc = document.getElementById('mistura-desc').value.trim()
  if (!desc) { toast('Informe a descrição da mistura', 'error'); return }

  if (A.mistura) {
    await sb.from('misturas_do_dia').update({ descricao: desc, updated_at: new Date().toISOString() }).eq('id', A.mistura.id)
  } else {
    await sb.from('misturas_do_dia').insert({ titulo: '🌶️ Mistura do Dia', descricao: desc, ativo: true })
  }

  await carregarMistura()
  document.getElementById('mistura-preview-txt').textContent = desc
  toast('Mistura do dia atualizada! Cardápio atualizado em tempo real. 🌶️')
  carregarHistoricoMisturas()
}

async function limparMistura() {
  if (!A.mistura) return
  if (!confirm('Remover a mistura do dia do cardápio?')) return
  await sb.from('misturas_do_dia').update({ ativo: false }).eq('id', A.mistura.id)
  A.mistura = null
  toast('Mistura removida do cardápio')
  renderAba()
}

async function carregarHistoricoMisturas() {
  const el = document.getElementById('historico-misturas')
  if (!el) return
  const { data } = await sb.from('misturas_do_dia').select('*')
    .order('created_at', { ascending: false }).limit(10)
  if (!data || data.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sem histórico</p>'; return }
  el.innerHTML = data.map(m => `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div>
        <p style="font-size:13px">${m.descricao}</p>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">${new Date(m.created_at).toLocaleDateString('pt-BR')}</p>
      </div>
      <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${m.ativo ? 'rgba(74,222,128,.1)' : 'var(--bg-card2)'};color:${m.ativo ? '#4ADE80' : 'var(--text-muted)'};flex-shrink:0">${m.ativo ? 'Ativa' : 'Inativa'}</span>
    </div>`).join('')
}

/* ─── ABA CONFIGURAÇÕES ─────────────────────────── */
function renderInfo() {
  const i = A.info
  return `
    <div class="section-header">
      <span class="section-title">⚙️ Configurações</span>
    </div>

    <div style="margin-bottom:24px">
      <h3 style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Status da Loja</h3>
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px 20px">
        <div>
          <p style="font-weight:700">Loja ${i.loja_aberta !== 'false' ? '🟢 Aberta' : '🔴 Fechada'}</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:2px">Quando fechada, clientes não conseguem finalizar pedidos</p>
        </div>
        <button class="toggle-disponivel${i.loja_aberta !== 'false' ? ' on' : ''}" id="toggle-loja"
          onclick="this.classList.toggle('on')"></button>
      </div>
    </div>

    <h3 style="font-size:13px;font-weight:700;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Dados do Restaurante</h3>
    <div class="info-grid" style="margin-bottom:24px">
      <div class="input-group">
        <label class="input-label">Nome do restaurante</label>
        <input class="input-field" id="i-nome" type="text" value="${i.nome || ''}">
      </div>
      <div class="input-group">
        <label class="input-label">Horário de funcionamento</label>
        <input class="input-field" id="i-horario" type="text" value="${i.horario || ''}">
      </div>
      <div class="input-group">
        <label class="input-label">Endereço</label>
        <input class="input-field" id="i-endereco" type="text" value="${i.endereco || ''}">
      </div>
      <div class="input-group">
        <label class="input-label">WhatsApp (com DDI: 5511...)</label>
        <input class="input-field" id="i-wpp" type="text" placeholder="5511999999999" value="${i.whatsapp || ''}">
      </div>
      <div class="input-group">
        <label class="input-label">Chave PIX</label>
        <input class="input-field" id="i-pix" type="text" value="${i.chave_pix || ''}">
      </div>
      <div class="input-group">
        <label class="input-label">Taxa de entrega (R$)</label>
        <input class="input-field" id="i-taxa" type="number" min="0" step="0.5" value="${i.taxa_entrega || '0'}">
      </div>
      <div class="input-group">
        <label class="input-label">Pedido mínimo (R$, 0 = sem mínimo)</label>
        <input class="input-field" id="i-minimo" type="number" min="0" step="0.5" value="${i.pedido_minimo || '0'}">
      </div>
      <div class="input-group">
        <label class="input-label">Senha do painel admin</label>
        <input class="input-field" id="i-senha" type="password" placeholder="Nova senha (deixe vazio para manter)" autocomplete="new-password">
      </div>
    </div>

    <button class="btn-novo" style="width:100%" onclick="salvarInfo()">💾 Salvar Configurações</button>`
}

async function salvarInfo() {
  const lojaAberta = document.getElementById('toggle-loja').classList.contains('on')

  const atualizacoes = [
    { chave: 'loja_aberta', valor: lojaAberta ? 'true' : 'false' },
    { chave: 'nome', valor: document.getElementById('i-nome').value.trim() },
    { chave: 'horario', valor: document.getElementById('i-horario').value.trim() },
    { chave: 'endereco', valor: document.getElementById('i-endereco').value.trim() },
    { chave: 'whatsapp', valor: document.getElementById('i-wpp').value.trim() },
    { chave: 'chave_pix', valor: document.getElementById('i-pix').value.trim() },
    { chave: 'taxa_entrega', valor: document.getElementById('i-taxa').value || '0' },
    { chave: 'pedido_minimo', valor: document.getElementById('i-minimo').value || '0' },
  ]

  const novaSenha = document.getElementById('i-senha').value.trim()
  if (novaSenha) atualizacoes.push({ chave: 'senha_admin', valor: novaSenha })

  for (const { chave, valor } of atualizacoes) {
    if (!valor) continue
    await sb.from('info_restaurante')
      .upsert({ chave, valor }, { onConflict: 'chave' })
  }

  await carregarInfo()
  toast('Configurações salvas! ✅')
  renderAba()
}

/* ─── HELPERS ────────────────────────────────────── */
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

let toastTimer
function toast(msg, tipo = 'success') {
  let el = document.getElementById('toast-admin')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast-admin'
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.className = 'toast show ' + tipo
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.className = 'toast', 3500)
}

/* ─── AUTO-AUTH ─────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await carregarInfo()
  if (sessionStorage.getItem('admin_auth') === '1') {
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('admin-app').style.display = 'flex'
    iniciarAdmin()
  }
})
