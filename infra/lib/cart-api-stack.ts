import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';

export class CartApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC ────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'CartApiVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ─── Security Groups ────────────────────────────────────────────────────
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSG', {
      vpc,
      description: 'Security group for Cart API Lambda',
      allowAllOutbound: true,
    });

    const rdsSg = new ec2.SecurityGroup(this, 'RdsSG', {
      vpc,
      description: 'Security group for Cart API RDS',
      allowAllOutbound: false,
    });

    // Allow Lambda to reach RDS on port 5432
    rdsSg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), 'Lambda to Postgres');

    // ─── RDS PostgreSQL ──────────────────────────────────────────────────────
    const dbSecret = new secretsmanager.Secret(this, 'CartApiDbSecret', {
      secretName: 'cart-api/db-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'cartapi' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const dbInstance = new rds.DatabaseInstance(this, 'CartApiDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSg],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'cartapi',
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      deletionProtection: false,           // set true for production
      removalPolicy: cdk.RemovalPolicy.DESTROY, // set RETAIN for production
      parameterGroup: new rds.ParameterGroup(this, 'CartApiPG', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_15,
        }),
        parameters: {
          'rds.force_ssl': '0',            // disable for simplicity; enable in prod
        },
      }),
    });

    // ─── Lambda (NestJS bundled with esbuild) ───────────────────────────────
    // projectRoot must be the directory that contains both src/ and package.json
    // (i.e. the repo root, one level above infra/).  Without this, CDK enforces
    // that entry must live under the infra/ folder and throws PathNotUnderRoot.
    const repoRoot = path.join(__dirname, '../..');

    const cartApiLambda = new lambdaNodejs.NodejsFunction(this, 'CartApiLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(repoRoot, 'src/lambda.ts'),
      projectRoot: repoRoot,   // ← tells esbuild where package.json lives
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      bundling: {
        forceDockerBundling: false,          // use local esbuild, never Docker
        externalModules: [
          '@nestjs/microservices',
          '@nestjs/websockets',
          'class-transformer',
          'class-validator',
        ],
        minify: false,
        sourceMap: true,
        target: 'node20',
        tsconfig: path.join(repoRoot, 'tsconfig.json'),
      },
      environment: {
        NODE_ENV: 'production',
        DB_HOST: dbInstance.dbInstanceEndpointAddress,
        DB_PORT: dbInstance.dbInstanceEndpointPort,
        DB_NAME: 'cartapi',
        DB_USERNAME: dbSecret.secretValueFromJson('username').unsafeUnwrap(),
        DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
        AUTH_USERNAME: 'AbrahamMunguia',
        AUTH_PASSWORD: 'Test1237',
      },
    });

    // Grant Lambda read access to the DB secret
    dbSecret.grantRead(cartApiLambda);

    // ─── API Gateway ─────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'CartApiGateway', {
      restApiName: 'cart-api',
      description: 'Cart API – NestJS on Lambda',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const integration = new apigateway.LambdaIntegration(cartApiLambda, { proxy: true });
    api.root.addMethod('ANY', integration);
    api.root.addResource('{proxy+}').addMethod('ANY', integration);

    // ─── CloudFormation Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url, description: 'API Gateway URL' });
    new cdk.CfnOutput(this, 'DbEndpoint', { value: dbInstance.dbInstanceEndpointAddress, description: 'RDS Postgres endpoint' });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: dbSecret.secretArn, description: 'Secrets Manager ARN for DB credentials' });
  }
}