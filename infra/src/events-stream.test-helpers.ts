import { Match, type Template } from "aws-cdk-lib/assertions";
import { expect } from "vitest";

// DB-5: exactly one delivery stream, into the Events bucket, partitioned by day so
// Athena can prune by date. Shared by both stacks' tests (ADR-0011).
export function expectEventStream(template: Template, name: string): void {
  template.resourceCountIs("AWS::KinesisFirehose::DeliveryStream", 1);
  const buckets = template.findResources("AWS::S3::Bucket");
  const eventsBucket = Object.keys(buckets).find((id) =>
    id.startsWith("Events"),
  );
  expect(eventsBucket).toBeDefined();
  template.hasResourceProperties("AWS::KinesisFirehose::DeliveryStream", {
    DeliveryStreamName: name,
    DeliveryStreamEncryptionConfigurationInput: Match.absent(),
    ExtendedS3DestinationConfiguration: Match.objectLike({
      BucketARN: { "Fn::GetAtt": [eventsBucket, "Arn"] },
      Prefix: "events/dt=!{timestamp:yyyy-MM-dd}/",
      ErrorOutputPrefix:
        "errors/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/",
      BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 5 },
    }),
  });
  // Only Firehose acting for this account may use the role (confused deputy).
  template.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Principal: { Service: "firehose.amazonaws.com" },
          Condition: {
            StringEquals: { "sts:ExternalId": { Ref: "AWS::AccountId" } },
          },
        }),
      ],
    },
  });
}

// The roles that send events get PutRecord(Batch) on the stream and nothing else there.
export function firehoseActionsFor(
  template: Template,
  roleIdPrefix: string,
): string[] {
  const policies = template.findResources("AWS::IAM::Policy");
  const actions: string[] = [];
  for (const policy of Object.values(policies)) {
    const props = policy["Properties"] as {
      Roles: { Ref: string }[];
      PolicyDocument: { Statement: { Action: string | string[] }[] };
    };
    if (!props.Roles.some((r) => r.Ref.startsWith(roleIdPrefix))) continue;
    for (const statement of props.PolicyDocument.Statement) {
      for (const action of [statement.Action].flat()) {
        if (action.startsWith("firehose:")) actions.push(action);
      }
    }
  }
  return actions.sort();
}
