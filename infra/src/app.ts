import { App } from "aws-cdk-lib";
import { ProdStack } from "./prod-stack.ts";

// One environment, prod in ap-south-1 (Q-P1-28). The account comes from the deploying
// credentials (CDK_DEFAULT_ACCOUNT), so synth needs none.
const app = new App();
new ProdStack(app, "interval-prod", { env: { region: "ap-south-1" } });
