# Arena Dex

Jogo de adivinhar Pokémon pela silhueta. É possível jogar sozinho ou competir com amigos em uma sala de até oito pessoas, acessada por código. Só é preciso escolher um nome.

## Como funciona

- Dez rodadas de 30 segundos, com cinco segundos para a revelação.
- Duas dicas por rodada, sobre tipo, altura e peso. Cada dica reduz a pontuação da rodada.
- Classificação atualizada durante a partida. Na competição, o servidor calcula a pontuação e não envia a resposta antes da revelação.
- Salas temporárias de duas horas, sem cadastro. O código e o acesso do jogador são guardados apenas na sessão do navegador.

## Rodar localmente

Requer Node.js 20 ou superior. Instale as dependências com `npm ci`, configure as variáveis abaixo em um arquivo `.env.local` e execute `npx vercel dev`. O modo solo consulta a [PokéAPI](https://pokeapi.co/) diretamente; as salas usam as Functions da Vercel e Redis.

```dotenv
UPSTASH_REDIS_REST_URL=https://seu-banco.upstash.io
UPSTASH_REDIS_REST_TOKEN=seu-token
```

Crie um banco Redis no plano gratuito da integração Upstash na Vercel e vincule-o ao projeto nos ambientes Production e Preview. Confirme que os nomes das variáveis no painel são exatamente os mostrados acima. Não publique o arquivo com os valores reais.

Execute `npm test` para testar pontuação, estados da partida, autenticação anônima, limites de requisição, proxy das silhuetas e integração das rotas. O projeto é publicado em [pokemon.gabrieldagostim.com](https://pokemon.gabrieldagostim.com/).

Dados e imagens dos Pokémon são da [PokéAPI](https://pokeapi.co/) e do [repositório oficial de sprites](https://github.com/PokeAPI/sprites). Projeto de fã, sem vínculo oficial com Pokémon.
