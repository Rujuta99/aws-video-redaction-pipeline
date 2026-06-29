import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const BUCKET_NAME = process.env.BUCKET_NAME;
const UPLOAD_PREFIX = process.env.UPLOAD_PREFIX || "video-transcription/uploads/";
const URL_EXPIRATION_SECONDS = Number(process.env.URL_EXPIRATION_SECONDS || 900);

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function safeFilename(filename) {
  return String(filename || "video-upload.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return response(200, { ok: true });
  }

  if (!BUCKET_NAME) {
    return response(500, { error: "BUCKET_NAME environment variable is required" });
  }

  const body = typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};
  const filename = safeFilename(body.filename);
  const contentType = body.contentType || "video/mp4";
  const videoId = randomUUID();
  const s3Key = `${UPLOAD_PREFIX}${videoId}/${filename}`;
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        videoId,
        filename,
        contentType,
        bucketName: BUCKET_NAME,
        s3Key,
        originalVideoS3Key: s3Key,
        source: "UPLOAD_URL",
        status: "UPLOAD_URL_CREATED",
        createdAt: now,
        updatedAt: now
      }
    })
  );

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType,
      ServerSideEncryption: "AES256"
    }),
    { expiresIn: URL_EXPIRATION_SECONDS }
  );

  return response(200, {
    videoId,
    uploadUrl,
    bucketName: BUCKET_NAME,
    s3Key,
    expiresInSeconds: URL_EXPIRATION_SECONDS
  });
};
