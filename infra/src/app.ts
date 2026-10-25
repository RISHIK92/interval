import { App } from "aws-cdk-lib";
import { AwsStack } from "./aws-stack.ts";
import { ProdStack } from "./prod-stack.ts";

// Two deployment modes (ADR-0011), prod in ap-south-1 (Q-P1-28). The account comes from
// the deploying credentials (CDK_DEFAULT_ACCOUNT), so synth needs none.
const app = new App();
const env = { region: "ap-south-1" };
new ProdStack(app, "interval-prod", { env });
new AwsStack(app, "interval-prod-aws", { env });
