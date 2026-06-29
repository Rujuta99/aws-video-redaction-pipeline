import { TranscribeClient, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";

const transcribe = new TranscribeClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export const handler = async (event) => {
  console.log("CheckTranscription input:", JSON.stringify(event));

  const videoId = event.videoId;
  if (!videoId) throw new Error("videoId is required");

  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
  const transcriptionJobName = event.transcriptionJobName || existing.Item?.transcriptionJobName;

  if (!transcriptionJobName) {
    throw new Error(`No transcriptionJobName found for videoId ${videoId}`);
  }

  const response = await transcribe.send(
    new GetTranscriptionJobCommand({ TranscriptionJobName: transcriptionJobName })
  );

  const job = response.TranscriptionJob;
  const transcribeStatus = job?.TranscriptionJobStatus || "UNKNOWN";
  const transcriptFileUri = job?.Transcript?.TranscriptFileUri || "";
  const failureReason = job?.FailureReason || "";
  const now = new Date().toISOString();

  let status = "TRANSCRIBING";
  if (transcribeStatus === "COMPLETED") status = "TRANSCRIPTION_COMPLETED";
  if (transcribeStatus === "FAILED") status = "TRANSCRIPTION_FAILED";

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId },
      UpdateExpression:
        "SET #status = :status, transcribeStatus = :transcribeStatus, transcriptFileUri = :transcriptFileUri, failureReason = :failureReason, transcriptionCheckedAt = :now, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": status,
        ":transcribeStatus": transcribeStatus,
        ":transcriptFileUri": transcriptFileUri,
        ":failureReason": failureReason,
        ":now": now
      }
    })
  );

  return {
    ...event,
    videoId,
    status,
    transcribeStatus,
    transcriptionJobName,
    transcriptFileUri,
    failureReason,
    checkedAt: now
  };
};
