# Estrutura do Projeto

## O que entra no repositório

Devem ficar versionados apenas os arquivos de código e configuração necessários para desenvolvimento e deploy, como:

- `routes/`, `views/`, `services/`, `helpers/`, `utils/`
- `prisma/`
- `public/` com assets estáticos do projeto
- `scripts/`
- `package.json` e `package-lock.json`
- arquivos de configuração como `.gitignore`, `tailwind.config.js`, `postcss.config.js`
- documentação em `docs/`

## O que não entra no repositório

Não devem ser versionados arquivos locais, gerados ou sensíveis, por exemplo:

- `node_modules/`
- `.env`
- `backups/` e `backup_extract/`
- dumps de banco como `*.sql`
- arquivos compactados como `*.zip`
- backups locais como `*.bak`
- uploads persistidos em `public/uploads/`
- arquivos temporários como `tmp-*`
- logs e saídas locais

## Como usar o `.env`

O arquivo `.env` é local e não deve ser enviado para o Git.

Use o `.env.example` como base:

1. copie o arquivo `.env.example`
2. renomeie para `.env`
3. preencha com os valores reais do seu ambiente

Segredos como `DATABASE_URL`, `JWT_SECRET` e credenciais de admin nunca devem ser versionados.

## Como funciona `public/uploads`

A pasta `public/uploads/` é usada para arquivos gerados em runtime, como uploads do sistema.

Ela:

- pode existir localmente para o app funcionar
- não deve ser versionada
- não deve ser usada para guardar arquivos permanentes do repositório

Se necessário em produção, o ideal é garantir a criação da pasta no ambiente de execução ou usar storage externo no futuro.

## Como rodar localmente

Passos básicos:

1. instalar dependências com `npm install`
2. criar o `.env` a partir do `.env.example`
3. garantir que o banco configurado em `DATABASE_URL` esteja disponível
4. gerar o Prisma Client com `npm run prisma:generate`
5. iniciar o projeto com `npm run dev`

Se precisar aplicar schema/migration local:

- `npm run prisma:migrate`

## Boas práticas de organização

- não salve backups, dumps ou exports na raiz do projeto
- não versione uploads, logs ou arquivos temporários
- use `docs/` para documentação curta e útil
- mantenha regras de negócio no código, não em arquivos locais soltos
- revise o `.gitignore` sempre que surgir uma nova pasta gerada em runtime
- prefira arquivos de exemplo como `.env.example` em vez de versionar configuração real
