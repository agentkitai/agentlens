#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config/types';
import { devConfig } from '../config/dev';
import { stagingConfig } from '../config/staging';
import { prodConfig } from '../config/prod';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { ServiceStack } from '../lib/service-stack';

const app = new cdk.App();

const envName = app.node.tryGetContext('env') || process.env.AGENTLENS_ENV || 'dev';

const configs: Record<string, EnvironmentConfig> = {
  dev: devConfig,
  staging: stagingConfig,
  prod: prodConfig,
};

const config = configs[envName];
if (!config) {
  throw new Error(`Unknown environment: ${envName}. Valid: ${Object.keys(configs).join(', ')}`);
}

const prefix = `AgentLens-${config.envName}`;

const network = new NetworkStack(app, `${prefix}-Network`, { config });
const data = new DataStack(app, `${prefix}-Data`, { config, network });
const service = new ServiceStack(app, `${prefix}-Service`, { config, network, data });

// Explicit dependencies
data.addDependency(network);
service.addDependency(data);
service.addDependency(network);
