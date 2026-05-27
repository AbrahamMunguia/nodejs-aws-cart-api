# Cart API – AWS CDK Deployment

NestJS Cart API deployed to AWS Lambda + API Gateway with a PostgreSQL RDS backend, managed entirely with AWS CDK.

---

## Architecture

```
Internet
   │
   ▼
┌──────────────────┐
│  API Gateway     │  (REST, proxy mode – all routes → Lambda)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐        ┌──────────────────────────────────┐
│  Lambda          │──────▶ │  RDS PostgreSQL (private subnet) │
│  (NestJS + esbuild)       │  Engine: Postgres 15             │
│  Node 20.x       │        │  DB: cartapi                     │
└──────────────────┘        └──────────────────────────────────┘
         │
    VPC (private subnet with egress via NAT)
```

**Key CDK constructs used:**

| Construct | Purpose |
|---|---|
| `aws-lambda-nodejs.NodejsFunction` | Bundle & deploy NestJS via esbuild |
| `aws-apigateway.RestApi` | HTTP front door, proxy all paths |
| `aws-rds.DatabaseInstance` | Postgres 15 in isolated subnet |
| `aws-ec2.Vpc` | Shared VPC for Lambda ↔ RDS communication |
| `aws-secretsmanager.Secret` | Auto-generated DB credentials |

---

## Database Schema

### `carts`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key, auto-generated |
| `user_id` | VARCHAR | Not null. Not a FK (no User table here) |
| `status` | ENUM(`OPEN`, `ORDERED`) | Default `OPEN` |
| `created_at` | TIMESTAMP | Auto-managed |
| `updated_at` | TIMESTAMP | Auto-managed |

### `cart_items`

| Column | Type | Notes |
|---|---|---|
| `cart_id` | UUID | FK → `carts.id`, ON DELETE CASCADE |
| `product_id` | VARCHAR | Not null |
| `count` | INTEGER | Number of items |

> **Primary key** of `cart_items` is the composite `(cart_id, product_id)`.

---

## Project Structure

```
.
├── infra/                       ← CDK infrastructure (separate package)
│   ├── bin/
│   │   └── cart-api.ts          ← CDK app entry point
│   ├── lib/
│   │   └── cart-api-stack.ts    ← Main stack (VPC, Lambda, APIGW, RDS)
│   ├── cdk.json
│   ├── package.json
│   └── tsconfig.json
│
├── src/                         ← NestJS application
│   ├── lambda.ts                ← Lambda handler (serverless-express wrapper)
│   ├── app.module.ts            ← Root module
│   ├── database/
│   │   └── database.module.ts   ← TypeORM async config from env vars
│   └── cart/
│       ├── entities/
│       │   ├── cart.entity.ts       ← Cart model (TypeORM)
│       │   └── cart-item.entity.ts  ← CartItem model (TypeORM)
│       ├── dto/
│       │   └── update-cart.dto.ts
│       ├── cart.controller.ts
│       ├── cart.service.ts
│       └── cart.module.ts
│
├── package.json                 ← NestJS deps (includes pg, typeorm, @vendia/serverless-express)
├── tsconfig.json
└── .env.example
```

---

## Prerequisites

- **Node.js** ≥ 20
- **AWS CLI** configured (`aws configure`)
- **CDK CLI** (`npm install -g aws-cdk`)
- **Bootstrap** your AWS account once per region:
  ```bash
  cdk bootstrap aws://ACCOUNT_ID/REGION
  ```

---

## Local Development

```bash
# 1. Install NestJS dependencies
npm install

# 2. Copy env file and fill in your local Postgres details
cp .env.example .env

# 3. Start a local Postgres (Docker)
docker run -d \
  --name cartapi-pg \
  -e POSTGRES_DB=cartapi \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15

# 4. Run in dev mode (TypeORM will auto-sync the schema)
npm run start:dev
```

---

## Deploying to AWS

```bash
# 1. Install CDK dependencies
cd infra
npm install

# 2. Synthesise CloudFormation template (sanity check)
npm run synth

# 3. Review what will change
npm run diff

# 4. Deploy everything
npm run deploy
```

CDK will output:

```
Outputs:
CartApiStack.ApiUrl       = https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/prod/
CartApiStack.DbEndpoint   = cartapidb.xxxx.us-east-1.rds.amazonaws.com
CartApiStack.DbSecretArn  = arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:cart-api/db-credentials-XXXXX
```

### Tear down

```bash
cd infra && npm run destroy
```

---

## API Endpoints

All routes are prefixed with `/api`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Get a JWT token |
| `GET` | `/api/profile/cart` | Get the current user's open cart |
| `PUT` | `/api/profile/cart` | Add/update an item `{ productId, count }` |
| `DELETE` | `/api/profile/cart` | Remove the open cart |
| `POST` | `/api/profile/cart/checkout` | Mark cart as ORDERED |

---

## Environment Variables

| Variable | Description | CDK source |
|---|---|---|
| `NODE_ENV` | `development` / `production` | Hardcoded in CDK |
| `DB_HOST` | RDS endpoint hostname | `dbInstance.dbInstanceEndpointAddress` |
| `DB_PORT` | RDS port (default 5432) | `dbInstance.dbInstanceEndpointPort` |
| `DB_NAME` | Database name | `cartapi` |
| `DB_USERNAME` | DB user | From Secrets Manager |
| `DB_PASSWORD` | DB password | From Secrets Manager |

> Credentials are read from Secrets Manager at **deploy time** and injected as Lambda environment variables. For even tighter security you can instead call Secrets Manager at **runtime** by reading `DB_SECRET_ARN` and using the AWS SDK.

---

## Notes on Production Hardening

- Set `deletionProtection: true` and `removalPolicy: RETAIN` on the RDS instance.
- Set `synchronize: false` in TypeORM config and use migrations instead.
- Enable `rds.force_ssl = 1` and `ssl: { rejectUnauthorized: true }` in the TypeORM options.
- Consider storing the DB password exclusively in Secrets Manager and fetching it at Lambda cold-start via `@aws-sdk/client-secrets-manager` to avoid it appearing in the Lambda console.
- Add a WAF to API Gateway for production traffic.
