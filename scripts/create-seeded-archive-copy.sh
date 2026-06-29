#!/usr/bin/env bash
set -euo pipefail

# Creates a seeded S3 archive by copying one existing seed object many times inside S3.
# This is for controlled scale testing. Do not run without a budget alert.

BUCKET_NAME="${BUCKET_NAME:-social-media-uploads-rujuta}"
SEED_KEY="${SEED_KEY:-video-transcription/archive-3tb/seed-0000.MOV}"
TARGET_PREFIX="${TARGET_PREFIX:-video-transcription/archive-3tb/}"
COPIES="${COPIES:-10}"

printf "Bucket: %s\nSeed key: %s\nTarget prefix: %s\nCopies: %s\n" "$BUCKET_NAME" "$SEED_KEY" "$TARGET_PREFIX" "$COPIES"
read -r -p "Continue with S3 server-side copies? Type YES: " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Cancelled."
  exit 1
fi

for i in $(seq -w 1 "$COPIES"); do
  target="${TARGET_PREFIX}seed-${i}.MOV"
  echo "Copying to s3://${BUCKET_NAME}/${target}"
  aws s3 cp "s3://${BUCKET_NAME}/${SEED_KEY}" "s3://${BUCKET_NAME}/${target}"
done

echo "Summary:"
aws s3 ls "s3://${BUCKET_NAME}/${TARGET_PREFIX}" --recursive --summarize --human-readable
