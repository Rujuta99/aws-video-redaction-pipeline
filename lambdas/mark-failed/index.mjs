import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export const handler = async (event) => {
  console.log("MarkFailed input:", JSON.stringify(event));

  const videoId = event.videoId;
  if (!videoId) throw new Error("videoId is required");

  const failedStage = event.failedStage || "UNKNOWN_STAGE";
  const errorInfo = event.errorInfo || {};
  const now = new Date().toISOString();

  const failureDetails = {
    failedStage,
    error: errorInfo.Error || errorInfo.error || "UnknownError",
    cause: errorInfo.Cause || errorInfo.cause || "No failure cause provided",
    failedAt: now
  };

  if (event.dryRun === true) {
    return { videoId, status: "DRY_RUN_FAILURE_CAPTURED", failureDetails };
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId },
      UpdateExpression:
        "SET #status = :status, failedStage = :failedStage, failureDetails = :failureDetails, failedAt = :failedAt, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "WORKFLOW_FAILED",
        ":failedStage": failedStage,
        ":failureDetails": JSON.stringify(failureDetails),
        ":failedAt": now,
        ":updatedAt": now
      }
    })
  );

  return { videoId, status: "WORKFLOW_FAILED", failedStage, failureDetails };
};
