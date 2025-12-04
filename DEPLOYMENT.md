# Deploy do Horriver Plate (Render)

Guia rápido para publicar a versão atual no Render usando o repositório Git como fonte.

## Pré-requisitos
- Repositório conectado ao Render (GitHub/GitLab) com acesso de leitura.
- Plano gratuito ou pago de Postgres configurado no Render.
- Node 20 disponível (já definido em `package.json`).

## Variáveis de ambiente necessárias
Configure-as no painel do Render (Settings > Environment):

- `DATABASE_URL`: URL completa do Postgres (use a conexão externa do Render). 
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: credenciais para o painel admin.
- `JWT_SECRET`: chave segura para assinar tokens de sessão.
- `PORT`: normalmente 10000 no Render (o Render injeta a porta em runtime, mas definir ajuda localmente).

## Passo a passo (novo deploy)
1. **Crie ou selecione um banco Postgres** no Render e copie a `External Database URL` (use SSL).
2. **Crie um novo Web Service** apontando para este repo. 
   - Build Command: `npm install`
   - Start Command: `npm start`
3. **Adicione as variáveis de ambiente** acima no serviço.
4. **Aplique o schema do Prisma**: 
   - Opção A (preferida): ative um *Deploy Hook* ou script de inicialização antes do start rodando `npx prisma migrate deploy`. No Render, adicione um *Post-deploy command* com `npx prisma migrate deploy`.
   - Opção B (manual): abra um shell do serviço e rode `npx prisma migrate deploy` sempre que o schema mudar.
5. **Faça o primeiro deploy**; o Render instala dependências, aplica migrations (conforme configurado) e sobe o servidor.

## Atualizar uma versão existente
1. `git pull` no repositório local e faça suas alterações.
2. `npm install` (se dependências novas) e teste localmente com `npm run dev`.
3. `npm run prisma:migrate` se o schema mudou; commite a migration gerada.
4. `git push` para o branch que o Render monitora (geralmente `main`).
5. O Render fará o deploy automaticamente; confirme que o *Post-deploy command* executa `npx prisma migrate deploy`.

## Verificação pós-deploy
- Acesse a URL pública do serviço e o painel admin para validar login.
- Teste a rota pública de votação `/votar/:token` com um token válido.
- No painel admin de partidas, confirme que geração de links e reset funcionam após o deploy.

## Dicas rápidas
- Use `npm run prisma:generate` localmente após pull se o client mudar.
- Em caso de erro de SSL no Postgres do Render, adicione `?sslmode=require` ao `DATABASE_URL`.
- Mantenha `JWT_SECRET` longo e único para produção.
