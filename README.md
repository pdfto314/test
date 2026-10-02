# 🎲 Jogatina Soundboard

Soundboard de mesa de RPG feito para o **iPad**: ambientes em loop, efeitos, trilhas e cenas.

## Usar no iPad

1. Abra o site no Safari e toque em **Compartilhar → Adicionar à Tela de Início** (abre em tela cheia, como app).
2. Toque em **Começar** (o iPad só libera áudio depois de um toque) ou **Continuar cena anterior**.
3. Escolha um tema na lateral (ou na faixa de cima, com o iPad em pé):
   - 🟧 **Ambiente** (sons longos): toque liga/desliga o loop, com fade.
   - 🟦 **Efeito** (sons de até 20 s): toque toca uma vez.
   - O botão do canto faz o contrário (efeito em loop, ou ambiente uma vez só).
4. Embaixo, em **Tocando**, ajuste o volume de cada som ou pare com ✕. *Ambiente* e *Efeitos* são o volume geral de cada tipo.
5. **🎬 Cenas**: salve o que está tocando (ex.: “Taverna chuvosa”) e troque de cena com transição suave.
6. **🔎 Busca** procura em todos os temas; **🕘 Recentes** guarda os últimos sons tocados; **ⓘ** mostra os créditos.

A tela fica acesa enquanto tiver som tocando.

## Organização dos sons

```
audio/
  Ambientes/   Chuva e Tempestade · Floresta e Campos · Mar e Porto · Cavernas e Masmorras · Rituais Sombrios
  Trilhas/     Keep on the Borderlands · Batalha · Tensão e Mistério · Cultistas
  Criaturas/   Aranha · Cavalo · Coruja · Dragão · Goblin · Lobo · Minotauro · Mortos-vivos · Rato · Warg
  Efeitos/     Combate
```

Cada pasta `audio/<Grupo>/<Tema>/` vira um tema no app, e **o nome do arquivo é o nome do som**.

## Adicionar sons

**Pelo iPad (ou navegador do PC):** toque em **＋ Sons**, escolha o tema (ou crie um novo), selecione os arquivos e envie.
Na primeira vez, conecte com um token do GitHub — as instruções aparecem na tela:
GitHub → Settings → Developer settings → *Fine-grained tokens* → *Generate new token* →
*Only select repositories* (este) → *Permissions → Contents: Read and write*.
O token fica salvo só naquele aparelho. Os sons aparecem em ~1 minuto.

**Pelo PC (git):** coloque os arquivos em `audio/<Grupo>/<Tema>/` e faça commit + push na `main`.
O GitHub Action (`.github/workflows/playlist.yml`) atualiza o `playlist.json` sozinho — depois rode `git pull`.
Se o Action falhar ao dar push: *Settings → Actions → General → Workflow permissions → Read and write permissions*.

Formatos aceitos: mp3, m4a, wav, ogg.

## Arquivos

| Arquivo | Para quê |
| --- | --- |
| `index.html`, `style.css`, `app.js` | o app |
| `upload.js` | envio de sons pelo app (＋ Sons) |
| `playlist.json` | lista de sons (gerada; não precisa editar) |
| `credits.json` | autores e licenças dos sons do Freesound |
| `renomeados.json` | caminhos antigos → novos (atualiza cenas salvas no aparelho) |
| `ferramentas/gerar_playlist.py` | gera o `playlist.json` (`python ferramentas/gerar_playlist.py`) |
| `ferramentas/*.bat`, `*.ps1` | Windows: gerar playlist e baixar sons do Freesound |
