import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME;
const RESULT_PREFIX = process.env.RESULT_PREFIX || "video-transcription/results/";

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function streamToString(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

export const handler = async (event) => {
  console.log("SaveFinalOutput input:", JSON.stringify(event));

  const videoId = event.videoId;
  if (!videoId) throw new Error("videoId is required");

  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
  if (!existing.Item) throw new Error(`No DynamoDB job found for videoId ${videoId}`);

  const bucketName = existing.Item.bucketName || event.bucketName || DEFAULT_BUCKET_NAME;
  const processedS3Key = event.processedS3Key || existing.Item.processedS3Key;
  if (!bucketName || !processedS3Key) throw new Error("bucketName and processedS3Key are required");

  const object = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: processedS3Key }));
  const processed = JSON.parse(await streamToString(object.Body));

  const now = new Date().toISOString();
  const finalOutputS3Key = `${RESULT_PREFIX}${videoId}/final-output.json`;

  const finalOutput = {
    videoId,
    status: "FINAL_OUTPUT_READY",
    input: {
      filename: existing.Item.filename,
      contentType: existing.Item.contentType,
      bucketName,
      originalVideoS3Key: existing.Item.originalVideoS3Key || existing.Item.s3Key
    },
    transcript: processed.transcript,
    summary: processed.summary,
    translations: processed.translations,
    redactionLog: processed.redactionLog,
    outputLocations: {
      processedS3Key,
      finalOutputS3Key
    },
    services: processed.services,
    createdAt: existing.Item.createdAt,
    completedAt: now
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: finalOutputS3Key,
      Body: JSON.stringify(finalOutput, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256"
    })
  );

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId },
      UpdateExpression:
        "SET #status = :status, finalOutputS3Key = :finalOutputS3Key, completedAt = :now, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "FINAL_OUTPUT_READY",
        ":finalOutputS3Key": finalOutputS3Key,
        ":now": now
      }
    })
  );

  return finalOutput;
};
