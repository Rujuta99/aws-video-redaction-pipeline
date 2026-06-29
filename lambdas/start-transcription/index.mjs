import { TranscribeClient, StartTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME;
const TRANSCRIBE_OUTPUT_PREFIX = process.env.TRANSCRIBE_OUTPUT_PREFIX || "video-transcription/transcripts/";
const TRANSCRIBE_LANGUAGE_CODE = process.env.TRANSCRIBE_LANGUAGE_CODE || "en-US";

const transcribe = new TranscribeClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export const handler = async (event) => {
  console.log("StartTranscription input:", JSON.stringify(event));

  const videoId = event.videoId;
  if (!videoId) throw new Error("videoId is required");

  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
  if (!existing.Item) throw new Error(`No DynamoDB job found for videoId ${videoId}`);

  const bucketName = existing.Item.bucketName || event.bucketName || DEFAULT_BUCKET_NAME;
  const s3Key = existing.Item.s3Key || existing.Item.originalVideoS3Key || event.s3Key;
  if (!bucketName || !s3Key) throw new Error("bucketName and s3Key are required");

  const transcriptionJobName = `sf-transcribe-${videoId}`;
  const outputKey = `${TRANSCRIBE_OUTPUT_PREFIX}${videoId}/`;
  const mediaUri = `s3://${bucketName}/${s3Key}`;
  const now = new Date().toISOString();

  try {
    await transcribe.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: transcriptionJobName,
        LanguageCode: TRANSCRIBE_LANGUAGE_CODE,
        Media: { MediaFileUri: mediaUri },
        OutputBucketName: bucketName,
        OutputKey: outputKey
      })
    );
  } catch (error) {
    if (error.name !== "ConflictException") {
      throw error;
    }
    console.log(`Transcription job already exists: ${transcriptionJobName}`);
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId },
      UpdateExpression:
        "SET #status = :status, transcriptionJobName = :jobName, transcriptionStartedAt = :now, updatedAt = :now, transcriptOutputKey = :outputKey",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "TRANSCRIBING",
        ":jobName": transcriptionJobName,
        ":now": now,
        ":outputKey": outputKey
      }
    })
  );

  return {
    ...event,
    videoId,
    status: "TRANSCRIBING",
    bucketName,
    s3Key,
    transcriptionJobName,
    mediaUri,
    transcriptOutputKey: outputKey,
    transcriptionStartedAt: now
  };
};
