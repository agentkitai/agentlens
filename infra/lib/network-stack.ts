import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/types';

export interface NetworkStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;
  public readonly redisSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    // VPC — use existing or create new
    if (config.existingVpcId) {
      this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: config.existingVpcId });
    } else {
      const vpc = new ec2.Vpc(this, 'Vpc', {
        ipAddresses: ec2.IpAddresses.cidr(config.vpcCidr),
        maxAzs: 2,
        natGateways: config.natGateways,
        subnetConfiguration: [
          { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        ],
      });

      // VPC Flow Logs
      if (config.enableFlowLogs) {
        vpc.addFlowLog('FlowLog', {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            new logs.LogGroup(this, 'FlowLogGroup', {
              logGroupName: `/vpc/agentlens-${config.envName}/flow-logs`,
              retention: logs.RetentionDays.ONE_MONTH,
              removalPolicy: config.removalPolicy === 'retain' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            }),
          ),
          trafficType: ec2.FlowLogTrafficType.ALL,
        });
      }

      this.vpc = vpc;
    }

    // Security Groups
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'ALB - inbound HTTPS',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(config.albIngressCidr),
      ec2.Port.tcp(443),
      'HTTPS from allowed CIDR',
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(config.albIngressCidr),
      ec2.Port.tcp(80),
      'HTTP (redirect to HTTPS)',
    );

    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'ECS tasks - inbound from ALB only',
      allowAllOutbound: true,
    });
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'From ALB',
    );

    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'RDS - inbound from ECS only',
      allowAllOutbound: false,
    });
    this.rdsSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'From ECS',
    );

    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      description: 'Redis - inbound from ECS only',
      allowAllOutbound: false,
    });
    this.redisSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(6379),
      'From ECS',
    );

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'AlbSgId', { value: this.albSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'EcsSgId', { value: this.ecsSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'RdsSgId', { value: this.rdsSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'RedisSgId', { value: this.redisSecurityGroup.securityGroupId });
  }
}
