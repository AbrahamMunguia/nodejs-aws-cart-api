import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class CartApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────────────────────
    // 1. S3 Bucket — stores the NestJS deployment artifact (zip)
    //    and any static assets the application might serve.
    //    CDK's NodejsFunction will upload its bundled code here;
    //    we declare it explicitly so the bucket is named, tagged,
    //    and has a clear lifecycle policy under our control.
    // ─────────────────────────────────────────────────────────────
    const deploymentBucket = new s3.Bucket(this, 'CartApiDeploymentBucket', {
      bucketName: `cart-api-deployment-${this.account}-${this.region}`,
      versioned: true,                          // keep previous Lambda zips
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,                  // clean-up on cdk destroy
      lifecycleRules: [
        {
          id: 'expire-old-deployment-zips',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    // ─────────────────────────────────────────────────────────────
    // 2. VPC — Lambda + RDS share the same private network
    // ─────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'CartApiVpc', {
      maxAzs: 2,
      natGateways: 1,       // required: Lambda (private subnet) needs NAT to call AWS APIs
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

    // ─────────────────────────────────────────────────────────────
    // 3. Security Groups
    // ─────────────────────────────────────────────────────────────

    const lambdaSG = new ec2.SecurityGroup(this, 'LambdaSG', {
      vpc,
      description: 'Security group for Cart API Lambda function',
      allowAllOutbound: true,
    });

    // RDS only accepts PostgreSQL traffic from Lambda
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

    // ─────────────────────────────────────────────────────────────
    // 4. RDS PostgreSQL Instance
    // ─────────────────────────────────────────────────────────────

    // Credentials auto-generated and stored in Secrets Manager
    const dbCredentials = rds.Credentials.fromGeneratedSecret('cartapi', {
      secretName: 'cart-api/db-credentials',
    });

    const dbInstance = new rds.DatabaseInstance(this, 'CartApiDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
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
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,   // ← SNAPSHOT for prod
      deletionProtection: false,                  // ← true for prod
      publiclyAccessible: false,
      storageEncrypted: true,
      parameterGroup: new rds.ParameterGroup(this, 'DbParamGroup', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16_3,
        }),
        description: 'Custom parameter group for Cart API PostgreSQL',
        parameters: {
          'rds.force_ssl': '0',   // simplify local dev; set 1 for prod
          max_connections: '100',
        },
      }),
    });

    // ─────────────────────────────────────────────────────────────
    // 5. Lambda Function — NestJS bundled with esbuild, stored in S3
    //
    //    NodejsFunction automatically uploads the bundled zip to the
    //    CDK bootstrap bucket.  We also pass deploymentBucket so the
    //    asset is co-located with our explicitly-declared bucket, and
    //    Lambda's execution role is granted read access.
    // ─────────────────────────────────────────────────────────────

    const lambdaFn = new lambdaNodejs.NodejsFunction(this, 'CartApiLambda', {
      entry: path.join(__dirname, '../../src/lambda/lambda.ts'),
      projectRoot: path.join(__dirname, '../../'),
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
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
        externalModules: ['pg-native'],
        nodeModules: [
          'pg',
          'typeorm',
          'reflect-metadata',
          '@nestjs/core',
          '@nestjs/common',
          '@nestjs/platform-express',
          '@nestjs/config',
          '@nestjs/jwt',
          '@nestjs/passport',
          'passport',
          'passport-jwt',
          'passport-local',
          'passport-http',
          'helmet',
          'rxjs',
          '@vendia/serverless-express',
          'express',
        ],
        tsconfig: path.join(__dirname, '../../tsconfig.json'),
        minify: false,
        sourceMap: true,
        target: 'node20',
        format: lambdaNodejs.OutputFormat.CJS,
        mainFields: ['main', 'module'],
        esbuildArgs: {
          '--keep-names': true,   // required for NestJS DI metadata
        },
      },
      environment: {
        NODE_ENV: 'production',
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_PORT: dbInstance.instanceEndpoint.port.toString(),
        DB_NAME: 'cartdb',
        DB_SECRET_ARN: dbInstance.secret?.secretArn ?? '',
        // Expose the deployment bucket name so application code
        // (or a health-check handler) can reference it if needed
        S3_DEPLOYMENT_BUCKET: deploymentBucket.bucketName,
      },
    });

    // Grant Lambda permission to read from the deployment bucket
    deploymentBucket.grantRead(lambdaFn);

    // Grant Lambda permission to read DB credentials from Secrets Manager
    dbInstance.secret?.grantRead(lambdaFn);

    // Allow Lambda SG to connect to RDS SG
    dbInstance.connections.allowFrom(lambdaFn, ec2.Port.tcp(5432));

    // ─────────────────────────────────────────────────────────────
    // 6. Upload NestJS build artefact to the deployment bucket
    //    (runs after `npm run build` produces ./dist)
    //    This keeps a versioned copy in S3 alongside the live Lambda.
    // ─────────────────────────────────────────────────────────────
    new s3deploy.BucketDeployment(this, 'CartApiS3Deployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../dist'))],
      destinationBucket: deploymentBucket,
      destinationKeyPrefix: 'nestjs-build/',
      prune: false,     // keep old versions; lifecycle rule expires noncurrent after 30 d
      retainOnDelete: false,
    });

    // ─────────────────────────────────────────────────────────────
    // 7. API Gateway — REST, full proxy to Lambda
    // ─────────────────────────────────────────────────────────────

    const api = new apigateway.RestApi(this, 'CartApiGateway', {
      restApiName: 'Cart API',
      description: 'API Gateway for Cart API NestJS Lambda',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        // loggingLevel / dataTraceEnabled require a CloudWatch role ARN to be
        // registered at the account level first (API GW Settings page).
        // Omitting them avoids the 400 "CloudWatch Logs role ARN must be set"
        // error without any impact on functionality.
        metricsEnabled: true,
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

    // ── /health  (no auth — liveness / readiness probe) ──────────
    const healthResource = api.root.addResource('health');
    healthResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(lambdaFn, { proxy: true }),
    );

    // ── /api/{proxy+}  (all NestJS routes) ───────────────────────
    const apiResource = api.root.addResource('api');
    const proxyResource = apiResource.addResource('{proxy+}');

    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFn, {
      proxy: true,
    });

    proxyResource.addMethod('ANY', lambdaIntegration);
    // Also handle /api itself (no trailing segment)
    apiResource.addMethod('ANY', lambdaIntegration);

    // ─────────────────────────────────────────────────────────────
    // 9. Stack Outputs — printed after every `cdk deploy`
    // ─────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Base API Gateway URL  (append "api/<route>" for NestJS routes)',
      exportName: 'CartApiUrl',
    });

    new cdk.CfnOutput(this, 'HealthEndpoint', {
      value: `${api.url}health`,
      description: 'GET this URL to verify the Lambda is alive',
      exportName: 'CartApiHealthEndpoint',
    });

    new cdk.CfnOutput(this, 'CartEndpoint', {
      value: `${api.url}api/profile/cart`,
      description: 'Cart endpoint (requires Authorization header)',
      exportName: 'CartApiCartEndpoint',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: lambdaFn.functionName,
      description: 'Lambda function name',
      exportName: 'CartApiLambdaName',
    });

    new cdk.CfnOutput(this, 'DeploymentBucketName', {
      value: deploymentBucket.bucketName,
      description: 'S3 bucket holding versioned NestJS deployment artifacts',
      exportName: 'CartApiDeploymentBucket',
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint hostname',
      exportName: 'CartApiDbEndpoint',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbInstance.secret?.secretArn ?? 'N/A',
      description: 'Secrets Manager ARN for DB credentials',
      exportName: 'CartApiDbSecretArn',
    });
  }
}