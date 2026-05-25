import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class CartApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────
    // 1. VPC — Lambda + RDS share the same VPC
    // ─────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'CartApiVpc', {
      maxAzs: 2,
      natGateways: 1,                    // required so Lambda in private subnet can reach AWS APIs
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ─────────────────────────────────────────────
    // 2. Security Groups
    // ─────────────────────────────────────────────

    // Lambda SG — allows outbound, no inbound rules needed
    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSG', {
      vpc,
      description: 'Security group for Cart API Lambda function',
      allowAllOutbound: true,
    });

    // RDS SG — only accepts traffic from Lambda SG on port 5432
    const rdsSG = new ec2.SecurityGroup(this, 'RdsSG', {
      vpc,
      description: 'Security group for Cart API RDS instance',
      allowAllOutbound: false,
    });

    rdsSG.addIngressRule(
      lambdaSG,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Lambda',
    );

    // ─────────────────────────────────────────────
    // 3. RDS PostgreSQL Instance
    // ─────────────────────────────────────────────

    // Credentials stored automatically in Secrets Manager
    const dbCredentials = rds.Credentials.fromGeneratedSecret('cartapi', {
      secretName: 'cart-api/db-credentials',
    });

    const dbInstance = new rds.DatabaseInstance(this, 'CartApiDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      credentials: dbCredentials,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [rdsSG],
      databaseName: 'cartdb',
      multiAz: false,                             // single-AZ for dev/cost savings
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,   // change to SNAPSHOT for prod
      deletionProtection: false,                  // set true for prod
      publiclyAccessible: false,
      storageEncrypted: true,
      parameterGroup: new rds.ParameterGroup(this, 'DbParamGroup', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16,
        }),
        description: 'Custom parameter group for Cart API PostgreSQL',
        parameters: {
          'rds.force_ssl': '0',          // simplifies local dev; enable for prod
          max_connections: '100',
        },
      }),
    });

    // ─────────────────────────────────────────────
    // 4. Lambda Function (NestJS via serverless-express)
    // ─────────────────────────────────────────────

    const lambdaFn = new lambdaNodejs.NodejsFunction(this, 'CartApiLambda', {
      // Points to the lambda entry in the NestJS project root (one level up from infra/)
      entry: path.join(__dirname, '../../src/lambda/lambda.ts'),
      // projectRoot must encompass both the entry file and the tsconfig
      projectRoot: path.join(__dirname, '../..'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSG],
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        // Use local esbuild — avoids Docker bundling on macOS
        forceDockerBundling: false,
        // pg-native is a native C++ addon — cannot be bundled by esbuild.
        // @nestjs/* optional peers: dynamically required by @nestjs/core but
        //   not installed (WebSockets, microservices, validation).
        // TypeORM optional drivers: typeorm supports many DBs via dynamic
        //   require(); we only use pg, so all other drivers must be external.
        externalModules: [
          // NestJS optional peers
          'pg-native',
          '@nestjs/microservices',
          '@nestjs/microservices/microservices-module',
          '@nestjs/websockets/socket-module',
          'class-transformer',
          'class-validator',
          // TypeORM optional DB drivers (not used — we use pg)
          'expo-sqlite',
          'mysql',
          'mysql2',
          'oracledb',
          'mssql',
          'sql.js',
          'sqlite3',
          'better-sqlite3',
          'react-native-sqlite-storage',
          'mongodb',
          'ioredis',
          'hdb-pool',
          '@sap/hana-client',
          'spanner',
        ],
        // Do NOT use nodeModules — it triggers `npm ci` in a temp dir which
        // requires a perfectly synced lock file. Instead, bundle everything inline.
        tsconfig: path.join(__dirname, '../../tsconfig.json'),
        minify: false,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        mainFields: ['main', 'module'],
        esbuildArgs: {
          '--keep-names': true,   // required for NestJS DI decorators
        },
      },
      environment: {
        NODE_ENV: 'production',
        // RDS connection details injected from the generated secret below
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_PORT: dbInstance.instanceEndpoint.port.toString(),
        DB_NAME: 'cartdb',
        // Actual username/password are pulled at runtime from the secret
        DB_SECRET_ARN: dbInstance.secret?.secretArn ?? '',
      },
    });

    // Allow Lambda to read the DB credentials secret
    dbInstance.secret?.grantRead(lambdaFn);
    // Allow Lambda to connect to RDS
    dbInstance.connections.allowFrom(lambdaFn, ec2.Port.tcp(5432));

    // ─────────────────────────────────────────────
    // 5. API Gateway (REST) — proxy all traffic to Lambda
    // ─────────────────────────────────────────────

    const api = new apigateway.LambdaRestApi(this, 'CartApiGateway', {
      handler: lambdaFn,
      proxy: true,                              // forward ALL routes to Lambda
      restApiName: 'Cart API',
      description: 'API Gateway for Cart API NestJS Lambda',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    // ─────────────────────────────────────────────
    // 6. Stack Outputs
    // ─────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Cart API Gateway endpoint URL',
      exportName: 'CartApiUrl',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: lambdaFn.functionName,
      description: 'Lambda function name',
      exportName: 'CartApiLambdaName',
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
      exportName: 'CartApiDbEndpoint',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbInstance.secret?.secretArn ?? 'N/A',
      description: 'ARN of the RDS credentials secret in Secrets Manager',
      exportName: 'CartApiDbSecretArn',
    });
  }
}
