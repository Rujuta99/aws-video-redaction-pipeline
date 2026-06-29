import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export const handler = async (event) => {
  console.log("ValidateUpload input:", JSON.stringify(event));

  const videoId = event.videoId;
  if (!videoId) throw new Error("videoId is required");

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { videoId }
    })
  );

  if (!existing.Item) {
    throw new Error(`No DynamoDB job found for videoId ${videoId}`);
  }

  const bucketName = existing.Item.bucketName || event.bucketName || DEFAULT_BUCKET_NAME;
  const s3Key = existing.Item.s3Key || existing.Item.originalVideoS3Key || event.s3Key;

  if (!bucketName || !s3Key) {
    throw new Error("bucketName and s3Key are required");
  }

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    })
  );

  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId },
      UpdateExpression:
        "SET #status = :status, bucketName = :bucketName, s3Key = :s3Key, originalVideoS3Key = :s3Key, fileSizeBytes = :fileSizeBytes, uploadValidatedAt = :now, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "UPLOAD_VALIDATED",
        ":bucketName": bucketName,
        ":s3Key": s3Key,
        ":fileSizeBytes": head.ContentLength || 0,
        ":now": now
      }
    })
  );

  return {
    ...event,
    videoId,
    status: "UPLOAD_VALIDATED",
    bucketName,
    s3Key,
    filename: existing.Item.filename || s3Key.split("/").pop(),
    contentType: existing.Item.contentType || head.ContentType || "application/octet-stream",
    fileSizeBytes: head.ContentLength || 0,
    uploadValidatedAt: now
  };
};
