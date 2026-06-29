import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { redactText } from "./redaction.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "VideoPost";
const DEFAULT_BUCKET_NAME = process.env.BUCKET_NAME;
const RESULT_PREFIX = process.env.RESULT_PREFIX || "video-transcription/results/";
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0";

const s3 = new S3Client({ region: REGION });
const translate = new TranslateClient({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function streamToString(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function parseS3KeyFromTranscriptUri(uri, bucketName) {
  if (!uri) return null;
  const parsed = new URL(uri);

  // Common Transcribe output format:
  // https://s3.us-east-1.amazonaws.com/bucket/key.json
  const path = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (path.startsWith(`${bucketName}/`)) {
    return path.slice(bucketName.length + 1);
  }

  // Virtual-hosted style fallback:
  // https://bucket.s3.us-east-1.amazonaws.com/key.json
  return path;
}

async function readTranscriptFromS3(bucketName, transcriptS3Key) {
  const object = await s3.send(
    new GetObjectCommand({ Bucket: bucketName, Key: transcriptS3Key })
  );
  const raw = await streamToString(object.Body);
  const parsed = JSON.parse(raw);
  return parsed?.results?.transcripts?.[0]?.transcript || "";
}

async function summarizeWithBedrock(redactedTranscript) {
  const prompt = `You are summarizing a redacted transcript for a demo media-processing pipeline.

Rules:
- Summarize only the non-sensitive content.
- Do not mention that a name, email, phone number, or other sensitive field was redacted.
- Do not repeat placeholders such as [NAME], [EMAIL], [PHONE], [SSN], or [CREDIT_CARD].
- Return 3 concise bullet points and one short one-sentence summary.

Transcript:
${redactedTranscript}`;

  const command = new ConverseCommand({
    modelId: BEDROCK_MODEL_ID,
    messages: [
      {
        role: "user",
        content: [{ text: prompt }]
      }
    ],
    inferenceConfig: {
      maxTokens: 500,
      temperature: 0.2,
      topP: 0.9
    }
  });

  const response = await bedrock.send(command);
  const content = response.output?.message?.content || [];
  const summary = content.map((item) => item.text || "").join("\n").trim();

  if (!summary) {
    throw new Error("Bedrock returned an empty summary");
  }

  return summary;
}

async function translateText(text, targetLanguageCode) {
  const result = await translate.send(
    new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: "en",
      TargetLanguageCode: targetLanguageCode
    })
  );
  return result.TranslatedText || "";
}

export const handler = async (event) => {
  console.log("ProcessTranscript input:", JSON.stringify(event));

  const videoId = event.videoId;
  if (!videoId) throw new Error("videoId is required");

  const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
  if (!existing.Item) throw new Error(`No DynamoDB job found for videoId ${videoId}`);

  const bucketName = existing.Item.bucketName || event.bucketName || DEFAULT_BUCKET_NAME;
  const transcriptFileUri = event.transcriptFileUri || existing.Item.transcriptFileUri;
  const transcriptS3Key = parseS3KeyFromTranscriptUri(transcriptFileUri, bucketName);

  if (!bucketName || !transcriptS3Key) {
    throw new Error("bucketName and transcriptS3Key are required");
  }

  const originalTranscript = await readTranscriptFromS3(bucketName, transcriptS3Key);
  const { redactedText, redactionLog } = redactText(originalTranscript);

  const [summary, hindi, marathi] = await Promise.all([
    summarizeWithBedrock(redactedText),
    translateText(redactedText, "hi"),
    translateText(redactedText, "mr")
  ]);

  const now = new Date().toISOString();
  const processedS3Key = `${RESULT_PREFIX}${videoId}/processed-output.json`;

  const output = {
    videoId,
    status: "PROCESSING_COMPLETED",
    transcript: {
      original: originalTranscript,
      redacted: redactedText,
      transcriptS3Key,
      transcriptFileUri
    },
    summary,
    translations: {
      en: redactedText,
      hi: hindi,
      mr: marathi
    },
    redactionLog,
    outputLocations: {
      processedS3Key
    },
    services: {
      transcription: "Amazon Transcribe",
      summarization: `Amazon Bedrock: ${BEDROCK_MODEL_ID}`,
      translation: "Amazon Translate",
      storage: "Amazon S3",
      jobTracking: "Amazon DynamoDB",
      orchestration: "AWS Step Functions"
    },
    processedAt: now
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: processedS3Key,
      Body: JSON.stringify(output, null, 2),
      ContentType: "application/json",
      ServerSideEncryption: "AES256"
    })
  );

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId },
      UpdateExpression:
        "SET #status = :status, processedS3Key = :processedS3Key, processedAt = :now, updatedAt = :now, summaryModel = :summaryModel",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "PROCESSING_COMPLETED",
        ":processedS3Key": processedS3Key,
        ":now": now,
        ":summaryModel": BEDROCK_MODEL_ID
      }
    })
  );

  return {
    ...event,
    videoId,
    status: "PROCESSING_COMPLETED",
    processedS3Key,
    summary,
    translations: output.translations,
    redactionLog,
    processedAt: now
  };
};
