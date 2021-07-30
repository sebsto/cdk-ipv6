import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { aws_ec2 as ec2, Fn, Tags } from 'aws-cdk-lib';

export class NetworkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // an IPv6 enabled VPC 
    const vpc = new IPv6Vpc(this, 'IPv6Demo', {

      // technically, the NAT gateway is not used with IPv6 but VPC constructs complains when
      // using PRIVATE subnets without NAT gateway :-(
      natGateways: 1, //this is the default value but I prefer to make it explicit

      maxAzs: 2,
      cidr: '10.0.0.0/16',
      subnetConfiguration: [{
        subnetType: ec2.SubnetType.PUBLIC,
        name: 'front',
        cidrMask: 24
      },{
        subnetType: ec2.SubnetType.PRIVATE,
        name: 'back',
        cidrMask: 24
      },{
        subnetType: ec2.SubnetType.ISOLATED,
        name: 'database',
        cidrMask: 24
      }]
    });
  }
}

// IPv6-enabled VPC
//
// Alas, there is no simple 'v6enabled' bool, so we have to do
// this the long way :(
// TODO: obsolete this class by improving CDK.
class IPv6Vpc extends ec2.Vpc {
  constructor(scope: Construct, id: string, props?: ec2.VpcProps) {
    super(scope, id, props);

    Tags.of(this).add('Name', this.node.path);

    const ip6cidr = new ec2.CfnVPCCidrBlock(this, 'Cidr6', {
      vpcId: this.vpcId,
      amazonProvidedIpv6CidrBlock: true,
    });

    const vpc6cidr = Fn.select(0, this.vpcIpv6CidrBlocks);
    const subnet6cidrs = Fn.cidr(vpc6cidr, 256, (128 - 64).toString());

    const allSubnets = [...this.publicSubnets, ...this.privateSubnets, ...this.isolatedSubnets];

    // associate an IPv6 block to each subnets
    allSubnets.forEach((subnet, i) => {
      const cidr6 = Fn.select(i, subnet6cidrs);

      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.ipv6CidrBlock = cidr6;
      subnet.node.addDependency(ip6cidr);
    });

    // for public subnets, ensure there is one IPv6 Internet Gateway
    if (this.publicSubnets) {
      let igwId = this.internetGatewayId;
      if (!igwId) {
        const igw = new ec2.CfnInternetGateway(this, 'IGW');
        igwId = igw.ref;

        new ec2.CfnVPCGatewayAttachment(this, 'VPCGW', {
          internetGatewayId: igw.ref,
          vpcId: this.vpcId,
        });
      }

      // and that each subnet has a routing table to the Internet Gateway
      this.publicSubnets.forEach(subnet => {
        const s = subnet as ec2.PublicSubnet;
        s.addRoute('DefaultRoute6', {
          routerType: ec2.RouterType.GATEWAY,
          routerId: igwId!,
          destinationIpv6CidrBlock: '::/0',
          enablesInternetConnectivity: true,
        });
      });
    }

    // for private subnet, ensure there is an IPv6 egress gateway
    if (this.privateSubnets) {
      const eigw = new ec2.CfnEgressOnlyInternetGateway(this, 'EIGW6', {
        vpcId: this.vpcId,
      });

      // and attach a routing table to the egress gateway
      // Yay firewalling by routing side effect :(
      this.privateSubnets.forEach(subnet => {
        const s = subnet as ec2.PrivateSubnet;
        s.addRoute('DefaultRoute6', {
          routerType: ec2.RouterType.EGRESS_ONLY_INTERNET_GATEWAY,
          routerId: eigw.ref,
          destinationIpv6CidrBlock: '::/0',
          enablesInternetConnectivity: true,
        });
      });
    }
  }
}
