# APIs consumidas

O Globo 3D conversa com **duas APIs externas**, ambas públicas, sem chave e sem cadastro, chamadas direto do navegador. Todo o resto (mapa, cidades, tráfego) vem empacotado no próprio build ou é simulado.

| # | Serviço | Para que serve | Quando é chamada | Autenticação |
|---|---|---|---|---|
| 1 | USGS Earthquake Feed | Terremotos das últimas 24 h | Ao abrir e a cada 60 s no modo sísmico | Nenhuma |
| 2 | Nominatim (OpenStreetMap) | Busca de qualquer lugar do mundo | Depois de 650 ms sem digitar, se a busca local não bastar | Nenhuma |

---

## 1. USGS Earthquake Feed

Código: `src/services/dataService.ts` (`fetchEarthquakes`).

- **Endpoint:** `GET https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson`
- **O que é:** feed GeoJSON do Serviço Geológico dos Estados Unidos com os terremotos de magnitude **2,5 ou maior** nas últimas 24 horas (o nome `2.5_day` significa isso).
- **Parâmetros:** nenhum. O feed é um arquivo fixo atualizado pelo USGS.
- **Opções da requisição:** `cache: 'no-store'` e `AbortSignal`, para cancelar ao trocar de modo.
- **Frequência:** uma chamada ao entrar no modo sísmico e depois a cada **60 segundos** (`QUAKE_REFRESH_MS` em `src/App.tsx`).
- **Custo:** gratuito. O arquivo é pequeno, e 1 chamada por minuto é um uso leve.

### Campos usados da resposta

```json
{
  "features": [
    {
      "id": "us7000xxxx",
      "geometry": { "coordinates": [longitude, latitude, profundidade_km] },
      "properties": { "mag": 6.6, "place": "62 km SW of Kimbe, Papua New Guinea", "time": 1731850000000 }
    }
  ]
}
```

| Campo | Vira, no projeto |
|---|---|
| `geometry.coordinates[0]` e `[1]` | `lon` e `lat` do pin |
| `geometry.coordinates[2]` | `depthKm`, que define a cor (rasa até 70 km, intermediária de 70 a 300, profunda acima de 300) |
| `properties.mag` | `magnitude`, rótulo `M 6.6` e intensidade do pin. Itens sem magnitude são descartados |
| `properties.place` | texto do tooltip e do feed (inglês, como vem do USGS) |
| `properties.time` | horário do evento, em milissegundos Unix. Alimenta o feed e a linha do tempo de 24 h |

### Tratamento de falha

Se a chamada falhar por rede, bloqueio ou status diferente de 200, o app **não quebra**: registra um aviso no console e usa **48 terremotos de demonstração**. O HUD passa a mostrar `OFFLINE` e a fonte `DEMO · USGS indisponível`. Quando a chamada é cancelada de propósito (`AbortError`), nada é mostrado.

### Pontos de atenção

- O feed é público e feito para consumo direto de páginas web. Não foi possível testar a chamada no ambiente de desenvolvimento (rede bloqueada), então vale conferir uma vez no site publicado.
- O feed só traz as últimas 24 horas. A linha do tempo não volta além disso.
- Os horários chegam em UTC e são convertidos no navegador.

---

## 2. Nominatim (OpenStreetMap)

Código: `src/services/geocodeService.ts` (`searchOnline`) e `src/components/SearchBar.tsx`.

- **Endpoint:** `GET https://nominatim.openstreetmap.org/search`
- **O que é:** geocodificador do projeto OpenStreetMap. Converte texto (cidade, rua, ponto turístico) em coordenadas.

### Parâmetros enviados

| Parâmetro | Valor | Motivo |
|---|---|---|
| `q` | texto digitado | termo da busca |
| `format` | `jsonv2` | resposta em JSON |
| `limit` | `6` | no máximo 6 sugestões |
| `accept-language` | `pt-BR` | nomes em português quando existirem |

Cabeçalho: `Accept: application/json`. Também usa `AbortSignal`.

### Como a busca funciona

1. A cada tecla, a barra consulta primeiro o **índice local** (países com nome em português e cidades fixas). É instantâneo e não usa rede.
2. Se o usuário parar de digitar por **650 ms**, chama o Nominatim. Chamadas anteriores ainda pendentes são **canceladas**.
3. Resultados locais e online são mesclados e a câmera voa até o escolhido.

### Campos usados da resposta

| Campo | Vira, no projeto |
|---|---|
| `place_id` | id do resultado (`osm-<id>`) |
| `name` e `display_name` | nome principal e detalhe (últimos 3 níveis do endereço) |
| `lat` e `lon` | destino da câmera e do farol |
| `boundingbox` | define o quão perto a câmera chega: lugares grandes (país) ficam longe, pequenos (rua) ficam perto |
| `addresstype` | detalhe de apoio quando falta endereço |

### Limites e política de uso

- A política do Nominatim pede **no máximo 1 requisição por segundo** e uso leve. O debounce de 650 ms e o cancelamento das requisições antigas existem por isso.
- A atribuição **© OpenStreetMap contributors** aparece na própria barra de busca, como exige a licença.
- O servidor público não é para tráfego pesado. Para muito acesso, o caminho é hospedar o próprio Nominatim ou usar um provedor pago, trocando só a URL em `searchOnline`.
- Nesse caso de falha (rede, 429, bloqueio), a busca **continua funcionando só com o índice local**, sem mensagem de erro para o usuário.

---

## Dados que não são API (vêm no build)

| Dado | Origem | Onde é usado |
|---|---|---|
| Contorno dos continentes | pacote npm `world-atlas` (`land-110m.json`) | máscara de terra, pontos e litoral (`EarthMesh.ts`) |
| Países | pacote npm `world-atlas` (`countries-110m.json`) | busca local (`geocodeService.ts`) |
| 32 cidades-hub | lista fixa em `dataService.ts` | modo tráfego e busca local |
| Tráfego entre cidades | **simulado** em `makeTrafficArc` | modo tráfego. Os "Gb/s" e os tipos (CDN, Backup...) são sorteados, não medidos |

Os dois arquivos do `world-atlas` são lidos no momento do build, então o mapa funciona **sem rede**. O tráfego do modo "tráfego" é ilustrativo e não deve ser apresentado como dado real.

---

## Resumo para a apresentação

- **Duas** APIs, as duas gratuitas, sem chave e chamadas do navegador.
- **USGS** entrega os terremotos reais, atualizados a cada minuto.
- **Nominatim** entrega a busca de qualquer lugar do mundo.
- Sem internet, o globo continua abrindo, com dados de demonstração e busca local.
- O modo tráfego é simulação, e é bom dizer isso em voz alta.
