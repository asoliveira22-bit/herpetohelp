# Pipeline automatizado SiBBr/GBIF — HerpetoHelp

## Objetivo

Processar os snapshots Darwin Core do SiBBr/GBIF por regras determinísticas, reduzindo a necessidade de revisão conversacional registro a registro. O modelo só deve ser usado nos casos taxonômicos ou de procedência que permaneçam como exceção.

## Princípios

1. O ZIP bruto é preservado sem alteração e pode ser conferido por SHA-256.
2. Registros originários do iNaturalist não entram na camada pública, inclusive grau de pesquisa.
3. Fósseis não entram na camada pública.
4. Coordenadas ausentes, inválidas, fora do Brasil ou incompatíveis com o país são excluídas automaticamente.
5. Taxonomia é reconciliada apenas por um mapa explícito e auditável. Relações que não autorizam fusão automática ficam em revisão manual.
6. A procedência de cada dataset é controlada por uma tabela própria. Dataset não auditado permanece fora da camada pública por padrão.
7. O pipeline nunca publica o HerpetoHelp. O resultado é apenas um pacote candidato para revisão.

## Entradas

- um ou mais ZIPs oficiais GBIF/SiBBr contendo `occurrence.txt`;
- `taxonomy_map.tsv`, derivado das bases taxonômicas vigentes do projeto;
- `provenance_map.tsv`, com a decisão de procedência por dataset;
- opcionalmente um GeoJSON do limite oficial do Brasil;
- opcionalmente hashes SHA-256 esperados dos snapshots.

O mapa taxonômico deve conter, no mínimo, `input_name` e `accepted_name`. Campos recomendados: `family`, `group`, `relation`, `merge_allowed`.

O mapa de procedência deve conter um identificador de dataset (`datasetKey` ou equivalente), `status` e, opcionalmente, `note`. Os estados `APPROVED`, `VALIDATED` e `VERIFIED` são elegíveis; estados não revisados ficam em revisão manual.

## Execução

Exemplo:

```bash
python3 scripts/process-sibbr-gbif.py \
  /dados/0013308-260903145123482.zip \
  /dados/0013325-260903145123482.zip \
  /dados/0013326-260903145123482.zip \
  /dados/0013359-260903145123482.zip \
  --taxonomy-map /dados/taxonomy_map.tsv \
  --provenance-map /dados/provenance_map.tsv \
  --brazil-geojson /dados/brasil.geojson \
  --raw-archive-dir /arquivo/00_BASE_BRUTA \
  --out-dir /arquivo/01_BASE_TRATADA_HERPETOHELP
```

Também pode ser chamado por `npm run data:sibbr -- ...`.

## Saídas

- `SiBBr_VALIDADO.tsv.gz`: registros que passaram por todas as regras automáticas e possuem taxonomia/procedência aprovadas;
- `SiBBr_EXCLUIDOS.tsv.gz`: registros rejeitados por regra determinística;
- `SiBBr_REVISAO_MANUAL.tsv.gz`: somente as exceções que exigem decisão humana;
- `SiBBr_AUDITORIA.tsv.gz`: trilha completa com decisão e motivo por registro;
- `SiBBr_PROVENIENCIA_DATASETS.tsv`: inventário dos datasets encontrados e seus estados;
- `summary.json`: contagens, motivos e bloqueios;
- `manifest.json`: hashes, status do release e indicação de revisão manual.

A saída nunca recebe autorização de publicação automática. `publication_allowed` permanece `false` e a promoção para o site exige aprovação expressa.

## Regras atuais

- `SOURCE_INATURALIST`: excluído;
- `FOSSIL_SPECIMEN`: excluído;
- `OCCURRENCE_NOT_PRESENT`: excluído;
- coordenada ausente/inválida/fora do intervalo: excluído;
- país diferente de Brasil: excluído;
- fora do envelope do Brasil: excluído;
- fora do polígono do Brasil, quando fornecido: excluído;
- nome sem reconciliação inequívoca: revisão manual;
- relação taxonômica com `merge_allowed=false`: revisão manual;
- procedência não auditada: revisão manual;
- procedência rejeitada: excluído;
- duplicata exata pelo identificador de ocorrência: excluída da base validada e preservada na auditoria.

## Fluxo mensal

O monitoramento de novos registros do SiBBr deve permanecer leve: detectar se existe snapshot oficial novo ou mudança relevante. O processamento pesado deve ser feito por este script, sem leitura registro a registro pelo modelo.

A sincronização mensal do HerpetoHelp deve consumir apenas um pacote produzido por este pipeline. Se `manual_review_required=true`, houver `blockers`, ou a versão não for inequivocamente mais recente, o site público permanece inalterado.

SALVE e SiBBr continuam fontes independentes e rastreáveis. Não há deduplicação automática entre fontes apenas por proximidade espacial ou espécie.
