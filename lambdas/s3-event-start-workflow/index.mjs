import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;
const UPLOAD_PREFIX = process.env.UPLOAD_PREFIX || "video-transcription/uploads/";

const sfn = new SFNClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function extractVideoIdFromS3Key(s3Key) {
  const parts = s3Key.split("/");
  const prefixParts = UPLOAD_PREFIX.replace(/\/$/, "").split("/");

  if (parts.length <= prefixParts.length) return null;
  for (let i = 0; i < prefixParts.length; i += 1) {
    if (parts[i] !== prefixParts[i]) return null;
  }
  return parts[prefixParts.length];
}

export const handler = async (event) => {
  console.log("S3 event:", JSON.stringify(event));
  if (!STATE_MACHINE_ARN) throw new Error("STATE_MACHINE_ARN environment variable is missing");

  const results = [];

  for (const record of event.Records || []) {
    const bucketName = record.s3.bucket.name;
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const videoId = extractVideoIdFromS3Key(s3Key);

    if (!videoId) {
      results.push({ s3Key, status: "SKIPPED", reason: "Could not extract videoId" });
      continue;
    }

    const now = new Date().toISOString();

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { videoId },
        UpdateExpression:
          "SET #status = :status, bucketName = :bucketName, s3Key = :s3Key, originalVideoS3Key = :s3Key, s3UploadReceivedAt = :now, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "S3_UPLOAD_RECEIVED",
          ":bucketName": bucketName,
          ":s3Key": s3Key,
          ":now": now
        }
      })
    );

    const execution = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: `video-${videoId}-${Date.now()}`,
        input: JSON.stringify({ videoId, bucketName, s3Key, triggeredBy: "S3_EVENT", startedAt: now })
      })
    );

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { videoId },
        UpdateExpression:
          "SET workflowExecutionArn = :workflowExecutionArn, workflowStartedAt = :now, updatedAt = :now",
        ExpressionAttributeValues: {
          ":workflowExecutionArn": execution.executionArn,
          ":now": now
        }
      })
    );

    results.push({ videoId, bucketName, s3Key, status: "WORKFLOW_STARTED", executionArn: execution.executionArn });
  }

  return { message: "S3 event processing completed", results };
};
