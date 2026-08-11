// Transcreve um pedaço de áudio (Whisper) e, quando for o campo "itens",
// também extrai os itens do pedido comparando o texto com o cardápio real
// (GPT), devolvendo produto_id + quantidade + observação já casados.
// Sem framework/build no projeto (site estático puro), então só usa APIs
// globais do runtime Node da Vercel — nada de dependência externa.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const { audio, mimetype, campo, produtos } = req.body || {};
  if (!audio) {
    res.status(400).json({ error: 'Áudio ausente' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY não configurada no projeto' });
    return;
  }

  try {
    const buffer = Buffer.from(audio, 'base64');
    const blob = new Blob([buffer], { type: (mimetype || 'audio/webm').split(';')[0] });

    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!whisperResp.ok) {
      const errTxt = await whisperResp.text();
      res.status(502).json({ error: `Whisper falhou: ${errTxt}` });
      return;
    }

    const whisperData = await whisperResp.json();
    const transcript = (whisperData.text || '').trim();

    if (campo !== 'itens' || !Array.isArray(produtos) || !produtos.length) {
      res.status(200).json({ transcript });
      return;
    }

    // Casa o texto falado com o cardápio real, pra não deixar a IA inventar
    // produto que não existe. Cada linha do cardápio é numerada e a IA só
    // pode responder com esses índices.
    const listaCardapio = produtos.map((p, i) => `${i}: ${p.nome} (${p.categoria || 'Outros'})`).join('\n');

    const gptResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Você extrai itens de pedido de um texto falado por um atendente de restaurante, casando com o cardápio abaixo. Responda SOMENTE em JSON no formato {"itens":[{"indice":N,"quantidade":N,"observacao":"texto ou null"}],"naoEncontrados":["trecho que não achou no cardápio"]}. Use "indice" só dos números da lista abaixo. Se o atendente falar o que vai dentro de uma marmita/marmitex (ex: "com frango e arroz"), coloque isso em "observacao" do item marmitex correspondente. Não invente produto fora da lista.\n\nCardápio:\n${listaCardapio}`,
          },
          { role: 'user', content: transcript },
        ],
      }),
    });

    if (!gptResp.ok) {
      const errTxt = await gptResp.text();
      res.status(502).json({ error: `Extração falhou: ${errTxt}`, transcript });
      return;
    }

    const gptData = await gptResp.json();
    let parsed = { itens: [], naoEncontrados: [] };
    try {
      parsed = JSON.parse(gptData.choices?.[0]?.message?.content || '{}');
    } catch {
      parsed = { itens: [], naoEncontrados: [] };
    }

    const itens = (parsed.itens || [])
      .map(it => {
        const produto = produtos[it.indice];
        if (!produto) return null;
        return {
          produto_id: produto.id,
          quantidade: Math.max(1, Number(it.quantidade) || 1),
          observacao: it.observacao || null,
        };
      })
      .filter(Boolean);

    res.status(200).json({ transcript, itens, naoEncontrados: parsed.naoEncontrados || [] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Erro inesperado' });
  }
};
