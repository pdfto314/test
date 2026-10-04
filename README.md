# 🎲 Jogatina Soundboard

Soundboard de mesa de RPG feito para o **iPad**: ambientes, trilhas, criaturas e efeitos, com cenas prontas e sons que tocam sozinhos.

## ⚙️ Configuração única (uma vez só)

No GitHub: **Settings → Pages → Build and deployment → Source: “GitHub Actions”**.

Pronto. A partir daí o site é publicado pelo workflow **Publicar site** (`.github/workflows/publicar.yml`) a cada mudança na `main`. O `playlist.json` é **gerado no deploy** e não fica no repositório, então **nenhum robô faz commit na main e você nunca precisa dar `git pull`** depois de enviar sons.

> Se já mudou a fonte e o site não atualizou, rode o workflow uma vez: *Actions → Publicar site → Run workflow*.

## Usar no iPad

1. Abra o site no Safari → **Compartilhar → Adicionar à Tela de Início** (tela cheia, como app).
2. **Começar a sessão** (ou **Continuar cena anterior**) e escolha uma **cena pronta** ou um tema.

| Gesto | O que faz |
| --- | --- |
| **Toque** num ambiente (∞) | liga/desliga o loop, com fade |
| **Toque** num efeito (⚡, até 20 s) | toca uma vez |
| Botão do canto do card | o contrário (efeito em loop / ambiente 1×) |
| **Segurar** um som (clique direito no PC) | loop, 1×, **🎲 aleatório**, volume, ⭐ favorito, ✏️ editar |

- **🎲 Aleatório**: o som toca sozinho de tempos em tempos (frequente / às vezes / raro).
- **🎬 Cenas** guardam ambientes + aleatórios + volumes; as **compartilhadas** (em `cenas.json`) aparecem em todos os aparelhos.
- **Fundo animado**: o fundo vira um "vídeo" do que está tocando — chuva com relâmpagos, vagalumes, ondas, pingos, brasas, névoa, faíscas — pulsando com o áudio (desligável em ⚙️ Ajustes; respeita "reduzir movimento").
- **Uma trilha por vez**, **🎲 Surpresa** por tema, **⭐ Favoritos**, **🕘 Recentes**, **🔎 busca**, visualizador e tela sempre acesa.

## Colocar sons no site — 3 jeitos, nenhum precisa de `git pull`

Estrutura: `audio/<Grupo>/<Tema>/<Som>.mp3` (o nome do arquivo é o nome do som; até 20 s vira efeito).

### 1. Pelo app (iPad, celular ou navegador do PC)
**⚙️ Ajustes → GitHub**: cole um token *fine-grained* e crie uma senha (uma vez por aparelho). Depois:
- **＋ Sons**: escolha arquivos — ou, no PC, **pastas inteiras** (`Taverna/` vira o tema *Taverna*; `Ambientes/Taverna/` vira grupo + tema). Sons repetidos são reconhecidos e pulados.
- **Segurar um som → ✏️ Editar**: renomear, mover de tema ou remover (cenas e créditos acompanham).
- **🎬 Cenas → Compartilhar** para todos os aparelhos.

Token: GitHub → *Settings → Developer settings → Fine-grained tokens → Generate* → *Only select repositories* (este) → *Permissions → Contents: Read and write*.

### 2. Pela pasta do computador (sem git)
`ferramentas/sincronizar.py` sincroniza uma pasta comum do PC com o repositório pela API — sem clone, sem pull. No Windows é só abrir **`ferramentas/sincronizar.bat`** (menu). No terminal:

```bash
pip install keyring                         # opcional: guarda o token no cofre do sistema
python ferramentas/sincronizar.py token     # uma vez
python ferramentas/sincronizar.py status "Sons Jogatina"
python ferramentas/sincronizar.py enviar "Sons Jogatina"            # novos e alterados (um commit)
python ferramentas/sincronizar.py enviar "Sons Jogatina" --apagar   # espelha: remove o que saiu da pasta
python ferramentas/sincronizar.py baixar "Sons Jogatina"            # cópia local do acervo
python ferramentas/sincronizar.py freesound "owl hoot" --tema "Criaturas/Coruja" --quantos 3
python ferramentas/sincronizar.py freesound --lote ferramentas/heroes_queries.json
```
Arquivos movidos/renomeados não são reenviados (o conteúdo é reconhecido pelo hash do git). Use `--simular` para ver antes.

### 3. Por git (se preferir)
`git add audio/… && git commit && git push`. O deploy gera a playlist; nada volta para a `main`.

## 🔐 Segurança

- **App**: o token é cifrado no aparelho com **AES-256-GCM**, chave derivada da sua senha (**PBKDF2-SHA256, 310 mil iterações**, sal aleatório). Nunca fica salvo em texto puro; só existe decifrado na memória depois de desbloquear, **bloqueia sozinho após 30 min** sem uso, e **10 senhas erradas apagam o token** do aparelho.
- Ao conectar, o app confere se o token consegue escrever e **avisa se for um token clássico** (que dá acesso a todos os seus repositórios).
- **CSP** (`index.html`): o site só executa os próprios scripts e só se conecta ao próprio site e a `api.github.com`.
- **PC**: o token vem de variável de ambiente ou do **cofre do sistema** (Windows Credential Manager / Chaves do macOS); nunca é gravado em arquivo. A chave do Freesound idem.
- Cada operação é **um único commit atômico**; se o repositório mudar no meio, a operação é refeita sobre a versão nova sem apagar o trabalho de ninguém.

## ✅ Testes

Rodam no GitHub a cada PR e push (workflow **Testes**). Localmente:

```bash
pip install mutagen && python -m unittest discover -s ferramentas/testes -v   # sincronizar.py e gerar_playlist.py
python ferramentas/gerar_playlist.py && npm install && npx playwright install chromium
npm test                                                                      # regras, cofre e app no navegador
```

Os testes usam um GitHub e um Freesound **simulados com estado real** (blobs, árvores e commits com hash do git), cobrindo: envio, repetidos, mover/renomear, espelhar, corridas entre dois envios, token inválido, download, Freesound, cofre do token, CSP e o app inteiro no navegador.

## Arquivos

| Arquivo | Para quê |
| --- | --- |
| `index.html`, `style.css` | página e visual |
| `js/app.js` | telas, navegação, painel do som, barra “Tocando” |
| `js/engine.js` | motor de áudio (Web Audio: volumes, fades, aleatórios, visualizador) |
| `js/backdrop.js` | fundo animado por tema (canvas, reage ao áudio) |
| `js/library.js` | biblioteca, favoritos, recentes, créditos |
| `js/scenes.js` | cenas (do aparelho e compartilhadas) |
| `js/manage.js` | enviar arquivos/pastas, renomear, mover, remover |
| `js/github.js` · `js/vault.js` | API do GitHub · cofre do token |
| `js/rules.js` | regras puras (nomes, playlist, hash do git) |
| `cenas.json` · `credits.json` | cenas compartilhadas · autores/licenças (ⓘ Créditos) |
| `renomeados.json` | caminhos antigos → novos (atualiza dados salvos no aparelho) |
| `ferramentas/` | `sincronizar.py`/`.bat`, `gerar_playlist.py`, `heroes_queries.json`, testes |
| `tests/` | testes de JavaScript e do app no navegador |
| `.github/workflows/` | `publicar.yml` (deploy) e `testes.yml` (CI) |
