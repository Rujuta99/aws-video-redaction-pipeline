import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME;
const DEMO_VIDEO_IDS = (process.env.DEMO_VIDEO_IDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET"
};

function response(statusCode, body) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body) };
}

async function streamToString(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

async function getJob(videoId) {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
  return result.Item;
}

async function getPresignedVideoUrl(job) {
  const bucketName = job.bucketName || DEFAULT_BUCKET_NAME;
  const key = job.originalVideoS3Key || job.s3Key;
  if (!bucketName || !key) return null;

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
    { expiresIn: 3600 }
  );
}

async function readFinalOutput(job) {
  const bucketName = job.bucketName || DEFAULT_BUCKET_NAME;
  if (!bucketName || !job.finalOutputS3Key) {
    throw new Error("Final output is not ready yet");
  }

  const object = await s3.send(
    new GetObjectCommand({ Bucket: bucketName, Key: job.finalOutputS3Key })
  );
  return JSON.parse(await streamToString(object.Body));
}

export const handler = async (event) => {
  console.log("DemoReadApi input:", JSON.stringify(event));

  const method = event.requestContext?.http?.method || event.httpMethod;
  const rawPath = event.rawPath || event.path || "/";

  if (method === "OPTIONS") return response(200, { ok: true });

  if (rawPath === "/videos" && method === "GET") {
    const videos = [];
    for (const videoId of DEMO_VIDEO_IDS) {
      const job = await getJob(videoId);
      if (!job) continue;

      videos.push({
        videoId,
        title: job.filename || videoId,
        filename: job.filename,
        contentType: job.contentType,
        status: job.status,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        videoUrl: await getPresignedVideoUrl(job),
        finalEndpoint: `/final/${videoId}`
      });
    }
    return response(200, { videos });
  }

  const finalMatch = rawPath.match(/^\/final\/([^/]+)$/);
  if (finalMatch && method === "GET") {
    const videoId = finalMatch[1];
    if (!DEMO_VIDEO_IDS.includes(videoId)) {
      return response(403, { error: "This video is not part of the public demo list" });
    }

    const job = await getJob(videoId);
    if (!job) return response(404, { error: "Video not found" });

    try {
      const finalOutput = await readFinalOutput(job);
      return response(200, finalOutput);
    } catch (error) {
      return response(404, { error: error.message });
    }
  }

  return response(404, { error: "Route not found" });
};
