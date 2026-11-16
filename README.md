# ORBITAL//SYS-01 · Globo 3D com dados ao vivo

Globo terrestre em WebGL (Vite + React + TypeScript + Three.js + Tailwind) com terremotos reais da USGS,
modo de tráfego global simulado, partículas, bloom forte, aberração cromática espectral e distorção de calor.

## Rodar localmente
```bash
pnpm install        # ou npm install
pnpm dev            # abre em http://localhost:5173
```

## Para apresentar
- `apresentacao/globo-3d.html` é um arquivo único e autocontido: abra com duplo clique no Chrome/Edge.
  Os dados da USGS são buscados ao vivo se houver internet; sem internet, entra o modo "OFFLINE · DEMO".
- `pnpm build` gera `dist/` (site estático para Vercel, Netlify Drop ou GitHub Pages).
- `pnpm build:single` gera `dist-single/index.html` (o mesmo arquivo único da pasta apresentacao).

## Atalhos
| Tecla | Ação |
|---|---|
| G | painel de calibração (lil-gui): bloom, aberração, calor, velocidades, escala |
| F | abre/fecha o feed lateral |
| T | tour automático pelos eventos mais intensos |
| M | alterna Sísmico / Tráfego |
| H | esconde o HUD (para prints e vídeo) |
| P | modo apresentação: faixas de cinema, tour cinematográfico e legenda grande (Esc sai) |
| Espaço | reproduz/pausa a linha do tempo das 24 h (modo Sísmico) |
| / ou Ctrl+K | foca a barra de busca |

Clique num item do feed ou num pin para a câmera voar até o ponto. Passe o mouse num pin para ver magnitude, local, horário e profundidade. Arraste para girar, role para aproximar.

## Busca de lugares
A barra no topo sugere países (Natural Earth, com nomes em português) e cidades-hub na hora, sem internet.
Com internet, também consulta o Nominatim do OpenStreetMap (gratuito, até 1 requisição por segundo, por isso a busca espera você parar de digitar).
Ao escolher um lugar, a câmera faz uma aproximação cinematográfica, um farol marca o ponto e um cartão mostra quantos eventos há a menos de 500 km.

## Linha do tempo
No modo Sísmico, o histograma no rodapé mostra os eventos por hora nas últimas 24 h. O play reproduz o dia em 24 segundos, com cada terremoto "explodindo" na hora em que aconteceu. Arraste o controle para ir a um horário específico.

## Cores dos pins
Cor = profundidade do terremoto (rasa 0–70 km, intermediária 70–300 km, profunda > 300 km). Tamanho = magnitude.

## Estrutura
- `src/scene/GlobeScene.ts`: cena, câmera, OrbitControls com damping, pós-processamento (Bloom + aberração + calor + vinheta), lil-gui, voo de câmera.
- `src/scene/EarthMesh.ts`: esfera de vidro escuro, continentes em pontos (world-atlas rasterizado), atmosfera fresnel prismática.
- `src/scene/ArcsLayer.ts`: arcos Bézier de partículas calculados na GPU, com aceleração de A para B e franja cromática.
- `src/scene/PinsLayer.ts`: erupções nos pins (núcleo, ondas de choque, faíscas, lens flare anamórfico).
- `src/scene/RingsLayer.ts`: disco de acreção e órbitas secundárias com rastro e beaming Doppler.
- `src/utils/geo.ts`: lat/lon para x,y,z e utilidades.
- `src/services/dataService.ts`: USGS (2.5_day) com fallback de demonstração + simulador de tráfego entre hubs.
- `src/services/geocodeService.ts`: busca local (países e cidades) + Nominatim/OpenStreetMap.
- `src/scene/BeaconLayer.ts`: farol do local buscado (feixe, ondas e mira).
- `src/components/SearchBar.tsx` e `src/components/Timeline.tsx`: busca e linha do tempo.
- `src/utils/depth.ts`: classes de profundidade e cores.

Dados do modo Tráfego são simulados e estão identificados assim na tela.
