import { S3Client, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const REGION = process.env.AWS_REGION || "us-east-1";
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME || "social-media-uploads-rujuta";
const DEFAULT_PREFIX = process.env.ARCHIVE_PREFIX || "video-transcription/archive/";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"];

const s3 = new S3Client({ region: REGION });
const sfn = new SFNClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function getArgValue(name, defaultValue) {
  const match = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!match) return defaultValue;
  return match.split("=").slice(1).join("=");
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVideoFile(key) {
  const lower = key.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getFilenameFromKey(key) {
  return key.split("/").pop();
}

function guessContentType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "application/octet-stream";
}

async function listArchivedVideos(bucketName, prefix, limit) {
  const videos = [];
  let continuationToken;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );

    for (const item of response.Contents || []) {
      if (!item.Key || item.Key.endsWith("/")) continue;
      if (!isVideoFile(item.Key)) continue;

      videos.push({
        key: item.Key,
        sizeBytes: item.Size || 0,
        lastModified: item.LastModified
      });

      if (limit && videos.length >= limit) return videos;
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return videos;
}

async function startBackfillJob(bucketName, video) {
  if (!STATE_MACHINE_ARN) {
    throw new Error("STATE_MACHINE_ARN environment variable is required");
  }

  const videoId = randomUUID();
  const filename = getFilenameFromKey(video.key);
  const contentType = guessContentType(filename);
  const now = new Date().toISOString();

  await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: video.key }));

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        videoId,
        filename,
        contentType,
        bucketName,
        s3Key: video.key,
        originalVideoS3Key: video.key,
        status: "BACKFILL_QUEUED",
        source: "ARCHIVE_BACKFILL",
        archiveS3Key: video.key,
        fileSizeBytes: video.sizeBytes,
        createdAt: now,
        updatedAt: now
      },
      ConditionExpression: "attribute_not_exists(videoId)"
    })
  );

  const execution = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: `backfill-${videoId}-${Date.now()}`,
      input: JSON.stringify({
        videoId,
        bucketName,
        s3Key: video.key,
        triggeredBy: "ARCHIVE_BACKFILL",
        startedAt: now
      })
    })
  );

  return {
    videoId,
    filename,
    s3Key: video.key,
    sizeBytes: video.sizeBytes,
    executionArn: execution.executionArn
  };
}

async function main() {
  const bucketName = getArgValue("--bucket", DEFAULT_BUCKET_NAME);
  const prefix = getArgValue("--prefix", DEFAULT_PREFIX);
  const limit = Number(getArgValue("--limit", "1"));
  const delayMs = Number(getArgValue("--delay-ms", "2000"));
  const dryRun = hasFlag("--dry-run");

  console.log("Backfill configuration:");
  console.log({ bucketName, prefix, table: TABLE_NAME, stateMachineArn: STATE_MACHINE_ARN, limit, delayMs, dryRun });

  const videos = await listArchivedVideos(bucketName, prefix, limit);
  const totalBytes = videos.reduce((sum, item) => sum + item.sizeBytes, 0);

  console.log(`Found ${videos.length} video object(s).`);
  console.log(`Scanned selected size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(3)} GB`);

  for (const [index, video] of videos.entries()) {
    console.log(`\n[${index + 1}/${videos.length}] ${video.key}`);
    console.log(`Size: ${(video.sizeBytes / 1024 / 1024).toFixed(2)} MB`);

    if (dryRun) {
      console.log("Dry run. No DynamoDB job or Step Functions execution was created.");
      continue;
    }

    try {
      const result = await startBackfillJob(bucketName, video);
      console.log("Started backfill workflow:");
      console.log(result);
    } catch (error) {
      console.error("Failed to start backfill:", error.message);
    }

    if (delayMs > 0 && index < videos.length - 1) {
      await sleep(delayMs);
    }
  }
}

main().catch((error) => {
  console.error("Backfill script failed:", error);
  process.exit(1);
});
